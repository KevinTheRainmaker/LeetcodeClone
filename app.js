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
  mode: (PARAMS.get("mode") || "").toLowerCase(),
};
if (!["java", "python", "cpp"].includes(runArgs.language)) {
  runArgs.language = "python";
}

const SESSION_USER_KEY = "cp_user_id";
const LOG_QUEUE_KEY = "cp_log_queue";
const EXP_SUFFIX = "_exp";

let allowedUsers = [];

function resolveUserId(rawUid) {
  const isExp = rawUid.endsWith(EXP_SUFFIX);
  const baseId = isExp ? rawUid.slice(0, -EXP_SUFFIX.length) : rawUid;
  return { baseId, isExp };
}

function isAllowedUser(baseId) {
  return allowedUsers.length === 0 || allowedUsers.includes(baseId);
}

function isTester() {
  return (session.userId || "").startsWith("test_");
}

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
  chatInitialized: false,
  lastSeedProblemId: null,
  explainLocked: false,
};

const els = {};
function cacheEls() {
  const ids = [
    "pTitle",
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
    "aiHandle",
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
    "diffBtn",
    "minimap",
    "app",
    "explainOverlay",
    "explainList",
    "explainInput",
    "explainSend",
    "explainResize",
  ];
  ids.forEach((id) => (els[id] = document.getElementById(id)));
}

// ────────────── Logging (central server) ──────────────
function currentPhase() {
  return runArgs.mode === "phase2" ? "phase2" : "normal";
}

function logMirrorKey(userId) {
  return `cp_log_${userId}:${currentPhase()}`;
}

function logEvent(action, detail = {}) {
  if (!session.userId) return;
  const p = currentProblem();
  const row = {
    ts: new Date().toISOString(),
    userId: session.userId,
    phase: currentPhase(),
    sessionId: session.sessionId,
    setId: runArgs.setId,
    language: state.lang,
    problemId: p?.id ?? null,
    problemIdx: state.idx,
    action,
    detail,
  };
  const mirrorKey = logMirrorKey(session.userId);
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
  const p = currentProblem();
  const base = {
    ts: new Date().toISOString(),
    userId: session.userId,
    sessionId: session.sessionId,
    setId: runArgs.setId,
    language: state.lang,
    problemId: p?.id ?? null,
    problemIdx: state.idx,
  };
  const beacons = [];
  if (state.code && state.code !== lastLoggedCode) {
    beacons.push({
      ...base,
      action: "code_edit",
      detail: { codeLength: state.code.length, code: state.code },
    });
  }
  beacons.push({
    ...base,
    action: "session_end",
    detail: { problemIdx: state.idx, solvedCount: state.solved.size },
  });
  for (const row of beacons) {
    try {
      navigator.sendBeacon(
        LOG_ENDPOINT,
        new Blob([JSON.stringify(row)], { type: "application/json" }),
      );
    } catch {}
  }
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

  // Build queue: ?set=X filters to that set's IDs; otherwise all problems.json entries
  let pool = [];
  if (runArgs.setId) {
    const match = state.sets.find(
      (x) => Number(x.setId) === Number(runArgs.setId),
    );
    if (match) {
      const isPhase2 = runArgs.mode === "phase2";
      const ids =
        isPhase2 && match.phase2ProblemIds
          ? match.phase2ProblemIds
          : match.problemIds;
      const setIds = new Set(ids || []);
      pool = state.problems.filter((x) => setIds.has(x.id)).map((x) => x.id);
    }
  }
  if (!pool.length) pool = state.problems.map((x) => x.id);
  state.queue = pool;

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
  const tester = isTester();
  host.innerHTML = "";
  for (let i = 0; i < total; i++) {
    const solved = state.solved.has(i);
    const current = i === state.idx;
    const locked = !tester && !solved && !current;
    const node = document.createElement("div");
    node.className =
      `p-node ${solved ? "solved" : ""} ${current ? "current" : ""} ${locked ? "locked" : ""}`.trim();
    node.title = `Problem ${i + 1}${solved ? " · solved" : current ? " · current" : locked ? " · locked" : ""}`;
    node.innerHTML =
      `<span class="num">${String(i + 1).padStart(2, "0")}</span>` +
      (solved
        ? `<svg viewBox="0 0 24 24"><polyline points="4 12 10 18 20 6"/></svg>`
        : locked
          ? `<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>`
          : `<span class="num-big">${i + 1}</span>`);
    if (tester && i !== state.idx) {
      node.style.cursor = "pointer";
      node.addEventListener("click", () => {
        state.idx = i;
        render();
        termClear();
        logEvent("tester_jump", { toIdx: i });
      });
    }
    host.appendChild(node);
  }
  const cur = host.querySelector(".p-node.current");
  if (cur) cur.scrollIntoView({ block: "nearest" });
}

