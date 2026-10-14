import { describe, expect, it } from "vitest";
import { evaluate, groupFiles, groupKey } from "../src/analyze.js";
import { ConfigError, DEFAULT_CONFIG, validate } from "../src/config.js";
import { parseNumstatZ } from "../src/git.js";
import { createMatcher, globToRegExp } from "../src/glob.js";

describe("globToRegExp", () => {
  it.each([
    ["*.lock", "yarn.lock", true],
    ["*.lock", "a/b/Cargo.lock", true],
    ["dist/", "dist/index.js", true],
    ["dist/", "packages/x/dist/a/b.js", true],
    ["dist/", "distance.ts", false],
    ["src/*.ts", "src/a.ts", true],
    ["src/*.ts", "src/x/a.ts", false],
    ["src/**/*.ts", "src/a.ts", true],
    ["src/**/*.ts", "src/x/y/a.ts", true],
    ["/root.txt", "root.txt", true],
    ["/root.txt", "a/root.txt", false],
    ["*.generated.*", "api/client.generated.ts", true],
    ["fil?.md", "file.md", true],
    ["a.b", "axb", false],
  ])("%s vs %s → %s", (pattern, path, expected) => {
    expect(globToRegExp(pattern).test(path)).toBe(expected);
  });

  it("createMatcher returns the matching pattern", () => {
    const m = createMatcher(["*.snap", "dist/"]);
    expect(m("a/__x__/b.snap")).toBe("*.snap");
    expect(m("src/a.ts")).toBeUndefined();
  });
});

describe("parseNumstatZ", () => {
  it("parses normal, binary and rename entries", () => {
    const out = "3\t1\tsrc/a.ts\0-\t-\timg.png\0" + "2\t0\t\0old/name.ts\0new/name.ts\0" + "0\t5\twith\ttab.txt\0";
    expect(parseNumstatZ(out)).toEqual([
      { path: "src/a.ts", added: 3, deleted: 1, binary: false, untracked: false },
      { path: "img.png", added: 0, deleted: 0, binary: true, untracked: false },
      { path: "new/name.ts", oldPath: "old/name.ts", added: 2, deleted: 0, binary: false, untracked: false },
      { path: "with\ttab.txt", added: 0, deleted: 5, binary: false, untracked: false },
    ]);
  });

  it("handles empty output", () => {
    expect(parseNumstatZ("")).toEqual([]);
  });
});

describe("evaluate", () => {
  const cfg = { warn: 200, fail: 400, maxFiles: 10 };

  it("is ok at or below warn", () => {
    expect(evaluate(200, 3, cfg)).toEqual({ level: "ok", reasons: [] });
  });
  it("warns above warn", () => {
    expect(evaluate(201, 3, cfg).level).toBe("warn");
  });
  it("fails above fail", () => {
    expect(evaluate(401, 3, cfg).level).toBe("fail");
  });
  it("too many files raises ok to warn but keeps fail", () => {
    expect(evaluate(10, 11, cfg)).toMatchObject({ level: "warn" });
    expect(evaluate(500, 11, cfg).reasons).toHaveLength(2);
    expect(evaluate(500, 11, cfg).level).toBe("fail");
  });
  it("maxFiles 0 disables the file check", () => {
    expect(evaluate(10, 999, { ...cfg, maxFiles: 0 }).level).toBe("ok");
  });
});

describe("grouping", () => {
  it.each([
    ["README.md", "(root)"],
    ["docs/a.md", "docs"],
    ["src/auth/login.ts", "src/auth"],
    ["src/index.ts", "src"],
    ["packages/core/src/x.ts", "packages/core"],
  ])("%s → %s", (path, key) => {
    expect(groupKey(path)).toBe(key);
  });

  it("aggregates and sorts by size", () => {
    const f = (path: string, added: number) => ({ path, added, deleted: 0, binary: false, untracked: false });
    expect(groupFiles([f("docs/a.md", 5), f("src/a/x.ts", 10), f("src/a/y.ts", 10)])).toEqual([
      { key: "src/a", added: 20, deleted: 0, files: 2 },
      { key: "docs", added: 5, deleted: 0, files: 1 },
    ]);
  });
});

describe("validate", () => {
  it("accepts defaults", () => {
    expect(validate({ ...DEFAULT_CONFIG })).toEqual({ ...DEFAULT_CONFIG, base: undefined });
  });
  it.each([
    [{ warn: -1 }, /warn/],
    [{ warn: 500, fail: 100 }, /클 수 없습니다/],
    [{ metric: "lines" }, /metric/],
    [{ exclude: "dist" }, /exclude/],
  ])("rejects %o", (patch, msg) => {
    expect(() => validate({ ...DEFAULT_CONFIG, ...patch })).toThrow(ConfigError);
    expect(() => validate({ ...DEFAULT_CONFIG, ...patch })).toThrow(msg);
  });
});
