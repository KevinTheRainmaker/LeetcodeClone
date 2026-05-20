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

function getAllowedOrigins() {
  const env = process.env.ALLOWED_ORIGINS;
  if (env) return new Set(env.split(",").map((s) => s.trim()));
  return new Set([
    "https://chi-27-step1-gqess6nbb-kevintherainmakers-projects.vercel.app",
    "http://localhost:8080",
    "http://localhost:3000",
  ]);
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

// Strip base64 image data from messages before logging (keeps storage lean)
function sanitizeForLogging(messages) {
  return messages.map((msg) => {
    if (!Array.isArray(msg.content)) return msg;
    return {
      ...msg,
      content: msg.content.map((block) =>
        block.type === "image_url"
          ? { type: "image_url", image_url: { url: "[image omitted]" } }
          : block,
      ),
    };
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  // Origin gate — only blocks requests with a known-bad Origin header.
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

  // Langfuse tracing setup
  const langfuse = makeLangfuse();
  let generation = null;
  const startTime = new Date();

  if (langfuse) {
    try {
      const trace = langfuse.trace({
        name: "chat",
        userId: rawUserId,
        metadata: { model, temperature, maxTokens },
      });
      generation = trace.generation({
        name: "openrouter",
        model,
        input: sanitizeForLogging(messages),
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
    res.end();

    // Log completed generation to Langfuse
    if (generation) {
      try {
        generation.end({ output: fullResponse, endTime: new Date() });
        await langfuse.flushAsync();
      } catch {}
    }
  } catch (err) {
    if (generation) {
      try {
        generation.end({
          output: String(err?.message || err),
          level: "ERROR",
          endTime: new Date(),
        });
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
