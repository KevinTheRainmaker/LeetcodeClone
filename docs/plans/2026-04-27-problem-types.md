# Problem Types Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 4가지 문제 유형(coding / creative-problem / cli-given / creative-cli) 지원 및 phase1/phase2 데이터 파일 분리

**Architecture:**

- `data/problems.json` (phase1, ID 1–99) + `data/phase2_problems.json` (phase2, ID 201–299) 로 파일 분리
- 각 문제에 `type` 필드 추가. 유형에 따라 프론트·서버 동작 분기
- creative 유형(2, 4)은 desc 편집 → 저장 후 에디터 활성화 2단계 플로우, 자동채점 없이 Next 활성화
- cli-given(유형 3)은 stdin/stdout 자동채점. coding(유형 1)은 기존 유지.

**Tech Stack:** Vanilla JS, FastAPI (Python), JSON data files

---

## Task 1: problems.json — type 필드 추가 + 새 문제 3개 추가

**Files:**

- Modify: `data/problems.json`

**Step 1: 기존 16개 문제에 `"type": "coding"` 필드 추가**

각 문제 오브젝트에 `"type": "coding"` 추가. 예:

```json
{
  "id": 1,
  "type": "coding",
  "slug": "development-progresses",
  ...
}
```

**Step 2: 새 문제 3개 파일 끝에 추가**

