# 시스템 구현 (System Implementation)

## 1. 시스템 개요

본 시스템은 알고리즘 학습 연구를 위한 웹 기반 코딩 플랫폼으로, 단일 페이지 앱(SPA) 프론트엔드, 코드 채점 서버, LLM 기반 AI 어시스턴트, 그리고 설명 게이트(Explanation Gate) 평가 모듈로 구성된다. 모든 실행 설정은 URL 쿼리 파라미터로 전달되며, 실험 조건(Experimental / Control)은 사용자 ID의 접미사(`_exp`)로 구분된다.

```
┌──────────────────────────────────────────────────────────┐
│                   Browser (SPA)                          │
│  index.html + app.js + styles.css                        │
│  ┌──────────┐  ┌──────────────┐  ┌──────────────────┐   │
│  │  Editor  │  │ AI Assistant │  │ Explanation Gate │   │
│  └────┬─────┘  └──────┬───────┘  └────────┬─────────┘   │
└───────┼───────────────┼──────────────────┼──────────────┘
        │               │                  │
        ▼               ▼                  ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│ Vercel       │  │ Vercel       │  │ Vercel       │
│ /api/judge   │  │ /api/chat    │  │ /api/chat    │
│ (Relay)      │  │ (SSE Proxy)  │  │ (SSE Proxy)  │
└──────┬───────┘  └──────┬───────┘  └──────────────┘
       │                 │
       ▼                 ▼
┌──────────────┐  ┌──────────────┐
│ FastAPI      │  │ OpenRouter   │
│ Judge Server │  │ (LLM API)    │
│ (Python)     │  └──────────────┘
└──────────────┘
```

**그림 1.** 시스템 아키텍처 다이어그램

---

## 2. 프론트엔드 (Single-Page Application)

### 2.1 URL 기반 실행 설정

플랫폼은 별도의 로그인 화면 없이 URL 쿼리 파라미터로 모든 실행 환경을 초기화한다. 부트 시점에 `URLSearchParams`로 파라미터를 파싱하여 전역 `runArgs` 객체에 저장한다.

| 파라미터         | 값                              | 설명          |
| ---------------- | ------------------------------- | ------------- |
| `set` / `set_id` | 숫자                            | 문제세트 번호 |
| `mode`           | `memo` / `assistant` / `phase2` | 학습 모드     |
| `user_id`        | 문자열                          | 사용자 식별자 |
| `lang`           | `python` / `java` / `cpp`       | 코딩 언어     |

사용자 ID에 `_exp` 접미사가 붙어 있으면 자동으로 `mode`가 `phase2`로 전환된다. 이 메커니즘을 통해 동일한 URL 파라미터 구조 하에서 실험 조건(Phase2 / Explanation Gate 활성화)과 통제 조건(일반 모드)을 코드 수정 없이 분리한다.

```js
// app.js:43–46
function resolveUserId(rawUid) {
  const isExp = rawUid.endsWith(EXP_SUFFIX); // "_exp" 감지
  const baseId = isExp ? rawUid.slice(0, -EXP_SUFFIX.length) : rawUid;
  return { baseId, isExp };
}
```

### 2.2 상태 관리

전역 `state` 객체가 플랫폼의 모든 런타임 상태를 단일 소스로 관리한다. 주요 필드는 다음과 같다.

- `problems` / `testcases` / `sets`: 서버에서 로드한 데이터 캐시
- `queue`: 현재 세션에서 풀어야 할 문제 ID 배열 (문제세트 + 모드 기반 필터링)
- `idx`: 현재 문제 인덱스
- `solved`: 완료한 문제 인덱스 집합 (localStorage 지속)
- `lang` / `code`: 현재 언어 및 에디터 코드
- `explainLocked` / `explainAttempts` / `explainGateLockTime`: Explanation Gate 상태

### 2.3 데이터 로드 및 문제 큐 초기화

