// ─────────────────────────────────────────────
// Coding Platform · frontend logic
// Dark IDE redesign wired to judge-server backend
// ─────────────────────────────────────────────

// API endpoints. By default talk to Vercel serverless proxies (/api/*).
// For local development outside Vercel, set localStorage.judgeApiBase to the
// judge-server origin (e.g. http://127.0.0.1:8000) — the frontend will then
// call /judge and /client/log directly on that origin, and /api/chat will
// still work only if vercel dev is running.
const JUDGE_API_BASE_OVERRIDE = localStorage.getItem("judgeApiBase") || "";
const JUDGE_URL = JUDGE_API_BASE_OVERRIDE
  ? `${JUDGE_API_BASE_OVERRIDE.replace(/\/$/, "")}/judge`
  : "/api/judge";
const LOG_ENDPOINT = JUDGE_API_BASE_OVERRIDE
  ? `${JUDGE_API_BASE_OVERRIDE.replace(/\/$/, "")}/client/log`
  : "/api/log";
const CHAT_URL = "/api/chat";

const PARAMS = new URLSearchParams(window.location.search);
const runArgs = {
  setId: PARAMS.get("set") || PARAMS.get("set_id") || null,
  userIdParam: PARAMS.get("user_id") || null,
  language: (PARAMS.get("lang") || "python").toLowerCase(),
};
if (!["javascript", "python", "cpp"].includes(runArgs.language)) {
  runArgs.language = "python";
}

const SESSION_USER_KEY = "cp_user_id";
const LOG_QUEUE_KEY = "cp_log_queue";

const session = {
  userId: null,
  sessionId: null,
  startedAt: null,
};

const state = {
  problems: [],
  sets: [],
  testcases: {},
  queue: [],
  idx: 0,
  solved: new Set(),
  lang: runArgs.language,
  code: "",
  runResult: null,
  accent: "cyan",
  density: "comfortable",
};

const els = {};
function cacheEls() {
  const ids = [
    "pTitle",
    "pDiff",
    "pSlug",
    "pFn",
    "pDesc",
    "pExamples",
    "qCounter",
    "fileName",
    "langChip",
    "gutter",
    "codeHighlight",
    "codeInput",
    "codeArea",
    "termBody",
    "runBtn",
    "submitBtn",
    "nextBtn",
    "timer",
    "railProbs",
    "railAi",
    "railSettings",
    "aiPanel",
    "aiClose",
    "aiBody",
    "aiInput",
    "aiSend",
    "aiModel",
    "tweaks",
    "userChip",
    "userChipName",
    "exportBtn",
    "resetBtn",
    "formatBtn",
    "moreBtn",
    "diffBtn",
    "minimap",
    "app",
  ];
  ids.forEach((id) => (els[id] = document.getElementById(id)));
}

// ────────────── Logging (central server) ──────────────
function logEvent(action, detail = {}) {
  if (!session.userId) return;
  const p = currentProblem();
  const row = {
    ts: new Date().toISOString(),
    userId: session.userId,
    sessionId: session.sessionId,
    setId: runArgs.setId,
    language: state.lang,
    problemId: p?.id ?? null,
    problemIdx: state.idx,
    action,
    detail,
  };
  const mirrorKey = `cp_log_${session.userId}`;
  const mirror = JSON.parse(localStorage.getItem(mirrorKey) || "[]");
  mirror.push(row);
  localStorage.setItem(mirrorKey, JSON.stringify(mirror));

  const q = JSON.parse(localStorage.getItem(LOG_QUEUE_KEY) || "[]");
  q.push(row);
  localStorage.setItem(LOG_QUEUE_KEY, JSON.stringify(q));
  flushLogs();
}

