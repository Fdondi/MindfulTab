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

function buildGoogleIdTokenAuthUrl(redirectUri, nonce) {
  const params = new URLSearchParams({
    client_id: GOOGLE_OAUTH_WEB_CLIENT_ID,
    response_type: "id_token",
    redirect_uri: redirectUri,
    scope: "openid email",
    nonce: String(nonce),
    prompt: "select_account"
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

function parseIdTokenFromWebAuthResult(responseUrl) {
  const hash = new URL(responseUrl).hash.replace(/^#/, "");
  const params = new URLSearchParams(hash);
  return params.get("id_token");
}

/** Matches service worker logic for usable backend session (app token + expiry). */
function mindfultabAiAuthUsable(settings) {
  const t = String(settings?.aiBackendToken || "").trim();
  if (!t) return false;
  const exp = Number(settings?.aiBackendTokenExpiresAtMs || 0);
  if (!exp || !Number.isFinite(exp)) return true;
  return exp > Date.now() + 15_000;
}

/**
 * @param {typeof chrome} EXT_API browser or chrome
 * @param {(type: string, payload?: object) => Promise} sendMessage
 */
async function mindfultabCompleteGoogleSignIn(EXT_API, sendMessage) {
  if (!EXT_API.identity?.getRedirectURL || !EXT_API.identity.launchWebAuthFlow) {
    throw new Error("Identity API not available.");
  }
  const redirect = EXT_API.identity.getRedirectURL();
  const nonce = crypto.randomUUID();
  const url = buildGoogleIdTokenAuthUrl(redirect, nonce);
  const responseUrl = await new Promise((resolve, reject) => {
    EXT_API.identity.launchWebAuthFlow({ url, interactive: true }, (u) => {
      if (EXT_API.runtime?.lastError) {
        reject(new Error(EXT_API.runtime.lastError.message));
        return;
      }
      resolve(u);
    });
  });
  const idToken = parseIdTokenFromWebAuthResult(responseUrl);
  if (!idToken) {
    throw new Error("No id_token in OAuth response. Check redirect URI in Google Cloud Console.");
  }
  const payload = decodeJwtPayload(idToken);
  if (payload.nonce !== nonce) {
    throw new Error("OAuth nonce mismatch.");
  }
  const out = await sendMessage("mindfultab/exchange-google-id-token", { idToken });
  if (!out?.ok) {
    throw new Error(out?.error || "Token exchange failed.");
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
  mindfultabCompleteGoogleSignIn,
  mindfultabGoogleSignOut
};
