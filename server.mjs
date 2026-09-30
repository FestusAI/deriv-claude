import express from "express";
import crypto from "crypto";
import path from "path";
import fs from "fs/promises";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const CLIENT_ID = String(process.env.DERIV_CLIENT_ID || "").trim();
const ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || "").trim();
const BASE_URL = String(process.env.APP_BASE_URL || process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`).replace(/\/+$/, "");
const REDIRECT_URI = `${BASE_URL}/callback`;
const IS_HTTPS = BASE_URL.startsWith("https://");

if (!CLIENT_ID) {
  console.error("Missing DERIV_CLIENT_ID.");
  process.exit(1);
}

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "8mb" }));

const sessions = new Map();
const SESSION_TTL_MS = 2 * 60 * 60 * 1000;
const BOT_DATA_DIR = path.join(__dirname, "data");
const BOT_DATA_FILE = path.join(BOT_DATA_DIR, "bots.json");
const BOT_FILE_DIR = path.join(BOT_DATA_DIR, "files");
const MAX_BOT_FILE_BYTES = 5 * 1024 * 1024;

const DEFAULT_BOTS = [
  {
    id: "hedge-v7",
    name: "DollarPrinting Hedge V7",
    category: "Free",
    badge: "Installed",
    source: "New site",
    description: "Higher + Lower paired contracts with demo-first Deriv OAuth, barrier checking, one-shot hedging, and continuous hedge mode.",
    launchType: "hedge",
    enabled: true,
    featured: true
  },
  { id: "under-mostly", name: "Under mostly", category: "Free", badge: "Migrated", source: "dollarprinting.site", description: "Free bot migrated from the old DollarPrinting Free Bots list.", launchType: "catalog", enabled: true },
  { id: "over-mostly", name: "Over mostly", category: "Free", badge: "Migrated", source: "dollarprinting.site", description: "Free bot migrated from the old DollarPrinting Free Bots list.", launchType: "catalog", enabled: true },
  { id: "alexspeedbot-expro2-2", name: "ALEXSPEEDBOT_ EXPRO2 (2)", category: "Free", badge: "Migrated", source: "dollarprinting.site", description: "Free bot migrated from the old DollarPrinting Free Bots list.", launchType: "catalog", enabled: true },
  { id: "over2recover3", name: "0ver2recover3", category: "Free", badge: "Migrated", source: "dollarprinting.site", description: "Free bot migrated from the old DollarPrinting Free Bots list.", launchType: "catalog", enabled: true },
  { id: "rise-and-fall", name: "Rise and fall", category: "Free", badge: "Migrated", source: "dollarprinting.site", description: "Free bot migrated from the old DollarPrinting Free Bots list.", launchType: "catalog", enabled: true },
  { id: "under7by-rec-under6", name: "Under7by rec under6", category: "Free", badge: "Migrated", source: "dollarprinting.site", description: "Free bot migrated from the old DollarPrinting Free Bots list.", launchType: "catalog", enabled: true },
  { id: "lasvagas-original", name: "lasvagas original", category: "Free", badge: "Migrated", source: "dollarprinting.site", description: "Free bot migrated from the old DollarPrinting Free Bots list.", launchType: "catalog", enabled: true },
  { id: "over-under-bot-v4", name: "over_under_bot_v4", category: "Free", badge: "Migrated", source: "dollarprinting.site", description: "Free bot migrated from the old DollarPrinting Free Bots list.", launchType: "catalog", enabled: true },
  { id: "over-under-bot-v5", name: "over_under_bot_v5", category: "Free", badge: "Migrated", source: "dollarprinting.site", description: "Free bot migrated from the old DollarPrinting Free Bots list.", launchType: "catalog", enabled: true },
  { id: "lasvegas-9", name: "lasvegas (9)", category: "Free", badge: "Migrated", source: "dollarprinting.site", description: "Free bot migrated from the old DollarPrinting Free Bots list.", launchType: "catalog", enabled: true }
];

function parseCookies(req) {
  const raw = req.headers.cookie || "";
  const out = {};
  raw.split(";").forEach(part => {
    const i = part.indexOf("=");
    if (i < 0) return;
    const key = decodeURIComponent(part.slice(0, i).trim());
    const val = decodeURIComponent(part.slice(i + 1).trim());
    if (key) out[key] = val;
  });
  return out;
}

function setCookie(res, sid) {
  const parts = [
    `dh_sid=${encodeURIComponent(sid)}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`
  ];
  if (IS_HTTPS) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}

function clearCookie(res) {
  const parts = ["dh_sid=", "HttpOnly", "SameSite=Lax", "Path=/", "Max-Age=0"];
  if (IS_HTTPS) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}

function newSession(res) {
  const sid = crypto.randomBytes(32).toString("base64url");
  const session = { createdAt: Date.now(), lastSeen: Date.now() };
  sessions.set(sid, session);
  setCookie(res, sid);
  return { sid, session };
}

function getSession(req, res, create = true) {
  const cookies = parseCookies(req);
  const sid = cookies.dh_sid;
  let session = sid ? sessions.get(sid) : null;

  if (session && Date.now() - session.lastSeen > SESSION_TTL_MS) {
    sessions.delete(sid);
    session = null;
  }
  if (session) {
    session.lastSeen = Date.now();
    return { sid, session };
  }
  return create ? newSession(res) : { sid: null, session: null };
}

function requireAuth(req, res, next) {
  const { session } = getSession(req, res, false);
  if (!session?.accessToken) return res.status(401).json({ error: "Not connected to Deriv." });
  if (session.accessExpiresAt && Date.now() >= session.accessExpiresAt) {
    delete session.accessToken;
    delete session.accessExpiresAt;
    return res.status(401).json({ error: "Deriv session expired. Connect again." });
  }
  req.derivSession = session;
  next();
}

function pkceChallenge(verifier) {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}

function oauthError(body, fallback) {
  return body?.error_description ||
         body?.error ||
         body?.errors?.map(e => e.message || e.code).filter(Boolean).join("; ") ||
         fallback;
}

function slugify(value) {
  return String(value || "bot")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || `bot-${Date.now()}`;
}

function cleanFileName(value) {
  return String(value || "bot-file")
    .replace(/[/\\?%*:|"<>]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "bot-file";
}

function sanitizeBot(raw = {}, previous = {}) {
  const name = String(raw.name || "").trim().slice(0, 120);
  if (!name) throw new Error("Bot name is required.");
  const launchUrl = String(raw.launchUrl || previous.launchUrl || "").trim().slice(0, 500);
  const fileUrl = String(raw.fileUrl || previous.fileUrl || "").trim().slice(0, 500);
  return {
    id: String(raw.id || slugify(name)).trim().slice(0, 100),
    name,
    category: String(raw.category || "Free").trim().slice(0, 50),
    badge: String(raw.badge || "Admin").trim().slice(0, 40),
    source: String(raw.source || "Admin").trim().slice(0, 80),
    description: String(raw.description || "Bot added from the admin page.").trim().slice(0, 500),
    launchUrl,
    fileUrl,
    fileName: String(raw.fileName || previous.fileName || "").trim().slice(0, 160),
    fileSize: Number(raw.fileSize || previous.fileSize || 0) || 0,
    fileType: String(raw.fileType || previous.fileType || "").trim().slice(0, 120),
    launchType: raw.launchType === "hedge" ? "hedge" : (launchUrl || fileUrl ? "link" : "catalog"),
    enabled: raw.enabled !== false,
    featured: raw.featured === true
  };
}

async function readBots() {
  try {
    const raw = await fs.readFile(BOT_DATA_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed?.bots)) return parsed.bots.map(sanitizeBot);
  } catch {}
  return DEFAULT_BOTS;
}

async function writeBots(bots) {
  await fs.mkdir(BOT_DATA_DIR, { recursive: true });
  await fs.writeFile(BOT_DATA_FILE, JSON.stringify({ bots }, null, 2), "utf8");
}

async function saveBotFile(botId, file = {}) {
  const rawData = String(file.data || "");
  const originalName = cleanFileName(file.name || `${botId}.bot`);
  if (!rawData) return null;
  const buffer = Buffer.from(rawData, "base64");
  if (!buffer.length) throw new Error("Uploaded file is empty.");
  if (buffer.length > MAX_BOT_FILE_BYTES) throw new Error("Bot file is too large. Maximum size is 5 MB.");
  await fs.mkdir(BOT_FILE_DIR, { recursive: true });
  const storedName = `${slugify(botId)}-${Date.now()}-${originalName}`;
  const target = path.join(BOT_FILE_DIR, storedName);
  await fs.writeFile(target, buffer);
  return {
    fileUrl: `/bot-files/${encodeURIComponent(storedName)}`,
    fileName: originalName,
    fileSize: buffer.length,
    fileType: String(file.type || "application/octet-stream").slice(0, 120)
  };
}

function requireAdmin(req, res, next) {
  if (!ADMIN_PASSWORD) return res.status(503).json({ error: "Admin page is not enabled. Set ADMIN_PASSWORD in Render environment variables." });
  const supplied = String(req.headers["x-admin-password"] || req.body?.password || "").trim();
  if (supplied !== ADMIN_PASSWORD) return res.status(401).json({ error: "Invalid admin password." });
  next();
}

function beginOAuth(req, res, registration = false) {
  const { session } = getSession(req, res, true);

  const state = crypto.randomBytes(32).toString("base64url");
  const verifier = crypto.randomBytes(64).toString("base64url");

  session.oauthState = state;
  session.codeVerifier = verifier;
  session.oauthStartedAt = Date.now();

  const q = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: "trade",
    state,
    code_challenge: pkceChallenge(verifier),
    code_challenge_method: "S256"
  });
  if (registration) q.set("prompt", "registration");

  res.redirect(`https://auth.deriv.com/oauth2/auth?${q.toString()}`);
}

