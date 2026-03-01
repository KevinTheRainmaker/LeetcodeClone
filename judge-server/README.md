# judge-server (FastAPI)

LeetCode clone용 간단 채점 서버입니다.

## 실행

```bash
cd /Users/hcis/Desktop/leetcode-clone/judge-server
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

헬스체크:
- `GET http://localhost:8000/health`

채점 API:
- `POST http://localhost:8000/judge`
- body 예시:
```json
{
  "problemId": 1,
  "language": "python",
  "code": "def two_sum(nums, target):\n    return [0,1]",
  "mode": "run"
}
```

## 주의

- 로컬 개발용 구현입니다.
- 프로덕션에서는 Docker/isolation, seccomp, resource limit 강화가 필요합니다.