페이지 부트 시 `loadData()`가 세 JSON 파일(`problems.json`, `phase2_problems.json`, `testcases.json`, `problem_sets.json`)을 병렬 fetch하여 `state`를 초기화한다. Phase2 모드에서는 `problem_sets.json`의 `phase2ProblemIds` 필드를 우선 사용한다.

```js
// app.js:244–294 요약
async function loadData() {
  const [p1, p2, t, s] = await Promise.all([
    fetch("./data/problems.json").then((r) => r.json()),
    fetch("./data/phase2_problems.json")
      .then((r) => r.json())
      .catch(() => []),
    fetch("./data/testcases.json").then((r) => r.json()),
    fetch("./data/problem_sets.json").then((r) => r.json()),
  ]);
  state.problems = [...p1, ...p2];
  // phase2 모드면 phase2ProblemIds 사용, 아니면 problemIds 사용
  const ids =
    isPhase2 && match.phase2ProblemIds
      ? match.phase2ProblemIds
      : match.problemIds;
  state.queue = state.problems.filter((x) => setIds.has(x.id)).map((x) => x.id);
}
```

### 2.4 코드 에디터

코드 에디터는 `<textarea>` 위에 `<pre>` 오버레이를 겹쳐 커스텀 구문 강조를 구현한 순수 JS 에디터다. Python / Java / C++ 세 언어의 키워드 집합과 문자열·주석 파싱 로직을 클라이언트에서 직접 처리한다. Tab 키 입력 시 4칸 들여쓰기, 스크롤 동기화, 코드 변경 시 localStorage 즉시 저장이 구현되어 있다.

에디터 상태는 키 패턴 `code:{userId}:p{problemId}:{lang}`으로 localStorage에 저장되어 새로고침 후에도 복원된다.

### 2.5 문제 유형 분기

플랫폼은 네 가지 문제 유형을 지원하며, 유형별로 UI 흐름이 달라진다.

| 유형               | 설명                     | 채점 방식                        |
| ------------------ | ------------------------ | -------------------------------- |
| `coding`           | 알고리즘 문제 풀기       | 함수 반환값 자동 비교            |
| `cli-given`        | 주어진 명세의 CLI 구현   | stdin/stdout 자동 비교           |
| `creative-problem` | 나만의 코딩 문제 만들기  | 자동채점 없음, 명세 작성 후 제출 |
| `creative-cli`     | 나만의 CLI 프로그램 설계 | 자동채점 없음, 명세 작성 후 제출 |

`creative-problem`과 `creative-cli` 유형에서는 코드 에디터 좌측에 마크다운 기반 Write Card UI가 렌더링된다. 수강생이 문제 명세를 작성하고 저장하기 전까지 코드 에디터가 잠긴 상태(`readOnly`)를 유지하여, 코딩 전에 설계를 먼저 완료하도록 강제한다.

---

## 3. 채점 서버 (Judge Server)

채점 서버는 FastAPI 기반 Python 서버로, 연구실 내부 Mac mini에서 실행되며 Cloudflare Tunnel을 통해 HTTPS 엔드포인트를 노출한다. Vercel의 `/api/judge` 서버리스 함수가 브라우저 요청을 중계하며, Bearer 토큰으로 터널 엔드포인트를 보호한다.

### 3.1 다언어 채점 엔진

`POST /judge` 엔드포인트는 `problemId`, `language`, `code`, `mode` 네 필드를 수신한다. 언어별 채점 흐름은 다음과 같다.

**Python**: 제출 코드와 테스트 케이스를 결합한 러너 스크립트를 생성하여 임시 디렉터리에서 `python3`로 실행한다. 각 케이스 결과를 JSON 라인으로 stdout에 출력하면 파서가 수집한다.

**Java**: `import java.util.*;` 및 `public class Main { ... }` 래퍼를 생성하고, 각 테스트 케이스별 `static void runCaseN()` 메서드를 코드-생성한다. `javac` 컴파일 후 `java Main`으로 실행한다.

