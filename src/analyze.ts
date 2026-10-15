import { DEFAULT_EXCLUDE, loadConfig, validate, type Config } from "./config.js";
import { createMatcher } from "./glob.js";
import { detectBase, diffNumstat, generatedPaths, mergeBase, repoRoot, untrackedFiles, type RawChange } from "./git.js";

export type Level = "ok" | "warn" | "fail";

export interface FileChange extends RawChange {
  /** Why the file was left out of the count (pattern or "gitattributes"). */
  excludedBy?: string;
}

export interface Group {
  key: string;
  added: number;
  deleted: number;
  files: number;
}

export interface Report {
  root: string;
  base: string;
  mergeBase: string;
  config: Config;
  files: FileChange[];
  excluded: FileChange[];
  added: number;
  deleted: number;
  /** The value compared against thresholds (depends on config.metric). */
  size: number;
  level: Level;
  reasons: string[];
  groups: Group[];
}

export function analyze(cwd: string, overrides: Partial<Config> = {}): Report {
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
    groups: groupFiles(counted),
  };
}

export function classify(root: string, raw: RawChange[], config: Config) {
  const patterns = config.useDefaultExclude ? [...DEFAULT_EXCLUDE, ...config.exclude] : config.exclude;
  const match = createMatcher(patterns);
  const generated = generatedPaths(root, raw.map((c) => c.path));

  const counted: FileChange[] = [];
  const excluded: FileChange[] = [];
  for (const c of raw) {
    const by = match(c.path) ?? (generated.has(c.path) ? "gitattributes" : undefined);
    if (by) excluded.push({ ...c, excludedBy: by });
    else counted.push(c);
  }
  return { counted, excluded };
}

export function evaluate(
  size: number,
  fileCount: number,
  config: Pick<Config, "warn" | "fail" | "maxFiles">,
): { level: Level; reasons: string[] } {
  const reasons: string[] = [];
  let level: Level = "ok";
  if (size > config.fail) {
    level = "fail";
    reasons.push(`변경 ${size}줄 > 실패 한도 ${config.fail}줄`);
  } else if (size > config.warn) {
    level = "warn";
    reasons.push(`변경 ${size}줄 > 경고 한도 ${config.warn}줄`);
  }
  if (config.maxFiles > 0 && fileCount > config.maxFiles) {
    if (level === "ok") level = "warn";
    reasons.push(`파일 ${fileCount}개 > 한도 ${config.maxFiles}개`);
  }
  return { level, reasons };
}

const CONTAINER_DIRS = new Set(["src", "lib", "libs", "packages", "apps", "services", "modules", "app", "internal", "cmd"]);

/** Groups by top-level directory, going one level deeper for common container dirs (src/, packages/ …). */
export function groupKey(path: string): string {
  const parts = path.split("/");
  if (parts.length === 1) return "(root)";
  if (CONTAINER_DIRS.has(parts[0]!) && parts.length > 2) return `${parts[0]}/${parts[1]}`;
  return parts[0]!;
}

export function groupFiles(files: readonly RawChange[]): Group[] {
  const map = new Map<string, Group>();
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

function sum(files: readonly RawChange[], key: "added" | "deleted"): number {
  return files.reduce((n, f) => n + f[key], 0);
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}
