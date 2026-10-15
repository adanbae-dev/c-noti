import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { analyze, type Report } from "./analyze.js";
import { CONFIG_FILE, ConfigError, DEFAULT_CONFIG, type Config, type Metric } from "./config.js";
import { formatReport, formatSummary } from "./format.js";
import { git, GitError, repoRoot } from "./git.js";
import { runHook } from "./hook.js";
import { mergeConfig, mergePrePush } from "./install.js";

const VERSION = "0.1.0";

const HELP = `c-noti ${VERSION} — PR 변경량 체크

사용법:
  c-noti [check]        요약 한 줄 출력, 실패 한도 초과 시 exit 1
  c-noti report         영역별·파일별 상세와 분할 제안
  c-noti init           ${CONFIG_FILE} 생성 (있으면 빠진 키만 추가, 기존 값 유지)
  c-noti install-hook   git pre-push 훅에 c-noti 검사 추가 (기존 훅 내용 유지)
  c-noti hook           Claude Code 훅 핸들러 (stdin JSON)

옵션:
  --base <ref>          비교 기준 (기본: origin/HEAD → main → master → develop 자동 탐지)
  --warn <n>            경고 한도 (기본 ${DEFAULT_CONFIG.warn})
  --fail <n>            실패 한도 (기본 ${DEFAULT_CONFIG.fail})
  --max-files <n>       파일 수 한도, 0이면 끔 (기본 ${DEFAULT_CONFIG.maxFiles})
  --metric <m>          total(추가+삭제) | added(추가만)
  --no-untracked        git add 안 된 새 파일 제외
  --strict              경고도 exit 1
  --json                JSON 출력
  --cwd <dir>           실행 디렉터리
`;

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      base: { type: "string" },
      warn: { type: "string" },
      fail: { type: "string" },
      "max-files": { type: "string" },
      metric: { type: "string" },
      "no-untracked": { type: "boolean" },
      strict: { type: "boolean" },
      json: { type: "boolean" },
      cwd: { type: "string" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
    },
  });

  if (values.help) return print(HELP), 0;
  if (values.version) return print(VERSION), 0;

  const command = positionals[0] ?? "check";
  const cwd = resolve(values.cwd ?? process.cwd());

  switch (command) {
    case "hook": {
      const result = runHook(await readStdin());
      if (result.stdout) print(result.stdout);
      return 0;
    }
    case "init":
      return init(cwd);
    case "install-hook":
      return installHook(cwd);
    case "check":
    case "report": {
      const overrides: Partial<Config> = {
        base: values.base,
        warn: toNumber("warn", values.warn),
        fail: toNumber("fail", values.fail),
        maxFiles: toNumber("max-files", values["max-files"]),
        metric: values.metric as Metric | undefined,
        includeUntracked: values["no-untracked"] ? false : undefined,
      };
      const report = analyze(cwd, overrides);
      if (values.json) print(JSON.stringify(toJson(report), null, 2));
      else print(command === "report" ? formatReport(report) : formatSummary(report));
      if (report.level === "fail" || (values.strict && report.level === "warn")) return 1;
      if (command === "check" && !values.json && report.level !== "ok") {
        print("자세히 보려면: c-noti report");
      }
      return 0;
    }
    default:
      printErr(`알 수 없는 명령: ${command}\n\n${HELP}`);
      return 2;
  }
}

function toJson(r: Report) {
  const { config, root, ...rest } = r;
  return { ...rest, thresholds: { warn: config.warn, fail: config.fail, maxFiles: config.maxFiles, metric: config.metric } };
}

function toNumber(name: string, v: string | undefined): number | undefined {
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new ConfigError(`--${name} 값이 숫자가 아닙니다: ${v}`);
  return n;
}

function init(cwd: string): number {
  const file = join(repoRoot(cwd), CONFIG_FILE);
  const { warn, fail, maxFiles, metric, exclude } = DEFAULT_CONFIG;
  const defaults = { warn, fail, maxFiles, metric, exclude };

  if (!existsSync(file)) {
    writeFileSync(file, JSON.stringify(defaults, null, 2) + "\n");
    print(`생성: ${file}`);
    return 0;
  }
  let existing: unknown;
  try {
    existing = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    throw new ConfigError(`${file}: JSON 파싱 실패, 파일을 수정하지 않았습니다 (${(e as Error).message})`);
  }
  if (!existing || typeof existing !== "object" || Array.isArray(existing)) {
    throw new ConfigError(`${file}: JSON 객체가 아니라 수정하지 않았습니다`);
  }
  const { merged, added } = mergeConfig(existing as Record<string, unknown>, defaults);
  if (added.length === 0) {
    print(`변경 없음: ${file} (모든 설정 키가 이미 있음)`);
    return 0;
  }
  writeFileSync(file, JSON.stringify(merged, null, 2) + "\n");
  print(`추가: ${added.join(", ")} → ${file} (기존 값 유지)`);
  return 0;
}

function installHook(cwd: string): number {
  const root = repoRoot(cwd);
  // --git-path respects core.hooksPath (husky etc.)
  const hooksDir = resolve(root, git(["rev-parse", "--git-path", "hooks"], root).trim());
  const file = join(hooksDir, "pre-push");
  const existing = existsSync(file) ? readFileSync(file, "utf8") : undefined;
  const next = mergePrePush(existing);
  if (next === undefined) {
    print(`이미 설치됨: ${file}`);
    return 0;
  }
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, next);
  if (existing === undefined) chmodSync(file, 0o755);
  print(existing === undefined ? `설치: ${file}` : `추가: ${file} (기존 훅 내용 유지, c-noti 검사를 맨 앞에 삽입)`);
  return 0;
}

function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return Promise.resolve("");
  return new Promise((res) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (data += c));
    process.stdin.on("end", () => res(data));
    process.stdin.on("error", () => res(data));
  });
}

function print(s: string) {
  process.stdout.write(s + "\n");
}
function printErr(s: string) {
  process.stderr.write(s + "\n");
}

// exitCode instead of process.exit(): stdout to a pipe is async on macOS and would be truncated.
main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (e: unknown) => {
    if (e instanceof GitError || e instanceof ConfigError || (e as { code?: string }).code?.startsWith("ERR_PARSE_ARGS")) {
      printErr(`c-noti: ${(e as Error).message}`);
    } else {
      printErr(`c-noti: 예상치 못한 오류\n${(e as Error).stack ?? e}`);
    }
    process.exitCode = 2;
  },
);
