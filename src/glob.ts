// Minimal gitignore-style glob matcher (no dependencies).
// Supports `**`, `*`, `?`. A pattern without `/` matches at any depth.

export function globToRegExp(pattern: string): RegExp {
  let p = pattern.trim().replace(/^\.\//, "");
  if (p.startsWith("/")) p = p.slice(1);
  else if (!p.replace(/\/$/, "").includes("/")) p = `**/${p}`;
  if (p.endsWith("/")) p = `${p}**`;

  let re = "";
  for (let i = 0; i < p.length; i++) {
    const c = p[i]!;
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

/** Returns the first pattern that matches `path`, or undefined. */
export function createMatcher(patterns: readonly string[]): (path: string) => string | undefined {
  const compiled = patterns.map((p) => [p, globToRegExp(p)] as const);
  return (path) => compiled.find(([, re]) => re.test(path))?.[0];
}
