import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { analyze, type Level, type Report } from "./analyze.js";
import { formatHookContext, formatSummary } from "./format.js";
import { currentBranch, gitDir } from "./git.js";

const RANK: Record<Level, number> = { ok: 0, warn: 1, fail: 2 };
const STATE_FILE = "c-noti-state.json";

type State = Record<string, { level: Level; size: number }>;

export interface HookResult {
  /** JSON to print on stdout, or undefined to stay silent. */
  stdout?: string;
}

/**
 * Claude Code PostToolUse handler.
 * Speaks up only when the branch escalates (ok→warn, warn→fail) so Claude isn't nagged on every edit.
 * Never throws: a broken size check must not disrupt editing.
 */
export function runHook(stdin: string, analyzeFn: (cwd: string) => Report = analyze): HookResult {
  try {
    const input = parseInput(stdin);
    const cwd = typeof input.cwd === "string" ? input.cwd : process.cwd();
    const report = analyzeFn(cwd);
    const statePath = join(gitDir(report.root), STATE_FILE);
    const branch = currentBranch(report.root);

    const state = readState(statePath);
    const prev = state[branch]?.level ?? "ok";
    state[branch] = { level: report.level, size: report.size };
    writeState(statePath, state);

    if (RANK[report.level] <= RANK[prev]) return {};
    return {
      stdout: JSON.stringify({
        systemMessage: formatSummary(report),
        hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: formatHookContext(report) },
      }),
    };
  } catch {
    return {};
  }
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
    return JSON.parse(readFileSync(path, "utf8")) as State;
  } catch {
    return {};
  }
}

function writeState(path: string, state: State): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(state));
}
