import json
import os
import re
import shutil
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

_data_env = os.getenv("DATA_DIR", "").strip()
DATA_DIR = Path(_data_env) if _data_env else Path(__file__).resolve().parent.parent / "data"

PYTHON_CMD = "python3" if shutil.which("python3") else "python"
PROBLEMS_PATH = DATA_DIR / "problems.json"
TESTCASES_PATH = DATA_DIR / "testcases.json"
PHASE2_PROBLEMS_PATH = DATA_DIR / "phase2_problems.json"
PHASE2_TESTCASES_PATH = DATA_DIR / "phase2_testcases.json"
TIME_LIMIT_SEC = 2.0
SHARED_TOKEN = os.getenv("JUDGE_SHARED_TOKEN", "").strip()
PUBLIC_PATHS = {"/health", "/"}

_origins_env = os.getenv("ALLOWED_ORIGINS", "").strip()
if _origins_env:
    _allowed_origins = [o.strip() for o in _origins_env.split(",") if o.strip()]
else:
    _allowed_origins = ["*"]

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


class ClientLogRequest(BaseModel):
    ts: str
    userId: str
    phase: str = "normal"
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
    path = PHASE2_PROBLEMS_PATH if problem_id >= 200 else PROBLEMS_PATH
    problems = load_json(path)
    for p in problems:
        if p.get("id") == problem_id:
            return p
    raise HTTPException(status_code=404, detail=f"Problem not found: {problem_id}")


def get_cases(problem_id: int, mode: str) -> List[Dict[str, Any]]:
    path = PHASE2_TESTCASES_PATH if problem_id >= 200 else TESTCASES_PATH
    try:
        testcases = load_json(path)
    except RuntimeError:
        return []
    key = str(problem_id)
    if key not in testcases:
        return []
    entry = testcases[key] or {}
    visible = entry.get("visible") or []
    hidden = entry.get("hidden") or []
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


def java_base_and_dims(v: Any):
    if isinstance(v, list):
        if not v:
            return ("int", 1)
        base, dims = java_base_and_dims(v[0])
        return (base, dims + 1)
    if isinstance(v, bool):
        return ("boolean", 0)
    if isinstance(v, int):
        return ("int", 0)
    if isinstance(v, float):
        return ("double", 0)
    if isinstance(v, str):
        return ("String", 0)
    raise ValueError(f"Unsupported Java type: {type(v)}")


def java_type_str(v: Any) -> str:
    base, dims = java_base_and_dims(v)
    return base + "[]" * dims


def _java_lit_inner(v: Any) -> str:
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, int):
        return str(v)
    if isinstance(v, float):
        return str(v)
    if isinstance(v, str):
        return json.dumps(v, ensure_ascii=False)
    if isinstance(v, list):
        return "{" + ", ".join(_java_lit_inner(x) for x in v) + "}"
    raise ValueError(f"Unsupported Java literal type: {type(v)}")


def java_literal(v: Any) -> str:
    if isinstance(v, list):
        return f"new {java_type_str(v)}" + _java_lit_inner(v)
    return _java_lit_inner(v)


def run_python(problem: Dict[str, Any], code: str, cases: List[Dict[str, Any]], work: Path):
    fn_name = problem.get("pythonFunctionName") or to_snake(problem.get("functionName", "solve"))
    payload = [{"index": i + 1, "input": tc["input"], "expected": tc["expected"]} for i, tc in enumerate(cases)]
    runner = f'''import json\n\n{code}\n\nFN_NAME = {json.dumps(fn_name)}\nfn = globals().get(FN_NAME)\nif not callable(fn):\n    print(json.dumps({{"fatal": f"Function '{{FN_NAME}}' not found."}}, ensure_ascii=False))\n    raise SystemExit(0)\n\nCASES = {json.dumps(payload, ensure_ascii=False)}\nfor c in CASES:\n    try:\n        actual = fn(*c["input"])\n        print(json.dumps({{"index": c["index"], "ok": actual == c["expected"], "actual": actual}}, ensure_ascii=False))\n    except Exception as e:\n        print(json.dumps({{"index": c["index"], "ok": False, "error": str(e)}}, ensure_ascii=False))\n'''
    script = work / "run.py"
    script.write_text(runner, encoding="utf-8")
    proc = run_command([PYTHON_CMD, str(script)], cwd=work)
    return parse_line_results(proc, cases)


