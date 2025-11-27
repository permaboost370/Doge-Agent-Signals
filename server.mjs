// server.mjs
import express from "express";
import cors from "cors";

const app = express();
app.use(express.json());

// ---------- CORS ----------
const allowedOrigins = (
  process.env.CORS_ORIGINS ||
  "http://localhost:5173,https://dogeagent.org,https://signals.dogeagent.org"
)
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

// ---------- CORS: allow everything (read-only API, fine) ----------
app.use(
cors({
    origin(origin, cb) {
      // allow curl / server-to-server requests
      if (!origin) return cb(null, true);
      if (allowedOrigins.includes(origin)) return cb(null, true);
      return cb(new Error("Not allowed by CORS"), false);
    },
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
@@ -70,7 +65,7 @@ async function cachedFetch(key, url, options = {}, ttlMs = DEFAULT_CACHE_TTL_MS)

/**
* Fetch a single feed from dubdub
 * We don't validate sortBy here – we just proxy whatever anoncoin supports.
 * (we just forward whatever sortBy anoncoin supports)
*/
async function fetchFeed({ sortBy, limit, chainType }) {
const url = buildDubDubUrl({ sortBy, limit, chainType });
@@ -80,7 +75,7 @@ async function fetchFeed({ sortBy, limit, chainType }) {
headers: {
Accept: "application/json",
"User-Agent": "DogeAgent-Signals/1.0",
      // Uncomment if anoncoin/dubdub starts requiring them:
      // Uncomment if anoncoin/dubdub starts requiring these:
// Origin: "https://anoncoin.it",
// Referer: "https://anoncoin.it/",
},
@@ -89,7 +84,7 @@ async function fetchFeed({ sortBy, limit, chainType }) {
return cachedFetch(key, url, options);
}

// ------------- Routes -------------
// ---------------------- Routes ----------------------

// Health check
app.get("/health", (req, res) => {
@@ -140,6 +135,7 @@ app.get("/anoncoin/feeds", async (req, res) => {
*   {
*     chainType,
*     limit,
 *     source,
*     feeds: {
*       marketCap: [...],
*       volume24h: [...],
