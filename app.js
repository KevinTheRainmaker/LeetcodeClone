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

let _kbBatch = null;
let _kbBatchTimer = null;
const KB_FLUSH_DELAY = 2500;
const KB_BATCH_MAX = 200;

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
  explainPassed: false,
  explainAttempts: 0,
  explainGateLockTime: null,
  explainConsecErrors: 0,
  gateUnits: [],
  gateUnitIndex: 0,
  descSaved: false,
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
    "explainBack",
    "explainResize",
    "explainAttempt",
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
  _flushKeystrokeBatch();
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
  const [p1, p2, t, s] = await Promise.all([
    fetch("./data/problems.json").then((r) => r.json()),
    fetch("./data/phase2_problems.json")
      .then((r) => r.json())
      .catch(() => []),
    fetch("./data/testcases.json").then((r) => r.json()),
    fetch("./data/problem_sets.json").then((r) => r.json()),
  ]);
  state.problems = [...p1, ...p2];
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

function renderDescPanel(p) {
  const saved = loadDesc();
  const alreadySaved = saved !== null;
  state.descSaved = alreadySaved;

  if (isCreativeType(p)) {
    els.pDesc.innerHTML = "";

    // ── 가이드 섹션 ──
    const guide = document.createElement("div");
    guide.className = "creative-guide";
    guide.innerHTML = buildDescHtml(p);
    els.pDesc.appendChild(guide);

    // ── 작성 카드 ──
    const sectionTitle =
      p.type === "creative-cli" ? "명세서 작성" : "문제 작성";
    const card = document.createElement("div");
    card.className = "write-card" + (alreadySaved ? " write-card--saved" : "");

    // 카드 헤더
    const cardHeader = document.createElement("div");
    cardHeader.className = "write-card__header";
    cardHeader.innerHTML = alreadySaved
      ? `<svg class="write-card__icon write-card__icon--ok" viewBox="0 0 24 24"><polyline points="4 12 10 18 20 6"/></svg>
         <div>
           <div class="write-card__title">작성 완료</div>
           <div class="write-card__hint">저장된 내용입니다 — 오른쪽 에디터에서 코드를 작성하세요</div>
         </div>`
      : `<svg class="write-card__icon" viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
         <div>
           <div class="write-card__title">${sectionTitle}</div>
           <div class="write-card__hint">작성 후 저장하면 오른쪽 에디터가 활성화됩니다</div>
         </div>`;
    card.appendChild(cardHeader);

    // 텍스트 영역
    const textarea = document.createElement("textarea");
    textarea.id = "descEditArea";
    textarea.className = "write-card__textarea";
    textarea.placeholder = p.placeholder || "내용을 입력하세요...";
    textarea.value = saved || "";
    textarea.readOnly = alreadySaved;
    card.appendChild(textarea);

    // 카드 푸터
    if (!alreadySaved) {
      const cardFooter = document.createElement("div");
      cardFooter.className = "write-card__footer";

      const charCount = document.createElement("span");
      charCount.className = "write-card__charcount";
      charCount.textContent = `${textarea.value.length}자`;
      textarea.addEventListener("input", () => {
        charCount.textContent = `${textarea.value.length}자`;
      });

      const saveBtn = document.createElement("button");
      saveBtn.className = "btn primary write-card__save-btn";
      saveBtn.innerHTML =
        "저장하고 코딩 시작 <svg viewBox='0 0 24 24' width='14' height='14'><path d='M5 12h14M12 5l7 7-7 7'/></svg>";
      saveBtn.addEventListener("click", () => {
        const text = textarea.value.trim();
        if (!text) {
          showToast("내용을 입력하세요");
          return;
        }
        saveDesc(text);
        state.descSaved = true;
        logEvent("desc_save", { chars: text.length, problemType: p.type });
        renderDescPanel(p);
        applyDescLock();
      });

      cardFooter.appendChild(charCount);
      cardFooter.appendChild(saveBtn);
      card.appendChild(cardFooter);
    }

    els.pDesc.appendChild(card);
  } else {
    els.pDesc.innerHTML = buildDescHtml(p);
  }
}

