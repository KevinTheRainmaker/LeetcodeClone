import json
import os
import re
import shutil
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, PlainTextResponse
from pydantic import BaseModel

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
PROBLEMS_PATH = DATA_DIR / "problems.json"
TESTCASES_PATH = DATA_DIR / "testcases.json"
ASSISTANT_DIR = Path(__file__).resolve().parent / "assistant_data"
SESSIONS_DIR = ASSISTANT_DIR / "sessions"
LOGS_DIR = ASSISTANT_DIR / "logs"

TIME_LIMIT_SEC = 2.0
ASSISTANT_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
SHARED_TOKEN = os.getenv("JUDGE_SHARED_TOKEN", "").strip()
PUBLIC_PATHS = {"/health", "/"}

_origins_env = os.getenv("ALLOWED_ORIGINS", "").strip()
if _origins_env:
    _allowed_origins = [o.strip() for o in _origins_env.split(",") if o.strip()]
else:
    _allowed_origins = ["*"]

SESSIONS_DIR.mkdir(parents=True, exist_ok=True)
LOGS_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="LeetCode Clone Judge Server")
app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def bearer_auth(request: Request, call_next):
    # Preflight and public paths always pass.
    if request.method == "OPTIONS" or request.url.path in PUBLIC_PATHS:
        return await call_next(request)
    if not SHARED_TOKEN:
        # Auth disabled — keep legacy open behaviour for local dev.
        return await call_next(request)
    header = request.headers.get("authorization", "")
    if not header.lower().startswith("bearer "):
        return JSONResponse({"error": "Missing bearer token"}, status_code=401)
    provided = header[7:].strip()
    if provided != SHARED_TOKEN:
        return JSONResponse({"error": "Invalid bearer token"}, status_code=401)
    return await call_next(request)


class JudgeRequest(BaseModel):
    problemId: int
    language: str
    code: str
    mode: str = "run"  # run | submit


class ChatRequest(BaseModel):
    sessionId: str
    question: str
    problemId: Optional[int] = None
    language: Optional[str] = None
    userId: Optional[str] = None


class ClientLogRequest(BaseModel):
    ts: str
    userId: str
    sessionId: Optional[str] = None
    setId: Optional[Any] = None
    language: Optional[str] = None
    problemId: Optional[int] = None
    problemIdx: Optional[int] = None
    action: str
    detail: Dict[str, Any] = {}


def load_json(path: Path):
    if not path.exists():
        raise RuntimeError(f"Missing file: {path}")
    return json.loads(path.read_text(encoding="utf-8"))


def get_problem(problem_id: int) -> Dict[str, Any]:
    problems = load_json(PROBLEMS_PATH)
    for p in problems:
        if p.get("id") == problem_id:
            return p
    raise HTTPException(status_code=404, detail=f"Problem not found: {problem_id}")


def get_cases(problem_id: int, mode: str) -> List[Dict[str, Any]]:
    testcases = load_json(TESTCASES_PATH)
    key = str(problem_id)
    if key not in testcases:
        raise HTTPException(status_code=404, detail=f"Testcases not found for problem: {problem_id}")
    visible = testcases[key].get("visible", [])
    hidden = testcases[key].get("hidden", [])
    return visible + hidden if mode == "submit" else visible


def to_snake(name: str) -> str:
    return re.sub(r"(?<!^)(?=[A-Z])", "_", name).lower()


def run_command(cmd: List[str], cwd: Path, timeout: float = TIME_LIMIT_SEC) -> subprocess.CompletedProcess:
    return subprocess.run(
        cmd,
        cwd=str(cwd),
        capture_output=True,
        text=True,
        timeout=timeout,
    )


def cpp_literal(v: Any) -> str:
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, int):
        return str(v)
    if isinstance(v, float):
        return str(v)
    if isinstance(v, str):
        return json.dumps(v, ensure_ascii=False)
    if isinstance(v, list):
        return "{" + ", ".join(cpp_literal(x) for x in v) + "}"
    raise ValueError(f"Unsupported C++ literal type: {type(v)}")


