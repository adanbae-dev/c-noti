import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type Metric = "total" | "added";

export interface Config {
  /** Base branch/ref to compare against. Auto-detected when omitted. */
  base?: string;
  /** Changed lines above this → warn. */
  warn: number;
  /** Changed lines above this → fail. */
  fail: number;
  /** Changed files above this → at least warn. 0 disables. */
  maxFiles: number;
  /** `total` = added + deleted, `added` = added only. */
  metric: Metric;
  /** Extra glob patterns excluded from counting (appended to defaults). */
  exclude: string[];
  /** Set false to drop the built-in exclude list. */
  useDefaultExclude: boolean;
  /** Count untracked (new, not yet `git add`ed) files. */
  includeUntracked: boolean;
}

export const DEFAULT_EXCLUDE: readonly string[] = [
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lockb",
  "*.lock",
  "go.sum",
  "__snapshots__/",
  "*.snap",
  "*.min.js",
  "*.min.css",
  "*.map",
  "dist/",
  "build/",
  "*.generated.*",
  "*.g.dart",
  "*.pb.go",
];

export const DEFAULT_CONFIG: Config = {
  warn: 200,
  fail: 400,
  maxFiles: 20,
  metric: "total",
  exclude: [],
  useDefaultExclude: true,
  includeUntracked: true,
};

export const CONFIG_FILE = ".c-noti.json";

export class ConfigError extends Error {}

export function loadConfig(root: string): Config {
  const raw = readRawConfig(root);
  return validate({ ...DEFAULT_CONFIG, ...raw });
}

function readRawConfig(root: string): Record<string, unknown> {
  const file = join(root, CONFIG_FILE);
  if (existsSync(file)) return parseJson(file, readFileSync(file, "utf8"));

  const pkg = join(root, "package.json");
  if (existsSync(pkg)) {
    const parsed = parseJson(pkg, readFileSync(pkg, "utf8"));
    const section = parsed["c-noti"];
    if (section && typeof section === "object") return section as Record<string, unknown>;
  }
  return {};
}

function parseJson(file: string, text: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new ConfigError(`${file}: JSON 객체여야 합니다`);
    }
    return value as Record<string, unknown>;
  } catch (e) {
    if (e instanceof ConfigError) throw e;
    throw new ConfigError(`${file}: JSON 파싱 실패 (${(e as Error).message})`);
  }
}

export function validate(c: Record<string, unknown>): Config {
  const num = (k: string) => {
    const v = c[k];
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0) {
      throw new ConfigError(`설정 "${k}"는 0 이상의 숫자여야 합니다 (현재: ${JSON.stringify(v)})`);
    }
    return v;
  };
  const bool = (k: string) => {
    if (typeof c[k] !== "boolean") throw new ConfigError(`설정 "${k}"는 true/false 여야 합니다`);
    return c[k] as boolean;
  };

  const warn = num("warn");
  const fail = num("fail");
  if (warn > fail) throw new ConfigError(`warn(${warn})은 fail(${fail})보다 클 수 없습니다`);

  if (c.metric !== "total" && c.metric !== "added") {
    throw new ConfigError(`설정 "metric"은 "total" 또는 "added" 여야 합니다`);
  }
  if (!Array.isArray(c.exclude) || !c.exclude.every((x) => typeof x === "string")) {
    throw new ConfigError(`설정 "exclude"는 문자열 배열이어야 합니다`);
  }
  if (c.base !== undefined && typeof c.base !== "string") {
    throw new ConfigError(`설정 "base"는 문자열이어야 합니다`);
  }

  return {
    base: c.base as string | undefined,
    warn,
    fail,
    maxFiles: num("maxFiles"),
    metric: c.metric,
    exclude: c.exclude as string[],
    useDefaultExclude: bool("useDefaultExclude"),
    includeUntracked: bool("includeUntracked"),
  };
}
