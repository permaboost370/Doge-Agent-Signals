import express from "express";
import cors from "cors";

const app = express();
app.use(express.json());

// ---------- CORS ----------
const allowedOrigins = (process.env.CORS_ORIGINS || "http://localhost:5173,https://dogeagent.org,https://signals.dogeagent.org")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, cb) {
      // allow curl / server-to-server requests
      if (!origin) return cb(null, true);
      if (allowedOrigins.includes(origin)) return cb(null, true);
      return cb(new Error("Not allowed by CORS"), false);
    },
  })
);

const PORT = process.env.PORT || 3000;

// Base for anoncoin/dubdub API
const DUBDUB_BASE = process.env.DUBDUB_BASE || "https://api.dubdub.tv/v1";

// Supported sort modes
const ALLOWED_SORTS = new Set(["trending", "new", "hot", "volume"]);

// Simple in-memory cache { key: { ts, ttlMs, data } }
const cache = new Map();
const DEFAULT_CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS || 30000);

/**
 * Build anoncoin/dubdub feed URL
 */
function buildDubDubUrl({ sortBy, limit, chainType }) {
  const params = new URLSearchParams({
    limit: String(limit ?? 10),
    sortBy,
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
 * Fetch a single feed from dubdub
 */
async function fetchFeed({ sortBy, limit, chainType }) {
  if (!ALLOWED_SORTS.has(sortBy)) {
    throw new Error(`Invalid sortBy: ${sortBy}`);
  }

  const url = buildDubDubUrl({ sortBy, limit, chainType });
  const key = `feed:${sortBy}:${limit}:${chainType}`;

  const options = {
    headers: {
      Accept: "application/json",
      "User-Agent": "DogeAgent-Signals/1.0",
      // Uncomment these if anoncoin/dubdub starts requiring them:
      // Origin: "https://anoncoin.it",
      // Referer: "https://anoncoin.it/",
    },
  };

  return cachedFetch(key, url, options);
}

// ------------- Routes -------------

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
 *   sortBy=trending|new|hot|volume (default: trending)
 *   limit=10
 *   chainType=solana (default)
 */
app.get("/anoncoin/feeds", async (req, res) => {
  try {
    const sortBy = (req.query.sortBy || "trending").toString();
    const limit = req.query.limit ? Number(req.query.limit) : 10;
    const chainType = (req.query.chainType || "solana").toString();

    if (!ALLOWED_SORTS.has(sortBy)) {
      return res.status(400).json({
        error: "invalid_sortBy",
        message: `sortBy must be one of: ${[...ALLOWED_SORTS].join(", ")}`,
      });
    }

    const data = await fetchFeed({ sortBy, limit, chainType });

    res.json({
      sortBy,
      chainType,
      limit,
      source: "dubdub.tv",
      items: data,
    });
  } catch (err) {
    console.error("Error in /anoncoin/feeds:", err);
    res.status(500).json({ error: "internal_error", message: err.message });
  }
});

/**
 * GET /anoncoin/feeds/all
 * Returns all four lists:
 *   {
 *     chainType,
 *     limit,
 *     feeds: {
 *       trending: [...],
 *       new: [...],
 *       hot: [...],
 *       volume: [...]
 *     }
 *   }
 */
app.get("/anoncoin/feeds/all", async (req, res) => {
  try {
    const limit = req.query.limit ? Number(req.query.limit) : 10;
    const chainType = (req.query.chainType || "solana").toString();

    const sorts = ["trending", "new", "hot", "volume"];

    const results = await Promise.all(
      sorts.map((sortBy) =>
        fetchFeed({ sortBy, limit, chainType }).catch((err) => ({
          _error: err.message,
        }))
      )
    );

    const feeds = {};
    sorts.forEach((name, idx) => {
      feeds[name] = results[idx];
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
