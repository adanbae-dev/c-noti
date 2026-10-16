import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { analyze } from "../src/analyze.js";
import { runHook } from "../src/hook.js";

let repo: string;

const sh = (...args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8" });
const write = (path: string, lines: number, prefix = "line") => {
  const file = join(repo, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, Array.from({ length: lines }, (_, i) => `${prefix} ${i}`).join("\n") + "\n");
};

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "c-noti-"));
  sh("init", "-q", "-b", "main");
  sh("config", "user.email", "t@example.com");
  sh("config", "user.name", "t");
  sh("config", "commit.gpgsign", "false");
  write("src/core/a.ts", 50);
  sh("add", ".");
  sh("commit", "-qm", "init");
  sh("checkout", "-qb", "feature");
});

afterEach(() => rmSync(repo, { recursive: true, force: true }));

describe("analyze", () => {
  it("counts committed, unstaged and untracked changes against merge-base", () => {
    write("src/core/b.ts", 30);
    sh("add", ".");
    sh("commit", "-qm", "b");
    write("src/core/a.ts", 60); // +10 lines (first 50 identical)
    write("docs/new.md", 5); // untracked

    const r = analyze(repo);
    expect(r.base).toBe("main");
    expect(r.added).toBe(45);
    expect(r.deleted).toBe(0);
    expect(r.level).toBe("ok");
    expect(r.files.find((f) => f.path === "docs/new.md")?.untracked).toBe(true);
    expect(r.groups.map((g) => g.key)).toEqual(["src/core", "docs"]);
  });

  it("ignores changes already on main after the branch point", () => {
    sh("checkout", "-q", "main");
    write("src/core/main-only.ts", 500);
    sh("add", ".");
    sh("commit", "-qm", "main work");
    sh("checkout", "-q", "feature");
    write("src/core/c.ts", 10);

    expect(analyze(repo).size).toBe(10);
  });

  it("excludes lockfiles, default patterns, config patterns and linguist-generated files", () => {
    write("package-lock.json", 1000);
    write("dist/bundle.js", 1000);
    write("gen/api.ts", 1000);
    write("fixtures/big.json", 1000);
    writeFileSync(join(repo, ".gitattributes"), "gen/** linguist-generated\n");
    writeFileSync(join(repo, ".c-noti.json"), JSON.stringify({ exclude: ["fixtures/"] }));
    write("src/core/real.ts", 7);

    const r = analyze(repo);
    const counted = r.files.map((f) => f.path).sort();
    expect(counted).toEqual([".c-noti.json", ".gitattributes", "src/core/real.ts"]);
    expect(r.excluded.map((f) => f.excludedBy).sort()).toEqual(["dist/", "fixtures/", "gitattributes", "package-lock.json"]);
  });

  it("applies thresholds, metric and --no-untracked overrides", () => {
    sh("rm", "-q", "src/core/a.ts");
    write("src/core/new.ts", 30);

    expect(analyze(repo, { warn: 40, fail: 70 }).level).toBe("fail"); // 50 deleted + 30 added
    expect(analyze(repo, { warn: 40, fail: 70, metric: "added" }).level).toBe("ok");
    expect(analyze(repo, { includeUntracked: false }).added).toBe(0);
  });

  it("does not count a pure rename as a full rewrite", () => {
    sh("mv", "src/core/a.ts", "src/core/renamed.ts");
    const r = analyze(repo);
    expect(r.size).toBe(0);
    expect(r.files[0]).toMatchObject({ path: "src/core/renamed.ts", oldPath: "src/core/a.ts" });
  });

  it("fails clearly when base is unknown", () => {
    expect(() => analyze(repo, { base: "nope" })).toThrow(/찾을 수 없습니다/);
  });
});