````json
{
  "id": 17,
  "type": "creative-problem",
  "slug": "make-your-own-problem",
  "title": "나만의 코딩 문제 만들기",
  "concept": "앞서 사용한 개념",
  "description": "앞서 풀었던 문제에서 사용한 알고리즘/자료구조 개념을 활용하여, 직접 코딩 테스트 문제를 설계하고 풀어보세요.\n\n[작성 가이드]\n- 어떤 상황/배경에서 이 개념이 필요한지 설명하세요\n- 함수 시그니처(입력/출력)를 명시하세요\n- 예시 입출력을 최소 1개 작성하세요\n- 제한 조건을 추가하면 더 좋습니다",
  "placeholder": "여기에 문제 설명을 작성하세요...\n\n예시 형식:\n[문제]\n...\n\n[입력]\n...\n\n[출력]\n...\n\n[예시]\n입력: ...\n출력: ...",
  "images": [],
  "examples": [],
  "starter": {
    "python": "# 위에서 직접 설계한 문제를 풀어보세요\ndef solution():\n    # TODO\n    pass\n",
    "java": "// 위에서 직접 설계한 문제를 풀어보세요\nstatic Object solution() {\n    // TODO\n    return null;\n}\n",
    "cpp": "// 위에서 직접 설계한 문제를 풀어보세요\nauto solution() {\n    // TODO\n}\n"
  }
},
{
  "id": 18,
  "type": "cli-given",
  "slug": "student-grade-manager",
  "title": "학생 성적 관리 시스템",
  "description": "아래 명세에 따라 텍스트 입출력 기반 학생 성적 관리 프로그램을 작성하세요.\n\n[명세]\n프로그램 시작 시 다음 메뉴를 반복 출력합니다:\n```\n=== 성적 관리 시스템 ===\n1. 학생 추가\n2. 전체 조회\n3. 성적 검색\n4. 종료\n선택: \n```\n\n**1. 학생 추가**\n- `이름:` 프롬프트로 이름 입력\n- `점수:` 프롬프트로 점수(0~100 정수) 입력\n- `[이름] 학생이 추가되었습니다.` 출력\n\n**2. 전체 조회**\n- `이름 | 점수` 헤더 출력 후 등록된 학생 목록 출력\n- 학생이 없으면 `등록된 학생이 없습니다.` 출력\n\n**3. 성적 검색**\n- `이름:` 프롬프트로 이름 입력\n- 해당 학생의 점수 출력. 없으면 `해당 학생을 찾을 수 없습니다.` 출력\n\n**4. 종료**\n- `프로그램을 종료합니다.` 출력 후 종료",
  "images": [],
  "examples": [
    {
      "input": "1 → 홍길동 → 85 → 2 → 4 순서로 입력",
      "output": "홍길동 학생이 추가되었습니다. / 이름 | 점수 / 홍길동 | 85",
      "explanation": "학생을 추가한 뒤 전체 조회하면 추가된 학생이 보입니다."
    }
  ],
  "starter": {
    "python": "# 학생 성적 관리 시스템을 구현하세요\ndef main():\n    students = {}\n    while True:\n        print(\"=== 성적 관리 시스템 ===\")\n        print(\"1. 학생 추가\")\n        print(\"2. 전체 조회\")\n        print(\"3. 성적 검색\")\n        print(\"4. 종료\")\n        choice = input(\"선택: \").strip()\n        # TODO\n\nif __name__ == '__main__':\n    main()\n",
    "java": "import java.util.Scanner;\nimport java.util.LinkedHashMap;\nimport java.util.Map;\n\npublic class Main {\n    public static void main(String[] args) {\n        Scanner sc = new Scanner(System.in);\n        Map<String, Integer> students = new LinkedHashMap<>();\n        while (true) {\n            System.out.println(\"=== 성적 관리 시스템 ===\");\n            System.out.println(\"1. 학생 추가\");\n            System.out.println(\"2. 전체 조회\");\n            System.out.println(\"3. 성적 검색\");\n            System.out.println(\"4. 종료\");\n            System.out.print(\"선택: \");\n            String choice = sc.nextLine().trim();\n            // TODO\n        }\n    }\n}\n",
    "cpp": "#include <iostream>\n#include <map>\n#include <string>\nusing namespace std;\n\nint main() {\n    map<string, int> students;\n    while (true) {\n        cout << \"=== 성적 관리 시스템 ===\" << endl;\n        cout << \"1. 학생 추가\" << endl;\n        cout << \"2. 전체 조회\" << endl;\n        cout << \"3. 성적 검색\" << endl;\n        cout << \"4. 종료\" << endl;\n        cout << \"선택: \";\n        string choice;\n        getline(cin, choice);\n        // TODO\n    }\n    return 0;\n}\n"
  }
},
{
  "id": 19,
  "type": "creative-cli",
  "slug": "design-your-cli",
  "title": "나만의 CLI 프로그램 설계",
  "description": "이번에는 여러분이 직접 기획자가 되어보세요.\n실제로 존재할 법한 서비스나 시스템을 하나 선택해서, 그 시스템의 핵심 기능을 구현해보세요.\n\n[조건]\n- 텍스트 입출력 기반으로 동작할 것\n- 데이터를 저장하고 조회하는 기능이 있을 것\n- 사용자가 선택할 수 있는 메뉴가 있을 것\n- 최소 3가지 이상의 핵심 기능을 포함할 것\n\n[제출물]\n- 기획한 시스템의 간단한 설명 (2~3문장)\n- 구현한 프로그램 코드",
  "placeholder": "여기에 시스템 명세를 작성하세요...\n\n예시 형식:\n[시스템 설명]\n...\n\n[핵심 기능]\n1. ...\n2. ...\n3. ...\n\n[메뉴 구조]\n...",
  "images": [],
  "examples": [],
  "starter": {
    "python": "# 직접 설계한 CLI 프로그램을 구현하세요\ndef main():\n    while True:\n        # 메뉴 출력\n        # 입력 처리\n        pass\n\nif __name__ == '__main__':\n    main()\n",
    "java": "import java.util.Scanner;\n\npublic class Main {\n    public static void main(String[] args) {\n        Scanner sc = new Scanner(System.in);\n        while (true) {\n            // 메뉴 출력 및 입력 처리\n        }\n    }\n}\n",
    "cpp": "#include <iostream>\n#include <string>\nusing namespace std;\n\nint main() {\n    while (true) {\n        // 메뉴 출력 및 입력 처리\n    }\n    return 0;\n}\n"
  }
}
````

**Step 3: 변경 확인**

JSON이 유효한지 확인:

```bash
python3 -c "import json; data=json.load(open('data/problems.json')); print(len(data), 'problems, last id:', data[-1]['id'])"
```

Expected: `19 problems, last id: 19`

**Step 4: Commit**

```bash
git add data/problems.json
git commit -m "feat: add type field to problems and 3 new problem types (ids 17-19)"
```

---

## Task 2: phase2_problems.json 생성

**Files:**

- Create: `data/phase2_problems.json`

**Step 1: phase2_problems.json 생성**

기존 phase2ProblemIds 참조 대상(ID 2, 7, 8, 10, 11, 12, 13, 14, 15, 16)을 200+ ID로 복사하고
새 유형 3개(ID 217, 218, 219)를 추가.

매핑: ID → ID+200 (2→202, 7→207, 8→208, 10→210, ..., 16→216)

