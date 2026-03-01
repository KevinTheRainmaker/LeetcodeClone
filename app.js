const JUDGE_API_BASE = localStorage.getItem("judgeApiBase") || "http://127.0.0.1:8000";

let problems = [];
let testcases = {};
let problemSets = [];

let selectedProblem = null;
let activeSet = null;
let activeSetQueue = [];
let activeSetIndex = 0;

let chatSessionId = localStorage.getItem("chatSessionId") || crypto.randomUUID();

const params = new URLSearchParams(window.location.search);
const runArgs = {
  setId: Number(params.get("set") || params.get("set_id") || 1),
  mode: (params.get("mode") || "memo").toLowerCase(),
  userId: params.get("user_id") || "anonymous",
  language: (params.get("lang") || "javascript").toLowerCase()
};

const allowedModes = new Set(["memo", "assistant", "socratic"]);
if (!allowedModes.has(runArgs.mode)) runArgs.mode = "memo";

const els = {
  list: document.getElementById("problemList"),
  title: document.getElementById("problemTitle"),
  difficulty: document.getElementById("difficulty"),
  desc: document.getElementById("problemDesc"),
  examples: document.getElementById("examples"),
  editor: document.getElementById("editor"),
  result: document.getElementById("result"),

  setBadge: document.getElementById("setBadge"),
  modeBadge: document.getElementById("modeBadge"),
  userBadge: document.getElementById("userBadge"),
  runBtn: document.getElementById("runBtn"),
  submitBtn: document.getElementById("submitBtn"),
  nextProblemBtn: document.getElementById("nextProblemBtn"),

  memoMode: document.getElementById("memoMode"),
  assistantMode: document.getElementById("assistantMode"),
  socraticMode: document.getElementById("socraticMode"),

  memoInput: document.getElementById("memoInput"),
  memoSavedAt: document.getElementById("memoSavedAt"),
  memoFinalSaveBtn: document.getElementById("memoFinalSaveBtn"),

  chatSessionId: document.getElementById("chatSessionId"),
  newSessionBtn: document.getElementById("newSessionBtn"),
  downloadLogBtn: document.getElementById("downloadLogBtn"),
  chatHistory: document.getElementById("chatHistory"),
  chatInput: document.getElementById("chatInput"),
  chatSendBtn: document.getElementById("chatSendBtn")
};

function nowKstString() {
  return new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
}

function logKey() {
  return `runlog:${runArgs.userId}:set${runArgs.setId}`;
}

async function logEvent(action, detail = {}) {
  const row = {
    ts: new Date().toISOString(),
    userId: runArgs.userId,
    setId: runArgs.setId,
    mode: runArgs.mode,
    problemId: selectedProblem?.id || null,
    index: activeSetIndex,
    action,
    detail
  };

  const logs = JSON.parse(localStorage.getItem(logKey()) || "[]");
  logs.push(row);
  localStorage.setItem(logKey(), JSON.stringify(logs));

  try {
    await fetch(`${JUDGE_API_BASE}/client/log`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(row)
    });
  } catch {
    // ignore network log failures
  }
}

function getMemoKey() {
  if (!selectedProblem) return `memo:${runArgs.userId}:default`;
  return `memo:${runArgs.userId}:set${runArgs.setId}:p${selectedProblem.id}`;
}

function autosaveMemo() {
  if (!selectedProblem) return;
  localStorage.setItem(getMemoKey(), els.memoInput.value);
  els.memoSavedAt.textContent = `자동저장: ${nowKstString()}`;
}

function finalSaveMemo() {
  if (!selectedProblem) return;
  const payload = {
    userId: runArgs.userId,
    setId: runArgs.setId,
    problemId: selectedProblem.id,
    problemTitle: selectedProblem.title,
    savedAt: nowKstString(),
    content: els.memoInput.value
  };
  localStorage.setItem(`${getMemoKey()}:final`, JSON.stringify(payload));
  els.memoSavedAt.textContent = `최종저장 완료: ${payload.savedAt}`;
  logEvent("memo_final_save");
}

function loadMemo() {
  if (!selectedProblem) return;
  const memo = localStorage.getItem(getMemoKey()) || "";
  els.memoInput.value = memo;
  els.memoSavedAt.textContent = memo ? `불러옴: ${nowKstString()}` : "아직 저장되지 않았습니다.";
}

function applyFixedMode() {
  els.memoMode.classList.toggle("active", runArgs.mode === "memo");
  els.assistantMode.classList.toggle("active", runArgs.mode === "assistant");
  els.socraticMode.classList.toggle("active", runArgs.mode === "socratic");
}

