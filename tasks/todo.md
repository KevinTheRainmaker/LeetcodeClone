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

---

# Phase2 프롬프트 개입: Type A / Type B

## 요구사항 요약

- **성공 기준**: Phase2에서만 사용자의 AI 입력을 판별하고, 저참여 입력에 대해 Type A 또는 Type B 방식으로 고참여 프롬프트 생성을 개입한다.
- **Type A**: 원 입력을 LLM에 보내기 전 판별한다. 고참여면 그대로 전송, 저참여면 사용자에게 접근 방식 입력을 추가로 받고 고참여 프롬프트를 생성한 뒤 원본/개선본 중 선택하게 한다.
- **Type B**: 원 입력은 즉시 전송한다. 저참여면 같은 대화 맥락을 기준으로 개선 프롬프트도 병렬 전송해 두 답변을 나란히 표시하고, 사용자가 이어갈 답변을 선택한다.
- **로깅**: 판별, 개입 노출, 사용자 추가 입력, 프롬프트 생성, 원본/개선본 선택, 각 응답 생성 결과를 모두 `logEvent`로 기록한다.
- **스코프**: 브라우저 확장처럼 동작하는 UI/흐름을 기존 AI 패널 안에 구현한다.
- **하지 않을 것**: Phase1(normal mode) 입력/채팅 경로 변경, 기존 plan gate 의미 변경, 별도 서버 API 신설.

## 접근 방식

- **방안 A (추천)**: `app.js`에서 Phase2 전용 interceptor를 추가하고 기존 `/api/chat` 프록시를 판별/생성/응답에 재사용한다. UI는 `index.html`의 AI drawer 내부에 Type A 모달과 Type B 비교 영역을 추가한다.
- **방안 B**: 서버 프록시에서 모든 요청을 판별해 개입한다. 클라이언트 UI 상태와 선택 로깅이 복잡해지고 Phase1 영향 범위가 커진다.
- **선택 이유**: 현재 기능은 사용자 선택/병렬 표시가 핵심이라 프론트 상태 관리가 자연스럽고, `currentPhase() === "phase2"` 가드로 Phase1 영향을 최소화할 수 있다.

## 구현 단계

- [x] 1. `app.js`: Phase2 전용 `prompt_intervention` 설정 추가 (`a`/`b`, 없으면 비활성)
- [x] 2. `app.js`: 저참여/고참여 판별 및 고참여 프롬프트 생성 유틸 추가
- [x] 3. `app.js`/`styles.css`: Type A 접근 방식 입력/선택 UI 추가 (동적 카드)
- [x] 4. `app.js`/`styles.css`: Type B 병렬 응답 비교/선택 UI 추가 (동적 카드)
- [x] 5. `app.js`: 기존 `sendAI()`를 Phase1 보존 경로와 Phase2 개입 경로로 분리
- [x] 6. `app.js`: 선택 이후 `aiHistory`, localStorage, 로깅이 일관되게 이어지도록 연결
- [x] 7. 검증: JS 구문 검사, Phase1 비활성 확인, Phase2 Type A/B 흐름 정적 점검

## 수정한 파일

- `app.js`: Phase2 전용 Type A/B 개입, 판별/생성 유틸, 병렬 응답 선택, 로깅 연결
- `styles.css`: Type A/B 개입 카드와 병렬 비교 UI 스타일
- `api/chat.js`: `_aexp`/`_bexp` raw user id 정규화 지원
- `judge-server/main.py`: `_aexp`/`_bexp` postfix와 `promptIntervention` 배정 필드 지원
- `tasks/todo.md`: 계획 및 검증 결과 기록

## Review (2026-06-27)

- 구문 검증 통과: `Get-Content -Raw app.js | node --check --input-type=commonjs -`
- 구문 검증 통과: `Get-Content -Raw api\chat.js | node --check --input-type=module -`
- 구문 검증 통과: `python -m py_compile judge-server\main.py`
- 공백/충돌 검증 통과: `git diff --check`
- 정적 확인: `activePromptIntervention()`이 `currentPhase() !== "phase2"`이면 항상 `null`을 반환하므로 Phase1에서는 기존 `sendAIPlain()` 경로만 사용됨
- 정적 확인: Type B는 원본/개선 응답 모두 `baseHistory` 스냅샷을 기준으로 요청해 두 생성의 이전 컨텍스트를 동일하게 유지함
- 미실행: 이 샌드박스에서 임시 HTTP 서버가 포트를 열지 못해 Playwright 브라우저 수동 시나리오는 실행하지 못함

## Bugfix Review (2026-06-27)

- 증상: Type A에서 원래 입력 `풀어줘`, 추가 맥락 `DFS가 뭐지?`를 넣었을 때 개선 프롬프트가 자연어 질문이 아니라 `python\nmaze = ...` 같은 코드/테스트 데이터로 표시됨
- 원인: 생성 프롬프트가 "rewritten prompt text"만 요구해 모델이 문제 맥락의 코드/예시를 프롬프트처럼 그대로 반환할 여지가 있었고, 클라이언트 후처리 방어가 없었음
- 수정: 생성 지시를 자연어 질문/지시문으로 제한하고, 코드-only 출력처럼 보이면 `fallbackHighEngagementPrompt()`로 안전한 고참여 프롬프트를 생성
- 검증: 사용자 재현값 형태의 코드-only 생성 결과가 `DFS가 뭐지?`를 포함한 자연어 학습 질문으로 변환됨을 Node 스니펫으로 확인

## 위험 요소

- **위험**: Type B에서 두 응답의 컨텍스트가 달라질 수 있음 → **완화**: 원본 사용자 메시지를 히스토리에 push하기 전 동일한 `compact` 스냅샷을 만들어 두 요청에 공통 사용.
- **위험**: 판별 API 실패 시 사용자가 막힘 → **완화**: 판별 실패는 고참여로 간주해 기존 전송을 유지하고 실패 로그를 남김.
- **위험**: Phase1 회귀 → **완화**: 모든 개입 진입점에 `currentPhase() === "phase2"` 및 설정값 체크.

## 테스트 전략

- 구문: `node --check` 동등 검사 또는 브라우저 스크립트 파싱 확인.
- 단위 성격: 로컬 정적 검사로 `currentPhase` 가드, Type A/B 상태 전이 확인.
- 수동 시나리오: `mode=memo` 일반 사용자, `mode=phase2&prompt_intervention=a`, `mode=phase2&prompt_intervention=b`.

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
