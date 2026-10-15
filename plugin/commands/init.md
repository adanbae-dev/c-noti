---
description: 현재 저장소에 c-noti 설정 파일(.c-noti.json) 생성. 이미 있으면 빠진 키만 추가하고 기존 값은 유지
allowed-tools: Bash(node ${CLAUDE_PLUGIN_ROOT}/bin/c-noti.js *)
---

다음 명령을 Bash로 실행하세요:

```
node ${CLAUDE_PLUGIN_ROOT}/bin/c-noti.js init
```

그다음:

1. 결과(생성 / 키 추가 / 변경 없음)와 파일 경로를 한 줄로 알려주세요.
2. 생성된 `.c-noti.json`의 현재 값을 보여주고, 각 키의 의미를 짧게 설명하세요.
   - `warn` / `fail`: 경고 / 실패 한도 (줄 수)
   - `maxFiles`: 파일 수 한도, 넘으면 최소 WARN (0이면 끔)
   - `metric`: `total`(추가+삭제) 또는 `added`(추가만)
   - `exclude`: 기본 제외 목록(lockfile·생성 코드 등)에 더할 glob 패턴
3. 값을 바꾸고 싶은지 물어보고, 사용자가 원할 때만 파일을 수정하세요.
4. 팀 전체에 같은 기준을 적용하려면 이 파일을 커밋하면 된다고 안내하세요. 커밋은 사용자가 요청할 때만 하세요.