app.get("/auth/login", (req, res) => beginOAuth(req, res, false));
app.get("/auth/signup", (req, res) => beginOAuth(req, res, true));

app.get("/callback", async (req, res) => {
  const { session } = getSession(req, res, false);
  if (!session) return res.redirect("/?auth_error=session_missing");

  const code = String(req.query.code || "");
  const returnedState = String(req.query.state || "");
  const oauthErr = String(req.query.error || "");

  if (oauthErr) return res.redirect(`/?auth_error=${encodeURIComponent(oauthErr)}`);
  if (!code || !returnedState || !session.oauthState || !session.codeVerifier) {
    return res.redirect("/?auth_error=invalid_callback");
  }

  const a = Buffer.from(returnedState);
  const b = Buffer.from(session.oauthState);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    delete session.oauthState;
    delete session.codeVerifier;
    return res.redirect("/?auth_error=state_mismatch");
  }

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: CLIENT_ID,
    code,
    code_verifier: session.codeVerifier,
    redirect_uri: REDIRECT_URI
  });

  try {
    const r = await fetch("https://auth.deriv.com/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body
    });
    let tokenBody = null;
    try { tokenBody = await r.json(); } catch {}

    if (!r.ok || !tokenBody?.access_token) {
      throw new Error(oauthError(tokenBody, `Token exchange failed (${r.status})`));
    }

    session.accessToken = tokenBody.access_token;
    session.accessExpiresAt = Date.now() + Number(tokenBody.expires_in || 3600) * 1000;
    delete session.oauthState;
    delete session.codeVerifier;
    return res.redirect("/?connected=1");
  } catch (err) {
    console.error("OAuth error:", err.message);
    return res.redirect("/?auth_error=token_exchange_failed");
  }
});

