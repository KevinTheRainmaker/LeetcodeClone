# Lessons

- Phase2 전용 기능을 추가할 때는 `currentPhase() === "phase2"` 가드를 별도 함수로 분리해 Phase1 경로가 기존 함수로 바로 떨어지는지 먼저 확인한다.
- 새 실험 postfix를 추가하면 프론트 `resolveUserId`, Vercel 프록시 user id 정규화, judge-server `EXP_SUFFIXES`를 함께 갱신한다.
- 병렬 LLM 응답 비교 기능은 사용자 메시지를 히스토리에 push하기 전 기준 히스토리 스냅샷을 만들어 두 요청이 같은 이전 컨텍스트를 보도록 한다.