let flushing = false;
async function flushLogs() {
  if (flushing) return;
  flushing = true;
  try {
    const q = JSON.parse(localStorage.getItem(LOG_QUEUE_KEY) || "[]");
    if (!q.length) return;
    const remaining = [];
    for (const row of q) {
      try {
        const res = await fetch(LOG_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(row),
          keepalive: true,
        });
        if (!res.ok) remaining.push(row);
      } catch {
        remaining.push(row);
      }
    }
    localStorage.setItem(LOG_QUEUE_KEY, JSON.stringify(remaining));
  } finally {
    flushing = false;
  }
}
setInterval(flushLogs, 15_000);
window.addEventListener("online", flushLogs);
window.addEventListener("beforeunload", () => {
  if (!session.userId) return;
  const row = {
    ts: new Date().toISOString(),
    userId: session.userId,
    sessionId: session.sessionId,
    setId: runArgs.setId,
    action: "session_end",
    detail: { problemIdx: state.idx, solvedCount: state.solved.size },
  };
  try {
    navigator.sendBeacon(
      LOG_ENDPOINT,
      new Blob([JSON.stringify(row)], { type: "application/json" }),
    );
  } catch {}
});

// ────────────── Progress persistence ──────────────
const progressKey = (uid) => `cp_progress_${uid}`;
function getProgress(uid) {
  try {
    return JSON.parse(localStorage.getItem(progressKey(uid)) || "{}");
  } catch {
    return {};
  }
}
function saveProgress(uid, patch) {
  const cur = getProgress(uid);
  const next = { ...cur, ...patch, lastSeenAt: new Date().toISOString() };
  localStorage.setItem(progressKey(uid), JSON.stringify(next));
}

// ────────────── Data load ──────────────
async function loadData() {
  const [p, t, s] = await Promise.all([
    fetch("./data/problems.json").then((r) => r.json()),
    fetch("./data/testcases.json").then((r) => r.json()),
    fetch("./data/problem_sets.json").then((r) => r.json()),
  ]);
  state.problems = p;
  state.testcases = t;
  state.sets = s.sets || [];

  // Build queue: URL set= selects a single set; otherwise merge all sets (max 20)
  let pool = [];
  if (runArgs.setId) {
    const match = state.sets.find(
      (x) => Number(x.setId) === Number(runArgs.setId),
    );
    if (match) pool = (match.problemIds || []).slice();
  }
  if (!pool.length) {
    state.sets.forEach((set) =>
      (set.problemIds || []).forEach((id) => {
        if (!pool.includes(id)) pool.push(id);
      }),
    );
  }
  if (!pool.length) pool = state.problems.map((x) => x.id);
  state.queue = pool.slice(0, 20);

  // Resume progress
  const prog = getProgress(session.userId);
  state.solved = new Set(prog.solvedIdx || []);
  let resumeIdx = prog.idx ?? 0;
  for (let i = 0; i < state.queue.length; i++) {
    if (!state.solved.has(i)) {
      resumeIdx = i;
      break;
    }
    if (i === state.queue.length - 1) resumeIdx = i;
  }
  state.idx = resumeIdx;

  render();
  logEvent("session_start", {
    resumedFrom: state.idx,
    solvedCount: state.solved.size,
    queueLength: state.queue.length,
  });
}

function currentProblem() {
  if (!state.queue.length) return null;
  return state.problems.find((p) => p.id === state.queue[state.idx]);
}

// ────────────── Render ──────────────
function escapeHtml(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c],
  );
}

function renderProbList() {
  const host = els.railProbs;
  if (!host) return;
  const total = state.queue.length;
  host.innerHTML = "";
  for (let i = 0; i < total; i++) {
    const solved = state.solved.has(i);
    const current = i === state.idx;
    const locked = !solved && !current;
    const node = document.createElement("div");
    node.className =
      `p-node ${solved ? "solved" : ""} ${current ? "current" : ""} ${locked ? "locked" : ""}`.trim();
    node.title = `Problem ${i + 1}${solved ? " · solved" : current ? " · current" : " · locked"}`;
    node.innerHTML =
      `<span class="num">${String(i + 1).padStart(2, "0")}</span>` +
      (solved
        ? `<svg viewBox="0 0 24 24"><polyline points="4 12 10 18 20 6"/></svg>`
        : locked
          ? `<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>`
          : `<span class="num-big">${i + 1}</span>`);
    host.appendChild(node);
  }
  const cur = host.querySelector(".p-node.current");
  if (cur) cur.scrollIntoView({ block: "nearest" });
}

