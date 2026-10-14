import type { Level, Report } from "./analyze.js";

const LABEL: Record<Level, string> = { ok: "OK", warn: "WARN", fail: "FAIL" };

export function formatSummary(r: Report): string {
  const metric = r.config.metric === "added" ? "추가" : "변경";
  return (
    `c-noti ${LABEL[r.level]}: ${metric} ${r.size}줄 (+${r.added} −${r.deleted}), 파일 ${r.files.length}개` +
    ` · base ${r.base} · 한도 ${r.config.warn}/${r.config.fail}줄`
  );
}

export function formatReport(r: Report, topFiles = 15): string {
  const lines = [formatSummary(r)];
  if (r.reasons.length) lines.push(...r.reasons.map((x) => `  - ${x}`));

  if (r.groups.length) {
    lines.push("", "영역별 변경량:");
    const width = Math.max(...r.groups.map((g) => g.key.length));
    for (const g of r.groups) {
      lines.push(`  ${g.key.padEnd(width)}  +${g.added} −${g.deleted}  (${g.files}개 파일)`);
    }
  }

  if (r.files.length) {
    lines.push("", `큰 파일 (상위 ${Math.min(topFiles, r.files.length)}개):`);
    for (const f of r.files.slice(0, topFiles)) {
      const tag = f.untracked ? " [새 파일]" : f.oldPath ? ` [← ${f.oldPath}]` : f.binary ? " [binary]" : "";
      lines.push(`  +${f.added} −${f.deleted}  ${f.path}${tag}`);
    }
  }

  if (r.excluded.length) {
    const ex = r.excluded.reduce((n, f) => n + f.added + f.deleted, 0);
    lines.push("", `제외됨: 파일 ${r.excluded.length}개, ${ex}줄 (lockfile·생성 코드 등)`);
  }

  if (r.level !== "ok" && r.groups.length > 1) {
    lines.push("", "분할 제안: 위 영역 단위로 PR을 나누는 것을 검토하세요. 테스트는 대상 코드와 같은 PR에 두세요.");
  }
  return lines.join("\n");
}

/** Message injected into Claude's context when the branch crosses a threshold. */
export function formatHookContext(r: Report): string {
  const top = r.groups
    .slice(0, 5)
    .map((g) => `${g.key} (+${g.added} −${g.deleted})`)
    .join(", ");
  const advice =
    r.level === "fail"
      ? "현재 브랜치가 PR 하나로 리뷰하기에 너무 큽니다. 새 범위의 작업을 더 진행하지 말고, 사용자에게 지금까지의 변경을 커밋/PR로 끊을지 먼저 확인하세요. 관련 없는 변경은 별도 브랜치로 분리를 제안하세요."
      : "PR 크기가 경고 한도를 넘었습니다. 남은 작업이 크다면 사용자에게 현재 단위로 PR을 끊을지 제안하세요.";
  return [
    formatSummary(r),
    ...r.reasons.map((x) => `- ${x}`),
    top && `영역별: ${top}`,
    advice,
    "상세 내역: /c-noti:size 명령으로 확인할 수 있습니다.",
  ]
    .filter(Boolean)
    .join("\n");
}
