/**
 * Same Web Client ID as MindfulHome AuthManager (GCP project that hosts the backend).
 * The OAuth client's authorized redirect URIs must include the extension redirect from identity.getRedirectURL().
 */
const GOOGLE_OAUTH_WEB_CLIENT_ID =
  "834588824353-dmcktqcifmgaovhfr0b37bdejjdq7lbn.apps.googleusercontent.com";

function decodeJwtPayload(jwt) {
  const parts = String(jwt || "").split(".");
  if (parts.length < 2) {
    throw new Error("Invalid JWT.");
  }
  const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "===".slice((b64.length + 3) % 4);
  const json = atob(padded);
  return JSON.parse(json);
}

function buildGoogleIdTokenAuthUrl(redirectUri, nonce, options) {
  const interactive = options?.interactive !== false;
  const params = new URLSearchParams({
    client_id: GOOGLE_OAUTH_WEB_CLIENT_ID,
    response_type: "id_token",
    redirect_uri: redirectUri,
    scope: "openid email",
    nonce: String(nonce),
    prompt: interactive ? "select_account" : "none"
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

function parseIdTokenFromWebAuthResult(responseUrl) {
  const hash = new URL(responseUrl).hash.replace(/^#/, "");
  const params = new URLSearchParams(hash);
  return params.get("id_token");
}

/** True when stored backend session token is present and not expiring within ~15s. */
function mindfultabAiAuthUsable(settings) {
  const t = String(settings?.aiBackendToken || "").trim();
  if (!t) return false;
  const exp = Number(settings?.aiBackendTokenExpiresAtMs || 0);
  if (!exp || !Number.isFinite(exp)) return false;
  return exp > Date.now() + 15_000;
}

/**
 * @param {typeof chrome} EXT_API
 * @param {{ interactive: boolean }} options
 */
async function mindfultabAcquireGoogleIdToken(EXT_API, options) {
  const interactive = Boolean(options?.interactive);
  if (!EXT_API.identity?.getRedirectURL || !EXT_API.identity.launchWebAuthFlow) {
    throw new Error("Identity API not available.");
  }
  const redirect = EXT_API.identity.getRedirectURL();
  const nonce = crypto.randomUUID();
  const url = buildGoogleIdTokenAuthUrl(redirect, nonce, { interactive });
  const responseUrl = await new Promise((resolve, reject) => {
    EXT_API.identity.launchWebAuthFlow({ url, interactive }, (u) => {
      if (EXT_API.runtime?.lastError) {
        reject(new Error(EXT_API.runtime.lastError.message));
        return;
      }
      resolve(u);
    });
  });
  const err = new URL(responseUrl).searchParams.get("error");
  if (err) {
    throw new Error(`Google OAuth error: ${err}`);
  }
  const idToken = parseIdTokenFromWebAuthResult(responseUrl);
  if (!idToken) {
    throw new Error("No id_token in OAuth response. Check redirect URI in Google Cloud Console.");
  }
  const payload = decodeJwtPayload(idToken);
  if (payload.nonce !== nonce) {
    throw new Error("OAuth nonce mismatch.");
  }
  return idToken;
}

/**
 * Try to obtain a new ID token without UI (requires an active Google session).
 * @returns {Promise<{ ok: true, idToken: string } | { ok: false, error: string, stage?: string }>}
 */
async function mindfultabTrySilentGoogleIdTokenRefreshDetailed(EXT_API) {
  if (!EXT_API.identity?.getRedirectURL || !EXT_API.identity.launchWebAuthFlow) {
    return {
      ok: false,
      error: "Identity API not available (getRedirectURL / launchWebAuthFlow).",
      stage: "identity_api"
    };
  }
  try {
    const redirect = EXT_API.identity.getRedirectURL();
    const nonce = crypto.randomUUID();
    const url = buildGoogleIdTokenAuthUrl(redirect, nonce, { interactive: false });
    const responseUrl = await new Promise((resolve, reject) => {
      EXT_API.identity.launchWebAuthFlow({ url, interactive: false }, (u) => {
        if (EXT_API.runtime?.lastError) {
          reject(new Error(EXT_API.runtime.lastError.message));
          return;
        }
        resolve(u);
      });
    });
    let parsed;
    try {
      parsed = new URL(responseUrl);
    } catch (e) {
      return { ok: false, error: `Invalid OAuth redirect URL: ${String(e)}`, stage: "response_url" };
    }
    const hashParams = new URLSearchParams(String(parsed.hash || "").replace(/^#/, ""));
    const oauthErr = parsed.searchParams.get("error") || hashParams.get("error");
    if (oauthErr) {
      const desc =
        parsed.searchParams.get("error_description") || hashParams.get("error_description") || "";
      const msg = desc ? `${oauthErr}: ${desc}` : oauthErr;
      return { ok: false, error: msg, stage: "oauth_error" };
    }
    const idToken = parseIdTokenFromWebAuthResult(responseUrl);
    if (!idToken) {
      return { ok: false, error: "No id_token in OAuth redirect (hash).", stage: "no_id_token" };
    }
    let payload;
    try {
      payload = decodeJwtPayload(idToken);
    } catch (e) {
      return { ok: false, error: `Invalid id_token JWT: ${String(e)}`, stage: "jwt_decode" };
    }
    if (payload.nonce !== nonce) {
      return { ok: false, error: "OAuth nonce mismatch.", stage: "nonce_mismatch" };
    }
    return { ok: true, idToken };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg, stage: "exception" };
  }
}

/**
 * Try to obtain a new ID token without UI. Returns null if not possible.
 * @param {typeof chrome} EXT_API
 */
async function mindfultabTrySilentGoogleIdTokenRefresh(EXT_API) {
  const r = await mindfultabTrySilentGoogleIdTokenRefreshDetailed(EXT_API);
  return r.ok ? r.idToken : null;
}

/**
 * @param {typeof chrome} EXT_API browser or chrome
 * @param {(type: string, payload?: object) => Promise} sendMessage
 */
async function mindfultabCompleteGoogleSignIn(EXT_API, sendMessage) {
  const idToken = await mindfultabAcquireGoogleIdToken(EXT_API, { interactive: true });
  const out = await sendMessage("mindfultab/exchange-google-id-token", { idToken });
  if (!out?.ok) {
    throw new Error(out?.error || "Google sign-in could not be completed with the AI backend.");
  }
  return out;
}

async function mindfultabGoogleSignOut(sendMessage) {
  const out = await sendMessage("mindfultab/google-sign-out");
  if (!out?.ok) {
    throw new Error(out?.error || "Sign out failed.");
  }
  return out;
}

self.MINDFULTAB_GOOGLE_OAUTH = {
  GOOGLE_OAUTH_WEB_CLIENT_ID,
  decodeJwtPayload,
  buildGoogleIdTokenAuthUrl,
  parseIdTokenFromWebAuthResult,
  mindfultabAiAuthUsable,
  mindfultabAcquireGoogleIdToken,
  mindfultabTrySilentGoogleIdTokenRefresh,
  mindfultabTrySilentGoogleIdTokenRefreshDetailed,
  mindfultabCompleteGoogleSignIn,
  mindfultabGoogleSignOut
};
