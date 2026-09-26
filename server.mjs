import express from "express";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const CLIENT_ID = String(process.env.DERIV_CLIENT_ID || "").trim();
const BASE_URL = String(process.env.APP_BASE_URL || process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`).replace(/\/+$/, "");
const REDIRECT_URI = `${BASE_URL}/callback`;
const IS_HTTPS = BASE_URL.startsWith("https://");

if (!CLIENT_ID) {
  console.error("Missing DERIV_CLIENT_ID.");
  process.exit(1);
}

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "50kb" }));

const sessions = new Map();
const SESSION_TTL_MS = 2 * 60 * 60 * 1000;

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