function updateNextGate() {
  const canAdvance =
    (isTester() || state.solved.has(state.idx)) &&
    state.idx < state.queue.length - 1;
  els.nextBtn.disabled = !canAdvance;
  els.nextBtn.title = canAdvance
    ? "다음 문제로 이동"
    : state.idx >= state.queue.length - 1
      ? "마지막 문제입니다"
      : "Submit으로 모든 테스트를 통과해야 다음 문제로 이동할 수 있습니다";
}

function resolveImage(entry) {
  if (!entry) return null;
  if (typeof entry === "string") return { src: entry.trim(), style: "" };
  const src = (entry.src || "").trim();
  if (!src) return null;
  const parts = [];
  if (entry.width) parts.push(`width:${entry.width}`);
  if (entry.height) parts.push(`height:${entry.height}`);
  return { src, style: parts.length ? parts.join(";") : "" };
}

// [이미지N] 마커를 img 태그로 치환 + 마크다운 파싱. 사용된 이미지 인덱스 Set 반환.
function buildRichText(text, images) {
  const used = new Set();
  const IMG_PH = "\x00IMGPH\x00";

  let src = (text || "").replace(
    /\[이미지(\d+)\]/g,
    (_, n) => `${IMG_PH}${n}${IMG_PH}`,
  );

  let html;
  if (typeof marked !== "undefined") {
    marked.setOptions({ gfm: true, breaks: true });
    html = marked.parse(src);
  } else {
    html = `<p>${escapeHtml(src).replace(/\n/g, "<br>")}</p>`;
  }

  const phRe = new RegExp(
    `${IMG_PH.replace(/\x00/g, "\\x00")}(\\d+)${IMG_PH.replace(/\x00/g, "\\x00")}`,
    "g",
  );
  html = html.replace(phRe, (_, n) => {
    const idx = parseInt(n, 10) - 1;
    const img = resolveImage(images[idx]);
    if (!img) return "";
    used.add(idx);
    const styleAttr = img.style ? ` style="${img.style}"` : "";
    return `<img class="p-image" src="${encodeURI(img.src)}" alt=""${styleAttr} onerror="this.style.display='none'">`;
  });

  return { html, used };
}

function buildDescHtml(p) {
  const images = p.images || [];
  const IMG_PH = "\x00IMGPH\x00";

  // Protect [이미지N] markers before markdown parsing
  let text = (p.description || "").replace(
    /\[이미지(\d+)\]/g,
    (_, n) => `${IMG_PH}${n}${IMG_PH}`,
  );

  let html;
  if (typeof marked !== "undefined") {
    marked.setOptions({ gfm: true, breaks: true });
    html = marked.parse(text);
  } else {
    html = `<p>${escapeHtml(text).replace(/\n/g, "<br>")}</p>`;
  }

  // Restore image placeholders
  const phRe = new RegExp(
    `${IMG_PH.replace(/\x00/g, "\\x00")}(\\d+)${IMG_PH.replace(/\x00/g, "\\x00")}`,
    "g",
  );
  html = html.replace(phRe, (_, n) => {
    const img = resolveImage(images[parseInt(n) - 1]);
    if (!img) return "";
    const styleAttr = img.style ? ` style="${img.style}"` : "";
    return `<img class="p-image" src="${escapeHtml(img.src)}" alt="이미지${n}"${styleAttr} onerror="this.style.display='none'">`;
  });

  return html;
}

