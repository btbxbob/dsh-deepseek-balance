import z from "@deepseek-ai/schemastery";
import { credentialRef } from "@deepseek-ai/dsh-credentials";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/**
 * dsh-balance — host half.
 *
 * A dual-half cordis plugin that exposes one loopback-only HTTP route,
 * GET /ds-balance/balance, which resolves the DeepSeek API key through the
 * harness credentials service (falling back to process.env) and proxies the
 * DeepSeek /user/balance endpoint. The browser half never sees the key.
 *
 * Every successful query is snapshotted to a local history file, so the
 * response can also carry an estimate of when the balance runs out (burn
 * rate derived from the most recent contiguous falling segment of history).
 *
 * @module dsh-balance
 */

/** Stable Cordis plugin name. */
export const name = "dsh-balance";

/** Services required before the route can mount. */
export const inject = ["webServer"];

/** Plugin config: which credential reference to resolve, or a literal key. */
export const Config = z.object({
  apiKeyEnv: z.string().role("credential-ref").default("DEEPSEEK_API_KEY"),
  apiKey: z.string().default(""),
  /** Minimum span (days) a falling balance segment must cover before an estimate is offered. */
  estimateMinDays: z.number().min(0).default(1),
  /** How many days of balance history to keep for burn-rate estimation. */
  historyMaxAgeDays: z.number().min(1).default(90)
});

/** The public DeepSeek API root. */
const DEEPSEEK_BASE_URL = "https://api.deepseek.com";

/** Route path (exact route; the SPA fallback and /api prefix never see it). */
const ROUTE_PATH = "/ds-balance/balance";

/** Short upstream-result cache so the badge refresh does not hammer the API. */
const CACHE_MS = 30_000;

/** Milliseconds in one day. */
const DAY_MS = 86_400_000;

/** Path of the balance history file: $DSH_HOME/dsh-balance/balance-history.json. */
function historyFilePath() {
  const home = process.env.DSH_HOME || path.join(os.homedir(), ".dsh");
  return path.join(home, "dsh-balance", "balance-history.json");
}

/**
 * Read the recorded balance history. A missing or corrupt file yields [].
 * @returns {Promise<Array<{at: number, total: number, currency: string}>>}
 */
async function loadHistory() {
  try {
    const raw = await fs.readFile(historyFilePath(), "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((s) => s && Number.isFinite(s.at) && Number.isFinite(Number(s.total)));
    }
  } catch {
    // first run: no history yet
  }
  return [];
}

/**
 * Snapshot one successful balance query, trim samples older than maxAgeDays,
 * and return the updated history (also used for the estimate below).
 */
async function recordSample(total, currency, maxAgeDays) {
  const now = Date.now();
  const history = await loadHistory();
  const cutoff = now - maxAgeDays * DAY_MS;
  const trimmed = history.filter((s) => s.at >= cutoff);
  const last = trimmed[trimmed.length - 1];
  if (last !== undefined && now - last.at < 60_000 && Number(last.total) === Number(total)) {
    return trimmed; // same balance within a minute: nothing new to record
  }
  trimmed.push({ at: now, total: Number(total), currency: currency || "CNY" });
  try {
    await fs.mkdir(path.dirname(historyFilePath()), { recursive: true });
    await fs.writeFile(historyFilePath(), JSON.stringify(trimmed), "utf8");
  } catch (error) {
    console.error("dsh-balance: failed to persist balance history", error);
  }
  return trimmed;
}

/**
 * Estimate when the balance runs out from recorded history.
 *
 * Strategy: walk back from the newest sample while the balance never rises;
 * a rise means a top-up, which would skew the burn rate, so the contiguous
 * falling segment is the usable consumption window. The daily spend is the
 * segment's total loss divided by its span, and daysLeft = current / daily.
 *
 * @param history - ascending balance samples.
 * @param currentTotal - the live balance just fetched.
 * @param minDays - minimum falling-segment span (days) to trust the estimate.
 */