describe("runHook", () => {
  const input = () => JSON.stringify({ cwd: repo, hook_event_name: "PostToolUse", tool_name: "Edit" });
  const cfg = (warn: number, fail: number) =>
    writeFileSync(join(repo, ".c-noti.json"), JSON.stringify({ warn, fail, exclude: [".c-noti.json"] }));

  it("is silent while under the limit", () => {
    cfg(20, 40);
    write("src/core/x.ts", 5);
    expect(runHook(input()).stdout).toBeUndefined();
  });

  it("notifies once per escalation, then again after dropping back", () => {
    cfg(20, 40);
    write("src/core/x.ts", 25);
    const warn = JSON.parse(runHook(input()).stdout!);
    expect(warn.hookSpecificOutput.hookEventName).toBe("PostToolUse");
    expect(warn.hookSpecificOutput.additionalContext).toContain("WARN");

    write("src/core/x.ts", 30);
    expect(runHook(input()).stdout).toBeUndefined(); // still warn → silent

    write("src/core/x.ts", 50);
    expect(JSON.parse(runHook(input()).stdout!).systemMessage).toContain("FAIL");

    write("src/core/x.ts", 1);
    expect(runHook(input()).stdout).toBeUndefined(); // dropped to ok
    write("src/core/x.ts", 25);
    expect(runHook(input()).stdout).toContain("WARN");
  });

  describe("SessionStart", () => {
    const start = () => runHook(JSON.stringify({ cwd: repo, hook_event_name: "SessionStart" }));

    it("is silent when the branch is within limits", () => {
      cfg(20, 40);
      write("src/core/x.ts", 5);
      expect(start().stdout).toBeUndefined();
    });

    it("re-tells a new session that the branch is already over a limit, even if an earlier session was warned", () => {
      cfg(20, 40);
      write("src/core/x.ts", 25);
      expect(runHook(input()).stdout).toContain("WARN"); // earlier session got the warning

      const out = JSON.parse(start().stdout!);
      expect(out.hookSpecificOutput.hookEventName).toBe("SessionStart");
      expect(out.hookSpecificOutput.additionalContext).toMatch(/^이 브랜치는 이미 PR 크기 한도를 넘은 상태/);
      expect(out.hookSpecificOutput.additionalContext).toContain("WARN");

      write("src/core/x.ts", 30);
      expect(runHook(input()).stdout).toBeUndefined(); // same level → PostToolUse stays quiet
    });
  });

  describe("turn summary (UserPromptSubmit → Stop)", () => {
    const ev = (name: string) => JSON.stringify({ cwd: repo, hook_event_name: name });

    it("summarizes only what changed during the turn, incl. new files", () => {
      write("src/core/before.ts", 100); // pre-existing branch work, not part of this turn
      expect(runHook(ev("UserPromptSubmit"))).toEqual({});

      write("src/core/a.ts", 55); // +5
      write("src/ui/new.tsx", 12); // new untracked file
      write("package-lock.json", 999); // excluded
      const msg: string = JSON.parse(runHook(ev("Stop")).stdout!).systemMessage;

      expect(msg).toContain("이번 작업   +17 −0 · 파일 2개");
      expect(msg).toContain("+12 −0  src/ui/new.tsx");
      expect(msg).not.toContain("before.ts");
      expect(msg).toContain("1개 제외");
      expect(msg).toMatch(/브랜치 누적 117 \/ 400줄/);
    });

    it("stays silent when the turn changed nothing, and does not repeat on a second Stop", () => {
      runHook(ev("UserPromptSubmit"));
      expect(runHook(ev("Stop")).stdout).toBeUndefined();

      write("src/core/x.ts", 3);
      expect(runHook(ev("Stop")).stdout).toBeDefined();
      expect(runHook(ev("Stop")).stdout).toBeUndefined();
    });

    it("stays silent without a baseline and leaves the real index untouched", () => {
      write("src/core/x.ts", 3);
      expect(runHook(ev("Stop")).stdout).toBeUndefined();
      runHook(ev("UserPromptSubmit"));
      expect(sh("status", "--porcelain")).toBe("?? src/\n".replace("src/", "src/core/x.ts"));
    });
  });

  it("never throws outside a git repo or on bad input", () => {
    const outside = mkdtempSync(join(tmpdir(), "c-noti-nogit-"));
    try {
      expect(runHook(JSON.stringify({ cwd: outside }))).toEqual({});
      // bad stdin falls back to process.cwd(), which may itself be a repo — only require no throw
      expect(() => runHook("not json")).not.toThrow();
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
