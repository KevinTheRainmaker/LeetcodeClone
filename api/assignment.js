// Vercel Serverless Function — relay condition assignment records to the judge-server.

import {
  normalizeJudgeBaseUrl,
  upstreamFetchErrorBody,
} from "../lib/judgeUpstream.js";

export const config = { maxDuration: 15 };

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const base = normalizeJudgeBaseUrl(process.env.JUDGE_BASE_URL);
  if (!base) {
    return res.status(500).json({ error: "JUDGE_BASE_URL is not configured" });
  }

  const body =
    typeof req.body === "string" ? req.body : JSON.stringify(req.body || {});

  const headers = { "Content-Type": "application/json" };
  if (process.env.JUDGE_SHARED_TOKEN) {
    headers["Authorization"] = `Bearer ${process.env.JUDGE_SHARED_TOKEN}`;
  }

  try {
    const upstream = await fetch(`${base}/client/assignment`, {
      method: "POST",
      headers,
      body,
    });
    const text = await upstream.text();
    res
      .status(upstream.status)
      .setHeader("Content-Type", "application/json; charset=utf-8")
      .send(text || "{}");
  } catch (err) {
    return res.status(502).json({
      error: "Assignment upstream failed",
      ...upstreamFetchErrorBody(err, { baseUrl: base }),
    });
  }
}