JAVA_HELPERS = r"""
    static String toJson(Object v) {
        if (v == null) return "null";
        if (v instanceof Boolean) return v.toString();
        if (v instanceof Number) return v.toString();
        if (v instanceof String) return jsonStr((String) v);
        if (v instanceof int[]) {
            int[] a = (int[]) v;
            StringBuilder sb = new StringBuilder("[");
            for (int i = 0; i < a.length; i++) { if (i > 0) sb.append(","); sb.append(a[i]); }
            sb.append("]"); return sb.toString();
        }
        if (v instanceof long[]) {
            long[] a = (long[]) v;
            StringBuilder sb = new StringBuilder("[");
            for (int i = 0; i < a.length; i++) { if (i > 0) sb.append(","); sb.append(a[i]); }
            sb.append("]"); return sb.toString();
        }
        if (v instanceof double[]) {
            double[] a = (double[]) v;
            StringBuilder sb = new StringBuilder("[");
            for (int i = 0; i < a.length; i++) { if (i > 0) sb.append(","); sb.append(a[i]); }
            sb.append("]"); return sb.toString();
        }
        if (v instanceof boolean[]) {
            boolean[] a = (boolean[]) v;
            StringBuilder sb = new StringBuilder("[");
            for (int i = 0; i < a.length; i++) { if (i > 0) sb.append(","); sb.append(a[i]); }
            sb.append("]"); return sb.toString();
        }
        if (v instanceof Object[]) {
            Object[] a = (Object[]) v;
            StringBuilder sb = new StringBuilder("[");
            for (int i = 0; i < a.length; i++) { if (i > 0) sb.append(","); sb.append(toJson(a[i])); }
            sb.append("]"); return sb.toString();
        }
        return jsonStr(v.toString());
    }

    static String jsonStr(String s) {
        if (s == null) return "null";
        StringBuilder sb = new StringBuilder("\"");
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c == '\\') sb.append("\\\\");
            else if (c == '"') sb.append("\\\"");
            else if (c == '\n') sb.append("\\n");
            else if (c == '\r') sb.append("\\r");
            else if (c == '\t') sb.append("\\t");
            else if (c < 0x20) sb.append(String.format("\\u%04x", (int) c));
            else sb.append(c);
        }
        sb.append("\"");
        return sb.toString();
    }
"""


def run_java(problem: Dict[str, Any], code: str, cases: List[Dict[str, Any]], work: Path):
    fn_name = problem.get("functionName", "solve")

    lines: List[str] = [
        "import java.util.*;",
        "",
        "public class Main {",
        "",
        code,
        "",
        "    public static void main(String[] args) {",
    ]
    for idx in range(1, len(cases) + 1):
        lines.append(f"        runCase{idx}();")
    lines.append("    }")
    lines.append("")

    for idx, tc in enumerate(cases, start=1):
        lines.append(f"    static void runCase{idx}() {{")
        lines.append("        try {")
        arg_names = []
        for j, arg in enumerate(tc["input"]):
            t = java_type_str(arg)
            name = f"arg{j}"
            arg_names.append(name)
            lines.append(f"            {t} {name} = {java_literal(arg)};")

        exp_type = java_type_str(tc["expected"])
        lines.append(f"            {exp_type} expected = {java_literal(tc['expected'])};")
        args = ", ".join(arg_names)
        lines.append(f"            {exp_type} actual = new Main().{fn_name}({args});")
        lines.append("            boolean ok = java.util.Objects.deepEquals(actual, expected);")
        lines.append(
            f'            System.out.println("{{\\"index\\":{idx},\\"ok\\":" + (ok ? "true" : "false") + ",\\"actual\\":" + toJson(actual) + "}}");'
        )
        lines.append("        } catch (Throwable e) {")
        lines.append(
            f'            System.out.println("{{\\"index\\":{idx},\\"ok\\":false,\\"error\\":" + jsonStr(String.valueOf(e)) + "}}");'
        )
        lines.append("        }")
        lines.append("    }")
        lines.append("")

    lines.append(JAVA_HELPERS)
    lines.append("}")

    src = work / "Main.java"
    src.write_text("\n".join(lines), encoding="utf-8")

    compile_proc = run_command(["javac", str(src)], cwd=work, timeout=15.0)
    if compile_proc.returncode != 0:
        return {
            "status": "Compile Error",
            "passed": 0,
            "total": len(cases),
            "caseResults": [],
            "stderr": (compile_proc.stderr or "").strip()[:4000],
            "runtimeMs": 0,
        }

    run_proc = run_command(["java", "-cp", str(work), "Main"], cwd=work)
    return parse_line_results(run_proc, cases)


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


