#!/usr/bin/env node

// src/cli.ts
import { chmodSync, existsSync as existsSync2, mkdirSync as mkdirSync2, readFileSync as readFileSync3, writeFileSync as writeFileSync2 } from "node:fs";
import { dirname as dirname2, join as join4, resolve } from "node:path";
import { parseArgs } from "node:util";

// src/config.ts
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
var DEFAULT_EXCLUDE = [
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lockb",
  "*.lock",
  "go.sum",
  "go.work.sum",
  "Package.resolved",
  "packages.lock.json",
  "gradle.lockfile",
  "__snapshots__/",
  "*.snap",
  "*.min.js",
  "*.min.css",
  "*.map",
  "dist/",
  "build/",
  // code generators
  "__generated__/",
  "*.generated.*",
  "*.g.dart",
  "*.freezed.dart",
  "*.mocks.dart",
  "*.gr.dart",
  "*.pb.go",
  "*_pb2.py",
  "*_pb.ts",
  // IDE project files
  "*.pbxproj"
];
var DEFAULT_CONFIG = {
  warn: 200,
  fail: 400,
  maxFiles: 20,
  metric: "total",
  exclude: [],
  useDefaultExclude: true,
  includeUntracked: true
};
var CONFIG_FILE = ".c-noti.json";
var ConfigError = class extends Error {
};
function loadConfig(root) {
  const raw = readRawConfig(root);
  return validate({ ...DEFAULT_CONFIG, ...raw });
}
function readRawConfig(root) {
  const file = join(root, CONFIG_FILE);
  if (existsSync(file)) return parseJson(file, readFileSync(file, "utf8"));
  const pkg = join(root, "package.json");
  if (existsSync(pkg)) {
    const parsed = parseJson(pkg, readFileSync(pkg, "utf8"));
    const section = parsed["c-noti"];
    if (section && typeof section === "object") return section;
  }
  return {};
}
function parseJson(file, text) {
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new ConfigError(`${file}: JSON \uAC1D\uCCB4\uC5EC\uC57C \uD569\uB2C8\uB2E4`);
    }
    return value;
  } catch (e) {
    if (e instanceof ConfigError) throw e;
    throw new ConfigError(`${file}: JSON \uD30C\uC2F1 \uC2E4\uD328 (${e.message})`);
  }
}
function validate(c) {
  const num = (k) => {
    const v = c[k];
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0) {
      throw new ConfigError(`\uC124\uC815 "${k}"\uB294 0 \uC774\uC0C1\uC758 \uC22B\uC790\uC5EC\uC57C \uD569\uB2C8\uB2E4 (\uD604\uC7AC: ${JSON.stringify(v)})`);
    }
    return v;
  };
  const bool = (k) => {
    if (typeof c[k] !== "boolean") throw new ConfigError(`\uC124\uC815 "${k}"\uB294 true/false \uC5EC\uC57C \uD569\uB2C8\uB2E4`);
    return c[k];
  };
  const warn = num("warn");
  const fail = num("fail");
  if (warn > fail) throw new ConfigError(`warn(${warn})\uC740 fail(${fail})\uBCF4\uB2E4 \uD074 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4`);
  if (c.metric !== "total" && c.metric !== "added") {
    throw new ConfigError(`\uC124\uC815 "metric"\uC740 "total" \uB610\uB294 "added" \uC5EC\uC57C \uD569\uB2C8\uB2E4`);
  }
  if (!Array.isArray(c.exclude) || !c.exclude.every((x) => typeof x === "string")) {
    throw new ConfigError(`\uC124\uC815 "exclude"\uB294 \uBB38\uC790\uC5F4 \uBC30\uC5F4\uC774\uC5B4\uC57C \uD569\uB2C8\uB2E4`);
  }
  if (c.base !== void 0 && typeof c.base !== "string") {
    throw new ConfigError(`\uC124\uC815 "base"\uB294 \uBB38\uC790\uC5F4\uC774\uC5B4\uC57C \uD569\uB2C8\uB2E4`);
  }
  return {
    base: c.base,
    warn,
    fail,
    maxFiles: num("maxFiles"),
    metric: c.metric,
    exclude: c.exclude,
    useDefaultExclude: bool("useDefaultExclude"),
    includeUntracked: bool("includeUntracked")
  };
}

