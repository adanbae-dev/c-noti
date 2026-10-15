# c-noti

PR은 작을수록 리뷰가 잘 됩니다. c-noti는 **현재 브랜치가 base 브랜치 대비 몇 줄 바뀌었는지** 재고, 한도를 넘으면 알려줍니다.

- **Claude Code 플러그인**
  - 작업이 끝날 때마다 **이번 작업에서 바뀐 내용 + 브랜치 누적**을 요약해 보여줍니다.
  - 코드를 수정하다 경고/실패 단계로 **넘어가는 순간에만** Claude에게 "여기서 PR을 끊자"는 컨텍스트를 넣습니다.
- **CLI**: `npx c-noti`로 로컬, git hook, CI에서 동일하게 사용.

## 무엇을 세나

`git merge-base HEAD <base>` 이후의 모든 변경 — 커밋된 것 + staged + unstaged + **아직 `git add` 안 한 새 파일** — 의 추가/삭제 줄 수.

- base 브랜치에 나중에 들어간 커밋은 세지 않습니다 (merge-base 기준).
- rename은 이동으로 인식 (`-M`), 바이너리는 0줄.
- 기본 제외: lockfile, `dist/`, `build/`, 스냅샷, `*.min.js`, `*.map`, `*.generated.*` 등 + `.gitattributes`의 `linguist-generated` / `linguist-vendored`.

## Claude Code 플러그인 설치

```
/plugin marketplace add <github-user>/c-noti
/plugin install c-noti@c-noti
```

| 훅 | 하는 일 |
|---|---|
| `UserPromptSubmit` | 요청 시점의 작업 트리를 git tree 객체로 스냅샷 (임시 index 사용, 실제 staging은 건드리지 않음). 출력 없음 |
| `Stop` | 스냅샷 이후 바뀐 파일만 요약해 표시. 바뀐 게 없으면 출력 없음 |
| `PostToolUse` (`Write\|Edit\|MultiEdit\|NotebookEdit`) | 단계가 올라갈 때만 Claude에게 경고 |

작업 종료 요약 예시:

```
━━ c-noti ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 이번 작업   +93 −0 · 파일 3개
     +60 −0  src/ui/Button.tsx
     +25 −0  src/api/a.ts
     +8 −0  src/ui/Button.test.tsx
     (lockfile·생성 코드 등 1개 제외)
 브랜치 누적 273 / 400줄  ███████░░░ 68%  ⚠️  WARN
     변경 273줄 > 경고 한도 200줄
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

- 훅은 플러그인 안에 들어 있어 **사용자의 `settings.json`이나 기존 훅을 수정하지 않고**, 기존 훅과 함께 실행됩니다.
- git 저장소가 아니거나 오류가 나면 조용히 통과합니다.
- 명령: `/c-noti:size` — 상세 리포트 + Claude가 PR 분할 계획 제안.
- 상태는 `.git/c-noti-state.json`, 스냅샷용 임시 index는 `.git/c-noti-index`에 저장합니다 (둘 다 c-noti 전용 파일).

## CLI

```bash
npx c-noti               # 요약 한 줄. FAIL이면 exit 1
npx c-noti report        # 영역별·파일별 상세
npx c-noti init          # .c-noti.json 생성. 이미 있으면 빠진 키만 추가 (기존 값 유지)
npx c-noti install-hook  # pre-push 훅에 c-noti 검사 추가. 기존 훅 내용은 그대로 두고 맨 앞에 삽입 (core.hooksPath 존중)
```

| 옵션 | 설명 |
|---|---|
| `--base <ref>` | 비교 기준. 기본: `origin/HEAD` → `origin/main` → `origin/master` → `main` → `master` → `develop` |
| `--warn <n>` / `--fail <n>` | 한도 (기본 200 / 400) |
| `--max-files <n>` | 파일 수 한도, 넘으면 최소 WARN. 0이면 끔 (기본 20) |
| `--metric total\|added` | 추가+삭제 / 추가만 |
| `--no-untracked` | 새 파일(untracked) 제외 |
| `--strict` | WARN도 exit 1 |
| `--json` | JSON 출력 |

exit code: `0` OK/WARN · `1` FAIL (또는 `--strict` WARN) · `2` 설정/git 오류

## 설정

`.c-noti.json` 또는 `package.json`의 `"c-noti"` 키:

```json
{
  "base": "develop",
  "warn": 200,
  "fail": 400,
  "maxFiles": 20,
  "metric": "total",
  "exclude": ["fixtures/", "**/*.sql"],
  "useDefaultExclude": true,
  "includeUntracked": true
}
```

기본 한도 200/400은 SmartBear/Cisco 코드 리뷰 사례 연구(한 번에 200–400 LOC 이상 리뷰 시 결함 발견 효율 저하)를 출발점으로 잡은 값입니다. 팀 상황에 맞게 조정하세요.

## CI

- Bitbucket Pipelines: [`examples/bitbucket-pipelines.yml`](examples/bitbucket-pipelines.yml)
- GitHub Actions: [`examples/github-actions.yml`](examples/github-actions.yml)

merge-base 계산을 위해 shallow clone을 피하세요 (`depth: full` / `fetch-depth: 0`).

## 개발

```bash
npm install
npm test          # vitest (단위 + 임시 git 저장소 통합 테스트)
npm run typecheck
npm run build     # dist/cli.js + plugin/bin/c-noti.js (단일 파일 번들, 런타임 의존성 0)
```

`plugin/bin/c-noti.js`는 빌드 산출물이지만 플러그인 설치 시 필요하므로 커밋합니다. 소스 변경 후 반드시 `npm run build`.