async function loadData() {
  try {
    const [problemsRes, testcasesRes, setsRes] = await Promise.all([
      fetch("./data/problems.json"),
      fetch("./data/testcases.json"),
      fetch("./data/problem_sets.json")
    ]);

    if (!problemsRes.ok || !testcasesRes.ok || !setsRes.ok) {
      throw new Error("문제/테스트케이스/문제세트 파일을 불러오지 못했습니다.");
    }

    problems = await problemsRes.json();
    testcases = await testcasesRes.json();
    problemSets = (await setsRes.json()).sets || [];

    activeSet = problemSets.find((s) => Number(s.setId) === Number(runArgs.setId));
    if (!activeSet) throw new Error(`set_id=${runArgs.setId} 문제세트를 찾을 수 없습니다.`);

    activeSetQueue = activeSet.problemIds || [];
    if (!activeSetQueue.length) throw new Error(`set_id=${runArgs.setId} 문제세트가 비어 있습니다.`);

    activeSetIndex = 0;
    selectedProblem = problems.find((p) => p.id === activeSetQueue[activeSetIndex]) || null;
    if (!selectedProblem) throw new Error("문제세트의 problemId가 problems.json에 없습니다.");

    initHeader();
    render();
    logEvent("session_start", { setName: activeSet.name });
  } catch (err) {
    els.result.textContent = `데이터 로드 실패: ${err.message}`;
  }
}

function initHeader() {
  els.setBadge.textContent = `SET #${runArgs.setId}`;
  els.modeBadge.textContent = `MODE: ${runArgs.mode.toUpperCase()}`;
  els.userBadge.textContent = `USER: ${runArgs.userId}`;
}

function updateNextButton() {
  const done = activeSetIndex >= activeSetQueue.length - 1;
  els.nextProblemBtn.disabled = done;
  if (done) els.nextProblemBtn.textContent = "완료";
}

function renderList() {
  els.list.innerHTML = `<h3>Problem Set</h3><div class="meta">${activeSet.name}</div>`;
  activeSetQueue.forEach((pid, idx) => {
    const p = problems.find((x) => x.id === pid);
    if (!p) return;
    const div = document.createElement("div");
    const cls = p.id === selectedProblem?.id ? "active" : "";
    div.className = `problem-item ${cls}`;
    const mark = idx < activeSetIndex ? "✅" : idx === activeSetIndex ? "▶" : "•";
    div.innerHTML = `<div class="title">${mark} ${idx + 1}. ${p.title}</div><div class="meta">${p.difficulty.toUpperCase()}</div>`;
    els.list.appendChild(div);
  });
}

function renderProblem() {
  if (!selectedProblem) return;

  els.title.textContent = `${activeSetIndex + 1}. ${selectedProblem.title}`;
  els.difficulty.textContent = selectedProblem.difficulty.toUpperCase();
  els.difficulty.className = `badge ${selectedProblem.difficulty}`;
  els.desc.textContent = selectedProblem.description;

  els.examples.innerHTML = "";
  selectedProblem.examples.forEach((ex, i) => {
    const box = document.createElement("div");
    box.className = "example";
    box.innerHTML = `<strong>Example ${i + 1}</strong><br/>Input: ${ex.input}<br/>Output: ${ex.output}`;
    els.examples.appendChild(box);
  });

  const tc = testcases[String(selectedProblem.id)] || { visible: [], hidden: [] };
  const info = document.createElement("div");
  info.className = "example";
  info.innerHTML = `<strong>Testcases:</strong> visible ${tc.visible.length}개 / hidden ${tc.hidden.length}개`;
  els.examples.appendChild(info);

  const key = `code:${runArgs.userId}:set${runArgs.setId}:p${selectedProblem.id}:${runArgs.language}`;
  const saved = localStorage.getItem(key);
  els.editor.value = saved || selectedProblem.starter[runArgs.language] || selectedProblem.starter.javascript || "";

  loadMemo();
  updateNextButton();
}

function saveCode() {
  if (!selectedProblem) return;
  const key = `code:${runArgs.userId}:set${runArgs.setId}:p${selectedProblem.id}:${runArgs.language}`;
  localStorage.setItem(key, els.editor.value);
}

