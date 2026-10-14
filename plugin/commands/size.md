---
description: 현재 브랜치의 PR 변경량을 확인하고, 한도를 넘으면 PR 분할 계획을 제안
argument-hint: "[--base <ref>] [--warn <n>] [--fail <n>]"
allowed-tools: Bash(node ${CLAUDE_PLUGIN_ROOT}/bin/c-noti.js *)
---

다음 명령을 Bash로 실행해 현재 브랜치의 변경량 리포트를 확인하세요:

```
node ${CLAUDE_PLUGIN_ROOT}/bin/c-noti.js report $ARGUMENTS
```

그다음:

1. 결과의 첫 줄(OK / WARN / FAIL)과 핵심 수치를 한두 문장으로 요약하세요.
2. WARN 또는 FAIL이면, 리포트의 영역별 변경량과 실제 변경 내용(`git diff`)을 근거로 **PR 분할 계획**을 제안하세요.
   - 각 PR이 독립적으로 리뷰·머지 가능하도록 의존 순서대로 나열 (예: 리팩터링/준비 → 기능 → 정리)
   - 테스트는 대상 코드와 같은 PR에 묶기
   - PR별 예상 변경 줄 수를 함께 표시
3. 실제로 브랜치를 나누거나 커밋을 옮기는 작업은 사용자가 요청할 때만 하세요.