function render() {
  const p = currentProblem();
  if (!p) return;

  els.pTitle.textContent = `Task ${state.idx + 1}: ${p.title}`;

  renderDescPanel(p);

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
    if (els.explainList) els.explainList.innerHTML = "";
    if (els.explainInput) els.explainInput.value = "";
    state.explainAttempts = 0;
    state.explainGateLockTime = null;
    state.gateUnits = [];
    state.gateUnitIndex = 0;
    updateAttemptCounter();
  }
  state.explainPassed = false;
  state.explainLocked = false;
  applyExplainLock();
  applyDescLock();
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

function isCreativeType(p) {
  return p?.type === "creative-problem" || p?.type === "creative-cli";
}

function isCliType(p) {
  return p?.type === "cli-given" || p?.type === "creative-cli";
}

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

// ────────────── Keystroke logging ──────────────
function _classifyKey(e) {
  if (e.ctrlKey || e.metaKey) return { type: "ctrl", key: e.key.toLowerCase() };
  if (e.key.length === 1) return { type: "printable" };
  if (
    [
      "ArrowLeft",
      "ArrowRight",
      "ArrowUp",
      "ArrowDown",
      "Home",
      "End",
      "PageUp",
      "PageDown",
    ].includes(e.key)
  )
    return { type: "navigation", key: e.key };
  if (["Backspace", "Delete"].includes(e.key))
    return { type: "delete", key: e.key };
  return { type: "special", key: e.key };
}

function _trackKeystroke(e) {
  if (!_kbBatch) _kbBatch = { startTs: Date.now(), keys: [] };
  _kbBatch.keys.push(_classifyKey(e));
  clearTimeout(_kbBatchTimer);
  if (_kbBatch.keys.length >= KB_BATCH_MAX) {
    _flushKeystrokeBatch();
  } else {
    _kbBatchTimer = setTimeout(_flushKeystrokeBatch, KB_FLUSH_DELAY);
  }
}