function updateNextGate() {
  const canAdvance =
    state.solved.has(state.idx) && state.idx < state.queue.length - 1;
  els.nextBtn.disabled = !canAdvance;
  els.nextBtn.title = canAdvance
    ? "다음 문제로 이동"
    : state.idx >= state.queue.length - 1
      ? "마지막 문제입니다"
      : "Submit으로 모든 테스트를 통과해야 다음 문제로 이동할 수 있습니다";
}

function render() {
  const p = currentProblem();
  if (!p) return;

  els.pTitle.textContent = `Task ${state.idx + 1}: ${p.title}`;
  els.pDiff.textContent = p.difficulty || "medium";
  els.pDiff.className = `p-tag ${p.difficulty || "medium"}`;
  els.pSlug.textContent = p.slug || "";
  els.pFn.textContent = p.functionName ? `fn: ${p.functionName}` : "";

  const descSafe = escapeHtml(p.description || "");
  els.pDesc.innerHTML = `<p>${descSafe}</p>`;

  els.pExamples.innerHTML = "";
  (p.examples || []).forEach((ex, i) => {
    const box = document.createElement("div");
    box.className = "example";
    box.innerHTML = `
      <div class="ex-label">Example ${i + 1}</div>
      <div class="ex-row"><span class="ex-k">Input</span><span class="ex-v">${escapeHtml(ex.input)}</span></div>
      <div class="ex-row"><span class="ex-k">Output</span><span class="ex-v">${escapeHtml(ex.output)}</span></div>
    `;
    els.pExamples.appendChild(box);
  });

  els.qCounter.textContent = `Question ${state.idx + 1} of ${state.queue.length}`;

  renderProbList();
  updateNextGate();

  const ext = { python: "py", javascript: "js", cpp: "cpp" }[state.lang];
  const fnKebab = (p.slug || "solution").replace(/-/g, "_");
  els.fileName.textContent = `${fnKebab}.${ext}`;
  els.langChip.textContent =
    state.lang === "python"
      ? "Python 3"
      : state.lang === "javascript"
        ? "JavaScript · Node"
        : "C++ · g++";

  // Load saved code for this user/problem/language, else starter
  const codeKey = `code:${session.userId}:p${p.id}:${state.lang}`;
  const saved = localStorage.getItem(codeKey);
  state.code =
    saved ??
    p.starter?.[state.lang] ??
    p.starter?.javascript ??
    "// starter missing";
  els.codeInput.value = state.code;
  paintEditor();
}

// ────────────── Syntax highlight (overlay) ──────────────
const KW = {
  python: new Set([
    "def",
    "return",
    "if",
    "elif",
    "else",
    "for",
    "while",
    "in",
    "not",
    "and",
    "or",
    "import",
    "from",
    "class",
    "pass",
    "None",
    "True",
    "False",
    "with",
    "as",
    "try",
    "except",
    "finally",
    "raise",
    "lambda",
    "async",
    "await",
    "yield",
    "self",
    "print",
  ]),
  javascript: new Set([
    "function",
    "const",
    "let",
    "var",
    "return",
    "if",
    "else",
    "for",
    "while",
    "in",
    "of",
    "new",
    "class",
    "this",
    "null",
    "true",
    "false",
    "undefined",
    "import",
    "from",
    "export",
    "async",
    "await",
    "try",
    "catch",
    "finally",
    "throw",
    "typeof",
    "instanceof",
  ]),
  cpp: new Set([
    "int",
    "return",
    "if",
    "else",
    "for",
    "while",
    "class",
    "struct",
    "public",
    "private",
    "protected",
    "auto",
    "const",
    "void",
    "vector",
    "string",
    "bool",
    "true",
    "false",
    "nullptr",
    "include",
    "using",
    "namespace",
    "std",
    "char",
    "double",
    "float",
    "long",
    "short",
    "unsigned",
    "signed",
    "template",
    "typename",
  ]),
};

function findComment(line, marker) {
  let inStr = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inStr) {
      if (ch === inStr) inStr = null;
    } else if (ch === '"' || ch === "'") {
      inStr = ch;
    } else if (
      marker.length === 1
        ? ch === marker
        : line.slice(i, i + marker.length) === marker
    ) {
      return i;
    }
  }
  return -1;
}

