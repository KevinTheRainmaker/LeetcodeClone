// Vercel Serverless Function — OpenRouter streaming proxy.
// Uses server-side secret OPENROUTER_API_KEY so the key never reaches the browser.

import { readFileSync } from "fs";
import { join } from "path";

export const config = { maxDuration: 30 };

// Module-level cache for allowed users
let _allowedUsers = null;
function getAllowedUsers() {
  if (!_allowedUsers) {
    try {
      const raw = readFileSync(
        join(process.cwd(), "data/allowed_users.json"),
        "utf8",
      );
      _allowedUsers = new Set(JSON.parse(raw));
    } catch {
      _allowedUsers = new Set();
    }
  }
  return _allowedUsers;
}

function getAllowedOrigins() {
  const env = process.env.ALLOWED_ORIGINS;
  if (env) return new Set(env.split(",").map((s) => s.trim()));
  return new Set([
    "https://chi-27-step1-gqess6nbb-kevintherainmakers-projects.vercel.app",
    "http://localhost:8080",
    "http://localhost:3000",
  ]);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  // Origin gate — only blocks requests with a known-bad Origin header.
  // Same-origin browser requests omit Origin entirely → allowed (user_id gate covers abuse).
  // localhost origins are always allowed for local dev (vercel dev injects these).
  const origin = req.headers.origin;
  const isLocalhost =
    !!origin &&
    (origin.startsWith("http://localhost") ||
      origin.startsWith("http://127.0.0.1"));
  if (origin && !isLocalhost && !getAllowedOrigins().has(origin)) {
    return res.status(403).json({ error: "Forbidden: origin not allowed" });
  }

  const body =
    typeof req.body === "string" ? safeParse(req.body) : req.body || {};

  // user_id gate — strip _exp suffix (experiment variant) before lookup
  const rawUserId = typeof body.user_id === "string" ? body.user_id.trim() : "";
  const userId = rawUserId.replace(/_exp$/, "");
  if (!userId || !getAllowedUsers().has(userId)) {
    return res.status(403).json({ error: "Forbidden: user not allowed" });
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return res
      .status(500)
      .json({ error: "OPENROUTER_API_KEY is not configured" });
  }

  const messages = Array.isArray(body.messages) ? body.messages : null;
  if (!messages) {
    return res.status(400).json({ error: "messages[] is required" });
  }

  const model =
    (typeof body.model === "string" && body.model.trim()) ||
    process.env.OPENROUTER_MODEL ||
    "anthropic/claude-sonnet-4.6";

  const temperature =
    typeof body.temperature === "number" ? body.temperature : 0.6;
  const maxTokens = typeof body.max_tokens === "number" ? body.max_tokens : 800;

  const referer =
    process.env.OPENROUTER_REFERER ||
    (req.headers.origin
      ? String(req.headers.origin)
      : "https://leetcodeclone.vercel.app");

  try {
    const upstream = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          "HTTP-Referer": referer,
          "X-Title": "LeetcodeClone",
        },
        body: JSON.stringify({
          model,
          messages,
          temperature,
          max_tokens: maxTokens,
          stream: true,
        }),
      },
    );

    if (!upstream.ok) {
      const errText = await upstream.text();
      return res
        .status(upstream.status)
        .setHeader("Content-Type", "application/json")
        .send(errText || "{}");
    }

    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("X-Accel-Buffering", "no");

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(decoder.decode(value, { stream: true }));
    }
    res.end();
  } catch (err) {
    if (!res.headersSent) {
      return res.status(502).json({
        error: "Upstream request failed",
        detail: String(err?.message || err),
      });
    }
    res.end();
  }
}

function safeParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}