**C++**: 각 테스트 케이스 입력을 타입 추론(`cpp_type()`)하여 변수 선언하고 `main()` 함수를 코드-생성한다. `g++ -std=c++17 -O2` 컴파일 후 실행한다.

세 언어 모두 타임아웃 2초, 임시 디렉터리 격리, 실행 후 즉시 디렉터리 삭제를 공통으로 적용한다.

**CLI 유형 채점**: `cli-given` 문제는 stdin을 프로세스에 주입하는 별도의 `run_cli()` 함수로 처리한다. 각 테스트 케이스에 정의된 `stdin` 텍스트를 표준 입력으로 전달하고, 프로세스의 stdout과 `expected_output`을 라인 단위로 비교한다.

### 3.2 채점 모드

- **run 모드**: `visible` 테스트 케이스만 실행하여 즉각적인 피드백을 제공한다.
- **submit 모드**: `visible` + `hidden` 테스트 케이스 전체를 실행한다. 전체 통과 시 `state.solved`에 해당 인덱스를 추가하고 Next 버튼을 활성화한다.

### 3.3 로그 수집 엔드포인트

`POST /client/log` 엔드포인트는 브라우저에서 발생한 이벤트를 JSONL 형식으로 `judge-server/client_logs/{userId}/` 디렉터리에 기록한다. 파일명은 `{phase}_p{problemId}.jsonl` 패턴을 따른다.

---

## 4. AI 어시스턴트

### 4.1 아키텍처

AI 어시스턴트는 Vercel 서버리스 함수(`/api/chat`)를 프록시로 사용하여 OpenRouter API를 호출하는 클라이언트-사이드 채팅 인터페이스다. API 키가 브라우저에 노출되지 않도록 서버 측에서 `OPENROUTER_API_KEY` 환경 변수를 주입한다. 기본 모델은 `anthropic/claude-sonnet-4.6`이며, localStorage의 `openrouter_model` 값으로 오버라이드할 수 있다.

응답은 SSE(Server-Sent Events) 스트리밍으로 전달되며, 브라우저는 스트림을 실시간으로 파싱하여 타이핑 효과를 제공한다.

### 4.2 세션 초기화 및 멀티모달 컨텍스트

AI 패널을 처음 열거나 문제가 바뀔 때 `initChatSession()`이 호출된다. 이 함수는 문제 본문(title, description, examples)과 `images[]` 배열에 포함된 이미지를 base64로 인코딩하여 첫 번째 user 메시지로 히스토리에 주입한다. 이후 모든 대화는 이 첫 메시지를 문맥으로 참조하므로, 모델이 이미지가 포함된 문제를 멀티모달로 이해할 수 있다.

```js
// app.js:1178–1213 요약
async function initChatSession() {
  // 이미지를 base64 DataURL로 변환
  const imageBlocks = await Promise.allSettled(
    (p.images || []).map((path) => fetchAsDataUrl(path)),
  );
  // 문제 텍스트 + 이미지를 첫 user 메시지로 주입
  aiHistory.push({
    role: "user",
    content: [{ type: "text", text: problemText }, ...imageBlocks],
  });
  aiHistory.push({ role: "assistant", content: GREETING });
}
```

### 4.3 문제 유형별 시스템 프롬프트

`buildSystemPrompt()`는 현재 문제의 `type` 필드에 따라 어시스턴트의 역할과 허용 범위를 동적으로 구성한다. `solve` 유형은 알고리즘 풀이 조언으로, `design` 유형은 문제 설계 조언으로, `implement` 유형은 명세 구현 조언으로 스코프를 제한한다. 이를 통해 연구에서 의도한 인지 과제(알고리즘 풀기 vs. 문제 설계 vs. 명세 구현)에 맞는 어시스턴트 행동을 보장한다.

