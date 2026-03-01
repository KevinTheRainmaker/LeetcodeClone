const JUDGE_API_BASE = localStorage.getItem("judgeApiBase") || "http://127.0.0.1:8000";

let problems = [];
let testcases = {};
let selectedProblem = null;
let currentMode = localStorage.getItem("runMode") || ""; // memo|assistant|socratic
let chatSessionId = localStorage.getItem("chatSessionId") || crypto.randomUUID();

const els = {
  list: document.getElementById("problemList"),
  title: document.getElementById("problemTitle"),
  difficulty: document.getElementById("difficulty"),
  desc: document.getElementById("problemDesc"),
  examples: document.getElementById("examples"),
  editor: document.getElementById("editor"),
  result: document.getElementById("result"),
  lang: document.getElementById("languageSelect"),
  runBtn: document.getElementById("runBtn"),
  submitBtn: document.getElementById("submitBtn"),

  modeLauncher: document.getElementById("modeLauncher"),
  startupModeSelect: document.getElementById("startupModeSelect"),
  startModeBtn: document.getElementById("startModeBtn"),
  resetModeBtn: document.getElementById("resetModeBtn"),
  modeTabs: document.getElementById("modeTabs"),
  tabMemo: document.getElementById("tabMemo"),
  tabAssistant: document.getElementById("tabAssistant"),
  tabSocratic: document.getElementById("tabSocratic"),
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

function getMemoKey() {
  if (!selectedProblem) return "memo-default";
  return `memo-${selectedProblem.id}`;
}

function autosaveMemo() {
  if (!selectedProblem) return;
  localStorage.setItem(getMemoKey(), els.memoInput.value);
  els.memoSavedAt.textContent = `자동저장: ${nowKstString()}`;
}

function finalSaveMemo() {
  if (!selectedProblem) return;
  const payload = {
    problemId: selectedProblem.id,
    problemTitle: selectedProblem.title,
    savedAt: nowKstString(),
    content: els.memoInput.value
  };
  localStorage.setItem(`${getMemoKey()}-final`, JSON.stringify(payload));
  els.memoSavedAt.textContent = `최종저장 완료: ${payload.savedAt}`;
}

function loadMemo() {
  if (!selectedProblem) return;
  const memo = localStorage.getItem(getMemoKey()) || "";
  els.memoInput.value = memo;
  els.memoSavedAt.textContent = memo ? `불러옴: ${nowKstString()}` : "아직 저장되지 않았습니다.";
}

function applyRunMode(mode) {
  currentMode = mode;
  localStorage.setItem("runMode", mode);

  els.modeLauncher.style.display = "flex";
  els.startupModeSelect.value = mode;

  els.memoMode.classList.toggle("active", mode === "memo");
  els.assistantMode.classList.toggle("active", mode === "assistant");
  els.socraticMode.classList.toggle("active", mode === "socratic");

  els.tabMemo.classList.toggle("active", mode === "memo");
  els.tabAssistant.classList.toggle("active", mode === "assistant");
  els.tabSocratic.classList.toggle("active", mode === "socratic");
}

function initRunMode() {
  if (!currentMode) {
    // 기본은 선택창 노출, 메모장 프리뷰
    els.startupModeSelect.value = "memo";
    els.memoMode.classList.add("active");
    els.assistantMode.classList.remove("active");
    els.socraticMode.classList.remove("active");
    return;
  }
  applyRunMode(currentMode);
}

async function loadData() {
  try {
    const [problemsRes, testcasesRes] = await Promise.all([
      fetch("./data/problems.json"),
      fetch("./data/testcases.json")
    ]);

    if (!problemsRes.ok || !testcasesRes.ok) {
      throw new Error("문제/테스트케이스 파일을 불러오지 못했습니다.");
    }

    problems = await problemsRes.json();
    testcases = await testcasesRes.json();

    if (!problems.length) {
      throw new Error("problems.json이 비어 있습니다.");
    }

    selectedProblem = problems[0];
    render();
  } catch (err) {
    els.result.textContent = `데이터 로드 실패: ${err.message}`;
  }
}

function renderList() {
  els.list.innerHTML = "<h3>Problems</h3>";
  for (const p of problems) {
    const div = document.createElement("div");
    div.className = `problem-item ${selectedProblem && p.id === selectedProblem.id ? "active" : ""}`;
    div.innerHTML = `<div class="title">${p.id}. ${p.title}</div><div class="meta">${p.difficulty.toUpperCase()}</div>`;
    div.onclick = () => {
      selectedProblem = p;
      render();
    };
    els.list.appendChild(div);
  }
}

function renderProblem() {
  if (!selectedProblem) return;

  els.title.textContent = `${selectedProblem.id}. ${selectedProblem.title}`;
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

  const key = `code-${selectedProblem.id}-${els.lang.value}`;
  const saved = localStorage.getItem(key);
  els.editor.value = saved || selectedProblem.starter[els.lang.value] || "";

  loadMemo();
}

function saveCode() {
  if (!selectedProblem) return;
  const key = `code-${selectedProblem.id}-${els.lang.value}`;
  localStorage.setItem(key, els.editor.value);
}

function formatJudgeResponse(resp, mode, language) {
  const lines = [
    resp.status || "Unknown",
    `Problem: ${selectedProblem.title}`,
    `Language: ${language}`,
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
    language: els.lang.value,
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
    return formatJudgeResponse(data, mode, els.lang.value);
  } catch (e) {
    return `채점 서버 연결 실패: ${e.message}\nJudge API: ${JUDGE_API_BASE}`;
  }
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
        language: els.lang.value
      })
    });
    const data = await res.json();
    if (!res.ok) {
      appendChat("assistant", `오류: ${JSON.stringify(data)}`);
      return;
    }
    appendChat("assistant", data.answer || "응답이 비어 있습니다.");
  } catch (e) {
    appendChat("assistant", `서버 연결 실패: ${e.message}`);
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

els.lang.addEventListener("change", renderProblem);
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

els.startModeBtn.addEventListener("click", () => applyRunMode(els.startupModeSelect.value));
els.resetModeBtn.addEventListener("click", () => {
  localStorage.removeItem("runMode");
  currentMode = "";
  initRunMode();
});

els.memoInput.addEventListener("input", autosaveMemo);
els.memoFinalSaveBtn.addEventListener("click", finalSaveMemo);
els.chatSendBtn.addEventListener("click", sendChat);
els.newSessionBtn.addEventListener("click", newChatSession);
els.downloadLogBtn.addEventListener("click", downloadLog);

initRunMode();
loadData();
