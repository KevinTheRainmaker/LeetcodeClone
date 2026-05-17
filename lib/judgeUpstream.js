// Shared by Vercel api/judge + api/log (Node serverless only).

import dns from "node:dns";

try {
  dns.setDefaultResultOrder("ipv4first");
} catch {
  // ignore on very old runtimes
}

/** @param {string | undefined} raw */
export function normalizeJudgeBaseUrl(raw) {
  let u = String(raw ?? "")
    .trim()
    .replace(/^["']+|["']+$/g, "");
  if (!u) return "";
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  return u.replace(/\/+$/, "");
}

/** @param {unknown} err @param {{ baseUrl?: string }} [opts] */
export function upstreamFetchErrorBody(err, opts = {}) {
  const chain = [];
  let cur = err;
  for (let i = 0; i < 6 && cur; i++) {
    const msg = cur instanceof Error ? cur.message : String(cur);
    if (msg) chain.push(msg);
    cur = cur instanceof Error ? cur.cause : null;
  }
  const detail = chain[0] || "Unknown error";
  const causes = chain.length > 1 ? chain.slice(1) : undefined;
  const vercelEnv = process.env.VERCEL_ENV || "";
  let upstreamHost;
  if (opts.baseUrl) {
    try {
      upstreamHost = new URL(opts.baseUrl).hostname;
    } catch {
      upstreamHost = "(invalid JUDGE_BASE_URL)";
    }
  }
  return {
    detail,
    causes,
    upstreamHost,
    vercelEnv: vercelEnv || undefined,
    hint:
      "Vercel→Railway fetch threw (not an HTTP status from judge). " +
      "Check: (1) JUDGE_BASE_URL is correct for this deployment " +
      (vercelEnv === "preview"
        ? "(Preview needs its own env or 'All environments'). "
        : "") +
      "(2) Railway public URL works: curl $JUDGE_BASE_URL/health " +
      "(3) no VPN/firewall blocking outbound HTTPS from Vercel.",
  };
}