def cpp_type(v: Any) -> str:
    if isinstance(v, bool):
        return "bool"
    if isinstance(v, int):
        return "int"
    if isinstance(v, float):
        return "double"
    if isinstance(v, str):
        return "string"
    if isinstance(v, list):
        if not v:
            return "vector<int>"
        return f"vector<{cpp_type(v[0])}>"
    raise ValueError(f"Unsupported C++ type: {type(v)}")


def run_python(problem: Dict[str, Any], code: str, cases: List[Dict[str, Any]], work: Path):
    fn_name = problem.get("pythonFunctionName") or to_snake(problem.get("functionName", "solve"))
    payload = [{"index": i + 1, "input": tc["input"], "expected": tc["expected"]} for i, tc in enumerate(cases)]
    runner = f'''import json\n\n{code}\n\nFN_NAME = {json.dumps(fn_name)}\nfn = globals().get(FN_NAME)\nif not callable(fn):\n    print(json.dumps({{"fatal": f"Function '{{FN_NAME}}' not found."}}, ensure_ascii=False))\n    raise SystemExit(0)\n\nCASES = {json.dumps(payload, ensure_ascii=False)}\nfor c in CASES:\n    try:\n        actual = fn(*c["input"])\n        print(json.dumps({{"index": c["index"], "ok": actual == c["expected"], "actual": actual}}, ensure_ascii=False))\n    except Exception as e:\n        print(json.dumps({{"index": c["index"], "ok": False, "error": str(e)}}, ensure_ascii=False))\n'''
    script = work / "run.py"
    script.write_text(runner, encoding="utf-8")
    proc = run_command(["python3", str(script)], cwd=work)
    return parse_line_results(proc, cases)


def run_javascript(problem: Dict[str, Any], code: str, cases: List[Dict[str, Any]], work: Path):
    fn_name = problem.get("functionName", "solve")
    payload = [{"index": i + 1, "input": tc["input"], "expected": tc["expected"]} for i, tc in enumerate(cases)]
    runner = f'''const FN_NAME = {json.dumps(fn_name)};\nconst __getFn = new Function(`\n{code}\nreturn (typeof ${{FN_NAME}} === 'function') ? ${{FN_NAME}} : null;\n`);\nconst fn = __getFn();\nif (typeof fn !== 'function') {{\n  console.log(JSON.stringify({{fatal: `Function '${{FN_NAME}}' not found.`}}));\n  process.exit(0);\n}}\nconst CASES = {json.dumps(payload, ensure_ascii=False)};\nfor (const c of CASES) {{\n  try {{\n    const actual = fn(...c.input);\n    const ok = JSON.stringify(actual) === JSON.stringify(c.expected);\n    console.log(JSON.stringify({{index: c.index, ok, actual}}));\n  }} catch (e) {{\n    console.log(JSON.stringify({{index: c.index, ok: false, error: String(e.message || e)}}));\n  }}\n}}\n'''
    script = work / "run.mjs"
    script.write_text(runner, encoding="utf-8")
    proc = run_command(["node", str(script)], cwd=work)
    return parse_line_results(proc, cases)