긴 대화에서 컨텍스트 한계를 처리하기 위해, `sendAI()`는 히스토리 전체 대신 첫 2개 메시지(문제 + 인사말)와 최근 N개 메시지를 결합하여 API에 전송한다(`head + tail` 슬라이싱).

---

## 5. Explanation Gate (Phase2 모드)

Explanation Gate는 Phase2 실험 조건에서 코딩 에디터 진입을 잠그고, 수강생이 LLM 기반 루브릭 평가를 통과해야만 에디터를 열 수 있도록 강제하는 핵심 연구 개입 기능이다.

### 5.1 트리거 조건

`render()` 함수가 호출될 때마다 `isPhase2Coding` 플래그를 평가한다. `runArgs.mode === "phase2"`이면 문제 유형에 관계없이 `state.explainLocked = true`로 설정하고 `applyExplainLock()`으로 오버레이를 활성화한다. 오버레이는 `<textarea>`를 readOnly로, RUN/Submit 버튼을 disabled로 전환하여 에디터를 완전히 차단한다.

### 5.2 루브릭 데이터 구조

각 문제의 평가 기준은 `data/rubrics/{problemId}.json`에 JSON으로 저장된다. 루브릭 항목은 `dimension`(code_reading / conceptual_understanding / debugging), `level`(what / why / what_if), `required` 필드로 구성된다.

```json
{
  "task_id": "206",
  "problem_title": "조이스틱",
  "rubric_items": [
    {
      "id": "R1",
      "dimension": "code_reading",
      "level": "what",
      "description": "알파벳 변경 횟수 계산 방법을 설명할 수 있다",
      "required": true
    },
    {
      "id": "R4",
      "dimension": "conceptual_understanding",
      "level": "why",
      "description": "탐욕 접근법이 유효한 이유를 설명할 수 있다",
      "required": true
    }
  ]
}
```

### 5.3 LLM 기반 루브릭 평가

수강생이 설명을 제출하면 `callGateApi()`가 `/api/chat`(OpenRouter)을 호출하여 비스트리밍 JSON 평가를 요청한다. 시스템 프롬프트(`GATE_SYSTEM_PROMPT`)는 각 루브릭 항목에 대해 두 차원을 독립적으로 평가하도록 지시한다.

- **SUFFICIENCY**: `sufficient` / `insufficient` — 설명이 해당 항목을 실질적으로 다루었는지
- **CORRECTNESS**: `correct` / `incorrect` / `not_applicable` — 설명이 사실적으로 정확한지

`gateDetermineUnlock()` 함수는 `required: true`인 모든 항목이 `sufficient + correct` 조건을 충족할 때 잠금 해제 신호를 반환한다.

```js
// app.js:1592–1611
function gateDetermineUnlock(evaluations, rubric) {
  const requiredEvals = evaluations.filter(e => requiredIds.has(e.rubric_id));
  const allSufficientAndCorrect = requiredEvals.every(
    e => e.sufficiency === "sufficient" && e.correctness === "correct"
  );
  return allSufficientAndCorrect
    ? { shouldUnlock: true, unlockType: "full", ... }
    : { shouldUnlock: false, ... };
}
```

루브릭 파일이 없는 경우(`rubric === null`) 200자 기준의 문자 수 폴백(`gateCharCountFallback`)을 사용하여 서비스 연속성을 보장한다.

### 5.4 Shallow Detection (AI 복붙 탐지)

수강생이 AI 어시스턴트 답변을 그대로 복사하여 제출하는 행동을 탐지하기 위해, `gateDetectShallow()` 함수가 두 단계 유사도 검사를 수행한다.

**1단계 — 단일 메시지 Jaccard 유사도**: 설명 토큰 집합과 최근 5개 어시스턴트 메시지 각각의 토큰 집합 사이의 Jaccard 계수(교집합/합집합)를 계산한다. 0.7 초과 시 `generator_copy`로 판정한다.

