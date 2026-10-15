# c-noti

PR은 작을수록 리뷰가 잘 됩니다. c-noti는 **현재 브랜치가 base 브랜치 대비 몇 줄 바뀌었는지** 재고, 한도를 넘으면 알려줍니다.

- **Claude Code 플러그인**: 작업이 끝날 때마다 변경 요약을 보여주고, 한도를 넘는 순간 Claude에게 "여기서 PR을 끊자"고 알립니다.
- **CLI**: `npx c-noti`로 로컬, git hook, CI에서 같은 기준으로 검사합니다.

## 빠른 시작

```
/plugin marketplace add <github-user>/c-noti
/plugin install c-noti@c-noti
```

설치하면 바로 동작합니다. 설정 파일은 없어도 되고, 기준을 바꾸고 싶을 때만 `/c-noti:init`으로 만듭니다.

> 로컬 경로에서 설치: `/plugin marketplace add /path/to/c-noti`

## 언제 동작하나

| 시점 | 무엇이 | 누구에게 |
|---|---|---|
| Claude가 파일을 저장할 때마다 (Write/Edit) | 한도를 **넘는 순간에만** 경고 (OK→WARN, WARN→FAIL) | Claude |
| Claude의 답변이 끝날 때마다 | 이번 작업 변경 + 브랜치 누적 요약 박스 | 사용자 화면 |
| `git push` (선택, `install-hook`) | FAIL이면 push 차단 | 터미널 |
| CI (선택) | PR 변경량 리포트 / 실패 처리 | 파이프라인 |

- **커밋과 무관합니다.** 커밋 전에도 뜨며, 커밋 여부와 상관없이 숫자는 같습니다 (아래 "무엇을 세나").
- `git commit` 시점의 검사는 없습니다. 작업 중간 커밋을 막지 않도록 push 시점에만 검사합니다.
- IDE에서 직접 고친 내용은 그 순간 알림이 없고, 다음 Claude 작업 때 **브랜치 누적**에 반영됩니다 ("이번 작업"에는 포함되지 않음).

## 무엇을 세나

`git merge-base HEAD <base>` 이후의 모든 변경 — 커밋된 것 + staged + unstaged + **아직 `git add` 안 한 새 파일** — 의 추가/삭제 줄 수.

- base 브랜치에 나중에 들어간 커밋은 세지 않습니다 (merge-base 기준).
- rename은 이동으로 인식 (`-M`), 바이너리는 0줄.
- 기본 제외: lockfile, `dist/`, `build/`, 스냅샷, `*.min.js`, `*.map`, `*.generated.*` 등 + `.gitattributes`의 `linguist-generated` / `linguist-vendored`.
- 한도 비교 값은 설정의 `metric`에 따라 **추가+삭제**(기본) 또는 **추가만**입니다.

## 로컬 동작과 데이터 흐름

c-noti는 **Claude나 외부 API를 호출하지 않습니다.** 변경량 계산은 로컬 `git` 명령과 파일 읽기만으로 합니다 (번들의 의존 모듈: `node:child_process`, `node:fs`, `node:path`, `node:util` — 네트워크 모듈 없음).

| 기능 | Claude 호출 | 네트워크 | 비고 |
|---|---|---|---|
| 변경량 계산 (훅·CLI 공통) | 없음 | 없음 | 로컬 `git` + 파일 읽기 |
| 한도 초과 경고 (PostToolUse) | 추가 호출 없음 | — | 아래 참고 |
| 작업 종료 요약 박스 | 없음 | 없음 | 사용자 화면 표시용 |
| `/c-noti:size`, `/c-noti:init` | **Claude가 실행** | 있음 | 슬래시 명령은 Claude에게 보내는 요청 |
| CLI (`check`, `report` 등) | 없음 | `npx` 첫 실행 시 npm 다운로드만 | 설치 후 오프라인 동작 |
| pre-push, CI | 없음 | CI의 npm 다운로드만 | Claude Code 불필요 |

- **경고 문구는 진행 중인 대화의 컨텍스트로 들어갑니다.** 줄 수·영역 이름(`src/api` 등)·브랜치 이름이 포함되며, 원래 오가는 Claude Code 요청과 함께 전송됩니다. 별도 호출이 생기지는 않습니다.
- **`/c-noti:size`는 분할 계획을 위해 Claude가 `git diff`를 읽을 수 있습니다.** 일반적인 Claude Code 작업과 같은 수준으로 코드 내용이 전송됩니다.

**완전히 로컬에서만 쓰기** — Claude Code 없이 CLI만 사용:

```bash
npm i -D c-noti        # 한 번 설치하면 이후 네트워크 불필요
npx c-noti report
npx c-noti install-hook
```

## Claude Code 플러그인

### 작업 종료 요약

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

- **이번 작업**: 요청을 보낸 이후 바뀐 파일만. 아무것도 안 바꾼 답변에는 표시하지 않습니다.
- **브랜치 누적**: base 대비 전체. 진행바는 실패 한도 대비 비율입니다.

### 명령

| 명령 | 하는 일 |
|---|---|
| `/c-noti:size` | 상세 리포트 + Claude가 PR 분할 계획 제안 |
| `/c-noti:init` | 현재 저장소에 `.c-noti.json` 생성. 이미 있으면 빠진 키만 추가 (기존 값 유지) |

### 동작 원리