def run_cli(language: str, code: str, cases: List[Dict[str, Any]], work: Path) -> Dict[str, Any]:
    if language == "python":
        script = work / "solution.py"
        script.write_text(code, encoding="utf-8")
        run_cmd = ["python3", str(script)]
    elif language == "java":
        src = work / "Main.java"
        src.write_text(code, encoding="utf-8")
        compile_proc = run_command(["javac", str(src)], cwd=work, timeout=15.0)
        if compile_proc.returncode != 0:
            return {
                "status": "Compile Error", "passed": 0, "total": len(cases),
                "caseResults": [], "stderr": (compile_proc.stderr or "").strip()[:4000], "runtimeMs": 0,
            }
        run_cmd = ["java", "-cp", str(work), "Main"]
    else:  # cpp
        src = work / "main.cpp"
        src.write_text(code, encoding="utf-8")
        compile_proc = run_command(
            ["g++", "-std=c++17", "-O2", "-o", str(work / "main"), str(src)], cwd=work, timeout=15.0
        )
        if compile_proc.returncode != 0:
            return {
                "status": "Compile Error", "passed": 0, "total": len(cases),
                "caseResults": [], "stderr": (compile_proc.stderr or "").strip()[:4000], "runtimeMs": 0,
            }
        run_cmd = [str(work / "main")]

    results = []
    start = time.perf_counter()
    for i, tc in enumerate(cases, start=1):
        stdin_text = tc.get("stdin") or ""
        expected = (tc.get("expected_output") or "").strip()
        try:
            proc = subprocess.run(
                run_cmd, cwd=str(work),
                input=stdin_text, capture_output=True, text=True, timeout=TIME_LIMIT_SEC,
            )
            actual = (proc.stdout or "").strip()
            expected_lines = [ln.strip() for ln in expected.splitlines() if ln.strip()]
            passed = all(ln in actual for ln in expected_lines)
            results.append({
                "index": i, "passed": passed,
                "stdin": stdin_text, "expected": expected, "actual": actual,
                "error": (proc.stderr or "").strip()[:500],
            })
        except subprocess.TimeoutExpired:
            results.append({
                "index": i, "passed": False,
                "stdin": stdin_text, "expected": expected, "actual": "", "error": "Time Limit Exceeded",
            })

    elapsed = int((time.perf_counter() - start) * 1000)
    passed_count = sum(1 for r in results if r["passed"])
    return {
        "status": "Accepted" if passed_count == len(cases) else "Wrong Answer",
        "passed": passed_count, "total": len(cases),
        "caseResults": results, "stderr": "", "runtimeMs": elapsed,
    }


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/judge")
def judge(req: JudgeRequest):
    if req.language not in {"java", "python", "cpp"}:
        raise HTTPException(status_code=400, detail="Unsupported language")
    if req.mode not in {"run", "submit"}:
        raise HTTPException(status_code=400, detail="mode must be run|submit")

    problem = get_problem(req.problemId)
    problem_type = problem.get("type") or "coding"

    # creative/unknown 유형은 채점 없이 빈 성공 반환
    CODING_TYPES = {"coding", "cli-given"}
    if problem_type not in CODING_TYPES:
        return {"status": "Accepted", "passed": 0, "total": 0, "caseResults": [], "runtimeMs": 0}

    cases = get_cases(req.problemId, req.mode)
    if not cases:
        raise HTTPException(status_code=400, detail="No testcases")

    # testcase 스키마 기본 검증
    if problem_type == "coding":
        for tc in cases:
            if not isinstance(tc.get("input"), list):
                raise HTTPException(status_code=400, detail=f"testcase input must be a list, got: {type(tc.get('input')).__name__}")

    work = Path(tempfile.mkdtemp(prefix="judge_"))
    started = time.perf_counter()
    try:
        if problem_type == "cli-given":
            out = run_cli(req.language, req.code, cases, work)
        elif req.language == "python":
            out = run_python(problem, req.code, cases, work)
        elif req.language == "cpp":
            out = run_cpp(problem, req.code, cases, work)
        else:
            out = run_java(problem, req.code, cases, work)
    except ValueError as e:
        out = {
            "status": "Unsupported Type",
            "passed": 0,
            "total": len(cases),
            "caseResults": [],
            "stderr": str(e),
            "runtimeMs": 0,
        }
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


_SAFE_ID = re.compile(r"[^A-Za-z0-9_\-]")


def _safe_segment(s: str, default: str = "anon") -> str:
    s = _SAFE_ID.sub("_", s or "")[:64]
    return s or default


@app.post("/client/log")
def client_log(req: ClientLogRequest):
    log_root = Path(__file__).resolve().parent / "client_logs"
    user_dir = log_root / _safe_segment(req.userId)
    user_dir.mkdir(parents=True, exist_ok=True)
    phase = _safe_segment(req.phase or "normal", "normal")
    fname = (
        f"{phase}_p{req.problemId}.jsonl"
        if req.problemId is not None
        else f"{phase}_meta.jsonl"
    )
    fpath = user_dir / fname
    with fpath.open("a", encoding="utf-8") as f:
        f.write(json.dumps(req.model_dump(), ensure_ascii=False) + "\n")
    return {"ok": True}