파일 구조 (각 문제에 `"type": "coding"` 포함):

```json
[
  { "id": 202, "type": "coding", ...기존 problem 2와 동일 내용... },
  { "id": 207, "type": "coding", ...기존 problem 7과 동일 내용... },
  { "id": 208, "type": "coding", ...기존 problem 8과 동일 내용... },
  { "id": 210, "type": "coding", ...기존 problem 10과 동일 내용... },
  { "id": 211, "type": "coding", ...기존 problem 11과 동일 내용... },
  { "id": 212, "type": "coding", ...기존 problem 12과 동일 내용... },
  { "id": 213, "type": "coding", ...기존 problem 13과 동일 내용... },
  { "id": 214, "type": "coding", ...기존 problem 14과 동일 내용... },
  { "id": 215, "type": "coding", ...기존 problem 15과 동일 내용... },
  { "id": 216, "type": "coding", ...기존 problem 16과 동일 내용... },
  { "id": 217, "type": "creative-problem", ...문제 17과 동일 내용(id만 217)... },
  { "id": 218, "type": "cli-given", ...문제 18과 동일 내용(id만 218)... },
  { "id": 219, "type": "creative-cli", ...문제 19와 동일 내용(id만 219)... }
]
```

**Step 2: 확인**

```bash
python3 -c "import json; d=json.load(open('data/phase2_problems.json')); print(len(d), 'problems'); print([p['id'] for p in d])"
```

Expected: `13 problems` with IDs `[202, 207, 208, 210, 211, 212, 213, 214, 215, 216, 217, 218, 219]`

**Step 3: Commit**

```bash
git add data/phase2_problems.json
git commit -m "feat: create phase2_problems.json with 200+ IDs"
```

---

## Task 3: testcases.json — cli-given 테스트케이스 추가

**Files:**

- Modify: `data/testcases.json`

**Step 1: 문제 18 (cli-given) 테스트케이스 추가**

testcases.json에 `"18"` 키 추가. cli-given 형식은 `stdin` / `expected_output` 필드 사용:

```json
"18": {
  "visible": [
    {
      "stdin": "1\n홍길동\n85\n2\n4\n",
      "expected_output": "홍길동 학생이 추가되었습니다.\n이름 | 점수\n홍길동 | 85\n프로그램을 종료합니다."
    }
  ],
  "hidden": [
    {
      "stdin": "1\n김철수\n72\n1\n이영희\n91\n3\n김철수\n4\n",
      "expected_output": "김철수 학생이 추가되었습니다.\n이영희 학생이 추가되었습니다.\n김철수 | 72\n프로그램을 종료합니다."
    },
    {
      "stdin": "3\n없는학생\n4\n",
      "expected_output": "해당 학생을 찾을 수 없습니다.\n프로그램을 종료합니다."
    }
  ]
}
```

**Step 2: 확인**

```bash
python3 -c "import json; d=json.load(open('data/testcases.json')); print('18' in d, d['18']['visible'][0].keys())"
```

Expected: `True dict_keys(['stdin', 'expected_output'])`

**Step 3: Commit**

```bash
git add data/testcases.json
git commit -m "feat: add cli-given testcases for problem 18"
```

---

## Task 4: phase2_testcases.json 생성

**Files:**

- Create: `data/phase2_testcases.json`

**Step 1: 생성**

기존 phase2 대상 코딩 문제(202~216) 테스트케이스는 원본과 동일 내용을 200+키로 복사.
218은 문제 18과 동일 내용.
217, 219는 테스트케이스 없음(creative 유형).

```json
{
  "202": { ...testcases["2"]와 동일... },
  "207": { ...testcases["7"]와 동일... },
  "208": { ...testcases["8"]와 동일... },
  "210": { ...testcases["10"]와 동일... },
  "211": { ...testcases["11"]와 동일... },
  "212": { ...testcases["12"]와 동일... },
  "213": { ...testcases["13"]와 동일... },
  "214": { ...testcases["14"]와 동일... },
  "215": { ...testcases["15"]와 동일... },
  "216": { ...testcases["16"]와 동일... },
  "218": { ...testcases["18"]와 동일 내용... }
}
```

**Step 2: 확인**

```bash
python3 -c "import json; d=json.load(open('data/phase2_testcases.json')); print(sorted(d.keys()))"
```

Expected: `['202', '207', '208', '210', '211', '212', '213', '214', '215', '216', '218']`