| 훅 | 하는 일 |
|---|---|
| `UserPromptSubmit` | 요청 시점의 작업 트리를 git tree 객체로 스냅샷 (임시 index 사용, 실제 staging은 건드리지 않음). 출력 없음 |
| `Stop` | 스냅샷 이후 바뀐 파일만 요약해 표시 |
| `PostToolUse` (`Write\|Edit\|MultiEdit\|NotebookEdit`) | 단계가 올라갈 때만 Claude에게 경고 |

- 훅은 플러그인 안에 들어 있어 **사용자의 `settings.json`이나 기존 훅을 수정하지 않고**, 기존 훅과 함께 실행됩니다.
- git 저장소가 아니거나 오류가 나면 조용히 통과합니다.
- 상태는 `.git/c-noti-state.json`, 스냅샷용 임시 index는 `.git/c-noti-index`에 저장합니다 (둘 다 c-noti 전용 파일).

## 설정

저장소 루트의 `.c-noti.json` 또는 `package.json`의 `"c-noti"` 키 (`.c-noti.json` 우선). 저장소별로 적용되며, 커밋하면 팀 전체가 같은 기준을 씁니다.

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

모든 키는 선택 사항이며, 빠진 키는 기본값을 씁니다.

| 키 | 값 | 기본값 | 설명 |
|---|---|---|---|
| `metric` | `"total"` | ✓ | 추가+삭제 줄 합계. 100줄을 고치면 −100 +100으로 200줄 |
| | `"added"` | | 추가 줄만. 삭제는 리뷰 부담이 작다고 보고 한도 계산에서 뺌. 리팩터링으로 많이 지우는 PR이 덜 걸림 |
| `warn` / `fail` | 0 이상 숫자 | 200 / 400 | 이 값을 **넘으면** 경고 / 실패 (`warn` ≤ `fail`이어야 함) |
| `maxFiles` | 0 이상 숫자 | 20 | 파일 수가 넘으면 최소 경고, 0이면 끔 |
| `exclude` | glob 문자열 배열 | `[]` | 기본 제외 목록에 **더할** 패턴 |
| `useDefaultExclude` | `true` / `false` | `true` | `false`면 기본 제외 목록(lockfile 등)을 쓰지 않음 |
| `includeUntracked` | `true` / `false` | `true` | `git add` 안 한 새 파일도 셀지 |
| `base` | 브랜치/ref 문자열 | 자동 탐지 | 비교 기준 |

기본 한도 200/400은 SmartBear/Cisco 코드 리뷰 사례 연구(한 번에 200–400 LOC 이상 리뷰 시 결함 발견 효율 저하)를 출발점으로 잡은 값입니다. 업계 표준이 아니므로 팀 상황에 맞게 조정하세요.

## CLI

```bash
npx c-noti               # 요약 한 줄. FAIL이면 exit 1
npx c-noti report        # 영역별·파일별 상세
npx c-noti init          # .c-noti.json 생성. 이미 있으면 빠진 키만 추가 (기존 값 유지)
npx c-noti install-hook  # pre-push 훅에 c-noti 검사 추가 (아래 참고)
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

CLI 옵션은 그 실행에만 적용되고, 플러그인 훅은 설정 파일만 읽습니다.

exit code: `0` OK/WARN · `1` FAIL (또는 `--strict` WARN) · `2` 설정/git 오류

## git hook / CI

**pre-push**: `npx c-noti install-hook`

- 기존 pre-push 훅이 있으면 내용을 그대로 두고, c-noti 검사를 shebang 바로 뒤에 삽입합니다 (기존 스크립트가 `exit`로 끝나도 실행되도록).
- 여러 번 실행해도 한 번만 들어갑니다. `core.hooksPath`(husky 등)를 존중합니다.

**CI**

- Bitbucket Pipelines: [`examples/bitbucket-pipelines.yml`](examples/bitbucket-pipelines.yml)
- GitHub Actions: [`examples/github-actions.yml`](examples/github-actions.yml)

merge-base 계산을 위해 shallow clone을 피하세요 (`depth: full` / `fetch-depth: 0`).

## 문제 해결

**요약 박스가 안 보임**

- 설치 직후 첫 답변에는 표시되지 않습니다 (비교할 스냅샷이 아직 없음).
- 그 답변에서 파일이 바뀌지 않았으면 표시하지 않습니다.
- 백그라운드 작업 알림 등으로 한 작업이 여러 번 끝나면, 요약은 변경이 있었던 첫 종료에만 나옵니다.
- `.git/c-noti-state.json`의 `runs`에 최근 훅 실행 20건이 남습니다. `emitted: false`이면 `note`에 이유(`no changes this turn`, `no baseline` 등)가 기록됩니다.

**숫자가 예상보다 큼**

- `main`에서 오래 갈라진 브랜치거나 base 탐지가 의도와 다를 수 있습니다. `npx c-noti report`의 `base` 표시를 확인하고, 필요하면 설정의 `base`로 지정하세요.
- 생성 코드·fixture 등은 `exclude`에 추가하세요.

**`main`에서 0줄로 나옴**

- base가 자기 자신이라 커밋되지 않은 변경만 셉니다. 작업 브랜치에서 사용하세요.

## 개발

```bash
npm install
npm test          # vitest (단위 + 임시 git 저장소 통합 테스트)
npm run typecheck
npm run build     # dist/cli.js + plugin/bin/c-noti.js (단일 파일 번들, 런타임 의존성 0)
```

`plugin/bin/c-noti.js`는 빌드 산출물이지만 플러그인 설치 시 필요하므로 커밋합니다. 소스 변경 후 반드시 `npm run build`.