**2단계 — 다중 메시지 포함률(Containment)**: 여러 메시지를 연속으로 복사·붙여넣기하는 경우 개별 Jaccard 값이 희석되는 문제를 보완한다. 설명이 15 토큰 이상일 때, 최근 5개 어시스턴트 메시지 전체의 어휘 합집합 대비 설명 토큰의 포함 비율을 계산한다. 0.8 초과 시 `generator_copy`로 판정한다.

```
containment = |{설명 토큰} ∩ {전체 AI 어휘}| / |{설명 토큰}|
```

탐지 시 설명 평가 결과에 경고 카드를 표시하지만, 잠금 해제 판단은 루브릭 평가 결과에 따른다.

### 5.5 UI 및 상호작용 흐름

1. 문제 로드 시 게이트 오버레이 활성화, `gate_triggered` 이벤트 기록
2. 수강생이 설명 텍스트 입력 후 "전송" 클릭 또는 Ctrl+Enter
3. `explanation_submitted` 이벤트 기록 (단어 수, 문자 수, 소요 시간 포함)
4. "설명을 평가 중입니다…" 로딩 버블 표시
5. LLM 평가 완료 후 루브릭 항목별 피드백 카드 렌더링 (✅/⚠️/❌)
6. `evaluation_completed` 이벤트 기록 (항목별 평가 결과 포함)
7. 모든 필수 항목 통과 시 "에디터 열기" 버튼 출현
8. 버튼 클릭 시 `gate_unlocked` 이벤트 기록 후 오버레이 비활성화

미통과 시 전송 버튼이 재활성화되어 수강생이 설명을 보완하고 재시도할 수 있다.

---

## 6. 로깅 시스템

### 6.1 이중 저장 구조

모든 사용자 행동은 `logEvent(action, detail)` 함수를 통해 기록된다. 각 이벤트는 다음 두 곳에 동시 저장된다.

- **localStorage 미러** (`cp_log_{userId}:{phase}`): 네트워크 불량 상황에서도 데이터 손실을 방지하는 로컬 백업
- **서버 큐** (`cp_log_queue`): 15초 주기 또는 온라인 전환 시 서버로 배치 전송

```js
// app.js:137–161 요약
function logEvent(action, detail = {}) {
  const row = {
    ts,
    userId,
    phase,
    sessionId,
    setId,
    language,
    problemId,
    problemIdx,
    action,
    detail,
  };
  // 1. localStorage 미러에 즉시 저장
  mirror.push(row);
  localStorage.setItem(mirrorKey, JSON.stringify(mirror));
  // 2. 전송 큐에 추가 → flushLogs() 호출
  q.push(row);
  localStorage.setItem(LOG_QUEUE_KEY, JSON.stringify(q));
  flushLogs();
}
```

### 6.2 기록되는 이벤트 목록

| 이벤트                          | 수집 정보                                |
| ------------------------------- | ---------------------------------------- |
| `session_start` / `session_end` | 세션 ID, 문제 인덱스, 해결 수            |
| `run` / `submit`                | 코드 전문, 코드 길이                     |
| `run_result` / `submit_result`  | 통과/전체 케이스 수, 실행 시간, 상태     |
| `problem_solved`                | 문제 인덱스                              |
| `code_edit`                     | 코드 전문, 코드 길이 (배치 처리)         |
| `paste` / `copy` / `cut`        | 클립보드 내용, 길이                      |
| `ai_assistant_reply`            | AI 응답 텍스트, 모델명                   |
| `gate_triggered`                | 문제 ID, 트리거 원인                     |
| `explanation_submitted`         | 시도 번호, 단어/문자 수, 소요 시간       |
| `evaluation_completed`          | 시도 번호, 루브릭 항목별 평가 결과       |
| `gate_unlocked`                 | 잠금 해제 유형, 총 시도 수, 총 소요 시간 |
| `manual_save`                   | 코드 전문                                |

### 6.3 Beacon API를 통한 세션 종료 로깅