function formatJudgeResponse(resp, mode) {
  const lines = [
    resp.status || "Unknown",
    `Problem: ${selectedProblem.title}`,
    `Language: ${runArgs.language}`,
    `Mode: ${mode.toUpperCase()}`,
    `Passed: ${resp.passed ?? 0}/${resp.total ?? 0}`,
    `Runtime: ${resp.runtimeMs ?? 0} ms`
  ];

  if (resp.stderr) {
    lines.push("\n[stderr]");
    lines.push(resp.stderr);
  }

  if (Array.isArray(resp.caseResults) && resp.caseResults.length) {
    lines.push("\n[Case Results]");
    resp.caseResults.forEach((c) => {
      lines.push(`\n#${c.index} ${c.passed ? "✅" : "❌"}\ninput: ${JSON.stringify(c.input)}\nexpected: ${JSON.stringify(c.expected)}\nactual: ${JSON.stringify(c.actual)}${c.error ? `\nerror: ${c.error}` : ""}`);
    });
  }
  return lines.join("\n");
}

async function judge(mode) {
  if (!selectedProblem) return "선택된 문제가 없습니다.";

  const body = {
    problemId: selectedProblem.id,
    language: runArgs.language,
    code: els.editor.value,
    mode
  };

  try {
    const res = await fetch(`${JUDGE_API_BASE}/judge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok) return `Judge API Error (${res.status})\n${JSON.stringify(data)}`;
    await logEvent(mode, { status: data.status, passed: data.passed, total: data.total });
    return formatJudgeResponse(data, mode);
  } catch (e) {
    await logEvent(mode, { error: e.message });
    return `채점 서버 연결 실패: ${e.message}\nJudge API: ${JUDGE_API_BASE}`;
  }
}

async function nextProblem() {
  if (activeSetIndex >= activeSetQueue.length - 1) return;
  activeSetIndex += 1;
  const pid = activeSetQueue[activeSetIndex];
  selectedProblem = problems.find((p) => p.id === pid) || selectedProblem;
  render();
  await logEvent("next_problem", { toIndex: activeSetIndex, toProblemId: pid });
}

function appendChat(role, text) {
  const div = document.createElement("div");
  div.className = `chat-item ${role}`;
  div.textContent = `${role === "user" ? "나" : "GPT"}: ${text}`;
  els.chatHistory.appendChild(div);
  els.chatHistory.scrollTop = els.chatHistory.scrollHeight;
}

async function sendChat() {
  const q = els.chatInput.value.trim();
  if (!q) return;
  appendChat("user", q);
  els.chatInput.value = "";
  els.chatSendBtn.disabled = true;

  try {
    const res = await fetch(`${JUDGE_API_BASE}/assistant/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: chatSessionId,
        question: q,
        problemId: selectedProblem?.id,
        language: runArgs.language,
        userId: runArgs.userId
      })
    });
    const data = await res.json();
    if (!res.ok) {
      appendChat("assistant", `오류: ${JSON.stringify(data)}`);
      return;
    }
    appendChat("assistant", data.answer || "응답이 비어 있습니다.");
    await logEvent("assistant_chat", { ok: true });
  } catch (e) {
    appendChat("assistant", `서버 연결 실패: ${e.message}`);
    await logEvent("assistant_chat", { ok: false, error: e.message });
  } finally {
    els.chatSendBtn.disabled = false;
  }
}

async function downloadLog() {
  try {
    const res = await fetch(`${JUDGE_API_BASE}/assistant/logs/${chatSessionId}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();

    const blob = new Blob([text], { type: "application/jsonl;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `chat-log-${chatSessionId}.jsonl`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    alert(`로그 다운로드 실패: ${e.message}`);
  }
}

function newChatSession() {
  chatSessionId = crypto.randomUUID();
  localStorage.setItem("chatSessionId", chatSessionId);
  els.chatSessionId.value = chatSessionId;
  els.chatHistory.innerHTML = "";
}

function render() {
  renderList();
  renderProblem();
  els.chatSessionId.value = chatSessionId;
}

els.editor.addEventListener("input", saveCode);
els.runBtn.addEventListener("click", async () => {
  saveCode();
  els.result.textContent = "Running...";
  els.result.textContent = await judge("run");
});
els.submitBtn.addEventListener("click", async () => {
  saveCode();
  els.result.textContent = "Submitting...";
  els.result.textContent = await judge("submit");
});
els.nextProblemBtn.addEventListener("click", nextProblem);

els.memoInput.addEventListener("input", autosaveMemo);
els.memoFinalSaveBtn.addEventListener("click", finalSaveMemo);
els.chatSendBtn.addEventListener("click", sendChat);
els.newSessionBtn.addEventListener("click", newChatSession);
els.downloadLogBtn.addEventListener("click", downloadLog);

applyFixedMode();
loadData();