**Step 3: Commit**

```bash
git add data/phase2_testcases.json
git commit -m "feat: create phase2_testcases.json"
```

---

## Task 5: problem_sets.json 업데이트

**Files:**

- Modify: `data/problem_sets.json`

**Step 1: phase2ProblemIds를 200+ ID로 업데이트 + 새 세트 추가**

```json
{
  "sets": [
    {
      "setId": 1,
      "name": "Pattern Tour",
      "description": "16개 대표 유형을 한 번에 훑는 풀 투어 (A~P 카테고리 각 1문제)",
      "problemIds": [1, 9, 3, 4, 5, 6, 7, 8, 17, 18, 19],
      "phase2ProblemIds": [
        202, 210, 211, 212, 213, 214, 215, 216, 217, 218, 219
      ]
    },
    {
      "setId": 2,
      "name": "Easy Foundations",
      "description": "기본기 다지기 (Easy 9문제)",
      "problemIds": [1, 2, 3, 4, 6, 17, 18, 19],
      "phase2ProblemIds": [207, 208, 212, 215, 217, 218, 219]
    },
    {
      "setId": 3,
      "name": "Medium Patterns",
      "description": "중급 패턴 (Medium 7문제)",
      "problemIds": [5, 9, 10, 11, 17, 18, 19],
      "phase2ProblemIds": [213, 214, 216, 217, 218, 219]
    },
    {
      "setId": 4,
      "name": "Mini Set (5문제)",
      "description": "코딩 2 + 창작 문제 1 + CLI 1 + 창작 CLI 1",
      "problemIds": [1, 3, 17, 18, 19],
      "phase2ProblemIds": [202, 210, 217, 218, 219]
    }
  ]
}
```

**Step 2: 확인**

```bash
python3 -c "import json; d=json.load(open('data/problem_sets.json')); [print(s['setId'], s['phase2ProblemIds']) for s in d['sets']]"
```

Expected: phase2ProblemIds에 200+ ID가 보임

**Step 3: Commit**

```bash
git add data/problem_sets.json
git commit -m "feat: update problem_sets.json phase2 IDs to 200+ range, add mini set"
```

---

## Task 6: judge-server/main.py — phase2 파일 지원 + cli-given 채점

**Files:**

- Modify: `judge-server/main.py`

**Step 1: phase2 파일 경로 상수 추가**

파일 상단 상수 블록에 추가:

```python
PHASE2_PROBLEMS_PATH = DATA_DIR / "phase2_problems.json"
PHASE2_TESTCASES_PATH = DATA_DIR / "phase2_testcases.json"
```

**Step 2: get_problem / get_cases를 ID 범위로 분기**

기존 `get_problem()` / `get_cases()` 대체:

```python
def get_problem(problem_id: int) -> Dict[str, Any]:
    path = PHASE2_PROBLEMS_PATH if problem_id >= 200 else PROBLEMS_PATH
    problems = load_json(path)
    for p in problems:
        if p.get("id") == problem_id:
            return p
    raise HTTPException(status_code=404, detail=f"Problem not found: {problem_id}")


def get_cases(problem_id: int, mode: str) -> List[Dict[str, Any]]:
    path = PHASE2_TESTCASES_PATH if problem_id >= 200 else TESTCASES_PATH
    testcases = load_json(path)
    key = str(problem_id)
    if key not in testcases:
        return []  # creative 유형은 testcase 없음 — 빈 리스트 반환
    visible = testcases[key].get("visible", [])
    hidden = testcases[key].get("hidden", [])
    return visible + hidden if mode == "submit" else visible
```

**Step 3: CLI 채점 함수 추가**

`parse_line_results` 함수 뒤에 추가:

```python
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
        compile_proc = run_command(["g++", "-std=c++17", "-O2", "-o", str(work / "main"), str(src)], cwd=work, timeout=15.0)
        if compile_proc.returncode != 0:
            return {
                "status": "Compile Error", "passed": 0, "total": len(cases),
                "caseResults": [], "stderr": (compile_proc.stderr or "").strip()[:4000], "runtimeMs": 0,
            }
        run_cmd = [str(work / "main")]

    results = []
    start = time.perf_counter()
    for i, tc in enumerate(cases, start=1):
        stdin_text = tc.get("stdin", "")
        expected = (tc.get("expected_output", "") or "").strip()
        try:
            proc = subprocess.run(
                run_cmd, cwd=str(work),
                input=stdin_text, capture_output=True, text=True, timeout=TIME_LIMIT_SEC,
            )
            actual = (proc.stdout or "").strip()
            # 핵심 줄들이 모두 포함되어 있으면 통과 (순서 무관, 부분 포함)
            expected_lines = [ln.strip() for ln in expected.splitlines() if ln.strip()]
            passed = all(ln in actual for ln in expected_lines)
            results.append({
                "index": i, "passed": passed,
                "stdin": stdin_text, "expected": expected, "actual": actual,
                "error": (proc.stderr or "").strip()[:500],
            })
        except subprocess.TimeoutExpired:
            results.append({"index": i, "passed": False, "stdin": stdin_text,
                            "expected": expected, "actual": "", "error": "Time Limit Exceeded"})

    elapsed = int((time.perf_counter() - start) * 1000)
    passed_count = sum(1 for r in results if r["passed"])
    return {
        "status": "Accepted" if passed_count == len(cases) else "Wrong Answer",
        "passed": passed_count, "total": len(cases),
        "caseResults": results, "stderr": "", "runtimeMs": elapsed,
    }
```

**Step 4: /judge 엔드포인트 분기 수정**

기존 `/judge` 핸들러에서:

1. `get_cases()` 반환이 빈 리스트여도 creative 유형이면 에러 내지 않도록 수정
2. `problem_type`에 따라 `run_cli()` 또는 기존 runner 호출

```python
@app.post("/judge")
def judge(req: JudgeRequest):
    if req.language not in {"java", "python", "cpp"}:
        raise HTTPException(status_code=400, detail="Unsupported language")
    if req.mode not in {"run", "submit"}:
        raise HTTPException(status_code=400, detail="mode must be run|submit")

    problem = get_problem(req.problemId)
    problem_type = problem.get("type", "coding")
    cases = get_cases(req.problemId, req.mode)

    # creative 유형은 프론트에서 judge 호출 안 함 — 혹시 호출되면 빈 성공 반환
    if problem_type in ("creative-problem", "creative-cli"):
        return {"status": "Accepted", "passed": 0, "total": 0, "caseResults": [], "runtimeMs": 0}

    if not cases:
        raise HTTPException(status_code=400, detail="No testcases")

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
    except subprocess.TimeoutExpired:
        out = {
            "status": "Time Limit Exceeded", "passed": 0, "total": len(cases),
            "caseResults": [], "stderr": "Execution timeout",
            "runtimeMs": int((time.perf_counter() - started) * 1000),
        }
    finally:
        shutil.rmtree(work, ignore_errors=True)

    out["runtimeMs"] = out.get("runtimeMs") or int((time.perf_counter() - started) * 1000)
    return out
```

**Step 5: 확인**

```bash
cd judge-server && python3 -c "from main import get_problem; print(get_problem(17)['type']); print(get_problem(202)['type'])"
```

Expected: `creative-problem` / `coding`

**Step 6: Commit**

```bash
git add judge-server/main.py
git commit -m "feat: judge server supports phase2 files and cli-given stdin/stdout judging"
```

---

## Task 7: app.js — loadData() 양쪽 파일 로드

**Files:**

- Modify: `app.js`

**Step 1: loadData() 수정**

기존 `loadData()` 함수에서 `problems.json`만 fetch → 두 파일 모두 fetch 후 merge:

```javascript
async function loadData() {
  const [p1, p2, t, s] = await Promise.all([
    fetch("./data/problems.json").then((r) => r.json()),
    fetch("./data/phase2_problems.json").then((r) => r.json()).catch(() => []),
    fetch("./data/testcases.json").then((r) => r.json()),
    fetch("./data/problem_sets.json").then((r) => r.json()),
  ]);
  state.problems = [...p1, ...p2];
  state.testcases = t;
  state.sets = s.sets || [];
  // ... 이하 기존 코드 동일
```

**Step 2: 확인 (브라우저 콘솔)**

- `http://localhost:8080/?set=4&mode=memo&user_id=test` 접속
- 콘솔에서 `state.problems.length` → 19개 이상 확인

**Step 3: Commit**

```bash
git add app.js
git commit -m "feat: loadData merges problems.json and phase2_problems.json"
```

---

## Task 8: app.js — render() 문제 유형별 desc 패널 분기

**Files:**

- Modify: `app.js`

**Step 1: state에 descSaved 필드 추가**

