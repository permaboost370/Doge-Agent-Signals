// Allowed feed modes we support from dubdub / anoncoin
const ALLOWED_FEED_MODES = [
  "trending",
  "marketCap",
  "volume24h",
  "topToday",
  "mostFollowed",
  "new",
];

// GET /anoncoin/feeds/all?limit=20&chainType=solana&modes=trending,marketCap
app.get("/anoncoin/feeds/all", async (req, res) => {
  const limit = Number(req.query.limit || 20);
  const chainType = String(req.query.chainType || "solana");

  // modes comes in as "trending,marketCap"
  const requestedModes = String(req.query.modes || "trending,marketCap")
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);

  const modes = requestedModes.filter((m) => ALLOWED_FEED_MODES.includes(m));

  if (!modes.length) {
    return res.status(400).json({
      ok: false,
      error: "No valid modes requested.",
      allowed: ALLOWED_FEED_MODES,
    });
  }

  const feeds = {};

  for (const mode of modes) {
    try {
      const url = new URL("https://api.dubdub.tv/v1/feeds");
      url.searchParams.set("limit", String(limit));
      url.searchParams.set("sortBy", mode);       // trending / marketCap / etc.
      url.searchParams.set("chainType", chainType);

      const upstream = await fetch(url.toString(), {
        headers: {
          accept: "application/json",
        },
      });

      if (!upstream.ok) {
        console.error("dubdub error for mode", mode, upstream.status);
        feeds[mode] = [];
        continue;
      }

      const json = await upstream.json();
      // dubdub response usually has { feeds: [...] }
      feeds[mode] = json.feeds || json.data || json;
    } catch (err) {
      console.error("Error fetching mode", mode, err);
      feeds[mode] = [];
    }
  }

  res.json({
    ok: true,
    source: "dubdub.tv",
    chainType,
    limit,
    feeds,
  });
});
