// Vercel Serverless Function — log judge run/submit events to Langfuse.
// Called by the client after each judge action so they appear as separate
// turns in the same Langfuse session alongside AI chat turns.

import Langfuse from "langfuse";

export const config = { maxDuration: 10 };

function isAllowedOrigin(origin) {
  if (!origin) return true;
  if (
    origin.startsWith("http://localhost") ||
    origin.startsWith("http://127.0.0.1")
  )
    return true;

  const env = process.env.ALLOWED_ORIGINS;
  if (env)
    return env
      .split(",")
      .map((s) => s.trim())
      .includes(origin);

  if (origin.endsWith("-kevintherainmakers-projects.vercel.app")) return true;
  if (origin === "https://leetcodeclone.vercel.app") return true;
  if (origin === "https://chi27.kangbeen.my") return true;

  return false;
}

function makeLangfuse() {
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
  const secretKey = process.env.LANGFUSE_SECRET_KEY;
  if (!publicKey || !secretKey) return null;
  return new Langfuse({
    publicKey,
    secretKey,
    baseUrl: process.env.LANGFUSE_HOST || "https://cloud.langfuse.com",
    flushAt: 100,
    flushInterval: 0,
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const origin = req.headers.origin;
  if (!isAllowedOrigin(origin)) {
    return res.status(403).json({ error: "Forbidden: origin not allowed" });
  }

  const body =
    typeof req.body === "string" ? safeParse(req.body) : req.body || {};

  const {
    event_type, // "code_run" | "code_submit" | "code_run_error" | "code_submit_error"
    user_id,
    session_id,
    problem_id,
    ai_turn_index,
    event_seq,
    mode, // "run" | "submit"
    status,
    passed,
    total,
    runtime_ms,
    code_length,
    timestamp,
  } = body;

  const langfuse = makeLangfuse();
  if (langfuse && event_type && user_id) {
    try {
      const traceName = problem_id
        ? `${event_type}:p${problem_id}`
        : event_type;
      const ts = timestamp ? new Date(timestamp) : new Date();
      langfuse.trace({
        name: traceName,
        sessionId: session_id ?? undefined,
        userId: user_id,
        timestamp: ts,
        input: { code_length, mode },
        output: { status, passed, total },
        metadata: {
          event_type,
          mode,
          problem_id,
          ai_turn_index,
          event_seq,
          status,
          passed,
          total,
          runtime_ms,
          code_length,
        },
      });
      await langfuse.flushAsync();
    } catch {
      // Langfuse failure must never break the response
    }
  }

  return res.status(200).json({ ok: true });
}

function safeParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}