def run_cpp(problem: Dict[str, Any], code: str, cases: List[Dict[str, Any]], work: Path):
    fn_name = problem.get("functionName", "solve")

    lines = [
        "#include <iostream>",
        "#include <vector>",
        "#include <string>",
        "#include <sstream>",
        "#include <unordered_map>",
        "#include <exception>",
        "using namespace std;",
        code,
        "template<typename T> string to_s(const T& v){ ostringstream oss; oss<<v; return oss.str(); }",
        "string to_s(const string& s){ return string(\"\\\"\") + s + \"\\\"\"; }",
        "string to_s(const bool& b){ return b ? \"true\" : \"false\"; }",
        "template<typename T> string to_s(const vector<T>& vec){ string out=\"[\"; for(size_t i=0;i<vec.size();++i){ if(i) out+=\",\"; out+=to_s(vec[i]); } out+=\"]\"; return out; }",
        "int main(){",
    ]

    for idx, tc in enumerate(cases, start=1):
        arg_names = []
        for j, arg in enumerate(tc["input"]):
            t = cpp_type(arg)
            name = f"arg_{idx}_{j}"
            arg_names.append(name)
            lines.append(f"  {t} {name} = {cpp_literal(arg)};")

        expected_type = cpp_type(tc["expected"])
        expected_literal = cpp_literal(tc["expected"])
        args = ", ".join(arg_names)
        lines.append("  try {")
        lines.append(f"    auto actual = {fn_name}({args});")
        lines.append(f"    {expected_type} expected = {expected_literal};")
        lines.append("    bool ok = (actual == expected);")
        lines.append(f"    cout << \"{{\\\"index\\\":{idx},\\\"ok\\\":\" << (ok?\"true\":\"false\") << \" ,\\\"actual\\\":\" << to_s(actual) << \"}}\" << '\\n';")
        lines.append("  } catch (const exception& e) {")
        lines.append(f"    cout << \"{{\\\"index\\\":{idx},\\\"ok\\\":false,\\\"error\\\":\\\"\" << e.what() << \"\\\"}}\" << '\\n';")
        lines.append("  }")

    lines += ["  return 0;", "}"]

    src = work / "main.cpp"
    src.write_text("\n".join(lines), encoding="utf-8")

    compile_proc = run_command(["g++", "-std=c++17", "-O2", "-o", "main", str(src)], cwd=work, timeout=5.0)
    if compile_proc.returncode != 0:
        return {
            "status": "Compile Error",
            "passed": 0,
            "total": len(cases),
            "caseResults": [],
            "stderr": (compile_proc.stderr or "").strip()[:4000],
            "runtimeMs": 0,
        }

    run_proc = run_command([str(work / "main")], cwd=work)
    return parse_line_results(run_proc, cases)


def parse_line_results(proc: subprocess.CompletedProcess, cases: List[Dict[str, Any]]):
    if proc.returncode != 0 and not proc.stdout:
        return {
            "status": "Runtime Error",
            "passed": 0,
            "total": len(cases),
            "caseResults": [],
            "stderr": (proc.stderr or "").strip()[:4000],
            "runtimeMs": 0,
        }

    lines = [ln.strip() for ln in (proc.stdout or "").splitlines() if ln.strip()]
    if lines and "fatal" in lines[0]:
        return {
            "status": "Compile Error",
            "passed": 0,
            "total": len(cases),
            "caseResults": [],
            "stderr": lines[0],
            "runtimeMs": 0,
        }

    results = []
    passed = 0
    for i, tc in enumerate(cases, start=1):
        item = {"index": i, "passed": False, "input": tc["input"], "expected": tc["expected"], "actual": None, "error": "No output"}
        if i - 1 < len(lines):
            raw = lines[i - 1]
            try:
                parsed = json.loads(raw)
                item["passed"] = bool(parsed.get("ok"))
                item["actual"] = parsed.get("actual")
                item["error"] = parsed.get("error")
            except Exception:
                item["error"] = f"Invalid runner output: {raw[:200]}"
        if item["passed"]:
            passed += 1
        results.append(item)

    status = "Accepted" if passed == len(cases) else "Wrong Answer"
    return {
        "status": status,
        "passed": passed,
        "total": len(cases),
        "caseResults": results,
        "stderr": (proc.stderr or "").strip()[:4000],
        "runtimeMs": 0,
    }


def session_path(session_id: str) -> Path:
    return SESSIONS_DIR / f"{session_id}.json"


def log_path(session_id: str) -> Path:
    return LOGS_DIR / f"{session_id}.jsonl"


def load_session_messages(session_id: str) -> List[Dict[str, str]]:
    p = session_path(session_id)
    if not p.exists():
        return []
    return json.loads(p.read_text(encoding="utf-8")).get("messages", [])


def save_session_messages(session_id: str, messages: List[Dict[str, str]]):
    p = session_path(session_id)
    p.write_text(json.dumps({"sessionId": session_id, "messages": messages}, ensure_ascii=False, indent=2), encoding="utf-8")


def append_log(session_id: str, role: str, content: str):
    lp = log_path(session_id)
    row = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "sessionId": session_id,
        "role": role,
        "content": content,
    }
    with lp.open("a", encoding="utf-8") as f:
        f.write(json.dumps(row, ensure_ascii=False) + "\n")