function highlightLine(line, lang) {
  const kws = KW[lang] || KW.python;
  const commentMarker = lang === "python" ? "#" : "//";
  const ci = findComment(line, commentMarker);
  const codePart = ci === -1 ? line : line.slice(0, ci);
  const commentPart = ci === -1 ? "" : line.slice(ci);

  let out = "";
  let i = 0;
  const n = codePart.length;
  while (i < n) {
    const ch = codePart[i];
    if (ch === " " || ch === "\t") {
      out += ch;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < n && codePart[j] !== ch) {
        if (codePart[j] === "\\") j++;
        j++;
      }
      const str = codePart.slice(i, Math.min(j + 1, n));
      out += `<span class="str">${escapeHtml(str)}</span>`;
      i = j + 1;
      continue;
    }
    if (/\d/.test(ch)) {
      let j = i;
      while (j < n && /[\d.]/.test(codePart[j])) j++;
      out += `<span class="num-tok">${escapeHtml(codePart.slice(i, j))}</span>`;
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i;
      while (j < n && /[A-Za-z0-9_]/.test(codePart[j])) j++;
      const ident = codePart.slice(i, j);
      let k = j;
      while (k < n && codePart[k] === " ") k++;
      const isCall = codePart[k] === "(";
      if (kws.has(ident)) {
        out += `<span class="kw">${escapeHtml(ident)}</span>`;
      } else if (isCall) {
        out += `<span class="fn">${escapeHtml(ident)}</span>`;
      } else {
        out += escapeHtml(ident);
      }
      i = j;
      continue;
    }
    out += escapeHtml(ch);
    i++;
  }

  if (commentPart) {
    out += `<span class="com">${escapeHtml(commentPart)}</span>`;
  }
  return out;
}