페이지 언로드(`beforeunload`) 시 `navigator.sendBeacon()`으로 마지막 `code_edit`과 `session_end` 이벤트를 전송한다. Beacon API는 페이지가 닫힌 후에도 전송을 완료하여 세션 종료 시점 데이터 손실을 방지한다.

### 6.4 키스트로크 배치 처리

코드 편집 이벤트는 타이핑 중 과도한 로그 생성을 방지하기 위해 배치 처리된다. 2500ms 디바운스 타이머(`KB_FLUSH_DELAY`) 또는 200회 타이핑(`KB_BATCH_MAX`) 중 먼저 도달하면 `code_edit` 이벤트를 기록한다.

---

## 7. 배포 아키텍처

### 7.1 Vercel 프론트엔드 및 서버리스 함수

프론트엔드(HTML/CSS/JS)와 세 개의 서버리스 함수(`/api/judge`, `/api/chat`, `/api/log`)는 Vercel에 배포된다. 서버리스 함수는 다음 역할을 수행한다.

- `/api/judge`: 브라우저 요청을 Mac mini judge server로 중계. `JUDGE_BASE_URL` 환경 변수로 터널 URL을 주입하고, `JUDGE_SHARED_TOKEN`으로 Bearer 인증을 추가한다.
- `/api/chat`: OpenRouter API의 SSE 스트리밍 응답을 그대로 파이프하는 프록시. `OPENROUTER_API_KEY`가 서버 측에 안전하게 보관된다.
- `/api/log`: 클라이언트 이벤트를 judge server의 `/client/log`로 중계한다.

### 7.2 Judge Server 보안

FastAPI 서버는 Bearer 토큰 미들웨어를 통해 `JUDGE_SHARED_TOKEN` 환경 변수와 일치하는 요청만 처리한다. `/health` 및 `/`는 인증 없이 접근 가능한 공개 경로로 제외된다. `ALLOWED_ORIGINS` 환경 변수로 CORS 출처를 제한한다.

---

## 8. 세션 진행 관리

세션 진행 상태(현재 문제 인덱스, 완료 문제 목록)는 `cp_progress_{userId}` 키로 localStorage에 지속 저장된다. 재접속 시 `getProgress()`로 복원하여 이전 세션의 마지막 문제부터 자동으로 재개된다.

문제 진행은 단방향 순차 구조를 강제한다. 이전 문제를 완료(`state.solved`)해야 Next 버튼이 활성화되며, 이전 문제로의 복귀는 허용되지 않는다. 테스터 계정(`test_` 접두사)은 예외적으로 레일 네비게이션을 통한 문제 간 자유 이동이 가능하다.

---

## 9. 구현 특이 사항

### 서버리스 제약 대응

LLM 평가(`callGateApi()`)는 별도의 `/api/gate` 서버리스 함수를 신설하는 대신 기존 `/api/chat` 엔드포인트를 재사용한다. 루브릭 JSON은 별도 서버 연산 없이 브라우저에서 직접 static 파일로 fetch하여, Vercel 서버리스의 30초 타임아웃 제약과 cold-start 지연 문제를 최소화한다.

### SSE 스트림 버퍼링

게이트 평가는 JSON 응답이 필요하므로, SSE 스트림을 `accumulated` 변수에 완전히 버퍼링한 후 한꺼번에 파싱한다. LLM이 JSON을 마크다운 코드 펜스(`\`\`\`json ... \`\`\``)로 감싸는 경우를 처리하기 위해 펜스 제거 로직을 포함한다.

### 진행 잠금 계층

코드 에디터 진입을 막는 잠금 조건은 두 계층으로 구성된다.

1. **Explanation Gate 잠금** (`state.explainLocked`): Phase2 모드에서 모든 문제에 적용
2. **명세 작성 잠금** (`isCreativeType + !state.descSaved`): Creative 유형에서 명세 저장 전까지 적용

두 잠금은 `applyDescLock()`에서 OR 조건으로 결합되어 처리된다.
