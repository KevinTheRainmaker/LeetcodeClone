// Vercel Serverless Function — OpenRouter proxy.
// Uses server-side secret OPENROUTER_API_KEY so the key never reaches the browser.

export const config = { maxDuration: 15 };

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return res
      .status(500)
      .json({ error: "OPENROUTER_API_KEY is not configured" });
  }

  const body =
    typeof req.body === "string" ? safeParse(req.body) : req.body || {};
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
        }),
      },
    );

    const text = await upstream.text();
    res
      .status(upstream.status)
      .setHeader("Content-Type", "application/json; charset=utf-8")
      .send(text || "{}");
  } catch (err) {
    return res.status(502).json({
      error: "Upstream request failed",
      detail: String(err?.message || err),
    });
  }
}

function safeParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}