function _flushKeystrokeBatch() {
  if (!_kbBatch || _kbBatch.keys.length === 0) return;
  const { startTs, keys } = _kbBatch;
  _kbBatch = null;
  const s = { printable: 0, delete: 0, navigation: 0, ctrl: [], special: [] };
  for (const k of keys) {
    if (k.type === "printable") s.printable++;
    else if (k.type === "delete") s.delete++;
    else if (k.type === "navigation") s.navigation++;
    else if (k.type === "ctrl") s.ctrl.push(k.key);
    else s.special.push(k.key);
  }
  logEvent("keystroke_batch", {
    totalKeys: keys.length,
    printableKeys: s.printable,
    deleteKeys: s.delete,
    navigationKeys: s.navigation,
    ctrlCombos: s.ctrl,
    specialKeys: [...new Set(s.special)],
    durationMs: Date.now() - startTs,
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

  // creative 유형: 자동채점 없이 저장 후 Next 활성화 (gate보다 먼저 체크)
  if (isCreativeType(p) && mode === "submit") {
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
    termPush(
      `<span class="term-ok">✓ 제출 완료 — NEXT 버튼으로 다음 문제로 이동하세요.</span>`,
    );
    return;
  }

  // phase2: Submit 첫 클릭 시 explanation gate 트리거 (빈 코드 제외)
  if (
    currentPhase() === "phase2" &&
    mode === "submit" &&
    !state.explainPassed
  ) {
    if (state.code.trim().length < 10) {
      termPush(`<span class="term-err">코드를 먼저 작성해주세요.</span>`);
      return;
    }
    state.explainLocked = true;
    state.explainGateLockTime = Date.now();
    updateAttemptCounter();
    applyExplainLock();
    logEvent("gate_triggered", {
      problemId: p.id,
      triggerSource: "submit_click",
    });
    initGateUnits(p, state.code);
    return;
  }

  const cmd =
    mode === "submit"
      ? "pytest --submit (visible + hidden)"
      : `${state.lang} ${els.fileName.textContent}`;
  termPush(`<span class="term-muted">$ ${escapeHtml(cmd)}</span>`);

  const sessionUid =
    session.userId ||
    localStorage.getItem(SESSION_USER_KEY) ||
    runArgs.userIdParam ||
    "";
  const { baseId } = resolveUserId(sessionUid);
  if (!baseId) {
    termPush(`<span class="term-err">Judge Error</span> <span class="term-muted">userId is missing. Please login again.</span>`);
    showLogin("세션이 만료되었습니다. 사용자 ID를 다시 입력하세요.");
    return;
  }
  // Keep session/user cache aligned before judge requests.
  if (session.userId !== baseId) session.userId = baseId;
  localStorage.setItem(SESSION_USER_KEY, baseId);

  const body = {
    problemId: p.id,
    language: state.lang,
    code: state.code,
    mode,
    userId: baseId,
  };
  console.log("[judge request body]", body);
  termPush(
    `<span class="term-muted">[debug] payload userId=${escapeHtml(String(body.userId || ""))}</span>`,
  );
  if (!body.userId) {
    termPush(
      `<span class="term-err">Judge Error</span> <span class="term-muted">blocked request because userId is empty</span>`,
    );
    return;
  }
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
        if (p.type === "cli-given") {
          if (c.passed) {
            termPush(
              `<span class="term-ok">  ✓ case #${c.index}</span> <span class="term-muted">stdin: ${escapeHtml((c.stdin || "").slice(0, 80).replace(/\n/g, "↵"))}</span>`,
            );
          } else {
            termPush(
              `<span class="term-err">  ✗ case #${c.index} failed</span>`,
            );
            if (c.stdin)
              termPush(
                `<span class="term-muted">    stdin:    ${escapeHtml((c.stdin || "").replace(/\n/g, "↵"))}</span>`,
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
                `<span class="term-err">    error:    ${escapeHtml(String(c.error).slice(0, 200))}</span>`,
              );
          }
        } else {
          if (c.passed) {
            termPush(
              `<span class="term-ok">  ✓ case #${c.index} passed</span>`,
            );
          } else {
            termPush(
              `<span class="term-err">  ✗ case #${c.index} failed</span> <span class="term-muted">input=${escapeHtml(JSON.stringify(c.input))} expected=${escapeHtml(JSON.stringify(c.expected))} actual=${escapeHtml(JSON.stringify(c.actual))}${c.error ? " err=" + escapeHtml(String(c.error).slice(0, 200)) : ""}</span>`,
            );
          }
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

// function buildSystemPrompt() {
//   const p = currentProblem();
//   const problemTitle = p ? p.title : "현재 문제";
//   return [
//     `You are a helpful coding assistant strictly scoped to ONE problem: "${problemTitle}".`,
//     "The full problem statement (and any images) was provided as the first user message in this conversation.",
//     "",
//     "STRICT SCOPE RULES:",
//     `- You may ONLY discuss: the problem itself, its constraints, hints, approach, time/space complexity, code review, and debugging of the student's solution.`,
//     `- If the user explicitly asks you to solve the current problem (e.g. '문제를 풀어줘', '정답 코드 작성해줘', 'solution 알려줘'), you should answer directly with a correct approach and code for this problem.`,
//     "- If the user asks about ANY other problem, topic, or task — even if it is a coding question — politely refuse in one sentence and redirect them back to the current problem.",
//     `- Example refusal (Korean): \"죄송합니다, 저는 현재 문제 '${problemTitle}'에 대해서만 도움드릴 수 있습니다.\"`,
//     "",
//     "RESPONSE STYLE:",
//     "- Respond in the user's language (Korean if they write Korean).",
//     "- If the user asks for hints, give hints.",
//     "- If the user asks for a full solution, provide the full solution directly.",
//     "- Be concise and focused on the current problem only.",
//     "",
//     `Language: ${state.lang}`,
//     `Student's current code:\n\`\`\`${state.lang}\n${state.code.slice(0, 2000)}\n\`\`\``,
//   ].join("\n");
// }

function buildSystemPrompt() {
  const p = currentProblem();
  const taskTitle = p ? p.title : "현재 태스크";
  const taskType = p ? p.type : "general";
  // type: "solve" | "design" | "implement" | "specify"

  const taskDescriptions = {
    solve: `프로그래밍 문제 풀기: "${taskTitle}"`,
    design: `프로그래밍 문제 디자인하기: "${taskTitle}"`,
    implement: `명세 구현 과제: "${taskTitle}"`,
    specify: `명세 작성하기: "${taskTitle}"`,
  };

  const scopeRules = {
    solve: [
      `- 현재 문제의 이해, 접근 방식, 시간/공간 복잡도, 힌트, 코드 리뷰, 디버깅에 대해서만 답변하세요.`,
      `- 사용자가 풀이를 직접 요청하면 (예: '풀어줘', '정답 알려줘', 'solution 작성해줘') 올바른 접근법과 코드를 제공하세요.`,
    ],
    design: [
      `- 문제 설계 조건, 예제 입출력 구성, 엣지 케이스 설정, 난이도 조정, 문제 서술 방식에 대해서만 답변하세요.`,
      `- 사용자가 문제 초안 작성을 요청하면 직접 작성해주세요.`,
    ],
    implement: [
      `- 주어진 명세의 이해, 기능별 구현 방법, 코드 구조 설계, 디버깅에 대해서만 답변하세요.`,
      `- 사용자가 특정 기능의 구현을 요청하면 해당 기능의 코드를 직접 제공하세요.`,
    ],
    specify: [
      `- 명세 작성 방법, 요구사항 구체화, 엣지 케이스 정의, 명세 구조 설계에 대해서만 답변하세요.`,
      `- 사용자가 명세 초안 작성을 요청하면 직접 작성해주세요.`,
    ],
  };

  const currentTaskDesc =
    taskDescriptions[taskType] ?? `현재 태스크: "${taskTitle}"`;
  const currentScopeRules = scopeRules[taskType] ?? [
    `- 현재 태스크와 직접 관련된 내용에 대해서만 답변하세요.`,
  ];

  const codeContext = state.code
    ? [
        "",
        `현재 작성 중인 코드:`,
        `\`\`\`${state.lang}`,
        state.code.slice(0, 2000),
        `\`\`\``,
      ].join("\n")
    : "";

  return [
    `You are a helpful assistant strictly scoped to ONE task: ${currentTaskDesc}.`,
    "The full task description (and any related materials) was provided as the first user message in this conversation.",
    "",
    "STRICT SCOPE RULES:",
    ...currentScopeRules,
    `- 현재 태스크와 무관한 질문이나 다른 태스크에 대한 요청은 한 문장으로 정중히 거절하고 현재 태스크로 안내하세요.`,
    `- 거절 예시 (Korean): \"죄송합니다, 저는 현재 태스크 '${taskTitle}'에 대해서만 도움드릴 수 있습니다.\"`,
    "",
    "RESPONSE STYLE:",
    "- 사용자가 사용하는 언어로 답변하세요. (한국어로 질문하면 한국어로 답변)",
    "- 힌트를 요청하면 힌트를 제공하고, 직접적인 답변을 요청하면 직접 제공하세요.",
    "- 현재 태스크에만 집중하여 간결하게 답변하세요.",
    "",
    `Language: ${state.lang}`,
    codeContext,
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
        user_id: runArgs.userIdParam,
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

function applyDescLock() {
  const p = currentProblem();
  const needsLock = isCreativeType(p) && !state.descSaved;
  if (els.codeInput)
    els.codeInput.readOnly = needsLock || !!state.explainLocked;
  if (els.runBtn) els.runBtn.disabled = needsLock || !!state.explainLocked;
  if (els.submitBtn)
    els.submitBtn.disabled = needsLock || !!state.explainLocked;
  if (needsLock && els.nextBtn) els.nextBtn.disabled = true;
  els.codeArea?.classList.toggle("editor-locked", needsLock);
}

function updateAttemptCounter() {
  // Attempt count is tracked in state.explainAttempts for logging only; no UI display
}

const GATE_ANALYZE_PROMPT = `You are analyzing student-submitted code to identify explanation units for a coding education platform. An explanation unit is a named function or a significant standalone algorithm block. Return one unit per function. If the code is a single block with no named functions, return one unit for the whole code.

Respond ONLY with valid JSON, no other text:
{"units":[{"id":"U1","display":"표시명(한국어, 예: joystick 함수)","snippet":"해당 함수/블록의 전체 코드","prompt_ko":"이 [함수명]이 어떻게 동작하는지 설명해주세요. 핵심 로직과 그 이유를 포함해서 설명하세요."}]}`;

const GATE_SYSTEM_PROMPT = `You are evaluating a student's explanation of a specific code unit in a coding education platform. Assess whether the explanation demonstrates genuine understanding.

Pass if: the explanation correctly describes how the code works, including the key logic and why it works that way.
Fail if: the explanation is vague, incorrect, or merely restates what the code does without explaining the underlying logic or reasoning.

Respond ONLY with valid JSON, no other text:
{"pass": true, "feedback": "한국어로 한두 문장 피드백"}`;

function gateDetectShallow(explanation, recentMessages) {
  if (!recentMessages || !recentMessages.length) {
    return { isShallow: false, reason: null, message: null };
  }
  const SHALLOW_MSG =
    "이 설명은 AI 어시스턴트의 답변과 매우 유사합니다. 코드가 어떻게 작동하는지, 그 이유는 무엇인지 자신의 말로 설명해주세요.";

  const expTokens = new Set(
    explanation.toLowerCase().split(/\s+/).filter(Boolean),
  );
  if (expTokens.size === 0)
    return { isShallow: false, reason: null, message: null };

  const recent = recentMessages.slice(-5).filter((m) => typeof m === "string");

  // 개별 메시지와 Jaccard 비교 (단일 메시지 복붙 탐지)
  for (const msg of recent) {
    const msgTokens = new Set(msg.toLowerCase().split(/\s+/).filter(Boolean));
    const intersection = [...expTokens].filter((t) => msgTokens.has(t)).length;
    const union = new Set([...expTokens, ...msgTokens]).size;
    if (union > 0 && intersection / union > 0.7) {
      return {
        isShallow: true,
        reason: "generator_copy",
        message: SHALLOW_MSG,
      };
    }
  }

  // 전체 AI 메시지 합산 대비 포함률 확인 (다수 메시지 연속 복붙 탐지)
  // 짧은 설명은 어휘 겹침이 우연히 높을 수 있으므로 최소 토큰 수 이상일 때만 적용
  if (expTokens.size >= 15) {
    const allAiTokens = new Set(
      recent.flatMap((m) => m.toLowerCase().split(/\s+/).filter(Boolean)),
    );
    const overlapCount = [...expTokens].filter((t) =>
      allAiTokens.has(t),
    ).length;
    const containment = overlapCount / expTokens.size;
    if (containment > 0.8) {
      return {
        isShallow: true,
        reason: "generator_copy",
        message: SHALLOW_MSG,
      };
    }
  }

  return { isShallow: false, reason: null, message: null };
}

function gateCharCountFallback(explanation) {
  const pass = explanation.trim().length >= 100;
  return {
    pass,
    feedback: pass
      ? "설명이 충분합니다."
      : "설명이 너무 짧습니다. 코드의 핵심 로직과 이유를 더 자세히 설명해주세요.",
    shallowDetection: { isShallow: false, reason: null, message: null },
  };
}

async function _sseToText(res) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let accumulated = "";
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop();
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (payload === "[DONE]") continue;
      try {
        const delta = JSON.parse(payload)?.choices?.[0]?.delta?.content;
        if (delta) accumulated += delta;
      } catch (_) {}
    }
  }
  let clean = accumulated.trim();
  const fence = clean.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fence) clean = fence[1].trim();
  return clean;
}

async function analyzeCodeForUnits(problem, code) {
  const res = await fetch(CHAT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: getModel(),
      messages: [
        { role: "system", content: GATE_ANALYZE_PROMPT },
        {
          role: "user",
          content: `문제: ${problem.title || problem.slug || ""}\n\n제출된 코드:\n\`\`\`\n${code.slice(0, 3000)}\n\`\`\``,
        },
      ],
      temperature: 0.0,
      max_tokens: 1000,
    }),
  });
  if (!res.ok) throw new Error(`코드 분석 API 오류 ${res.status}`);
  const text = await _sseToText(res);
  const parsed = JSON.parse(text);
  const units = Array.isArray(parsed?.units) ? parsed.units : [];
  if (units.length === 0) throw new Error("단위 없음");
  return units;
}

