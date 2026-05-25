// Vercel Serverless Function — OpenRouter streaming proxy.
// Uses server-side secret OPENROUTER_API_KEY so the key never reaches the browser.

import { readFileSync } from "fs";
import { join } from "path";
import Langfuse from "langfuse";

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

  // Allow any Vercel preview/production deployment for this project account
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
    flushAt: 1,
    flushInterval: 0,
  });
}

// Extract the last user message as plain text (truncated) for Langfuse logging.
// Using the full messages array risks hitting payload size limits and being silently dropped.
function extractLastUserText(messages, maxLen = 2000) {
  const msg = [...messages].reverse().find((m) => m.role === "user");
  if (!msg) return null;
  if (typeof msg.content === "string") return msg.content.slice(0, maxLen);
  if (Array.isArray(msg.content)) {
    return msg.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("")
      .slice(0, maxLen);
  }
  return null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  // Origin gate — only blocks requests with a known-bad Origin header.
  const origin = req.headers.origin;
  if (!isAllowedOrigin(origin)) {
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

  // Langfuse tracing setup
  const langfuse = makeLangfuse();
  let generation = null;
  let lfTrace = null;
  const startTime = new Date();

  if (langfuse) {
    try {
      const logInput = extractLastUserText(messages);
      lfTrace = langfuse.trace({
        name: "chat",
        userId: rawUserId,
        timestamp: startTime,
        input: logInput,
        metadata: { model, temperature, maxTokens },
      });
      generation = lfTrace.generation({
        name: "openrouter",
        model,
        modelParameters: { temperature, maxTokens },
        input: logInput,
        startTime,
      });
    } catch {
      // Langfuse setup failure must never break chat
    }
  }

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
      if (generation) {
        try {
          generation.end({
            output: errText,
            level: "ERROR",
            endTime: new Date(),
          });
          if (lfTrace) lfTrace.update({ output: errText });
          await langfuse.flushAsync();
        } catch {}
      }
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
    let fullResponse = "";
    let sseBuffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      res.write(chunk);

      // Parse SSE to accumulate full response text for Langfuse
      sseBuffer += chunk;
      const lines = sseBuffer.split("\n");
      sseBuffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") continue;
        try {
          const delta = JSON.parse(payload)?.choices?.[0]?.delta?.content;
          if (delta) fullResponse += delta;
        } catch {
          // partial JSON — skip
        }
      }
    }
    // Flush Langfuse BEFORE res.end() — Vercel reclaims the container immediately
    // after the response ends, so any async work after res.end() is not guaranteed.
    if (generation) {
      try {
        const logOutput = fullResponse.slice(0, 2000) || null;
        generation.end({ output: fullResponse || null, endTime: new Date() });
        if (lfTrace) lfTrace.update({ output: logOutput });
        await langfuse.flushAsync();
      } catch {}
    }

    res.end();
  } catch (err) {
    if (generation) {
      try {
        const errStr = String(err?.message || err);
        generation.end({ output: errStr, level: "ERROR", endTime: new Date() });
        if (lfTrace) lfTrace.update({ output: errStr });
        await langfuse.flushAsync();
      } catch {}
    }
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
