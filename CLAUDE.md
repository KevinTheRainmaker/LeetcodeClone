# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 개요

LeetCode 스타일의 코딩 연습 플랫폼입니다. 순수 HTML/JS/CSS 프론트엔드와 FastAPI 채점 서버로 구성됩니다. UI에서 문제세트/모드를 선택하지 않고, **URL 쿼리 파라미터**로 모든 실행 설정을 받습니다.

## 실행 방법

### 프론트엔드

```bash
cd /path/to/LeetcodeClone
python3 -m http.server 8080
```

접속: `http://localhost:8080/?set=1&mode=memo&user_id=kevin`

### FastAPI 채점 서버

```bash
cd judge-server
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
export OPENAI_API_KEY="sk-..."
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

헬스체크: `curl http://127.0.0.1:8000/health`

## URL 파라미터

| 파라미터         | 값                                | 설명                                          |
| ---------------- | --------------------------------- | --------------------------------------------- |
| `set` / `set_id` | 숫자                              | 문제세트 번호 (`data/problem_sets.json` 기준) |
| `mode`           | `memo` / `assistant` / `socratic` / `phase2` | 학습 모드. `phase2`는 IDE를 잠그고 설명 입력 오버레이를 띄움 |
| `user_id`        | 문자열                            | 사용자 식별자 (로그 분리 저장용)              |
| `lang`           | `python` / `java` / `cpp`         | 코드 언어 (기본: `python`)                    |

## 아키텍처

```
LeetcodeClone/
├── index.html          # 단일 페이지 앱 (SPA)
├── app.js              # 전체 프론트 로직 (바닐라 JS)
├── styles.css          # 스타일
├── data/
│   ├── problems.json       # 문제 정의 (id, description, examples, starter 코드, 선택적 images)
│   ├── testcases.json      # 테스트케이스 (visible/hidden 구분)
│   ├── problem_sets.json   # 문제세트 (setId → problemIds 배열)
│   ├── allowed_users.json  # 허용 사용자 ID 배열 (base ID만; _exp suffix 없이)
│   └── images/             # 문제 삽입 이미지 (PNG/JPG) — problems.json에서 경로로 참조
└── judge-server/
    ├── main.py             # FastAPI 앱 (채점 + 어시스턴트 + 로그)
    ├── requirements.txt    # fastapi, uvicorn
    ├── assistant_data/
    │   ├── sessions/       # 채팅 세션 JSON (sessionId.json)
    │   └── logs/           # 채팅 로그 JSONL (sessionId.jsonl)
    └── client_logs/        # 클라이언트 이벤트 로그 ({userId}_set{setId}.jsonl)
```

### 프론트엔드 (`app.js`)

- `runArgs`: URL 파라미터를 파싱해 `setId`, `mode`, `userId`, `language` 저장
- `loadData()`: `data/*.json` 3개를 병렬 fetch 후 문제세트 큐(`activeSetQueue`) 초기화
- `renderProblem()`: 현재 문제 렌더링, localStorage에서 코드/메모/채팅 복원
- `judge(mode)`: `POST /judge`로 코드 제출 (`mode`: `run` | `submit`)
- `logEvent()`: localStorage + `POST /client/log`에 이벤트 이중 저장
- 모드별 UI 표시: `memo` / `assistant` / `socratic` 섹션을 CSS class로 전환

**localStorage 키 패턴:**

- 코드: `code:{userId}:set{setId}:p{problemId}:{lang}`
- 메모: `memo:{userId}:set{setId}:p{problemId}`
- 채팅: `chat:{userId}:set{setId}:mode{mode}`
- 이벤트 로그: `runlog:{userId}:set{setId}`

### 채점 서버 (`judge-server/main.py`)

- `POST /judge`: Python(`python3`), Java(`javac`/`java`), C++(`g++`) 코드를 임시 디렉터리에서 실행 후 결과 반환
  - `run` 모드: visible 테스트케이스만
  - `submit` 모드: visible + hidden 테스트케이스 전체
- `POST /assistant/chat`: OpenAI API 호출 (모델: `OPENAI_MODEL` env, 기본 `gpt-4o-mini`)
- `GET /assistant/logs/{sessionId}`: 채팅 로그 JSONL 반환
- `POST /client/log`: 클라이언트 이벤트를 서버 JSONL로 저장

### 데이터 파일 구조

**`problems.json`** 항목 필드:

- `id`, `description`, `examples`, `starter` (언어별 초기 코드), `functionName`, `pythonFunctionName`
- `images` (선택): `["data/images/pN-name.png", ...]` — 문제 설명에 렌더링되고 AI 어시스턴트 첫 user 메시지에도 base64로 동봉

**`testcases.json`** 항목 필드:

- `{problemId}: { visible: [...], hidden: [...] }` — 각 케이스: `{ input: [...], expected: any }`

**`problem_sets.json`**:

- `{ sets: [{ setId, name, problemIds: [...] }] }`

## UI 정책

- 상단에는 진행도(`N / M`)만 표시, 문제 제목/난이도 미표시
- 순차 진행만 가능 (이전 문제 복귀 불가)
- Judge API base URL: localStorage `judgeApiBase` 값 또는 `http://127.0.0.1:8000`

## AI 어시스턴트 플로우 (프론트 → `/api/chat` Vercel 프록시 → OpenRouter)

- 채팅은 **문제별 세션**. 문제가 바뀌면 `aiHistory`와 패널 UI가 리셋됨.
- AI 패널을 처음 열 때 `initChatSession()`이 문제 본문 + `images[]`(base64 인코딩)를 첫 user 메시지로 주입하고, 하드코딩 그리팅 `"안녕하세요, 이 문제를 풀기 위해 도움이 필요한가요?"`를 첫 assistant 응답으로 넣는다.
- 이후 유저 질문만 히스토리에 append. 모델은 히스토리의 첫 user 메시지에서 문제(이미지 포함)를 참조.
- 긴 대화에서도 앞 2개(문제 + 그리팅)는 항상 요청에 포함 — `sendAI()`의 `head + tail` 슬라이싱 참고.
- 기본 모델: `anthropic/claude-sonnet-4.6` (비전 지원). localStorage `openrouter_model`로 오버라이드 가능.
