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
}

export interface HookResult {
  /** JSON to print on stdout, or undefined to stay silent. */
  stdout?: string;
}

/**
 * Claude Code hook handler, dispatched on `hook_event_name`:
 * - UserPromptSubmit: snapshot the working tree (silent)
 * - Stop: show the user what this turn changed + branch total
 * - PostToolUse (default): tell Claude when the branch escalates (ok→warn→fail)
 * Never throws: a broken size check must not disrupt the session.
 */
export function runHook(stdin: string, analyzeFn: (cwd: string) => Report = analyze): HookResult {
  try {
    const input = parseInput(stdin);
    const cwd = typeof input.cwd === "string" ? input.cwd : process.cwd();
    const root = repoRoot(cwd);
    const statePath = join(gitDir(root), STATE_FILE);
    const state = readState(statePath);

    let result: HookResult;
    switch (input.hook_event_name) {
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
    writeState(statePath, state);
    return result;
  } catch {
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
  if (!state.turnTree) return {}; // installed mid-turn: no baseline
  const tree = snapshotTree(root, dirname(statePath));
  if (tree === state.turnTree) return {};

  const report = analyzeFn(root);
  const { counted, excluded } = classify(root, diffTrees(root, state.turnTree, tree), report.config);
  state.turnTree = tree; // a repeated Stop in the same turn won't repeat the summary
  recordLevel(root, state, report);
  if (counted.length === 0 && excluded.length === 0) return {};

  return {
    stdout: JSON.stringify({
      systemMessage: formatTurnSummary({ files: counted, excludedCount: excluded.length }, report),
    }),
  };
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
    return { branches: s.branches ?? {}, ...(s.turnTree && { turnTree: s.turnTree }) };
  } catch {
    return { branches: {} };
  }
}

function writeState(path: string, state: State): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(state));
}