async function initGateUnits(problem, code) {
  const loadEl = document.createElement("div");
  loadEl.className = "explain-bubble bot";
  loadEl.textContent = "제출한 코드를 분석 중입니다…";
  if (els.explainList) {
    els.explainList.appendChild(loadEl);
    els.explainList.scrollTop = els.explainList.scrollHeight;
  }
  try {
    state.gateUnits = await analyzeCodeForUnits(problem, code);
  } catch (_) {
    state.gateUnits = [
      {
        id: "U1",
        display: "전체 코드",
        snippet: code,
        prompt_ko:
          "이 코드가 어떻게 동작하는지 설명해주세요. 핵심 로직과 그 이유를 포함해서 설명하세요.",
      },
    ];
  }
  loadEl.remove();
  state.gateUnitIndex = 0;
  showCurrentGateUnit();
}

function showCurrentGateUnit() {
  const unit = state.gateUnits[state.gateUnitIndex];
  if (!unit) return;
  const total = state.gateUnits.length;
  const idx = state.gateUnitIndex + 1;

  const el = document.createElement("div");
  el.className = "explain-bubble bot";

  const header = document.createElement("strong");
  header.textContent = `[${idx}/${total}] ${unit.display}`;
  el.appendChild(header);

  if (unit.snippet) {
    const pre = document.createElement("pre");
    pre.className = "explain-code-snippet";
    pre.textContent = unit.snippet;
    el.appendChild(pre);
  }

  const question = document.createElement("p");
  question.style.marginTop = "8px";
  question.textContent = unit.prompt_ko;
  el.appendChild(question);

  if (els.explainList) {
    els.explainList.appendChild(el);
    els.explainList.scrollTop = els.explainList.scrollHeight;
  }
  if (els.explainInput) els.explainInput.placeholder = unit.prompt_ko;
}

