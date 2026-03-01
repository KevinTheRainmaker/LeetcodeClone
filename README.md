# LeetCode Clone + FastAPI Judge Server

구현 완료 항목:
1. **코드 채점** (JavaScript / Python / C++)
2. **메모장 모드** (자동저장 + 최종저장)
3. **답변제공 모드** (GPT API 연동, 멀티턴 메모리, 로그 저장/다운로드)

## 실행 화면

![LeetCode Clone 실행 화면](docs/screenshot-main.png)

## 경로

- 프론트엔드: `/Users/hcis/Desktop/leetcode-clone`
- 채점/답변 서버: `/Users/hcis/Desktop/leetcode-clone/judge-server`
- 문제 데이터: `/Users/hcis/Desktop/leetcode-clone/data/problems.json`
- 테스트케이스: `/Users/hcis/Desktop/leetcode-clone/data/testcases.json`

---

## 1) 프론트엔드 실행

```bash
cd /Users/hcis/Desktop/leetcode-clone
python3 -m http.server 8080
```

브라우저: `http://localhost:8080`

## 2) FastAPI 서버 실행

```bash
cd /Users/hcis/Desktop/leetcode-clone/judge-server
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
export OPENAI_API_KEY="sk-..."
# optional: export OPENAI_MODEL="gpt-4o-mini"
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

헬스체크:
- `GET http://localhost:8000/health`

---

## 기능 상세

### A. 메모장 모드 (프론트)
- 문제별 메모 자동저장(localStorage)
- "최종저장" 버튼으로 별도 final 저장(localStorage)
- 기능 지원 없이 자기설명 작성에 집중

### B. 답변제공 모드 (GPT)
- 질문 전송: `POST /assistant/chat`
- 세션별 멀티턴 히스토리 저장: `judge-server/assistant_data/sessions/<sessionId>.json`
- 로그(JSONL) 저장: `judge-server/assistant_data/logs/<sessionId>.jsonl`
- 프론트에서 로그 다운로드 지원

### C. 채점 API
- `POST /judge`
- `mode=run`: visible만
- `mode=submit`: visible+hidden

---

## API 요약

### `POST /judge`
```json
{
  "problemId": 1,
  "language": "python",
  "code": "def two_sum(nums, target):\n    return [0,1]",
  "mode": "run"
}
```

### `POST /assistant/chat`
```json
{
  "sessionId": "uuid-string",
  "question": "Two Sum 파이썬 풀이랑 해설줘",
  "problemId": 1,
  "language": "python"
}
```

### `GET /assistant/logs/{sessionId}`
- 해당 세션 대화 로그(JSONL) 반환

---

## 보안 주의

현재는 로컬 개발용입니다. 외부 공개 시 필수:
- 코드 실행 샌드박스 강화(Docker/seccomp)
- CPU/메모리/프로세스 제한
- 네트워크/파일 접근 제어
- 인증/권한 관리

