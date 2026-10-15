import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { analyze, classify, type Level, type Report } from "./analyze.js";
import { formatHookContext, formatSummary, formatTurnSummary } from "./format.js";
import { currentBranch, diffTrees, gitDir, repoRoot, snapshotTree } from "./git.js";

const RANK: Record<Level, number> = { ok: 0, warn: 1, fail: 2 };
const STATE_FILE = "c-noti-state.json";

interface State {
  branches: Record<string, { level: Level; size: number }>;
  /** Working-tree snapshot taken when the user submitted the current prompt. */
  turnTree?: string;
  /** Recent invocations (newest last), for diagnosing "hook ran but nothing showed up". */
  runs?: Run[];
}

interface Run {
  event: string;
  at: string;
  emitted: boolean;
  /** Why nothing was emitted, or the error message. */
  note?: string;
}

export interface HookResult {
  /** JSON to print on stdout, or undefined to stay silent. */
  stdout?: string;
  /** Why the hook stayed silent (diagnostics only). */
  note?: string;
}

/**
 * Claude Code hook handler, dispatched on `hook_event_name`:
 * - UserPromptSubmit: snapshot the working tree (silent)
 * - Stop: show the user what this turn changed + branch total
 * - PostToolUse (default): tell Claude when the branch escalates (ok→warn→fail)
 * Never throws: a broken size check must not disrupt the session.
 */
export function runHook(stdin: string, analyzeFn: (cwd: string) => Report = analyze): HookResult {
  let statePath: string | undefined;
  let state: State | undefined;
  const input = parseInput(stdin);
  const event = typeof input.hook_event_name === "string" ? input.hook_event_name : "PostToolUse";
  try {
    const cwd = typeof input.cwd === "string" ? input.cwd : process.cwd();
    const root = repoRoot(cwd);
    statePath = join(gitDir(root), STATE_FILE);
    state = readState(statePath);

    let result: HookResult;
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
    recordRun(state, { event, emitted: result.stdout !== undefined, note: result.note });
    writeState(statePath, state);
    return result;
  } catch (e) {
    if (statePath && state) {
      recordRun(state, { event, emitted: false, note: `error: ${(e as Error).message}` });
      try {
        writeState(statePath, state);
      } catch {
        // ignore
      }
    }
    return {};
  }
}

function onPostToolUse(root: string, state: State, analyzeFn: (cwd: string) => Report): HookResult {
  const report = analyzeFn(root);
  const prev = recordLevel(root, state, report);
  if (RANK[report.level] <= RANK[prev]) return {};
  return {
    stdout: JSON.stringify({
      systemMessage: formatSummary(report),
      hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: formatHookContext(report) },
    }),
  };
}

function onStop(root: string, statePath: string, state: State, analyzeFn: (cwd: string) => Report): HookResult {
  if (!state.turnTree) return { note: "no baseline (installed mid-turn)" };
  const tree = snapshotTree(root, dirname(statePath));
  if (tree === state.turnTree) return { note: "no changes this turn" };

  const report = analyzeFn(root);
  const { counted, excluded } = classify(root, diffTrees(root, state.turnTree, tree), report.config);
  state.turnTree = tree; // a repeated Stop in the same turn won't repeat the summary
  recordLevel(root, state, report);
  if (counted.length === 0 && excluded.length === 0) return { note: "tree changed but no file diff" };

  return {
    stdout: JSON.stringify({
      systemMessage: formatTurnSummary({ files: counted, excludedCount: excluded.length }, report),
    }),
  };
}

const MAX_RUNS = 20;

function recordRun(state: State, run: Omit<Run, "at">): void {
  const entry: Run = { at: new Date().toISOString(), ...run };
  state.runs = [...(state.runs ?? []), entry].slice(-MAX_RUNS);
}

/** Stores the branch's current level and returns the previous one. */
function recordLevel(root: string, state: State, report: Report): Level {
  const branch = currentBranch(root);
  const prev = state.branches[branch]?.level ?? "ok";
  state.branches[branch] = { level: report.level, size: report.size };
  return prev;
}

function parseInput(stdin: string): Record<string, unknown> {
  try {
    const v: unknown = JSON.parse(stdin || "{}");
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function readState(path: string): State {
  try {
    const s = JSON.parse(readFileSync(path, "utf8")) as Partial<State>;
    const { lastRun: _legacy, ...rest } = s as Partial<State> & { lastRun?: unknown };
    return { ...rest, branches: rest.branches ?? {} };
  } catch {
    return { branches: {} };
  }
}

function writeState(path: string, state: State): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(state));
}