function estimateDepletion(history, currentTotal, minDays) {
  const seg = [];
  for (let i = history.length - 1; i >= 0; i--) {
    const sample = history[i];
    // Samples accumulate newest-first; walking back, the balance must keep
    // rising (older = higher). A non-rising step means a top-up happened
    // between the two samples, so the usable falling segment ends here.
    if (seg.length > 0 && sample.total <= seg[seg.length - 1].total) break;
    seg.push(sample);
  }
  seg.reverse();
  if (seg.length < 2) return { available: false, reason: "insufficient-samples" };
  const first = seg[0];
  const last = seg[seg.length - 1];
  const elapsedDays = (last.at - first.at) / DAY_MS;
  if (elapsedDays < minDays) {
    return { available: false, reason: "short-window", elapsedDays };
  }
  const spent = Math.max(first.total - last.total, 0);
  if (spent <= 0) return { available: false, reason: "no-spend" };
  const dailySpend = spent / elapsedDays;
  const daysLeft = Number(currentTotal) / dailySpend;
  return {
    available: true,
    dailySpend,
    daysLeft,
    depletedAt: new Date(Date.now() + daysLeft * DAY_MS).toISOString(),
    basedOnDays: elapsedDays,
    samples: seg.length
  };
}

/**
 * Loopback-only trust fence, mirroring the connection plugin's browser-trust
 * rule: the Host must be a loopback address and a cross-site fetch is
 * rejected, so a random website cannot poke this route for the key holder.
 * @param req - node:http request.
 * @returns whether the request is trusted.
 */
function isTrustedRequest(req) {
  const host = req.headers.host;
  if (typeof host !== "string" || host === "") return false;
  const hostname = host.split(":")[0].toLowerCase();
  if (hostname !== "127.0.0.1" && hostname !== "localhost" && hostname !== "::1") return false;
  if (req.headers["sec-fetch-site"] === "cross-site") return false;
  const origin = req.headers.origin;
  if (origin === undefined) return true;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** Write a JSON response. */
function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(body);
}

/** Resolve the API key: literal config > credentials service > process env. */
async function resolveApiKey(ctx, config) {
  if (config.apiKey !== "") return config.apiKey;
  const credentials = ctx.get("credentials");
  if (credentials !== undefined) {
    const hit = await credentials.resolve(credentialRef(config.apiKeyEnv));
    if (hit !== undefined && typeof hit.value === "string" && hit.value !== "") return hit.value;
  }
  const ambient = process.env[config.apiKeyEnv];
  if (typeof ambient === "string" && ambient !== "") return ambient;
  return "";
}

/**
 * Mount the balance route. Responses are JSON and never echo the API key.
 * @param ctx - plugin context carrying the webServer service.
 * @param config - validated {@link Config}.
 */
export function apply(ctx, config) {
  let cache = null;

  const handler = async (req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      json(res, 405, { ok: false, error: "method-not-allowed" });
      return;
    }
    if (!isTrustedRequest(req)) {
      json(res, 403, { ok: false, error: "forbidden" });
      return;
    }
    if (cache !== null && Date.now() - cache.at < CACHE_MS) {
      json(res, 200, cache.payload);
      return;
    }
    const key = await resolveApiKey(ctx, config);
    if (key === "") {
      const payload = {
        ok: false,
        error: "not-configured",
        hint: `store ${config.apiKeyEnv} through the credentials service (the web Models page writes it), or export it in the launching environment`
      };
      json(res, 200, payload);
      return;
    }
    try {
      const upstream = await fetch(`${DEEPSEEK_BASE_URL}/user/balance`, {
        headers: {
          Authorization: `Bearer ${key}`,
          Accept: "application/json"
        },
        signal: AbortSignal.timeout(15_000)
      });
      const data = await upstream.json().catch(() => null);
      if (!upstream.ok) {
        json(res, 502, { ok: false, error: "upstream", status: upstream.status, detail: data });
        return;
      }
      const info = data && data.balance_infos && data.balance_infos[0];
      const payload = { ok: true, ...(data ?? {}), fetchedAt: new Date().toISOString() };
      // DeepSeek returns total_balance as a string ("50.64"), so coerce first.
      const total = info === undefined ? NaN : Number(info.total_balance);
      if (Number.isFinite(total)) {
        const history = await recordSample(total, info.currency, config.historyMaxAgeDays);
        payload.estimation = estimateDepletion(history, total, config.estimateMinDays);
      }
      cache = { at: Date.now(), payload };
      json(res, 200, payload);
    } catch (error) {
      json(res, 502, { ok: false, error: "transport", message: error instanceof Error ? error.message : String(error) });
    }
  };

  ctx.effect(() => ctx.webServer.register({
    kind: "exact",
    path: ROUTE_PATH,
    handler
  }), "dsh-balance: balance route");
}
