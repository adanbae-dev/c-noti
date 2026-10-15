import { describe, expect, it } from "vitest";
import { HOOK_MARKER, mergeConfig, mergePrePush } from "../src/install.js";

describe("mergePrePush", () => {
  it("creates a fresh script when none exists", () => {
    const out = mergePrePush(undefined)!;
    expect(out.startsWith("#!/bin/sh\n")).toBe(true);
    expect(out).toContain("npx --yes c-noti check || exit 1");
  });

  it("inserts after the shebang and keeps every existing line", () => {
    const existing = "#!/usr/bin/env bash\nnpm run lint\nexec ./other-hook\n";
    const out = mergePrePush(existing)!;
    expect(out.startsWith("#!/usr/bin/env bash\n" + HOOK_MARKER)).toBe(true);
    expect(out.endsWith("npm run lint\nexec ./other-hook\n")).toBe(true);
  });

  it("prepends when there is no shebang", () => {
    expect(mergePrePush("echo hi\n")!.endsWith("echo hi\n")).toBe(true);
  });

  it("is idempotent", () => {
    const once = mergePrePush("#!/bin/sh\necho hi\n")!;
    expect(mergePrePush(once)).toBeUndefined();
  });
});

describe("mergeConfig", () => {
  it("adds only missing keys and never changes existing values", () => {
    const { merged, added } = mergeConfig({ warn: 999, base: "develop" }, { warn: 200, fail: 400 });
    expect(merged).toEqual({ warn: 999, base: "develop", fail: 400 });
    expect(added).toEqual(["fail"]);
  });

  it("reports nothing added when complete", () => {
    expect(mergeConfig({ warn: 1, fail: 2 }, { warn: 200, fail: 400 }).added).toEqual([]);
  });
});
