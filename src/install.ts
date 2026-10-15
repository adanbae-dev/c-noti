// Additive installers: never overwrite what the user already has.

export const HOOK_MARKER = "# c-noti pre-push";
const HOOK_BLOCK = `${HOOK_MARKER}\nnpx --yes c-noti check || exit 1\n# c-noti end\n`;

/**
 * Returns the pre-push script with the c-noti block added, or undefined if it is already there.
 * The block goes right after the shebang so it runs even when the existing script ends with `exit`/`exec`.
 */
export function mergePrePush(existing: string | undefined): string | undefined {
  if (existing === undefined || existing.trim() === "") return `#!/bin/sh\n${HOOK_BLOCK}`;
  if (existing.includes(HOOK_MARKER)) return undefined;
  if (existing.startsWith("#!")) {
    const eol = existing.indexOf("\n");
    if (eol < 0) return `${existing}\n${HOOK_BLOCK}`;
    return existing.slice(0, eol + 1) + HOOK_BLOCK + existing.slice(eol + 1);
  }
  return HOOK_BLOCK + existing;
}

/** Adds missing keys from `defaults`; existing values (even "wrong" ones) are kept as-is. */
export function mergeConfig(
  existing: Record<string, unknown>,
  defaults: Record<string, unknown>,
): { merged: Record<string, unknown>; added: string[] } {
  const added = Object.keys(defaults).filter((k) => !(k in existing));
  const merged = { ...existing };
  for (const k of added) merged[k] = defaults[k];
  return { merged, added };
}
