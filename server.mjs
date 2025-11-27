// server.mjs
import express from "express";
import cors from "cors";

const app = express();

// ---------- CORS: allow everything (read-only API, fine) ----------
app.use(
  cors({
    origin: "*",
  })
);

// Optional logging so you can see who is calling
app.use((req, res, next) => {
  console.log("Incoming:", req.method, req.url, "Origin:", req.headers.origin);
  next();
});

app.use(express.json());

const PORT = process.env.PORT || 3000;

// Base for anoncoin/dubdub API
const DUBDUB_BASE = process.env.DUBDUB_BASE || "https://api.dubdub.tv/v1";

// Simple in-memory cache { key: { ts, ttlMs, data } }
const cache = new Map();
const DEFAULT_CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS || 30000);

/**
 * Build anoncoin/dubdub feed URL
 */
function buildDubDubUrl({ sortBy, limit, chainType }) {
  const params = new URLSearchParams({
    limit: String(limit ?? 10),
    sortBy: sortBy || "marketCap",
    chainType: chainType || "solana",
  });

  return `${DUBDUB_BASE}/feeds?${params.toString()}`;
}

/**
 * Fetch with simple cache
 */
async function cachedFetch(key, url, options = {}, ttlMs = DEFAULT_CACHE_TTL_MS) {
  const cached = cache.get(key);
  const now = Date.now();

  if (cached && now - cached.ts < ttlMs) {
    return cached.data;
  }

  const res = await fetch(url, options);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Upstream error ${res.status}: ${text}`);
  }

  const data = await res.json();
  cache.set(key, { ts: now, ttlMs, data });
  return data;
}

/**
 * Normalize dubdub/anoncoin feed response into a flat array of entries.
 * This removes guesswork from the frontend.
 */
function normalizeDubDubFeed(data) {
  if (!data) return [];
  if (Array.isArray(data)) return data;

  if (typeof data !== "object") return [];

  // Common patterns:
  // { feeds: [...] }
  if (Array.isArray(data.feeds)) return data.feeds;

  // Sometimes feeds: { something: [...] }
  if (data.feeds && typeof data.feeds === "object" && !Array.isArray(data.feeds)) {
    const feedsVals = Object.values(data.feeds);
    const firstArray = feedsVals.find((v) => Array.isArray(v));
    if (firstArray) return firstArray;
  }

  // Other common keys we might see
  const candidateKeys = ["items", "data", "docs", "results", "tokens", "coins"];
  for (const key of candidateKeys) {
    const v = data[key];
    if (Array.isArray(v)) return v;
  }

  // Fallback: first array among values
  const vals = Object.values(data);
  const firstArray = vals.find((v) => Array.isArray(v));
  if (firstArray) return firstArray;

  return [];
}

/**
 * Fetch a single feed from dubdub
 * (we just forward whatever sortBy anoncoin supports)
 */
async function fetchFeed({ sortBy, limit, chainType }) {
  const url = buildDubDubUrl({ sortBy, limit, chainType });
  const key = `feed:${sortBy}:${limit}:${chainType}`;

  const options = {
    headers: {
      Accept: "application/json",
      "User-Agent": "DogeAgent-Signals/1.0",
      // If anoncoin/dubdub ever require these, you can uncomment:
      // Origin: "https://anoncoin.it",
      // Referer: "https://anoncoin.it/",
    },
  };

  return cachedFetch(key, url, options);
}

// ---------------------- Routes ----------------------

// Health check
app.get("/health", (req, res) => {
  res.json({
    ok: true,
    service: "dogeagent-signals",
    time: new Date().toISOString(),
  });
});

/**
 * GET /anoncoin/feeds
 * Query:
 *   sortBy=marketCap|volume24h|topToday|mostFollowed|new|trending|...
 *   limit=10
 *   chainType=solana
 */
app.get("/anoncoin/feeds", async (req, res) => {
  try {
    const sortBy = (req.query.sortBy || "marketCap").toString();
    const limit = req.query.limit ? Number(req.query.limit) : 10;
    const chainType = (req.query.chainType || "solana").toString();

    const raw = await fetchFeed({ sortBy, limit, chainType });
    const items = normalizeDubDubFeed(raw);

    res.json({
      sortBy,
      chainType,
      limit,
      source: "dubdub.tv",
      items,
    });
  } catch (err) {
    console.error("Error in /anoncoin/feeds:", err);
    res.status(500).json({ error: "internal_error", message: err.message });
  }
});

/**
 * GET /anoncoin/feeds/all
 *
 * Query:
 *   modes=marketCap,volume24h,topToday,mostFollowed,new,trending
 *   limit=10
 *   chainType=solana
 *
 * Returns:
 *   {
 *     chainType,
 *     limit,
 *     source,
 *     feeds: {
 *       marketCap: [...],
 *       trending: [...],
 *       ...
 *     }
 *   }
 */
app.get("/anoncoin/feeds/all", async (req, res) => {
  try {
    const limit = req.query.limit ? Number(req.query.limit) : 10;
    const chainType = (req.query.chainType || "solana").toString();

    const modesParam =
      (req.query.modes ||
        "marketCap,volume24h,topToday,mostFollowed,new"
      ).toString();

    const sorts = modesParam
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    if (!sorts.length) {
      return res.status(400).json({
        error: "invalid_modes",
        message: "modes query must contain at least one sort key",
      });
    }

    const rawResults = await Promise.all(
      sorts.map((sortBy) =>
        fetchFeed({ sortBy, limit, chainType }).catch((err) => ({
          _error: err.message,
        }))
      )
    );

    const feeds = {};
    sorts.forEach((name, idx) => {
      const raw = rawResults[idx];
      if (raw && raw._error) {
        // If upstream failed for this mode, expose empty array + error
        feeds[name] = [];
      } else {
        feeds[name] = normalizeDubDubFeed(raw);
      }
    });

    res.json({
      chainType,
      limit,
      source: "dubdub.tv",
      feeds,
    });
  } catch (err) {
    console.error("Error in /anoncoin/feeds/all:", err);
    res.status(500).json({ error: "internal_error", message: err.message });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`DogeAgent Signals listening on port ${PORT}`);
});