function paintEditor() {
  const code = els.codeInput.value;
  state.code = code;
  const lines = code.split("\n");
  // gutter
  els.gutter.innerHTML = lines.map((_, i) => `<div>${i + 1}</div>`).join("");
  // highlight
  els.codeHighlight.innerHTML = lines
    .map((ln) => highlightLine(ln, state.lang) || "&nbsp;")
    .join("\n");
  // minimap: per-line class by dominant token
  if (els.minimap) {
    const commentMarker = state.lang === "python" ? "#" : "//";
    const miniHtml = lines
      .map((ln) => {
        const trimmed = ln.trim();
        if (!trimmed) return `<div class="mini-line"></div>`;
        let cls = "";
        if (trimmed.startsWith(commentMarker)) cls = "com";
        else if (/["']/.test(trimmed)) cls = "str";
        else if (
          /\b(def|function|return|class|if|else|for|while|import|const|let|var|public|private)\b/.test(
            trimmed,
          )
        )
          cls = "kw";
        else if (/\w+\s*\(/.test(trimmed)) cls = "fn";
        return `<div class="mini-line ${cls}"></div>`;
      })
      .join("");
    const viewport = `<div class="viewport"></div>`;
    els.minimap.innerHTML = miniHtml + viewport;
  }
  // sync scroll
  els.codeHighlight.scrollTop = els.codeInput.scrollTop;
  els.codeHighlight.scrollLeft = els.codeInput.scrollLeft;
  els.gutter.scrollTop = els.codeInput.scrollTop;
}

function saveCode() {
  const p = currentProblem();
  if (!p || !session.userId) return;
  const key = `code:${session.userId}:p${p.id}:${state.lang}`;
  localStorage.setItem(key, state.code);
}

// ────────────── Terminal ──────────────
function termClear() {
  els.termBody.innerHTML = `<div><span class="prompt">/usercode/session$</span><span class="term-cursor"></span></div>`;
}
function termPush(html) {
  const div = document.createElement("div");
  div.innerHTML = html;
  const cursor = els.termBody.querySelector(".term-cursor")?.parentElement;
  if (cursor && cursor === els.termBody.lastElementChild) cursor.remove();
  els.termBody.appendChild(div);
  const nl = document.createElement("div");
  nl.innerHTML = `<span class="prompt">/usercode/session$</span><span class="term-cursor"></span>`;
  els.termBody.appendChild(nl);
  els.termBody.scrollTop = els.termBody.scrollHeight;
}

// ────────────── Judge (real backend) ──────────────
async function judge(mode) {
  const p = currentProblem();
  if (!p) return;
  saveCode();
  const cmd =
    mode === "submit"
      ? "pytest --submit (visible + hidden)"
      : `${state.lang} ${els.fileName.textContent}`;
  termPush(`<span class="term-muted">$ ${escapeHtml(cmd)}</span>`);

  const body = {
    problemId: p.id,
    language: state.lang,
    code: state.code,
    mode,
  };
  logEvent(mode, {
    codeLength: state.code.length,
    code: state.code.slice(0, 4000),
  });

  try {
    const res = await fetch(JUDGE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) {
      termPush(
        `<span class="term-err">Judge Error ${res.status}</span> <span class="term-muted">${escapeHtml(JSON.stringify(data).slice(0, 400))}</span>`,
      );
      return;
    }
    const passed = data.passed ?? 0;
    const total = data.total ?? 0;
    termPush(
      `<span class="term-muted">Running ${total} test case(s) · runtime ${data.runtimeMs ?? 0} ms</span>`,
    );
    if (Array.isArray(data.caseResults)) {
      data.caseResults.forEach((c) => {
        if (c.passed) {
          termPush(`<span class="term-ok">  ✓ case #${c.index} passed</span>`);
        } else {
          termPush(
            `<span class="term-err">  ✗ case #${c.index} failed</span> <span class="term-muted">input=${escapeHtml(JSON.stringify(c.input))} expected=${escapeHtml(JSON.stringify(c.expected))} actual=${escapeHtml(JSON.stringify(c.actual))}${c.error ? " err=" + escapeHtml(String(c.error).slice(0, 200)) : ""}</span>`,
          );
        }
      });
    }
    if (data.stderr) {
      termPush(
        `<span class="term-err">[stderr]</span> <span class="term-muted">${escapeHtml(String(data.stderr).slice(0, 800))}</span>`,
      );
    }
    termPush(
      `<span class="${passed === total && total > 0 ? "term-ok" : "term-err"}">${passed === total && total > 0 ? "✓ ALL PASSED" : "✗ FAILED"}</span> <span class="term-muted">${passed}/${total} · mode=${mode}</span>`,
    );

    logEvent(`${mode}_result`, {
      status: data.status,
      passed,
      total,
      runtimeMs: data.runtimeMs,
    });

    if (mode === "submit" && total > 0 && passed === total) {
      if (!state.solved.has(state.idx)) {
        state.solved.add(state.idx);
        saveProgress(session.userId, { solvedIdx: [...state.solved] });
        logEvent("problem_solved", { problemIdx: state.idx });
        termPush(
          `<span class="term-ok">→ 다음 문제로 이동할 수 있습니다. NEXT 버튼을 누르세요.</span>`,
        );
      }
      updateNextGate();
      renderProbList();
    }
  } catch (e) {
    termPush(
      `<span class="term-err">채점 서버 연결 실패</span> <span class="term-muted">${escapeHtml(e.message)} (${JUDGE_URL})</span>`,
    );
    logEvent(`${mode}_error`, { error: e.message });
  }
}

// ────────────── Timer ──────────────
let tSec = 0;
setInterval(() => {
  if (!session.userId) return;
  tSec++;
  const h = String(Math.floor(tSec / 3600)).padStart(2, "0");
  const m = String(Math.floor((tSec % 3600) / 60)).padStart(2, "0");
  const s = String(tSec % 60).padStart(2, "0");
  els.timer.textContent = `${h}:${m}:${s}`;
}, 1000);

// ────────────── AI panel (OpenRouter via /api/chat proxy) ──────────────
const OR_MODEL_KEY = "openrouter_model";
const DEFAULT_MODEL = "anthropic/claude-3.5-haiku";
let aiHistory = [];

function getModel() {
  return localStorage.getItem(OR_MODEL_KEY) || DEFAULT_MODEL;
}

function openAI() {
  els.aiPanel.classList.add("open");
  els.aiModel.textContent = getModel();
  setTimeout(() => els.aiInput.focus(), 50);
}
function closeAI() {
  els.aiPanel.classList.remove("open");
}
function addMsg(role, html) {
  const d = document.createElement("div");
  d.className = `ai-msg ${role}`;
  d.innerHTML = html;
  els.aiBody.appendChild(d);
  els.aiBody.scrollTop = els.aiBody.scrollHeight;
  return d;
}

function buildSystemPrompt() {
  const p = currentProblem();
  const baseTone =
    "You are a concise coding tutor. Prefer hints over full solutions. Provide full code only if the student explicitly asks.";
  if (!p) return baseTone;
  return [
    baseTone,
    "Respond in the user's language (Korean if they write Korean).",
    "Use short paragraphs and inline `code` where helpful.",
    "",
    `# Current Problem: ${p.title}`,
    `Difficulty: ${p.difficulty}`,
    `Description: ${p.description}`,
    `Examples: ${JSON.stringify(p.examples || [])}`,
    `Language: ${state.lang}`,
    `Student's current code:\n\`\`\`${state.lang}\n${state.code.slice(0, 2000)}\n\`\`\``,
  ].join("\n");
}

function renderMarkdown(src) {
  let s = escapeHtml(src);
  s = s.replace(/```([\s\S]*?)```/g, (_, c) => `<pre>${c}</pre>`);
  s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/\n/g, "<br>");
  return s;
}

async function sendAI() {
  const q = els.aiInput.value.trim();
  if (!q) return;
  addMsg("user", escapeHtml(q));
  els.aiInput.value = "";
  aiHistory.push({ role: "user", content: q });
  logEvent("ai_user_message", { text: q });

  const pending = addMsg("bot", `<em class="term-muted">생각 중…</em>`);
  try {
    const res = await fetch(CHAT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: getModel(),
        messages: [
          { role: "system", content: buildSystemPrompt() },
          ...aiHistory.slice(-12),
        ],
        temperature: 0.6,
        max_tokens: 800,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      pending.innerHTML = `<span class="term-err">오류 ${res.status}</span>: ${escapeHtml(data?.error?.message || JSON.stringify(data))}`;
      return;
    }
    const text = data?.choices?.[0]?.message?.content || "(응답 비어 있음)";
    aiHistory.push({ role: "assistant", content: text });
    pending.innerHTML = renderMarkdown(text);
    logEvent("ai_assistant_reply", { text, model: getModel() });
  } catch (e) {
    pending.innerHTML = `<span class="term-err">네트워크 오류</span>: ${escapeHtml(e.message)}`;
  }
}

// ────────────── Tweaks ──────────────
const ACCENTS = {
  cyan: "oklch(0.78 0.12 215)",
  violet: "oklch(0.74 0.15 285)",
  green: "oklch(0.78 0.15 150)",
  amber: "oklch(0.82 0.14 75)",
};
function applyAccent(name) {
  state.accent = name;
  document.documentElement.style.setProperty("--accent", ACCENTS[name]);
  document.querySelectorAll("#twAccent .tw-sw").forEach((s) => {
    s.classList.toggle("active", s.dataset.accent === name);
  });
  localStorage.setItem("cp_accent", name);
}
function applyLang(name) {
  state.lang = name;
  document.querySelectorAll("#twLang button").forEach((b) => {
    b.classList.toggle("active", b.dataset.lang === name);
  });
  localStorage.setItem("cp_lang", name);
  if (state.queue.length) render();
}
function applyDensity(name) {
  state.density = name;
  els.app?.classList.toggle("compact", name === "compact");
  document.querySelectorAll("#twDensity button").forEach((b) => {
    b.classList.toggle("active", b.dataset.density === name);
  });
  localStorage.setItem("cp_density", name);
}

// ────────────── Wire up ──────────────
function wireUp() {
  els.runBtn.addEventListener("click", () => judge("run"));
  els.submitBtn.addEventListener("click", () => judge("submit"));
  els.nextBtn.addEventListener("click", () => {
    if (!state.solved.has(state.idx)) return;
    if (state.idx < state.queue.length - 1) {
      state.idx++;
      saveProgress(session.userId, { idx: state.idx });
      logEvent("next_problem", { toIdx: state.idx });
      render();
      termClear();
    }
  });

  els.codeInput.addEventListener("input", () => {
    paintEditor();
    saveCode();
  });
  els.codeInput.addEventListener("scroll", () => {
    els.codeHighlight.scrollTop = els.codeInput.scrollTop;
    els.codeHighlight.scrollLeft = els.codeInput.scrollLeft;
    els.gutter.scrollTop = els.codeInput.scrollTop;
  });
  els.codeInput.addEventListener("keydown", (e) => {
    if (e.key === "Tab") {
      e.preventDefault();
      const start = els.codeInput.selectionStart;
      const end = els.codeInput.selectionEnd;
      const before = els.codeInput.value.slice(0, start);
      const after = els.codeInput.value.slice(end);
      els.codeInput.value = before + "    " + after;
      els.codeInput.selectionStart = els.codeInput.selectionEnd = start + 4;
      paintEditor();
      saveCode();
    }
  });

  els.resetBtn.addEventListener("click", () => {
    const p = currentProblem();
    if (!p) return;
    if (!confirm("현재 코드를 starter로 초기화하시겠습니까?")) return;
    const starter = p.starter?.[state.lang] ?? p.starter?.javascript ?? "";
    els.codeInput.value = starter;
    paintEditor();
    saveCode();
    logEvent("reset_code");
  });

  // Rail: AI
  els.railAi.addEventListener("click", () => {
    if (els.aiPanel.classList.contains("open")) closeAI();
    else {
      els.tweaks.classList.remove("open");
      openAI();
    }
  });
  els.aiClose.addEventListener("click", closeAI);
  els.aiSend.addEventListener("click", sendAI);
  els.aiInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") sendAI();
  });

  // Rail: tweaks
  els.railSettings.addEventListener("click", () => {
    els.aiPanel.classList.remove("open");
    els.tweaks.classList.toggle("open");
  });

  document.querySelectorAll(".term-tab").forEach((t) => {
    t.addEventListener("click", () => {
      document
        .querySelectorAll(".term-tab")
        .forEach((x) => x.classList.remove("active"));
      t.classList.add("active");
    });
  });

  // Tweaks wiring
  document.querySelectorAll("#twAccent .tw-sw").forEach((s) => {
    s.addEventListener("click", () => applyAccent(s.dataset.accent));
  });
  document.querySelectorAll("#twLang button").forEach((b) => {
    b.addEventListener("click", () => {
      applyLang(b.dataset.lang);
      logEvent("change_language", { to: b.dataset.lang });
    });
  });
  document.querySelectorAll("#twDensity button").forEach((b) => {
    b.addEventListener("click", () => applyDensity(b.dataset.density));
  });

  // Format button: shallow indent normalization (spaces; no external formatter)
  els.formatBtn?.addEventListener("click", () => {
    const normalized = els.codeInput.value
      .replace(/\t/g, "    ")
      .replace(/[ \t]+$/gm, "");
    if (normalized !== els.codeInput.value) {
      els.codeInput.value = normalized;
      paintEditor();
      saveCode();
      logEvent("format_code");
    }
  });

  // More: opens tweaks panel as a shortcut
  els.moreBtn?.addEventListener("click", () => {
    els.aiPanel.classList.remove("open");
    els.tweaks.classList.toggle("open");
  });

  // Diff: show current code vs starter in the terminal
  els.diffBtn?.addEventListener("click", () => {
    const p = currentProblem();
    if (!p) return;
    const starter = p.starter?.[state.lang] ?? "";
    const cur = state.code || "";
    if (starter === cur) {
      termPush(`<span class="term-muted">(no changes vs starter)</span>`);
      return;
    }
    const sLines = starter.split("\n");
    const cLines = cur.split("\n");
    const n = Math.max(sLines.length, cLines.length);
    termPush(`<span class="term-muted">diff: current vs starter</span>`);
    for (let i = 0; i < n; i++) {
      if (sLines[i] === cLines[i]) continue;
      if (sLines[i] !== undefined) {
        termPush(`<span class="term-err">- ${escapeHtml(sLines[i])}</span>`);
      }
      if (cLines[i] !== undefined) {
        termPush(`<span class="term-ok">+ ${escapeHtml(cLines[i])}</span>`);
      }
    }
  });

  // Export
  els.exportBtn.addEventListener("click", () => {
    const arr = JSON.parse(
      localStorage.getItem(`cp_log_${session.userId}`) || "[]",
    );
    const jsonl = arr.map((r) => JSON.stringify(r)).join("\n");
    const blob = new Blob([jsonl], {
      type: "application/jsonl;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${session.userId}_logs_${Date.now()}.jsonl`;
    a.click();
    URL.revokeObjectURL(url);
  });

  // Click outside tweaks to close
  document.addEventListener("click", (e) => {
    if (
      els.tweaks.classList.contains("open") &&
      !els.tweaks.contains(e.target) &&
      !els.railSettings.contains(e.target) &&
      !els.moreBtn.contains(e.target)
    ) {
      els.tweaks.classList.remove("open");
    }
  });
}

// ────────────── Boot: login / resume ──────────────
function showLogin() {
  const overlay = document.createElement("div");
  overlay.id = "loginOverlay";
  overlay.innerHTML = `
    <div class="login-card">
      <div class="login-brand">
        <span class="orb"></span>
        <span>CODING PLATFORM</span>
      </div>
      <h2>시작하기</h2>
      <p>배정받은 사용자 ID를 입력하세요. 진행 상황은 서버에 기록되며, 재접속 시 풀던 문제부터 이어서 진행할 수 있습니다.</p>
      <label>사용자 ID</label>
      <input id="loginInput" placeholder="예: user001" autocomplete="username" />
      <div class="login-err" id="loginErr"></div>
      <button id="loginBtn">접속</button>
      <p class="small">이전 문제를 해결해야 다음 문제로 이동할 수 있습니다. 되돌아가기는 제공되지 않습니다.</p>
    </div>`;
  document.body.appendChild(overlay);

  const input = overlay.querySelector("#loginInput");
  const err = overlay.querySelector("#loginErr");
  const btn = overlay.querySelector("#loginBtn");
  const prev = localStorage.getItem(SESSION_USER_KEY);
  if (prev) input.value = prev;
  input.focus();

  const go = () => {
    const uid = input.value.trim();
    if (!uid) {
      err.textContent = "ID를 입력하세요.";
      return;
    }
    if (!/^[\w.-]{2,64}$/.test(uid)) {
      err.textContent = "ID는 문자/숫자/._-만 사용 가능합니다.";
      return;
    }
    localStorage.setItem(SESSION_USER_KEY, uid);
    beginSession(uid);
    overlay.remove();
  };
  btn.addEventListener("click", go);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") go();
  });
}

function beginSession(uid) {
  session.userId = uid;
  session.sessionId = crypto.randomUUID();
  session.startedAt = new Date().toISOString();

  els.userChip.style.display = "inline-flex";
  els.userChipName.textContent = uid;
  els.exportBtn.style.display = "inline-block";

  loadData();
}

function boot() {
  cacheEls();
  wireUp();

  // Restore saved accent/lang/density
  const savedAccent = localStorage.getItem("cp_accent");
  if (savedAccent && ACCENTS[savedAccent]) applyAccent(savedAccent);
  const savedLang = localStorage.getItem("cp_lang");
  if (savedLang && ["javascript", "python", "cpp"].includes(savedLang)) {
    state.lang = savedLang;
  }
  const savedDensity = localStorage.getItem("cp_density");
  applyDensity(savedDensity === "compact" ? "compact" : "comfortable");
  document.querySelectorAll("#twLang button").forEach((b) => {
    b.classList.toggle("active", b.dataset.lang === state.lang);
  });

  // If URL provided a user_id, skip login for backward compat with older links
  if (runArgs.userIdParam) {
    beginSession(runArgs.userIdParam);
  } else {
    showLogin();
  }
}

boot();