app.get("/api/session", (req, res) => {
  const { session } = getSession(req, res, false);
  const authenticated = Boolean(
    session?.accessToken &&
    (!session.accessExpiresAt || Date.now() < session.accessExpiresAt)
  );
  res.json({
    authenticated,
    expires_in: authenticated && session.accessExpiresAt
      ? Math.max(0, Math.floor((session.accessExpiresAt - Date.now()) / 1000))
      : 0
  });
});

app.get("/api/accounts", requireAuth, async (req, res) => {
  try {
    const r = await fetch("https://api.derivws.com/trading/v1/options/accounts", {
      headers: {
        "Authorization": `Bearer ${req.derivSession.accessToken}`,
        "Accept": "application/json"
      }
    });
    const body = await r.json();
    if (!r.ok) {
      return res.status(r.status).json({
        error: body?.errors?.map(e => e.message || e.code).join("; ") || "Unable to fetch Options accounts."
      });
    }
    res.json(body);
  } catch {
    res.status(502).json({ error: "Could not reach Deriv Options account service." });
  }
});

app.post("/api/otp", requireAuth, async (req, res) => {
  const accountId = String(req.body?.account_id || "").trim();
  if (!/^DOT[A-Za-z0-9_-]+$/i.test(accountId)) {
    return res.status(400).json({ error: "Invalid Options account ID." });
  }

  try {
    const r = await fetch(
      `https://api.derivws.com/trading/v1/options/accounts/${encodeURIComponent(accountId)}/otp`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${req.derivSession.accessToken}`,
          "Accept": "application/json"
        }
      }
    );
    const body = await r.json();
    if (!r.ok || !body?.data?.url) {
      return res.status(r.status || 502).json({
        error: body?.errors?.map(e => e.message || e.code).join("; ") || "Unable to create trading connection."
      });
    }
    res.json({ url: body.data.url });
  } catch {
    res.status(502).json({ error: "Could not reach Deriv trading connection service." });
  }
});

app.post("/api/logout", (req, res) => {
  const { sid } = getSession(req, res, false);
  if (sid) sessions.delete(sid);
  clearCookie(res);
  res.json({ ok: true });
});

app.get("/api/config", (req, res) => {
  res.json({ redirect_uri: REDIRECT_URI, oauth_client_id: CLIENT_ID });
});

app.get("/api/bots", async (req, res) => {
  const bots = await readBots();
  res.json({ bots: bots.filter(bot => bot.enabled !== false) });
});

app.get("/api/admin/bots", requireAdmin, async (req, res) => {
  res.json({ bots: await readBots() });
});

app.post("/api/admin/bots", requireAdmin, async (req, res) => {
  try {
    const bots = await readBots();
    const rawBot = req.body?.bot || req.body || {};
    const requestedId = String(rawBot.id || slugify(rawBot.name || "")).trim();
    const existing = bots.findIndex(row => row.id === requestedId);
    const previous = existing >= 0 ? bots[existing] : {};
    let bot = sanitizeBot(rawBot, previous);
    const uploaded = await saveBotFile(bot.id, req.body?.file);
    if (uploaded) {
      bot = sanitizeBot({ ...bot, ...uploaded, launchType: "link" }, bot);
    }
    if (existing >= 0) bots[existing] = bot;
    else bots.push(bot);
    await writeBots(bots);
    res.json({ ok: true, bot, bots });
  } catch (err) {
    res.status(400).json({ error: err.message || "Could not save bot." });
  }
});

app.delete("/api/admin/bots/:id", requireAdmin, async (req, res) => {
  const id = String(req.params.id || "");
  const bots = (await readBots()).filter(bot => bot.id !== id);
  await writeBots(bots);
  res.json({ ok: true, bots });
});

app.get("/admin", (req, res) => res.sendFile(path.join(__dirname, "public", "admin.html")));
app.get("/bot-files/:name", async (req, res) => {
  const name = cleanFileName(req.params.name);
  const target = path.join(BOT_FILE_DIR, name);
  if (!target.startsWith(BOT_FILE_DIR)) return res.status(400).send("Invalid file.");
  try {
    await fs.access(target);
    res.download(target, name.replace(/^[a-z0-9-]+-\d+-/i, ""));
  } catch {
    res.status(404).send("File not found.");
  }
});

app.use(express.static(path.join(__dirname, "public"), { etag: true, maxAge: "1h" }));
app.use((req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

setInterval(() => {
  const cutoff = Date.now() - SESSION_TTL_MS;
  for (const [sid, s] of sessions) {
    if ((s.lastSeen || s.createdAt || 0) < cutoff) sessions.delete(sid);
  }
}, 15 * 60 * 1000).unref();

app.listen(PORT, () => {
  console.log(`App running on ${BASE_URL}`);
  console.log(`OAuth callback: ${REDIRECT_URI}`);
});
