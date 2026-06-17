# Phase2 컨디션 재설계: 자유 LLM(free) vs 계획 작성 필수(plan)

## 확정된 설계 (사용자 답변 기반)

- **Postfix 규칙**: `_fexp` → free(자유 LLM), `_pexp` → plan(계획 필수). 레거시 `_exp` → free로 매핑.
- **기존 explanation gate(Submit 시 코드 설명 게이트) 제거**, `phase2_modes.json` 배정 비활성화.
- **계획 폼**: AI 패널 처음 열 때 4문항 한 화면 폼, 일괄 제출, 문항별 관련성 피드백.
- 계획 4문항: ① 문제 한 문장 재설명 ② 핵심 입출력/제약 ③ 접근 방식 1–2개 ④ 예상 막힐 지점
- 검증: 각 응답이 질문과 **관련성 있는지만** LLM으로 체크 (무의미 응답 방지). API 실패 시 길이 기반 폴백.
- 계획 작성은 **문제당 1회**. 통과하면 해당 문제에서 LLM 해금 (localStorage 영속 → 새로고침 시 재요구 안 함).
- 타임스탬프 기록: `plan_gate_shown`(폼 노출), `plan_gate_submitted`(시도별), `plan_gate_unlocked`(해금, 소요시간 포함). 기존 logEvent → 서버 JSONL 경유.
- **배정 결과 별도 파일 기록**: judge-server `assignments/condition_assignments.jsonl` (신규 endpoint `POST /client/assignment` + Vercel 프록시 `api/assignment.js`).

## Todo

- [x] 1. app.js: resolveUserId 확장 (`_fexp`/`_pexp`/`_exp` → condition), state.planCondition 도입, phase2_modes 로딩 제거
- [x] 2. app.js: beginSession에서 배정 기록 전송 (recordAssignment)
- [x] 3. app.js: Submit 시 explanation gate 트리거 제거 (judge(), render() 내 gate 리셋)
- [x] 4. app.js: plan gate 구현 — openAI() 분기, 폼 렌더/제출/관련성 검증/해금/로깅
- [x] 5. index.html: AI 패널 내 계획 폼 마크업 추가
- [x] 6. styles.css: 계획 폼 스타일
- [x] 7. judge-server/main.py: AssignmentRequest 모델 + POST /client/assignment + base_user_id postfix 확장
- [x] 8. api/assignment.js: Vercel 프록시 추가
- [x] 9. data/phase2_modes.json deprecate 표기, CLAUDE.md 문서 갱신
- [x] 10. 검증: node syntax check, 서버 起動 테스트, 수동 시나리오 점검

## Review (2026-06-12)

**구문 검증**: app.js / api/assignment.js / judge-server/main.py 모두 통과.
주의: 저장소 내에서 `node --check app.js`는 `package.json type:module` 때문에
기존 중복 `function escapeHtml`(브라우저 classic script에서는 합법)에 오탐 발생 —
저장소 밖에서 검사해야 함. HEAD도 동일하게 실패하므로 이번 변경과 무관.

**브라우저 E2E (Playwright, python http.server 8080)**:

- `test_205016_pexp` 로그인 → mode=phase2, planCondition=plan, rawId가 sessionStorage에 보존됨 ✓
- AI 패널 열기 → 채팅 숨김 + 4문항 폼 표시, `firstShownAt` 저장, `ai_panel_opened`/`plan_gate_shown` 로깅 ✓
- 4문항 작성 제출 → (정적 서버라 검증 API 실패 → 길이 폴백) 전 문항 통과 → `plan_gate_submitted`/`plan_gate_unlocked`(planDurationMs=21414) 기록, 폼 닫히고 채팅 초기화 ✓
- 새로고침 → 해금 유지, 폼 재표시 안 됨 ✓
- `test_205016_fexp` → 게이트 없이 즉시 채팅 ✓ / resolveUserId 4케이스(\_fexp/\_pexp/\_exp/plain) 모두 정상 ✓
- 빈 응답 제출 차단, 짧은 응답(폴백 fail) 시 문항별 fail 피드백 + 잠금 유지 ✓
- `POST /api/assignment` 로그인 시 발화 확인 (정적 서버 501은 예상 동작) ✓

**미실행 검증**: judge-server는 Unix 전용(`import resource`)이라 Windows 로컬에서 기동 불가 —
`/client/assignment` 엔드포인트는 구문 검사만 완료. 배포 환경에서 1회 확인 필요.
LLM 관련성 검증 경로(`checkPlanRelevance`)도 실제 /api/chat 환경에서 1회 확인 권장.

## 추가: Phase2 문제 교체 — A1~A3, B1~B3 (2026-06-12, 후속 요청)

phase2/main_study_problems_pilot.md 기반 6문제를 cli-given(stdin/stdout) 유형으로 추가.
Phase1 파일(problems.json, testcases.json)은 무변경.

- ID: 211(A1 배달 로봇), 212(A2 보안 구역 로봇), 213(A3 빙판 창고 로봇),
  221(B1 주차장 정산), 222(B2 엘리베이터), 223(B3 카페 주문)
- `phase2/build_data.py`가 데이터 3파일 생성 (멱등, 재실행 가능):
  phase2_problems.json(기존 201~204 유지+신규 6), phase2_testcases.json(신규 키),
  problem_sets.json set1 phase2ProblemIds → 6개 전부 (나중에 패밀리 선택 시 이 배열만 수정)
- 레퍼런스 솔루션 누락분 직접 작성: `sol_a1.py`, `sol_b1.py` — md 공개 정답과 전부 일치 검증
- B1 공개 테스트 입력은 md 요약에서 재구성 (`tests_b1.py` 신규) — 6/6 md 정답 재현.
  주의: md T6의 "9999 21:50 IN"으로는 정답 1000이 안 나옴 → 22:50 IN으로 조정해 정답 유지
- 히든 4개/문제: md 히든 설계 지침 기반, 기대값은 솔루션 생성. A3 히든은 랜덤 탐색으로
  의도 충족 격자 발굴 (R 제거 시 -1이 되는 격자 등)
- 검증: 59케이스(visible+hidden) CLI 실행 교차검증 0 실패 / 프런트 렌더 확인
  (6문제 큐, md 표·예제 줄바꿈 정상, stdin starter)
- 주의: judge run_cli의 판정은 "expected 각 줄이 actual에 포함" — 단일 숫자 출력에서
  드물게 관대한 매칭 가능성 있음 (예: 기대 "1" ⊂ 실제 "-1"). 필요시 추후 엄격화 검토

## 추가: 계획 고정 표시 (2026-06-12, 후속 요청)

해금 후 채팅 중에도 작성한 계획이 AI 패널 헤더 바로 아래 "📋 내 계획" 카드로 고정 표시됨.

- `updatePlanSummary()`: plan 컨디션 + 해금 + `lastAnswers` 존재 시 표시. `showPlanGate`/`hidePlanGate`에서 호출되어 문제 전환·해금·새로고침 모두 자동 갱신
- 헤더 클릭으로 접기/펼치기 (`togglePlanSummary`), 본문 `max-height: 28vh` 스크롤
- E2E 확인: 해금 직후 4항목 표시 ✓ / 토글 ✓ / 새로고침 후 유지 ✓ / free 컨디션·게이트 중 숨김 ✓