`state` 객체 초기화 부분에 `descSaved: false` 추가:

```javascript
const state = {
  ...
  explainLocked: false,
  descSaved: false,   // ← 추가
};
```

**Step 2: descKey helper 함수 추가 (saveCode 근처에)**

```javascript
function descKey() {
  const p = currentProblem();
  if (!p || !session.userId) return null;
  return `desc:${session.userId}:p${p.id}`;
}

function saveDesc(text) {
  const k = descKey();
  if (k) localStorage.setItem(k, text);
}

function loadDesc() {
  const k = descKey();
  return k ? localStorage.getItem(k) : null;
}
```

**Step 3: isCreativeType / isCliType helper 함수 추가**

```javascript
function isCreativeType(p) {
  return p?.type === "creative-problem" || p?.type === "creative-cli";
}

function isCliType(p) {
  return p?.type === "cli-given" || p?.type === "creative-cli";
}
```

**Step 4: render() 함수 수정**

기존 `render()` 에서 `els.pDesc.innerHTML = buildDescHtml(p);` 부분을 대체:

```javascript
function renderDescPanel(p) {
  const saved = loadDesc();
  const alreadySaved = saved !== null;

  if (isCreativeType(p)) {
    // desc 편집 영역
    els.pDesc.innerHTML = "";

    const instructions = document.createElement("div");
    instructions.className = "p-desc creative-instructions";
    instructions.innerHTML = buildDescHtml(p);
    els.pDesc.appendChild(instructions);

    const label = document.createElement("div");
    label.className = "p-section-title";
    label.textContent = alreadySaved
      ? "내가 작성한 문제 (저장됨)"
      : "문제 작성";
    els.pDesc.appendChild(label);

    const textarea = document.createElement("textarea");
    textarea.id = "descEditArea";
    textarea.className = "desc-edit-area";
    textarea.placeholder = p.placeholder || "내용을 입력하세요...";
    textarea.value = saved || "";
    textarea.readOnly = alreadySaved;
    els.pDesc.appendChild(textarea);

    if (!alreadySaved) {
      const saveBtn = document.createElement("button");
      saveBtn.className = "btn primary desc-save-btn";
      saveBtn.textContent = "저장";
      saveBtn.addEventListener("click", () => {
        const text = textarea.value.trim();
        if (!text) {
          showToast("내용을 입력하세요");
          return;
        }
        saveDesc(text);
        state.descSaved = true;
        logEvent("desc_save", { chars: text.length, problemType: p.type });
        renderDescPanel(p); // re-render locked
        applyDescLock();
      });
      els.pDesc.appendChild(saveBtn);
    } else {
      const badge = document.createElement("div");
      badge.className = "desc-saved-badge";
      badge.textContent = "✓ 저장됨 — 아래 에디터에서 코드를 작성하세요";
      els.pDesc.appendChild(badge);
    }

    state.descSaved = alreadySaved;
  } else {
    // 기존 방식
    els.pDesc.innerHTML = buildDescHtml(p);
  }
}
```

**Step 5: render() 안에서 `els.pDesc.innerHTML = buildDescHtml(p)` 를 `renderDescPanel(p)` 로 교체**

또한 render() 끝 부분(phase2 처리) 수정:

```javascript
// 기존 코드
if (runArgs.mode === "phase2") {
  state.explainLocked = true;
  ...
}
applyExplainLock();

// 수정 후
const isPhase2Coding = runArgs.mode === "phase2" && p?.type === "coding";
state.explainLocked = isPhase2Coding;
if (isPhase2Coding) {
  if (els.explainList) els.explainList.innerHTML = "";
  if (els.explainInput) els.explainInput.value = "";
}
applyExplainLock();
applyDescLock();
```

**Step 6: Commit**

```bash
git add app.js
git commit -m "feat: render desc panel differently for creative problem types"
```

---

## Task 9: app.js — applyDescLock() + wireUp() 연결

**Files:**

- Modify: `app.js`

**Step 1: applyDescLock 함수 추가 (applyExplainLock 근처에)**

```javascript
function applyDescLock() {
  const p = currentProblem();
  const needsLock = isCreativeType(p) && !state.descSaved;
  if (els.codeInput)
    els.codeInput.readOnly = needsLock || !!state.explainLocked;
  if (els.runBtn) els.runBtn.disabled = needsLock || !!state.explainLocked;
  if (els.submitBtn)
    els.submitBtn.disabled = needsLock || !!state.explainLocked;
  if (needsLock && els.nextBtn) els.nextBtn.disabled = true;

  // 에디터 영역 시각적 비활성화
  els.codeArea?.classList.toggle("editor-locked", needsLock);
}
```