async function callGateApi(text) {
  const unit = state.gateUnits[state.gateUnitIndex];
  if (!unit) return gateCharCountFallback(text);

  const recentAssistantMsgs = aiHistory
    .filter((m) => m.role === "assistant" && typeof m.content === "string")
    .slice(-5)
    .map((m) => m.content);
  const shallowDetection = gateDetectShallow(text, recentAssistantMsgs);

  const res = await fetch(CHAT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
      model: getModel(),
      messages: [
        { role: "system", content: GATE_SYSTEM_PROMPT },
        {
          role: "user",
          content: `코드:\n\`\`\`\n${(unit.snippet || "").slice(0, 2000)}\n\`\`\`\n\n질문: ${unit.prompt_ko}\n\n학생의 설명: ${text}`,
        },
      ],
      temperature: 0.0,
      max_tokens: 2000,
      user_id: runArgs.userIdParam,
    }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(
      `평가 API 오류 ${res.status}: ${data?.error?.message || JSON.stringify(data)}`,
    );
  }

  const raw = await _sseToText(res);
  let pass = false;
  let feedback = "";
  try {
    const parsed = JSON.parse(raw);
    pass = !!parsed.pass;
    feedback = parsed.feedback || "";
  } catch (_) {
    throw new Error("응답을 파싱할 수 없습니다. 다시 시도해주세요.");
  }

  return { pass, feedback, shallowDetection };
}

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderRubricFeedback(gateResponse) {
  const { pass, feedback, shallowDetection } = gateResponse;
  const container = document.createElement("div");
  container.className = "rubric-feedback";

  if (shallowDetection?.isShallow && shallowDetection.message) {
    const warn = document.createElement("div");
    warn.className = "shallow-warning";
    warn.textContent = shallowDetection.message;
    container.appendChild(warn);
  }

  const item = document.createElement("div");
  item.className = `rubric-item ${pass ? "correct" : "missing"}`;
  item.innerHTML =
    `<span class="rubric-item-icon">${pass ? "✅" : "❌"}</span>` +
    `<div class="rubric-item-body">` +
    `<span class="rubric-item-feedback">${escapeHtml(feedback)}</span>` +
    `</div>`;
  container.appendChild(item);

  els.explainList.appendChild(container);
  els.explainList.scrollTop = els.explainList.scrollHeight;

  if (!pass) return;

  state.gateUnitIndex++;
  if (state.gateUnitIndex < state.gateUnits.length) {
    showCurrentGateUnit();
    return;
  }

  // 모든 단위 통과 → Submit / 에디터로 돌아가기 버튼 표시
  const unlockContainer = document.createElement("div");
  unlockContainer.className = "rubric-feedback";

  const msg = document.createElement("div");
  msg.className = "explain-unlock-msg";
  msg.textContent =
    "모든 설명을 완료했습니다. 제출하거나 코드를 수정할 수 있습니다.";
  unlockContainer.appendChild(msg);

  const btnRow = document.createElement("div");
  btnRow.style.cssText = "display:flex;gap:8px;margin-top:8px;";

  const backBtn = document.createElement("button");
  backBtn.className = "btn";
  backBtn.textContent = "에디터로 돌아가기";
  backBtn.addEventListener("click", () => {
    state.explainPassed = false;
    state.explainLocked = false;
    applyExplainLock();
    logEvent("gate_back_to_editor", { totalAttempts: state.explainAttempts });
  });

  const submitBtn = document.createElement("button");
  submitBtn.className = "btn primary explain-unlock-btn";
  submitBtn.textContent = "Submit 제출";
  submitBtn.addEventListener("click", () => {
    logEvent("gate_unlocked", {
      unlockType: "full",
      totalAttempts: state.explainAttempts,
      unitCount: state.gateUnits.length,
      totalTimeMs: state.explainGateLockTime
        ? Date.now() - state.explainGateLockTime
        : null,
    });
    state.explainPassed = true;
    state.explainLocked = false;
    applyExplainLock();
    judge("submit");
  });

  btnRow.appendChild(backBtn);
  btnRow.appendChild(submitBtn);
  unlockContainer.appendChild(btnRow);

  els.explainList.appendChild(unlockContainer);
  els.explainList.scrollTop = els.explainList.scrollHeight;
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

  state.explainAttempts += 1;
  updateAttemptCounter();

  logEvent("explanation_submitted", {
    attemptNumber: state.explainAttempts,
    wordCount: text.split(/\s+/).filter(Boolean).length,
    charCount: text.length,
    timeSpentMs: state.explainGateLockTime
      ? Date.now() - state.explainGateLockTime
      : null,
  });

  const evaluatingEl = document.createElement("div");
  evaluatingEl.className = "explain-bubble bot";
  evaluatingEl.textContent = "설명을 평가 중입니다…";
  els.explainList.appendChild(evaluatingEl);
  els.explainList.scrollTop = els.explainList.scrollHeight;

  let succeeded = false;
  try {
    const gateResponse = await callGateApi(text);
    succeeded = true;
    state.explainConsecErrors = 0;
    evaluatingEl.remove();

    renderRubricFeedback(gateResponse);

    logEvent("evaluation_completed", {
      attemptNumber: state.explainAttempts,
      unitIndex: state.gateUnitIndex,
      pass: gateResponse.pass,
    });
  } catch (e) {
    state.explainConsecErrors = (state.explainConsecErrors || 0) + 1;
    const errMsg = `평가 오류: ${e.message}. 다시 시도해주세요.`;
    if (!succeeded) {
      evaluatingEl.textContent = errMsg;
    } else {
      addExplainBubble("bot", errMsg);
    }
    if (state.explainConsecErrors >= 3) {
      const escapeEl = document.createElement("div");
      escapeEl.className = "explain-bubble bot";
      escapeEl.innerHTML = `<span style="color:var(--accent-red,#f87171)">평가 서버에 반복적으로 연결할 수 없습니다.</span><br>
        <button class="btn" style="margin-top:8px" id="explainForceUnlock">잠금 해제하고 계속 진행</button>`;
      els.explainList?.appendChild(escapeEl);
      els.explainList.scrollTop = els.explainList.scrollHeight;
      document
        .getElementById("explainForceUnlock")
        ?.addEventListener("click", () => {
          state.explainConsecErrors = 0;
          state.explainLocked = false;
          applyExplainLock();
          logEvent("gate_force_unlocked", {
            reason: "network_error",
            attempts: state.explainAttempts,
          });
        });
    }
  } finally {
    if (state.explainLocked) {
      els.explainSend.disabled = false;
    }
    state.explainGateLockTime = Date.now();
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
    _trackKeystroke(e);
  });
  els.codeInput.addEventListener("paste", (e) => {
    const text = e.clipboardData?.getData("text") ?? "";
    logEvent("paste", { chars: text.length, content: text });
  });
  els.codeInput.addEventListener("copy", () => {
    const sel = els.codeInput.value.slice(
      els.codeInput.selectionStart,
      els.codeInput.selectionEnd,
    );
    if (sel.length > 0) logEvent("copy", { chars: sel.length, content: sel });
  });
  els.codeInput.addEventListener("cut", () => {
    const sel = els.codeInput.value.slice(
      els.codeInput.selectionStart,
      els.codeInput.selectionEnd,
    );
    if (sel.length > 0) logEvent("cut", { chars: sel.length, content: sel });
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
  els.explainBack?.addEventListener("click", () => {
    state.explainLocked = false;
    state.explainPassed = false;
    applyExplainLock();
    logEvent("gate_cancelled", { attempts: state.explainAttempts });
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
  applyDescLock();

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