def call_openai_chat(messages: List[Dict[str, str]]) -> str:
    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        raise HTTPException(status_code=500, detail="OPENAI_API_KEY is not set on judge-server")

    payload = {
        "model": ASSISTANT_MODEL,
        "messages": messages,
        "temperature": 0.2,
    }

    req = urllib.request.Request(
        "https://api.openai.com/v1/chat/completions",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            body = json.loads(resp.read().decode("utf-8"))
            return body["choices"][0]["message"]["content"].strip()
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="ignore")[:1000]
        raise HTTPException(status_code=500, detail=f"OpenAI API error: {detail}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"OpenAI call failed: {e}")


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/judge")
def judge(req: JudgeRequest):
    if req.language not in {"javascript", "python", "cpp"}:
        raise HTTPException(status_code=400, detail="Unsupported language")
    if req.mode not in {"run", "submit"}:
        raise HTTPException(status_code=400, detail="mode must be run|submit")

    problem = get_problem(req.problemId)
    cases = get_cases(req.problemId, req.mode)
    if not cases:
        raise HTTPException(status_code=400, detail="No testcases")

    work = Path(tempfile.mkdtemp(prefix="judge_"))
    started = time.perf_counter()
    try:
        if req.language == "python":
            out = run_python(problem, req.code, cases, work)
        elif req.language == "cpp":
            out = run_cpp(problem, req.code, cases, work)
        else:
            out = run_javascript(problem, req.code, cases, work)
    except subprocess.TimeoutExpired:
        out = {
            "status": "Time Limit Exceeded",
            "passed": 0,
            "total": len(cases),
            "caseResults": [],
            "stderr": "Execution timeout",
            "runtimeMs": int((time.perf_counter() - started) * 1000),
        }
    finally:
        shutil.rmtree(work, ignore_errors=True)

    out["runtimeMs"] = out.get("runtimeMs") or int((time.perf_counter() - started) * 1000)
    return out


@app.post("/assistant/session/new")
def assistant_session_new():
    sid = str(uuid.uuid4())
    save_session_messages(sid, [])
    return {"sessionId": sid}


@app.post("/assistant/chat")
def assistant_chat(req: ChatRequest):
    sid = req.sessionId.strip()
    if not sid:
        raise HTTPException(status_code=400, detail="sessionId is required")
    question = req.question.strip()
    if not question:
        raise HTTPException(status_code=400, detail="question is required")

    history = load_session_messages(sid)

    system_msg = (
        "당신은 코딩 튜터입니다. 한국어로 답변하세요. "
        "요청이 알고리즘/코딩 질문이면 핵심 아이디어, 복잡도, 코드 스니펫을 제공하세요. "
        "설명은 간결하되 실전적으로 작성하세요."
    )

    context = f"problemId={req.problemId}, language={req.language}" if req.problemId else ""
    user_text = f"[{context}]\n{question}" if context else question

    messages = [{"role": "system", "content": system_msg}] + history + [{"role": "user", "content": user_text}]

    answer = call_openai_chat(messages)

    new_history = history + [
        {"role": "user", "content": user_text},
        {"role": "assistant", "content": answer},
    ]
    new_history = new_history[-20:]
    save_session_messages(sid, new_history)

    append_log(sid, "user", user_text)
    append_log(sid, "assistant", answer)

    return {"sessionId": sid, "answer": answer}


@app.get("/assistant/logs/{session_id}", response_class=PlainTextResponse)
def assistant_logs(session_id: str):
    lp = log_path(session_id)
    if not lp.exists():
        raise HTTPException(status_code=404, detail="Log not found")
    return lp.read_text(encoding="utf-8")


_SAFE_ID = re.compile(r"[^A-Za-z0-9_\-]")


def _safe_segment(s: str, default: str = "anon") -> str:
    s = _SAFE_ID.sub("_", s or "")[:64]
    return s or default


@app.post("/client/log")
def client_log(req: ClientLogRequest):
    log_root = Path(__file__).resolve().parent / "client_logs"
    user_dir = log_root / _safe_segment(req.userId)
    user_dir.mkdir(parents=True, exist_ok=True)
    fname = (
        f"p{req.problemId}.jsonl" if req.problemId is not None else "_meta.jsonl"
    )
    fpath = user_dir / fname
    with fpath.open("a", encoding="utf-8") as f:
        f.write(json.dumps(req.model_dump(), ensure_ascii=False) + "\n")
    return {"ok": True}
