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
 * response can also carry a playful guess of when the balance runs out (burn
 * rate derived from the drops seen over the most recent few queries).
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
  /** How many recent balance samples the depletion guess is based on. */
  estimateLookback: z.number().min(2).max(200).default(8),
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
 * Estimate when the balance runs out — deliberately loose, more fun than
 * accurate, based on the past few queries.
 *
 * The old rule demanded a contiguous falling segment spanning >= 1 day, which
 * with dense sampling (a sample every ~2 min while the page is open, and flat
 * stretches in between) almost never existed, so the estimate was usually
 * absent. Now the burn rate is derived from the last `lookback` samples:
 * every drop between consecutive samples counts as spend, and that spend is
 * spread over the whole window span, so top-ups and flat stretches no longer
 * silence the estimate. When the window shows no spend at all, the guess is
 * "balance is barely moving" (dailySpend 0, daysLeft null) and the client
 * renders a playful "will last forever" line instead of nothing.
 *
 * @param history - ascending balance samples.
 * @param currentTotal - the live balance just fetched.
 * @param lookback - how many recent samples to base the guess on.
 */
function estimateDepletion(history, currentTotal, lookback) {
  if (history.length < 2) return { available: false, reason: "insufficient-samples" };
  const recent = history.slice(-lookback);
  let spent = 0;
  for (let i = 1; i < recent.length; i++) {
    const drop = recent[i - 1].total - recent[i].total;
    if (drop > 0) spent += drop;
  }
  const spanMs = recent[recent.length - 1].at - recent[0].at;
  const spanDays = spanMs / DAY_MS;
  if (spent <= 0 || spanDays <= 0) {
    return {
      available: true,
      dailySpend: 0,
      daysLeft: null,
      depletedAt: null,
      basedOnSamples: recent.length,
      windowHours: spanMs / 3_600_000
    };
  }
  const dailySpend = spent / spanDays;
  const daysLeft = Number(currentTotal) / dailySpend;
  return {
    available: true,
    dailySpend,
    daysLeft,
    depletedAt: new Date(Date.now() + daysLeft * DAY_MS).toISOString(),
    basedOnSamples: recent.length,
    windowHours: spanMs / 3_600_000
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
        payload.estimation = estimateDepletion(history, total, config.estimateLookback);
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