**Step 2: boot() 안에서 applyDescLock() 호출 추가**

기존 `applyExplainLock()` 호출 바로 다음에:

```javascript
applyExplainLock();
applyDescLock(); // ← 추가
```

**Step 3: Commit**

```bash
git add app.js
git commit -m "feat: applyDescLock controls editor access for creative types"
```

---

## Task 10: app.js — judge() 함수 창작 유형 처리

**Files:**

- Modify: `app.js`

**Step 1: judge() 함수 상단에 creative 유형 분기 추가**

기존 `judge(mode)` 함수 첫 부분에 추가:

```javascript
async function judge(mode) {
  const p = currentProblem();
  if (!p) return;

  // creative 유형: 자동채점 없이 저장 후 Next 활성화
  if (isCreativeType(p) && mode === "submit") {
    saveCode();
    const desc = loadDesc() || "";
    logEvent("creative_submit", {
      problemType: p.type,
      desc,
      code: state.code,
      codeLength: state.code.length,
    });
    if (!state.solved.has(state.idx)) {
      state.solved.add(state.idx);
      saveProgress(session.userId, { solvedIdx: [...state.solved] });
      logEvent("problem_solved", { problemIdx: state.idx });
    }
    updateNextGate();
    renderProbList();
    termPush(`<span class="term-ok">✓ 제출 완료 — NEXT 버튼으로 다음 문제로 이동하세요.</span>`);
    return;
  }

  // cli-given Run 모드: 터미널 실행 표시
  if (p.type === "cli-given" && mode === "run") {
    termPush(`<span class="term-muted">$ ${escapeHtml(state.lang)} solution (stdin 테스트케이스 적용)</span>`);
  }

  // 이하 기존 코드...
  saveCode();
  ...
```

**Step 2: cli-given 터미널 출력 형식 수정**

기존 `caseResults.forEach` 블록에서 cli-given 유형이면 stdin/stdout 표시:

