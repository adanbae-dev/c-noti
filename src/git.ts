import { execFileSync } from "node:child_process";
import { closeSync, copyFileSync, openSync, readSync, statSync } from "node:fs";
import { join } from "node:path";

export class GitError extends Error {}

export function git(args: string[], cwd: string, opts: { input?: string; env?: NodeJS.ProcessEnv } = {}): string {
  try {
    return execFileSync("git", args, {
      cwd,
      input: opts.input,
      env: opts.env,
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (e) {
    const err = e as { stderr?: string; message: string };
    const detail = (err.stderr || err.message).trim().split("\n")[0];
    throw new GitError(`git ${args[0]} 실패: ${detail}`);
  }
}

function tryGit(args: string[], cwd: string): string | undefined {
  try {
    return git(args, cwd).trim() || undefined;
  } catch {
    return undefined;
  }
}

export function repoRoot(cwd: string): string {
  return git(["rev-parse", "--show-toplevel"], cwd).trim();
}

export function gitDir(cwd: string): string {
  return git(["rev-parse", "--absolute-git-dir"], cwd).trim();
}

export function currentBranch(cwd: string): string {
  return tryGit(["rev-parse", "--abbrev-ref", "HEAD"], cwd) ?? "HEAD";
}

const FALLBACK_BASES = ["origin/main", "origin/master", "main", "master", "origin/develop", "develop"];

/** Resolves the ref to compare against. Throws if nothing usable is found. */
export function detectBase(cwd: string, configured?: string): string {
  if (configured) {
    if (refExists(cwd, configured)) return configured;
    throw new GitError(`base "${configured}"를 찾을 수 없습니다 (git fetch가 필요할 수 있습니다)`);
  }
  const originHead = tryGit(["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"], cwd);
  const candidates = originHead ? [originHead, ...FALLBACK_BASES] : FALLBACK_BASES;
  const found = candidates.find((ref) => refExists(cwd, ref));
  if (!found) {
    throw new GitError(`base 브랜치를 찾지 못했습니다. --base 옵션이나 ${".c-noti.json"}의 "base"로 지정하세요`);
  }
  return found;
}

function refExists(cwd: string, ref: string): boolean {
  return tryGit(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], cwd) !== undefined;
}

export function mergeBase(cwd: string, base: string): string {
  const mb = tryGit(["merge-base", "HEAD", base], cwd);
  if (!mb) {
    throw new GitError(
      `HEAD와 ${base}의 공통 조상을 찾지 못했습니다 (커밋이 없거나 shallow clone일 수 있습니다. CI라면 fetch depth를 늘리세요)`,
    );
  }
  return mb;
}

export interface RawChange {
  path: string;
  oldPath?: string;
  added: number;
  deleted: number;
  binary: boolean;
  untracked: boolean;
}

/** Tracked changes from `since` to the working tree (committed + staged + unstaged). */
export function diffNumstat(cwd: string, since: string): RawChange[] {
  return parseNumstatZ(git(["diff", "--numstat", "-z", "-M", "--no-ext-diff", since, "--"], cwd));
}

/**
 * Parses `git diff --numstat -z`.
 * Normal entry:  "A\tD\tpath\0"
 * Rename entry:  "A\tD\t\0old\0new\0"
 * Binary files report "-" for both counts.
 */
export function parseNumstatZ(out: string): RawChange[] {
  const tokens = out.split("\0");
  const changes: RawChange[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    if (!token) continue;
    const t1 = token.indexOf("\t");
    const t2 = token.indexOf("\t", t1 + 1);
    if (t1 < 0 || t2 < 0) continue;
    const a = token.slice(0, t1);
    const d = token.slice(t1 + 1, t2);
    const binary = a === "-" || d === "-";
    let path = token.slice(t2 + 1);
    let oldPath: string | undefined;
    if (path === "") {
      oldPath = tokens[++i];
      path = tokens[++i] ?? "";
    }
    changes.push({
      path,
      ...(oldPath !== undefined && { oldPath }),
      added: binary ? 0 : Number(a),
      deleted: binary ? 0 : Number(d),
      binary,
      untracked: false,
    });
  }
  return changes;
}

const MAX_UNTRACKED_BYTES = 5 * 1024 * 1024;

export function untrackedFiles(root: string): RawChange[] {
  const out = git(["ls-files", "--others", "--exclude-standard", "-z"], root);
  return out
    .split("\0")
    .filter(Boolean)
    .map((path) => {
      const { lines, binary } = countLines(join(root, path));
      return { path, added: lines, deleted: 0, binary, untracked: true };
    });
}

function countLines(file: string): { lines: number; binary: boolean } {
  let size: number;
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
  if (buf.subarray(0, 8000).includes(0)) return { lines: 0, binary: true };
  let lines = 0;
  for (const b of buf) if (b === 10) lines++;
  if (buf[size - 1] !== 10) lines++;
  return { lines, binary: false };
}

/** Paths marked `linguist-generated` or `linguist-vendored` in .gitattributes. */
export function generatedPaths(root: string, paths: readonly string[]): Set<string> {
  if (paths.length === 0) return new Set();
  const out = git(
    ["check-attr", "-z", "--stdin", "linguist-generated", "linguist-vendored"],
    root,
    { input: paths.join("\0") + "\0" },
  );
  const tokens = out.split("\0");
  const result = new Set<string>();
  for (let i = 0; i + 2 < tokens.length; i += 3) {
    const value = tokens[i + 2];
    if (value === "set" || value === "true") result.add(tokens[i]!);
  }
  return result;
}

/**
 * Writes the whole working tree (incl. untracked, minus ignored) as a tree object and returns its id.
 * Uses a private index file so the user's staging area is untouched.
 */
export function snapshotTree(root: string, gitDirPath: string): string {
  const index = join(gitDirPath, "c-noti-index");
  try {
    copyFileSync(join(gitDirPath, "index"), index); // start from the real index so `add` only rehashes changed files
  } catch {
    // no index yet (fresh repo) — git creates one
  }
  const env = { ...process.env, GIT_INDEX_FILE: index };
  git(["add", "-A"], root, { env });
  return git(["write-tree"], root, { env }).trim();
}

export function diffTrees(root: string, from: string, to: string): RawChange[] {
  return parseNumstatZ(git(["diff", "--numstat", "-z", "-M", "--no-ext-diff", from, to, "--"], root));
}