function render() {
  const p = currentProblem();
  if (!p) return;

  els.pTitle.textContent = `Task ${state.idx + 1}: ${p.title}`;

  els.pDesc.innerHTML = buildDescHtml(p);

  els.pExamples.innerHTML = "";
  const examples = p.examples || [];
  if (examples.length > 0) {
    const wrap = document.createElement("div");
    wrap.className = "ex-tabbed";

    // tab bar (only shown when 2+ examples)
    if (examples.length > 1) {
      const bar = document.createElement("div");
      bar.className = "ex-tabs";
      examples.forEach((_, i) => {
        const btn = document.createElement("button");
        btn.className = "ex-tab" + (i === 0 ? " active" : "");
        btn.textContent = `Example ${i + 1}`;
        btn.addEventListener("click", () => {
          bar
            .querySelectorAll(".ex-tab")
            .forEach((b) => b.classList.remove("active"));
          wrap
            .querySelectorAll(".ex-panel")
            .forEach((pnl) => pnl.classList.remove("active"));
          btn.classList.add("active");
          wrap.querySelectorAll(".ex-panel")[i].classList.add("active");
        });
        bar.appendChild(btn);
      });
      wrap.appendChild(bar);
    }

    examples.forEach((ex, i) => {
      const panel = document.createElement("div");
      panel.className = "ex-panel" + (i === 0 ? " active" : "");
      const box = document.createElement("div");
      box.className = "example";
      let inner = `
        <div class="ex-row"><span class="ex-k">Input</span><span class="ex-v">${escapeHtml(ex.input)}</span></div>
        <div class="ex-row"><span class="ex-k">Output</span><span class="ex-v">${escapeHtml(ex.output)}</span></div>
      `;
      if (ex.explanation) {
        const { html } = buildRichText(ex.explanation, p.images || []);
        inner += `<div class="ex-explanation"><span class="ex-k">Explanation</span><div class="ex-explanation-body">${html}</div></div>`;
      }
      box.innerHTML = inner;
      panel.appendChild(box);
      wrap.appendChild(panel);
    });

    els.pExamples.appendChild(wrap);
  }

  els.qCounter.textContent = `Question ${state.idx + 1} of ${state.queue.length}`;

  renderProbList();
  updateNextGate();

  const ext = { python: "py", java: "java", cpp: "cpp" }[state.lang];
  const fnKebab = (p.slug || "solution").replace(/-/g, "_");
  els.fileName.textContent = `${fnKebab}.${ext}`;
  els.langChip.textContent =
    state.lang === "python"
      ? "Python 3"
      : state.lang === "java"
        ? "Java"
        : "C++ · g++";

  // Load saved code for this user/problem/language, else starter
  const codeKey = `code:${session.userId}:p${p.id}:${state.lang}`;
  const saved = localStorage.getItem(codeKey);
  state.code =
    saved ??
    p.starter?.[state.lang] ??
    p.starter?.python ??
    "// starter missing";
  els.codeInput.value = state.code;
  paintEditor();

  if (state.lastSeedProblemId !== p.id) {
    aiHistory = [];
    if (els.aiBody) els.aiBody.innerHTML = "";
    state.chatInitialized = false;
    state.lastSeedProblemId = p.id;
    if (els.aiPanel?.classList.contains("open")) initChatSession();
  }

  if (runArgs.mode === "phase2") {
    state.explainLocked = true;
    if (els.explainList) els.explainList.innerHTML = "";
    if (els.explainInput) els.explainInput.value = "";
  }
  applyExplainLock();
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
  java: new Set([
    "class",
    "public",
    "private",
    "protected",
    "static",
    "final",
    "abstract",
    "void",
    "int",
    "long",
    "short",
    "byte",
    "char",
    "float",
    "double",
    "boolean",
    "String",
    "return",
    "if",
    "else",
    "for",
    "while",
    "do",
    "switch",
    "case",
    "break",
    "continue",
    "new",
    "this",
    "super",
    "null",
    "true",
    "false",
    "try",
    "catch",
    "finally",
    "throw",
    "throws",
    "import",
    "package",
    "extends",
    "implements",
    "interface",
    "enum",
    "instanceof",
    "synchronized",
    "volatile",
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
          /\b(def|return|class|if|else|for|while|import|public|private|static|void|int|boolean)\b/.test(
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

let codeEditLogTimer = null;
let lastLoggedCode = null;
function scheduleCodeEditLog() {
  clearTimeout(codeEditLogTimer);
  codeEditLogTimer = setTimeout(flushCodeEditLog, 2500);
}
function flushCodeEditLog() {
  if (!session.userId) return;
  if (state.code === lastLoggedCode) return;
  lastLoggedCode = state.code;
  logEvent("code_edit", {
    codeLength: state.code.length,
    code: state.code,
  });
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
    code: state.code,
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
const DEFAULT_MODEL = "anthropic/claude-sonnet-4.6";
const GREETING = "안녕하세요, 이 문제를 풀기 위해 도움이 필요한가요?";
let aiHistory = [];

function getModel() {
  return localStorage.getItem(OR_MODEL_KEY) || DEFAULT_MODEL;
}

function openAI() {
  els.aiPanel.classList.add("open");
  els.aiModel.textContent = getModel();
  initChatSession();
  setTimeout(() => els.aiInput.focus(), 50);
}
function closeAI() {
  els.aiPanel.classList.remove("open");
}

async function fetchAsDataUrl(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  return await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

async function initChatSession() {
  if (state.chatInitialized) return;
  const p = currentProblem();
  if (!p) return;
  state.chatInitialized = true;

  const imageBlocks = [];
  for (const path of p.images || []) {
    try {
      const dataUrl = await fetchAsDataUrl(path);
      imageBlocks.push({ type: "image_url", image_url: { url: dataUrl } });
    } catch (_) {
      // 이미지 로드 실패 시 스킵 (없는 것으로 간주)
    }
  }

  const examplesText = (p.examples || [])
    .map(
      (ex, i) =>
        `Example ${i + 1}\n  Input: ${ex.input}\n  Output: ${ex.output}`,
    )
    .join("\n\n");
  const problemText =
    `# Problem: ${p.title}\n\n` +
    `${p.description || ""}\n\n` +
    (examplesText ? `Examples:\n${examplesText}` : "");

  const userContent = imageBlocks.length
    ? [{ type: "text", text: problemText }, ...imageBlocks]
    : problemText;

  aiHistory.push({ role: "user", content: userContent });
  aiHistory.push({ role: "assistant", content: GREETING });

  addMsg("bot", renderMarkdown(GREETING));
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
  const problemTitle = p ? p.title : "현재 문제";
  return [
    `You are a helpful coding assistant strictly scoped to ONE problem: "${problemTitle}".`,
    "The full problem statement (and any images) was provided as the first user message in this conversation.",
    "",
    "STRICT SCOPE RULES:",
    `- You may ONLY discuss: the problem itself, its constraints, hints, approach, time/space complexity, code review, and debugging of the student's solution.`,
    `- If the user explicitly asks you to solve the current problem (e.g. '문제를 풀어줘', '정답 코드 작성해줘', 'solution 알려줘'), you should answer directly with a correct approach and code for this problem.`,
    "- If the user asks about ANY other problem, topic, or task — even if it is a coding question — politely refuse in one sentence and redirect them back to the current problem.",
    `- Example refusal (Korean): \"죄송합니다, 저는 현재 문제 '${problemTitle}'에 대해서만 도움드릴 수 있습니다.\"`,
    "",
    "RESPONSE STYLE:",
    "- Respond in the user's language (Korean if they write Korean).",
    "- If the user asks for hints, give hints.",
    "- If the user asks for a full solution, provide the full solution directly.",
    "- Be concise and focused on the current problem only.",
    "",
    `Language: ${state.lang}`,
    `Student's current code:\n\`\`\`${state.lang}\n${state.code.slice(0, 2000)}\n\`\`\``,
  ].join("\n");
}

function renderMarkdown(src) {
  let s = escapeHtml(src);

  // 코드 블록을 먼저 추출 (언어 식별자 제거, \n→<br> 치환에서 보호)
  const blocks = [];
  s = s.replace(/```(\w+)?\n([\s\S]*?)```/g, (_, _lang, code) => {
    const i = blocks.length;
    blocks.push(code);
    return `\x00BLOCK${i}\x00`;
  });

  s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/\n/g, "<br>");

  // 코드 블록 복원 (\n을 <br>로 바꾸지 않아 textContent 복사 시 줄바꿈 유지)
  s = s.replace(/\x00BLOCK(\d+)\x00/g, (_, i) => {
    const code = blocks[+i];
    return `<div class="code-wrap"><button class="copy-btn" aria-label="Copy code">Copy</button><pre>${code}</pre></div>`;
  });

  return s;
}

async function sendAI() {
  const q = els.aiInput.value.trim();
  if (!q) return;
  addMsg("user", escapeHtml(q));
  els.aiInput.value = "";
  els.aiInput.style.height = "auto";
  aiHistory.push({ role: "user", content: q });
  logEvent("ai_user_message", { text: q });

  const pending = addMsg("bot", `<em class="term-muted">생각 중…</em>`);
  try {
    const head = aiHistory.slice(0, 2);
    const tail = aiHistory.slice(Math.max(2, aiHistory.length - 10));
    const compact = [...head, ...tail];
    const res = await fetch(CHAT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: getModel(),
        messages: [
          { role: "system", content: buildSystemPrompt() },
          ...compact,
        ],
        temperature: 0.6,
        max_tokens: 800,
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      pending.innerHTML = `<span class="term-err">오류 ${res.status}</span>: ${escapeHtml(data?.error?.message || JSON.stringify(data))}`;
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let accumulated = "";
    let buf = "";

    pending.innerHTML = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop();
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") break;
        try {
          const delta = JSON.parse(payload)?.choices?.[0]?.delta?.content;
          if (delta) {
            accumulated += delta;
            pending.innerHTML = renderMarkdown(accumulated);
            els.aiBody.scrollTop = els.aiBody.scrollHeight;
          }
        } catch (_) {
          /* partial JSON — skip */
        }
      }
    }

    const text = accumulated || "(응답 비어 있음)";
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
const LANG_ACCENT = { python: "cyan", java: "violet", cpp: "amber" };

function applyAccent(name) {
  state.accent = name;
  document.documentElement.style.setProperty("--accent", ACCENTS[name]);
}
function applyLang(name) {
  state.lang = name;
  document.querySelectorAll("#twLang button").forEach((b) => {
    b.classList.toggle("active", b.dataset.lang === name);
  });
  localStorage.setItem("cp_lang", name);
  applyAccent(LANG_ACCENT[name] || "cyan");
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
function applyFontSize(name) {
  const valid = ["small", "medium", "large"];
  const fs = valid.includes(name) ? name : "small";
  const app = els.app;
  if (app) {
    valid.forEach((v) => app.classList.remove(`fs-${v}`));
    if (fs !== "small") app.classList.add(`fs-${fs}`);
  }
  document.querySelectorAll("#twFontSize button").forEach((b) => {
    b.classList.toggle("active", b.dataset.fs === fs);
  });
  localStorage.setItem("cp_fs", fs);
}

// ────────────── Explain mode ──────────────
function initExplainResize() {
  const handle = els.explainResize;
  const input = els.explainInput;
  if (!handle || !input) return;
  let startY = 0;
  let startH = 0;
  handle.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    startY = e.clientY;
    startH = input.getBoundingClientRect().height;
    handle.setPointerCapture(e.pointerId);
  });
  handle.addEventListener("pointermove", (e) => {
    if (!handle.hasPointerCapture(e.pointerId)) return;
    const delta = startY - e.clientY;
    const next = Math.min(500, Math.max(160, startH + delta));
    input.style.height = `${next}px`;
  });
  handle.addEventListener("pointerup", (e) => {
    handle.releasePointerCapture(e.pointerId);
  });
}

function applyExplainLock() {
  const locked = !!state.explainLocked;
  els.explainOverlay?.classList.toggle("active", locked);
  els.explainOverlay?.setAttribute("aria-hidden", String(!locked));
  if (els.codeInput) els.codeInput.readOnly = locked;
  if (els.runBtn) els.runBtn.disabled = locked;
  if (els.submitBtn) els.submitBtn.disabled = locked;
  if (locked && els.nextBtn) els.nextBtn.disabled = true;
}

// TODO: replace with real criteria
function checkExplainCriteria(text) {
  return text.trim().length >= 200;
}

// TODO: replace with real AI call
async function generateExplainFeedback(_text) {
  await new Promise((r) => setTimeout(r, 300));
  return "(샘플 피드백) 설명을 잘 받았습니다. 접근 방법을 좀 더 구체적으로 설명해 주세요.";
}

function addExplainBubble(kind, text) {
  const div = document.createElement("div");
  div.className = `explain-bubble ${kind}`;
  div.textContent = text;
  els.explainList.appendChild(div);
  els.explainList.scrollTop = els.explainList.scrollHeight;
}

async function sendExplain() {
  const text = els.explainInput.value.trim();
  if (!text) return;
  addExplainBubble("user", text);
  els.explainInput.value = "";
  els.explainSend.disabled = true;
  try {
    const fb = await generateExplainFeedback(text);
    addExplainBubble("bot", fb);
    if (checkExplainCriteria(text)) {
      state.explainLocked = false;
      applyExplainLock();
      logEvent("explain_unlock", { chars: text.length });
    }
  } finally {
    els.explainSend.disabled = false;
  }
}

// ────────────── Wire up ──────────────
function wireUp() {
  els.runBtn.addEventListener("click", () => judge("run"));
  els.submitBtn.addEventListener("click", () => judge("submit"));
  els.nextBtn.addEventListener("click", () => {
    if (!isTester() && !state.solved.has(state.idx)) return;
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
    scheduleCodeEditLog();
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
      scheduleCodeEditLog();
    }
  });

  els.resetBtn.addEventListener("click", () => {
    const p = currentProblem();
    if (!p) return;
    if (!confirm("현재 코드를 starter로 초기화하시겠습니까?")) return;
    const starter = p.starter?.[state.lang] ?? p.starter?.python ?? "";
    els.codeInput.value = starter;
    paintEditor();
    saveCode();
    logEvent("reset_code");
  });

  // AI drawer: handle + rail button both toggle
  function toggleAI() {
    if (els.aiPanel.classList.contains("open")) closeAI();
    else {
      els.tweaks.classList.remove("open");
      openAI();
    }
  }
  els.aiHandle.addEventListener("click", toggleAI);
  els.railAi.addEventListener("click", toggleAI);

  // 코드 스니펫 복사 (이벤트 위임 — 스트리밍 중 innerHTML 교체와 무관)
  els.aiBody.addEventListener("click", (e) => {
    const btn = e.target.closest(".copy-btn");
    if (!btn) return;
    const code = btn.nextElementSibling?.textContent ?? "";
    navigator.clipboard.writeText(code).then(() => {
      btn.textContent = "Copied!";
      setTimeout(() => (btn.textContent = "Copy"), 1500);
    });
  });
  els.aiClose.addEventListener("click", closeAI);
  els.aiSend.addEventListener("click", sendAI);
  els.aiInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      sendAI();
    }
  });
  els.aiInput.addEventListener("input", () => {
    const el = els.aiInput;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  });

  // Rail: tweaks
  els.railSettings.addEventListener("click", (e) => {
    e.stopPropagation();
    els.aiPanel.classList.remove("open");
    if (els.tweaks.classList.contains("open")) {
      els.tweaks.classList.remove("open");
      return;
    }
    positionTweaksNextToSettings();
    els.tweaks.classList.add("open");
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
  document.querySelectorAll("#twLang button").forEach((b) => {
    b.addEventListener("click", () => {
      applyLang(b.dataset.lang);
      logEvent("change_language", { to: b.dataset.lang });
    });
  });
  document.querySelectorAll("#twDensity button").forEach((b) => {
    b.addEventListener("click", () => applyDensity(b.dataset.density));
  });
  document.querySelectorAll("#twFontSize button").forEach((b) => {
    b.addEventListener("click", () => applyFontSize(b.dataset.fs));
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
    const phase = currentPhase();
    const arr = JSON.parse(
      localStorage.getItem(logMirrorKey(session.userId)) || "[]",
    );
    const jsonl = arr.map((r) => JSON.stringify(r)).join("\n");
    const blob = new Blob([jsonl], {
      type: "application/jsonl;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${session.userId}_${phase}_logs_${Date.now()}.jsonl`;
    a.click();
    URL.revokeObjectURL(url);
  });

  // Explain mode send + resize
  initExplainResize();
  els.explainSend?.addEventListener("click", sendExplain);
  els.explainInput?.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      sendExplain();
    }
  });

  // Click outside tweaks to close
  document.addEventListener("click", (e) => {
    if (
      els.tweaks.classList.contains("open") &&
      !els.tweaks.contains(e.target) &&
      !els.railSettings.contains(e.target)
    ) {
      els.tweaks.classList.remove("open");
    }
  });

  // Ctrl/Cmd+S — explicit save with toast
  document.addEventListener("keydown", (e) => {
    const isSave = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s";
    if (!isSave) return;
    e.preventDefault();
    if (!session.userId) return;
    saveCode();
    saveProgress(session.userId, { idx: state.idx });
    clearTimeout(codeEditLogTimer);
    lastLoggedCode = null;
    logEvent("manual_save", {
      codeLength: state.code.length,
      code: state.code,
    });
    showToast("저장됨");
  });
}

function positionTweaksNextToSettings() {
  const btn = els.railSettings?.getBoundingClientRect();
  if (!btn) return;
  const margin = 8;
  const top = Math.max(12, btn.top);
  els.tweaks.style.top = `${top}px`;
  els.tweaks.style.left = `${btn.right + margin}px`;
  els.tweaks.style.bottom = "auto";
}

let toastTimer = null;
function showToast(msg) {
  let el = document.getElementById("appToast");
  if (!el) {
    el = document.createElement("div");
    el.id = "appToast";
    el.className = "app-toast";
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 1400);
}

// ────────────── Boot: login / resume ──────────────
function showLogin(initialError = "") {
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
  if (initialError) err.textContent = initialError;
  input.focus();

  const go = () => {
    const raw = input.value.trim();
    if (!raw) {
      err.textContent = "ID를 입력하세요.";
      return;
    }
    if (!/^[\w.-]{2,64}$/.test(raw)) {
      err.textContent = "ID는 문자/숫자/._-만 사용 가능합니다.";
      return;
    }
    const { baseId, isExp } = resolveUserId(raw);
    if (!isAllowedUser(baseId)) {
      err.textContent = "허용되지 않은 사용자 ID입니다.";
      return;
    }
    if (isExp) runArgs.mode = "phase2";
    localStorage.setItem(SESSION_USER_KEY, baseId);
    beginSession(baseId);
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
  applyExplainLock();

  // Restore saved lang/density; accent follows language automatically
  const savedLang = localStorage.getItem("cp_lang");
  if (savedLang && ["java", "python", "cpp"].includes(savedLang)) {
    state.lang = savedLang;
  }
  applyAccent(LANG_ACCENT[state.lang] || "cyan");
  const savedDensity = localStorage.getItem("cp_density");
  applyDensity(savedDensity === "compact" ? "compact" : "comfortable");
  applyFontSize(localStorage.getItem("cp_fs") || "small");
  document.querySelectorAll("#twLang button").forEach((b) => {
    b.classList.toggle("active", b.dataset.lang === state.lang);
  });

  setupVdividerDrag();

  // Load allowed user list, then handle login
  fetch("./data/allowed_users.json")
    .then((r) => r.json())
    .then((list) => {
      allowedUsers = Array.isArray(list) ? list : [];
    })
    .catch(() => {
      allowedUsers = [];
    })
    .finally(() => {
      if (runArgs.userIdParam) {
        const { baseId, isExp } = resolveUserId(runArgs.userIdParam);
        if (!isAllowedUser(baseId)) {
          showLogin("허용되지 않은 사용자 ID입니다.");
        } else {
          if (isExp) runArgs.mode = "phase2";
          beginSession(baseId);
        }
      } else {
        showLogin();
      }
    });
}

function setupVdividerDrag() {
  const vdiv = document.querySelector(".vdivider");
  const panel = document.querySelector(".panel-right");
  if (!vdiv || !panel) return;

  const MIN_EDITOR = 140;
  const MIN_TERM = 120;
  const ACTIONS_ROW_H = 44;
  const HANDLE_H = 6;

  const saved = parseInt(localStorage.getItem("termHeight") || "", 10);
  if (!isNaN(saved) && saved >= MIN_TERM) {
    panel.style.gridTemplateRows = `1fr ${HANDLE_H}px ${saved}px ${ACTIONS_ROW_H}px`;
  }

  let dragging = false;
  vdiv.addEventListener("mousedown", (e) => {
    dragging = true;
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
    e.preventDefault();
  });

  window.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    const rect = panel.getBoundingClientRect();
    const offsetFromTop = e.clientY - rect.top;
    const total = rect.height;
    const maxTerm = total - MIN_EDITOR - HANDLE_H - ACTIONS_ROW_H;
    let termH = total - offsetFromTop - HANDLE_H - ACTIONS_ROW_H;
    termH = Math.max(MIN_TERM, Math.min(maxTerm, termH));
    panel.style.gridTemplateRows = `1fr ${HANDLE_H}px ${termH}px ${ACTIONS_ROW_H}px`;
  });

  window.addEventListener("mouseup", () => {
    if (!dragging) return;
    dragging = false;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    const match = panel.style.gridTemplateRows.match(/(\d+)px\s+\d+px\s*$/);
    if (match) localStorage.setItem("termHeight", match[1]);
  });
}

boot();