```javascript
if (Array.isArray(data.caseResults)) {
  data.caseResults.forEach((c) => {
    if (p.type === "cli-given") {
      // CLI 결과: stdin 입력과 실제 출력 표시
      if (c.passed) {
        termPush(
          `<span class="term-ok">  ✓ case #${c.index}</span> <span class="term-muted">stdin: ${escapeHtml((c.stdin || "").slice(0, 80).replace(/\n/g, "↵"))}</span>`,
        );
      } else {
        termPush(`<span class="term-err">  ✗ case #${c.index}</span>`);
        if (c.stdin)
          termPush(
            `<span class="term-muted">    stdin: ${escapeHtml((c.stdin || "").replace(/\n/g, "↵"))}</span>`,
          );
        if (c.expected)
          termPush(
            `<span class="term-muted">    expected: ${escapeHtml((c.expected || "").slice(0, 300))}</span>`,
          );
        if (c.actual)
          termPush(
            `<span class="term-muted">    actual:   ${escapeHtml((c.actual || "").slice(0, 300))}</span>`,
          );
        if (c.error)
          termPush(
            `<span class="term-err">    error: ${escapeHtml(String(c.error).slice(0, 200))}</span>`,
          );
      }
    } else {
      // 기존 coding 유형 결과 표시
      if (c.passed) {
        termPush(`<span class="term-ok">  ✓ case #${c.index} passed</span>`);
      } else {
        termPush(
          `<span class="term-err">  ✗ case #${c.index} failed</span> <span class="term-muted">input=${escapeHtml(JSON.stringify(c.input))} expected=${escapeHtml(JSON.stringify(c.expected))} actual=${escapeHtml(JSON.stringify(c.actual))}${c.error ? " err=" + escapeHtml(String(c.error).slice(0, 200)) : ""}</span>`,
        );
      }
    }
  });
}
```

**Step 3: Commit**

```bash
git add app.js
git commit -m "feat: judge() handles creative submit (no-judge) and cli-given terminal output"
```

---

## Task 11: HTML + CSS — desc-edit-area 스타일

**Files:**

- Modify: `styles.css`

**Step 1: 창작 유형 desc 편집 영역 스타일 추가**

```css
/* Creative problem desc editing */
.desc-edit-area {
  width: 100%;
  min-height: 180px;
  max-height: 400px;
  padding: 12px;
  background: var(--bg-2, #1e2026);
  border: 1px solid var(--border, #2a2d35);
  border-radius: 6px;
  color: var(--fg, #e0e2e8);
  font-family: "JetBrains Mono", monospace;
  font-size: 13px;
  line-height: 1.6;
  resize: vertical;
  box-sizing: border-box;
  margin: 8px 0;
}
.desc-edit-area:focus {
  outline: none;
  border-color: var(--accent);
}
.desc-edit-area[readonly] {
  opacity: 0.75;
  cursor: default;
  background: var(--bg-1, #16181d);
}
.desc-save-btn {
  margin-top: 4px;
  width: 100%;
}
.desc-saved-badge {
  margin-top: 8px;
  padding: 8px 12px;
  background: oklch(0.25 0.08 150 / 0.4);
  border: 1px solid oklch(0.5 0.15 150 / 0.5);
  border-radius: 4px;
  color: oklch(0.8 0.15 150);
  font-size: 12px;
}
.creative-instructions {
  margin-bottom: 12px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border, #2a2d35);
}
.editor-locked {
  opacity: 0.45;
  pointer-events: none;
}
```

**Step 2: Commit**

```bash
git add styles.css
git commit -m "feat: styles for creative problem desc editing area"
```

---

## Task 12: 통합 테스트

**Step 1: 프론트엔드 서버 실행**

```bash
python3 -m http.server 8080
```

**Step 2: 각 유형 확인**

| URL                                | 확인 항목                                                                           |
| ---------------------------------- | ----------------------------------------------------------------------------------- |
| `/?set=4&mode=memo&user_id=test`   | 문제 1,3(coding), 17(creative-problem), 18(cli-given), 19(creative-cli) 순서로 로드 |
| phase1 coding (문제 1)             | 기존과 동일하게 desc 정적, 에디터 즉시 활성                                         |
| phase1 creative-problem (문제 17)  | desc에 textarea + 저장 버튼 표시, 저장 전 에디터 잠김, 저장 후 에디터 활성          |
| phase1 cli-given (문제 18)         | desc 정적, 에디터 즉시 활성, Run/Submit 동작 확인                                   |
| phase1 creative-cli (문제 19)      | textarea + 저장 버튼, 저장 후 에디터 활성, Submit 시 Next 활성                      |
| `/?set=4&mode=phase2&user_id=test` | phase2 문제(202, 210, 217, 218, 219) 로드 확인                                      |
| phase2 coding (문제 202)           | explain overlay 표시 확인                                                           |
| phase2 creative (문제 217)         | explain overlay 없음, desc textarea 표시                                            |

**Step 3: Judge 서버 테스트 (로컬)**

```bash
cd judge-server && uvicorn main:app --reload --port 8000
```

문제 18 cli-given submit 테스트:

```bash
curl -X POST http://127.0.0.1:8000/judge \
  -H "Content-Type: application/json" \
  -d '{"problemId": 18, "language": "python", "code": "def main():\n    students={}\n    while True:\n        print(\"=== 성적 관리 시스템 ===\")\n        print(\"1. 학생 추가\")\n        print(\"2. 전체 조회\")\n        print(\"3. 성적 검색\")\n        print(\"4. 종료\")\n        c=input(\"선택: \").strip()\n        if c==\"1\":\n            n=input(\"이름: \").strip()\n            s=int(input(\"점수: \").strip())\n            students[n]=s\n            print(f\"{n} 학생이 추가되었습니다.\")\n        elif c==\"2\":\n            if not students: print(\"등록된 학생이 없습니다.\")\n            else:\n                print(\"이름 | 점수\")\n                for k,v in students.items(): print(f\"{k} | {v}\")\n        elif c==\"3\":\n            n=input(\"이름: \").strip()\n            if n in students: print(f\"{n} | {students[n]}\")\n            else: print(\"해당 학생을 찾을 수 없습니다.\")\n        elif c==\"4\":\n            print(\"프로그램을 종료합니다.\")\n            break\nif __name__==\"__main__\": main()", "mode": "submit"}'
```

Expected: `"status": "Accepted"`, `"passed": 1`

**Step 4: Final Commit**

```bash
git add -A
git commit -m "feat: complete 4-problem-type implementation with phase1/phase2 file split"
```