// src/glob.ts
function globToRegExp(pattern) {
  let p = pattern.trim().replace(/^\.\//, "");
  if (p.startsWith("/")) p = p.slice(1);
  else if (!p.replace(/\/$/, "").includes("/")) p = `**/${p}`;
  if (p.endsWith("/")) p = `${p}**`;
  let re = "";
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === "*") {
      if (p[i + 1] === "*") {
        const atSegmentStart = i === 0 || p[i - 1] === "/";
        if (atSegmentStart && p[i + 2] === "/") {
          re += "(?:.*/)?";
          i += 2;
        } else {
          re += ".*";
          i += 1;
        }
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += "[^/]";
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${re}$`);
}
function createMatcher(patterns) {
  const compiled = patterns.map((p) => [p, globToRegExp(p)]);
  return (path) => compiled.find(([, re]) => re.test(path))?.[0];
}

// src/git.ts
import { execFileSync } from "node:child_process";
import { closeSync, copyFileSync, openSync, readSync, statSync } from "node:fs";
import { join as join2 } from "node:path";
var GitError = class extends Error {
};
function git(args, cwd, opts = {}) {
  try {
    return execFileSync("git", args, {
      cwd,
      input: opts.input,
      env: opts.env,
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
      stdio: ["pipe", "pipe", "pipe"]
    });
  } catch (e) {
    const err = e;
    const detail = (err.stderr || err.message).trim().split("\n")[0];
    throw new GitError(`git ${args[0]} \uC2E4\uD328: ${detail}`);
  }
}
function tryGit(args, cwd) {
  try {
    return git(args, cwd).trim() || void 0;
  } catch {
    return void 0;
  }
}
function repoRoot(cwd) {
  return git(["rev-parse", "--show-toplevel"], cwd).trim();
}
function gitDir(cwd) {
  return git(["rev-parse", "--absolute-git-dir"], cwd).trim();
}
function currentBranch(cwd) {
  return tryGit(["rev-parse", "--abbrev-ref", "HEAD"], cwd) ?? "HEAD";
}
var FALLBACK_BASES = ["origin/main", "origin/master", "main", "master", "origin/develop", "develop"];
function detectBase(cwd, configured) {
  if (configured) {
    if (refExists(cwd, configured)) return configured;
    throw new GitError(`base "${configured}"\uB97C \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4 (git fetch\uAC00 \uD544\uC694\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4)`);
  }
  const originHead = tryGit(["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"], cwd);
  const candidates = originHead ? [originHead, ...FALLBACK_BASES] : FALLBACK_BASES;
  const found = candidates.find((ref) => refExists(cwd, ref));
  if (!found) {
    throw new GitError(`base \uBE0C\uB79C\uCE58\uB97C \uCC3E\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4. --base \uC635\uC158\uC774\uB098 ${".c-noti.json"}\uC758 "base"\uB85C \uC9C0\uC815\uD558\uC138\uC694`);
  }
  return found;
}
function refExists(cwd, ref) {
  return tryGit(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], cwd) !== void 0;
}
function mergeBase(cwd, base) {
  const mb = tryGit(["merge-base", "HEAD", base], cwd);
  if (!mb) {
    throw new GitError(
      `HEAD\uC640 ${base}\uC758 \uACF5\uD1B5 \uC870\uC0C1\uC744 \uCC3E\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4 (\uCEE4\uBC0B\uC774 \uC5C6\uAC70\uB098 shallow clone\uC77C \uC218 \uC788\uC2B5\uB2C8\uB2E4. CI\uB77C\uBA74 fetch depth\uB97C \uB298\uB9AC\uC138\uC694)`
    );
  }
  return mb;
}
function diffNumstat(cwd, since) {
  return parseNumstatZ(git(["diff", "--numstat", "-z", "-M", "--no-ext-diff", since, "--"], cwd));
}
function parseNumstatZ(out) {
  const tokens = out.split("\0");
  const changes = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (!token) continue;
    const t1 = token.indexOf("	");
    const t2 = token.indexOf("	", t1 + 1);
    if (t1 < 0 || t2 < 0) continue;
    const a = token.slice(0, t1);
    const d = token.slice(t1 + 1, t2);
    const binary = a === "-" || d === "-";
    let path = token.slice(t2 + 1);
    let oldPath;
    if (path === "") {
      oldPath = tokens[++i];
      path = tokens[++i] ?? "";
    }
    changes.push({
      path,
      ...oldPath !== void 0 && { oldPath },
      added: binary ? 0 : Number(a),
      deleted: binary ? 0 : Number(d),
      binary,
      untracked: false
    });
  }
  return changes;
}
var MAX_UNTRACKED_BYTES = 5 * 1024 * 1024;
function untrackedFiles(root) {
  const out = git(["ls-files", "--others", "--exclude-standard", "-z"], root);
  return out.split("\0").filter(Boolean).map((path) => {
    const { lines, binary } = countLines(join2(root, path));
    return { path, added: lines, deleted: 0, binary, untracked: true };
  });
}
function countLines(file) {
  let size;
  try {
    const st = statSync(file);
    if (!st.isFile()) return { lines: 0, binary: true };
    size = st.size;
  } catch {
    return { lines: 0, binary: true };
  }
  if (size === 0) return { lines: 0, binary: false };
  if (size > MAX_UNTRACKED_BYTES) return { lines: 0, binary: true };
  const buf = Buffer.alloc(size);
  const fd = openSync(file, "r");
  try {
    readSync(fd, buf, 0, size, 0);
  } finally {
    closeSync(fd);
  }
  if (buf.subarray(0, 8e3).includes(0)) return { lines: 0, binary: true };
  let lines = 0;
  for (const b of buf) if (b === 10) lines++;
  if (buf[size - 1] !== 10) lines++;
  return { lines, binary: false };
}
function generatedPaths(root, paths) {
  if (paths.length === 0) return /* @__PURE__ */ new Set();
  const out = git(
    ["check-attr", "-z", "--stdin", "linguist-generated", "linguist-vendored"],
    root,
    { input: paths.join("\0") + "\0" }
  );
  const tokens = out.split("\0");
  const result = /* @__PURE__ */ new Set();
  for (let i = 0; i + 2 < tokens.length; i += 3) {
    const value = tokens[i + 2];
    if (value === "set" || value === "true") result.add(tokens[i]);
  }
  return result;
}
function snapshotTree(root, gitDirPath) {
  const index = join2(gitDirPath, "c-noti-index");
  try {
    copyFileSync(join2(gitDirPath, "index"), index);
  } catch {
  }
  const env = { ...process.env, GIT_INDEX_FILE: index };
  git(["add", "-A"], root, { env });
  return git(["write-tree"], root, { env }).trim();
}
function diffTrees(root, from, to) {
  return parseNumstatZ(git(["diff", "--numstat", "-z", "-M", "--no-ext-diff", from, to, "--"], root));
}

// src/analyze.ts
function analyze(cwd, overrides = {}) {
  const root = repoRoot(cwd);
  const config = validate({ ...loadConfig(root), ...stripUndefined(overrides) });
  const base = detectBase(root, config.base);
  const mb = mergeBase(root, base);
  const raw = diffNumstat(root, mb);
  if (config.includeUntracked) raw.push(...untrackedFiles(root));
  const { counted, excluded } = classify(root, raw, config);
  const added = sum(counted, "added");
  const deleted = sum(counted, "deleted");
  const size = config.metric === "added" ? added : added + deleted;
  const { level, reasons } = evaluate(size, counted.length, config);
  return {
    root,
    base,
    mergeBase: mb,
    config,
    files: counted.sort((a, b) => b.added + b.deleted - (a.added + a.deleted)),
    excluded,
    added,
    deleted,
    size,
    level,
    reasons,
    groups: groupFiles(counted)
  };
}
function classify(root, raw, config) {
  const patterns = config.useDefaultExclude ? [...DEFAULT_EXCLUDE, ...config.exclude] : config.exclude;
  const match = createMatcher(patterns);
  const generated = generatedPaths(root, raw.map((c) => c.path));
  const counted = [];
  const excluded = [];
  for (const c of raw) {
    const by = match(c.path) ?? (generated.has(c.path) ? "gitattributes" : void 0);
    if (by) excluded.push({ ...c, excludedBy: by });
    else counted.push(c);
  }
  return { counted, excluded };
}
function evaluate(size, fileCount, config) {
  const reasons = [];
  const label = config.metric === "added" ? "\uCD94\uAC00" : "\uBCC0\uACBD";
  let level = "ok";
  if (size > config.fail) {
    level = "fail";
    reasons.push(`${label} ${size}\uC904 > \uC2E4\uD328 \uD55C\uB3C4 ${config.fail}\uC904`);
  } else if (size > config.warn) {
    level = "warn";
    reasons.push(`${label} ${size}\uC904 > \uACBD\uACE0 \uD55C\uB3C4 ${config.warn}\uC904`);
  }
  if (config.maxFiles > 0 && fileCount > config.maxFiles) {
    if (level === "ok") level = "warn";
    reasons.push(`\uD30C\uC77C ${fileCount}\uAC1C > \uD55C\uB3C4 ${config.maxFiles}\uAC1C`);
  }
  return { level, reasons };
}
var CONTAINER_DIRS = /* @__PURE__ */ new Set(["src", "lib", "libs", "packages", "apps", "services", "modules", "app", "internal", "cmd"]);
function groupKey(path) {
  const parts = path.split("/");
  if (parts.length === 1) return "(root)";
  if (CONTAINER_DIRS.has(parts[0]) && parts.length > 2) return `${parts[0]}/${parts[1]}`;
  return parts[0];
}
function groupFiles(files) {
  const map = /* @__PURE__ */ new Map();
  for (const f of files) {
    const key = groupKey(f.path);
    const g = map.get(key) ?? { key, added: 0, deleted: 0, files: 0 };
    g.added += f.added;
    g.deleted += f.deleted;
    g.files += 1;
    map.set(key, g);
  }
  return [...map.values()].sort((a, b) => b.added + b.deleted - (a.added + a.deleted));
}
function sum(files, key) {
  return files.reduce((n, f) => n + f[key], 0);
}
function stripUndefined(o) {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== void 0));
}

// src/format.ts
var LABEL = { ok: "OK", warn: "WARN", fail: "FAIL" };
function formatSummary(r) {
  const metric = r.config.metric === "added" ? "\uCD94\uAC00" : "\uBCC0\uACBD";
  return `c-noti ${LABEL[r.level]}: ${metric} ${r.size}\uC904 (+${r.added} \u2212${r.deleted}), \uD30C\uC77C ${r.files.length}\uAC1C \xB7 base ${r.base} \xB7 \uD55C\uB3C4 ${r.config.warn}/${r.config.fail}\uC904`;
}
function formatReport(r, topFiles = 15) {
  const lines = [formatSummary(r)];
  if (r.reasons.length) lines.push(...r.reasons.map((x) => `  - ${x}`));
  if (r.groups.length) {
    lines.push("", "\uC601\uC5ED\uBCC4 \uBCC0\uACBD\uB7C9:");
    const width = Math.max(...r.groups.map((g) => g.key.length));
    for (const g of r.groups) {
      lines.push(`  ${g.key.padEnd(width)}  +${g.added} \u2212${g.deleted}  (${g.files}\uAC1C \uD30C\uC77C)`);
    }
  }
  if (r.files.length) {
    lines.push("", `\uD070 \uD30C\uC77C (\uC0C1\uC704 ${Math.min(topFiles, r.files.length)}\uAC1C):`);
    for (const f of r.files.slice(0, topFiles)) {
      const tag = f.untracked ? " [\uC0C8 \uD30C\uC77C]" : f.oldPath ? ` [\u2190 ${f.oldPath}]` : f.binary ? " [binary]" : "";
      lines.push(`  +${f.added} \u2212${f.deleted}  ${f.path}${tag}`);
    }
  }
  if (r.excluded.length) {
    const ex = r.excluded.reduce((n, f) => n + f.added + f.deleted, 0);
    lines.push("", `\uC81C\uC678\uB428: \uD30C\uC77C ${r.excluded.length}\uAC1C, ${ex}\uC904 (lockfile\xB7\uC0DD\uC131 \uCF54\uB4DC \uB4F1)`);
  }
  if (r.level !== "ok" && r.groups.length > 1) {
    lines.push("", "\uBD84\uD560 \uC81C\uC548: \uC704 \uC601\uC5ED \uB2E8\uC704\uB85C PR\uC744 \uB098\uB204\uB294 \uAC83\uC744 \uAC80\uD1A0\uD558\uC138\uC694. \uD14C\uC2A4\uD2B8\uB294 \uB300\uC0C1 \uCF54\uB4DC\uC640 \uAC19\uC740 PR\uC5D0 \uB450\uC138\uC694.");
  }
  return lines.join("\n");
}
var ICON = { ok: "\u2705 OK", warn: "\u26A0\uFE0F  WARN", fail: "\u26D4 FAIL" };
var RULE = "\u2501".repeat(44);
function progressBar(value, max, width = 10) {
  const ratio = max > 0 ? Math.min(value / max, 1) : 1;
  const filled = Math.round(ratio * width);
  return "\u2588".repeat(filled) + "\u2591".repeat(width - filled);
}
function formatTurnSummary(turn, r, maxFiles = 6) {
  const added = turn.files.reduce((n, f) => n + f.added, 0);
  const deleted = turn.files.reduce((n, f) => n + f.deleted, 0);
  const sorted = [...turn.files].sort((a, b) => b.added + b.deleted - (a.added + a.deleted));
  const pct = r.config.fail > 0 ? Math.round(r.size / r.config.fail * 100) : 0;
  const lines = [
    `\u2501\u2501 c-noti ${RULE}`,
    ` \uC774\uBC88 \uC791\uC5C5   +${added} \u2212${deleted} \xB7 \uD30C\uC77C ${turn.files.length}\uAC1C`,
    ...sorted.slice(0, maxFiles).map((f) => `     +${f.added} \u2212${f.deleted}  ${f.path}${f.binary ? " [binary]" : ""}`)
  ];
  if (sorted.length > maxFiles) lines.push(`     \u2026 \uC678 ${sorted.length - maxFiles}\uAC1C`);
  if (turn.excludedCount) lines.push(`     (lockfile\xB7\uC0DD\uC131 \uCF54\uB4DC \uB4F1 ${turn.excludedCount}\uAC1C \uC81C\uC678)`);
  lines.push(
    ` \uBE0C\uB79C\uCE58 \uB204\uC801 ${r.size} / ${r.config.fail}\uC904  ${progressBar(r.size, r.config.fail)} ${pct}%  ${ICON[r.level]}`,
    ...r.reasons.map((x) => `     ${x}`),
    `\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501${RULE}`
  );
  return lines.join("\n");
}
function formatHookContext(r) {
  const top = r.groups.slice(0, 5).map((g) => `${g.key} (+${g.added} \u2212${g.deleted})`).join(", ");
  const advice = r.level === "fail" ? "\uD604\uC7AC \uBE0C\uB79C\uCE58\uAC00 PR \uD558\uB098\uB85C \uB9AC\uBDF0\uD558\uAE30\uC5D0 \uB108\uBB34 \uD07D\uB2C8\uB2E4. \uC0C8 \uBC94\uC704\uC758 \uC791\uC5C5\uC744 \uB354 \uC9C4\uD589\uD558\uC9C0 \uB9D0\uACE0, \uC0AC\uC6A9\uC790\uC5D0\uAC8C \uC9C0\uAE08\uAE4C\uC9C0\uC758 \uBCC0\uACBD\uC744 \uCEE4\uBC0B/PR\uB85C \uB04A\uC744\uC9C0 \uBA3C\uC800 \uD655\uC778\uD558\uC138\uC694. \uAD00\uB828 \uC5C6\uB294 \uBCC0\uACBD\uC740 \uBCC4\uB3C4 \uBE0C\uB79C\uCE58\uB85C \uBD84\uB9AC\uB97C \uC81C\uC548\uD558\uC138\uC694." : "PR \uD06C\uAE30\uAC00 \uACBD\uACE0 \uD55C\uB3C4\uB97C \uB118\uC5C8\uC2B5\uB2C8\uB2E4. \uB0A8\uC740 \uC791\uC5C5\uC774 \uD06C\uB2E4\uBA74 \uC0AC\uC6A9\uC790\uC5D0\uAC8C \uD604\uC7AC \uB2E8\uC704\uB85C PR\uC744 \uB04A\uC744\uC9C0 \uC81C\uC548\uD558\uC138\uC694.";
  return [
    formatSummary(r),
    ...r.reasons.map((x) => `- ${x}`),
    top && `\uC601\uC5ED\uBCC4: ${top}`,
    advice,
    "\uC0C1\uC138 \uB0B4\uC5ED: /c-noti:size \uBA85\uB839\uC73C\uB85C \uD655\uC778\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4."
  ].filter(Boolean).join("\n");
}

// src/hook.ts
import { mkdirSync, readFileSync as readFileSync2, writeFileSync } from "node:fs";
import { dirname, join as join3 } from "node:path";
var RANK = { ok: 0, warn: 1, fail: 2 };
var STATE_FILE = "c-noti-state.json";
function runHook(stdin, analyzeFn = analyze) {
  let statePath;
  let state;
  const input = parseInput(stdin);
  const event = typeof input.hook_event_name === "string" ? input.hook_event_name : "PostToolUse";
  try {
    const cwd = typeof input.cwd === "string" ? input.cwd : process.cwd();
    const root = repoRoot(cwd);
    statePath = join3(gitDir(root), STATE_FILE);
    state = readState(statePath);
    let result;
    switch (event) {
      case "UserPromptSubmit":
        state.turnTree = snapshotTree(root, dirname(statePath));
        result = {};
        break;
      case "Stop":
        result = onStop(root, statePath, state, analyzeFn);
        break;
      default:
        result = onPostToolUse(root, state, analyzeFn);
    }
    recordRun(state, { event, emitted: result.stdout !== void 0, note: result.note });
    writeState(statePath, state);
    return result;
  } catch (e) {
    if (statePath && state) {
      recordRun(state, { event, emitted: false, note: `error: ${e.message}` });
      try {
        writeState(statePath, state);
      } catch {
      }
    }
    return {};
  }
}
function onPostToolUse(root, state, analyzeFn) {
  const report = analyzeFn(root);
  const prev = recordLevel(root, state, report);
  if (RANK[report.level] <= RANK[prev]) return {};
  return {
    stdout: JSON.stringify({
      systemMessage: formatSummary(report),
      hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: formatHookContext(report) }
    })
  };
}
function onStop(root, statePath, state, analyzeFn) {
  if (!state.turnTree) return { note: "no baseline (installed mid-turn)" };
  const tree = snapshotTree(root, dirname(statePath));
  if (tree === state.turnTree) return { note: "no changes this turn" };
  const report = analyzeFn(root);
  const { counted, excluded } = classify(root, diffTrees(root, state.turnTree, tree), report.config);
  state.turnTree = tree;
  recordLevel(root, state, report);
  if (counted.length === 0 && excluded.length === 0) return { note: "tree changed but no file diff" };
  return {
    stdout: JSON.stringify({
      systemMessage: formatTurnSummary({ files: counted, excludedCount: excluded.length }, report)
    })
  };
}
var MAX_RUNS = 20;
function recordRun(state, run) {
  const entry = { at: (/* @__PURE__ */ new Date()).toISOString(), ...run };
  state.runs = [...state.runs ?? [], entry].slice(-MAX_RUNS);
}
function recordLevel(root, state, report) {
  const branch = currentBranch(root);
  const prev = state.branches[branch]?.level ?? "ok";
  state.branches[branch] = { level: report.level, size: report.size };
  return prev;
}
function parseInput(stdin) {
  try {
    const v = JSON.parse(stdin || "{}");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}
function readState(path) {
  try {
    const s = JSON.parse(readFileSync2(path, "utf8"));
    const { lastRun: _legacy, ...rest } = s;
    return { ...rest, branches: rest.branches ?? {} };
  } catch {
    return { branches: {} };
  }
}
function writeState(path, state) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(state));
}

// src/install.ts
var HOOK_MARKER = "# c-noti pre-push";
var HOOK_BLOCK = `${HOOK_MARKER}
npx --yes c-noti check || exit 1
# c-noti end
`;
function mergePrePush(existing) {
  if (existing === void 0 || existing.trim() === "") return `#!/bin/sh
${HOOK_BLOCK}`;
  if (existing.includes(HOOK_MARKER)) return void 0;
  if (existing.startsWith("#!")) {
    const eol = existing.indexOf("\n");
    if (eol < 0) return `${existing}
${HOOK_BLOCK}`;
    return existing.slice(0, eol + 1) + HOOK_BLOCK + existing.slice(eol + 1);
  }
  return HOOK_BLOCK + existing;
}
function mergeConfig(existing, defaults) {
  const added = Object.keys(defaults).filter((k) => !(k in existing));
  const merged = { ...existing };
  for (const k of added) merged[k] = defaults[k];
  return { merged, added };
}

// src/cli.ts
var VERSION = "0.1.0";
var HELP = `c-noti ${VERSION} \u2014 PR \uBCC0\uACBD\uB7C9 \uCCB4\uD06C

\uC0AC\uC6A9\uBC95:
  c-noti [check]        \uC694\uC57D \uD55C \uC904 \uCD9C\uB825, \uC2E4\uD328 \uD55C\uB3C4 \uCD08\uACFC \uC2DC exit 1
  c-noti report         \uC601\uC5ED\uBCC4\xB7\uD30C\uC77C\uBCC4 \uC0C1\uC138\uC640 \uBD84\uD560 \uC81C\uC548
  c-noti init           ${CONFIG_FILE} \uC0DD\uC131 (\uC788\uC73C\uBA74 \uBE60\uC9C4 \uD0A4\uB9CC \uCD94\uAC00, \uAE30\uC874 \uAC12 \uC720\uC9C0)
  c-noti install-hook   git pre-push \uD6C5\uC5D0 c-noti \uAC80\uC0AC \uCD94\uAC00 (\uAE30\uC874 \uD6C5 \uB0B4\uC6A9 \uC720\uC9C0)
  c-noti hook           Claude Code \uD6C5 \uD578\uB4E4\uB7EC (stdin JSON)

\uC635\uC158:
  --base <ref>          \uBE44\uAD50 \uAE30\uC900 (\uAE30\uBCF8: origin/HEAD \u2192 main \u2192 master \u2192 develop \uC790\uB3D9 \uD0D0\uC9C0)
  --warn <n>            \uACBD\uACE0 \uD55C\uB3C4 (\uAE30\uBCF8 ${DEFAULT_CONFIG.warn})
  --fail <n>            \uC2E4\uD328 \uD55C\uB3C4 (\uAE30\uBCF8 ${DEFAULT_CONFIG.fail})
  --max-files <n>       \uD30C\uC77C \uC218 \uD55C\uB3C4, 0\uC774\uBA74 \uB054 (\uAE30\uBCF8 ${DEFAULT_CONFIG.maxFiles})
  --metric <m>          total(\uCD94\uAC00+\uC0AD\uC81C) | added(\uCD94\uAC00\uB9CC)
  --no-untracked        git add \uC548 \uB41C \uC0C8 \uD30C\uC77C \uC81C\uC678
  --strict              \uACBD\uACE0\uB3C4 exit 1
  --json                JSON \uCD9C\uB825
  --cwd <dir>           \uC2E4\uD589 \uB514\uB809\uD130\uB9AC
`;
async function main(argv) {
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
      version: { type: "boolean", short: "v" }
    }
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
      const overrides = {
        base: values.base,
        warn: toNumber("warn", values.warn),
        fail: toNumber("fail", values.fail),
        maxFiles: toNumber("max-files", values["max-files"]),
        metric: values.metric,
        includeUntracked: values["no-untracked"] ? false : void 0
      };
      const report = analyze(cwd, overrides);
      if (values.json) print(JSON.stringify(toJson(report), null, 2));
      else print(command === "report" ? formatReport(report) : formatSummary(report));
      if (report.level === "fail" || values.strict && report.level === "warn") return 1;
      if (command === "check" && !values.json && report.level !== "ok") {
        print("\uC790\uC138\uD788 \uBCF4\uB824\uBA74: c-noti report");
      }
      return 0;
    }
    default:
      printErr(`\uC54C \uC218 \uC5C6\uB294 \uBA85\uB839: ${command}

${HELP}`);
      return 2;
  }
}
function toJson(r) {
  const { config, root, ...rest } = r;
  return { ...rest, thresholds: { warn: config.warn, fail: config.fail, maxFiles: config.maxFiles, metric: config.metric } };
}
function toNumber(name, v) {
  if (v === void 0) return void 0;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new ConfigError(`--${name} \uAC12\uC774 \uC22B\uC790\uAC00 \uC544\uB2D9\uB2C8\uB2E4: ${v}`);
  return n;
}
function init(cwd) {
  const file = join4(repoRoot(cwd), CONFIG_FILE);
  const { warn, fail, maxFiles, metric, exclude } = DEFAULT_CONFIG;
  const defaults = { warn, fail, maxFiles, metric, exclude };
  if (!existsSync2(file)) {
    writeFileSync2(file, JSON.stringify(defaults, null, 2) + "\n");
    print(`\uC0DD\uC131: ${file}`);
    return 0;
  }
  let existing;
  try {
    existing = JSON.parse(readFileSync3(file, "utf8"));
  } catch (e) {
    throw new ConfigError(`${file}: JSON \uD30C\uC2F1 \uC2E4\uD328, \uD30C\uC77C\uC744 \uC218\uC815\uD558\uC9C0 \uC54A\uC558\uC2B5\uB2C8\uB2E4 (${e.message})`);
  }
  if (!existing || typeof existing !== "object" || Array.isArray(existing)) {
    throw new ConfigError(`${file}: JSON \uAC1D\uCCB4\uAC00 \uC544\uB2C8\uB77C \uC218\uC815\uD558\uC9C0 \uC54A\uC558\uC2B5\uB2C8\uB2E4`);
  }
  const { merged, added } = mergeConfig(existing, defaults);
  if (added.length === 0) {
    print(`\uBCC0\uACBD \uC5C6\uC74C: ${file} (\uBAA8\uB4E0 \uC124\uC815 \uD0A4\uAC00 \uC774\uBBF8 \uC788\uC74C)`);
    return 0;
  }
  writeFileSync2(file, JSON.stringify(merged, null, 2) + "\n");
  print(`\uCD94\uAC00: ${added.join(", ")} \u2192 ${file} (\uAE30\uC874 \uAC12 \uC720\uC9C0)`);
  return 0;
}
function installHook(cwd) {
  const root = repoRoot(cwd);
  const hooksDir = resolve(root, git(["rev-parse", "--git-path", "hooks"], root).trim());
  const file = join4(hooksDir, "pre-push");
  const existing = existsSync2(file) ? readFileSync3(file, "utf8") : void 0;
  const next = mergePrePush(existing);
  if (next === void 0) {
    print(`\uC774\uBBF8 \uC124\uCE58\uB428: ${file}`);
    return 0;
  }
  mkdirSync2(dirname2(file), { recursive: true });
  writeFileSync2(file, next);
  if (existing === void 0) chmodSync(file, 493);
  print(existing === void 0 ? `\uC124\uCE58: ${file}` : `\uCD94\uAC00: ${file} (\uAE30\uC874 \uD6C5 \uB0B4\uC6A9 \uC720\uC9C0, c-noti \uAC80\uC0AC\uB97C \uB9E8 \uC55E\uC5D0 \uC0BD\uC785)`);
  return 0;
}
function readStdin() {
  if (process.stdin.isTTY) return Promise.resolve("");
  return new Promise((res) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => data += c);
    process.stdin.on("end", () => res(data));
    process.stdin.on("error", () => res(data));
  });
}
function print(s) {
  process.stdout.write(s + "\n");
}
function printErr(s) {
  process.stderr.write(s + "\n");
}
main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (e) => {
    if (e instanceof GitError || e instanceof ConfigError || e.code?.startsWith("ERR_PARSE_ARGS")) {
      printErr(`c-noti: ${e.message}`);
    } else {
      printErr(`c-noti: \uC608\uC0C1\uCE58 \uBABB\uD55C \uC624\uB958
${e.stack ?? e}`);
    }
    process.exitCode = 2;
  }
);
