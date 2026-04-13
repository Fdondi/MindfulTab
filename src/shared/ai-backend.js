/**
 * MindfulHome-compatible Gemini backend client (same /api/generate contract as MindfulHome's BackendClient).
 * @see https://github.com/Fdondi/MindfulHome/blob/main/app/src/main/java/com/mindfulhome/ai/backend/BackendClient.kt
 */
const DEFAULT_AI_BACKEND_BASE_URL = "https://my-gemini-backend-834588824353.europe-west1.run.app";
const MINDFULTAB_AI_MODEL = "gemini-2.5-flash-lite";

function buildToolsObject(...functionDecls) {
  return { functionDeclarations: functionDecls };
}

function fnDecl(name, description, parameters) {
  const o = { name, description };
  if (parameters) o.parameters = parameters;
  return o;
}

const INTENT_TOOL_SCHEMA = buildToolsObject(
  fnDecl(
    "approve_intent",
    "The user's stated reason is a genuine, meaningful intent for the chosen duration. Call this to allow the timer to start."
  ),
  fnDecl(
    "reject_intent",
    "The reason is nonsense, jokes, filler, or not a real browsing purpose. Call with a short, kind user-facing message.",
    {
      type: "OBJECT",
      properties: {
        message: {
          type: "STRING",
          description: "What to show the user, e.g. asking for a real reason"
        }
      },
      required: ["message"]
    }
  ),
  fnDecl(
    "prompt_long_session_confirmation",
    "The reason sounds plausible but the duration is long and may deserve a second thought. Call with a short question for the user.",
    {
      type: "OBJECT",
      properties: {
        message: {
          type: "STRING",
          description: "User-facing question, e.g. asking if they are sure about the length"
        }
      },
      required: ["message"]
    }
  )
);

const EXTENSION_GRANT_TOOLS = buildToolsObject(
  fnDecl(
    "grantExtension",
    "Grant the user extra time on their current browsing timer when they give a good reason.",
    {
      type: "OBJECT",
      properties: {
        minutes: {
          type: "INTEGER",
          description: "Number of extra minutes (typically 5 to 15)"
        }
      },
      required: ["minutes"]
    }
  )
);

function normalizeFunctionCalls(raw) {
  const list = raw?.function_calls || raw?.functionCalls || [];
  if (!Array.isArray(list)) return [];
  return list.map((c) => {
    const name = String(c?.name || c?.functionName || "").trim();
    let args = c?.args ?? c?.arguments ?? {};
    if (typeof args === "string") {
      try {
        args = JSON.parse(args);
      } catch (_) {
        args = {};
      }
    }
    return { name, args: args && typeof args === "object" ? args : {} };
  });
}

function parseErrorFromBody(body, status) {
  try {
    const obj = JSON.parse(body);
    const detail = obj.detail;
    if (typeof detail === "string") return detail;
    if (detail && typeof detail.message === "string") return detail.message;
  } catch (_) {}
  return `HTTP ${status}`;
}

/**
 * Exchange Google ID token for MindfulHome backend app token (same as MindfulHome BackendClient.exchangeToken).
 */
async function exchangeGoogleIdTokenForAppToken(baseUrl, googleIdToken) {
  const root = String(baseUrl || DEFAULT_AI_BACKEND_BASE_URL).replace(/\/$/, "");
  const id = String(googleIdToken || "").trim();
  if (!id) {
    throw new Error("Missing Google ID token.");
  }
  const res = await fetch(`${root}/api/auth/exchange`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      Authorization: `Bearer ${id}`
    },
    body: ""
  });
  const text = await res.text();
  if (!res.ok) {
    const err = new Error(parseErrorFromBody(text, res.status));
    err.httpStatus = res.status;
    throw err;
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (_) {
    throw new Error("Auth exchange returned non-JSON.");
  }
  const token = String(parsed.token || parsed.access_token || "").trim();
  if (!token) {
    throw new Error("Auth exchange response missing token.");
  }
  const expiresAt = String(parsed.expiresAt || parsed.expires_at || "").trim();
  const expiresAtMs = expiresAt ? Date.parse(expiresAt) : NaN;
  return {
    token,
    expiresAtMs: Number.isFinite(expiresAtMs) ? expiresAtMs : Date.now() + 30 * 24 * 60 * 60 * 1000
  };
}

async function checkBackendAuthStatus(baseUrl, appToken) {
  const root = String(baseUrl || DEFAULT_AI_BACKEND_BASE_URL).replace(/\/$/, "");
  const auth = String(appToken || "").trim();
  if (!auth) {
    throw new Error("Missing app token.");
  }
  const res = await fetch(`${root}/api/auth/status`, {
    method: "GET",
    headers: { Authorization: `Bearer ${auth}` }
  });
  const text = await res.text();
  if (!res.ok) {
    const err = new Error(parseErrorFromBody(text, res.status));
    err.httpStatus = res.status;
    throw err;
  }
}

async function mindfultabBackendGenerate({ baseUrl, token, model, contents, tools }) {
  const root = String(baseUrl || DEFAULT_AI_BACKEND_BASE_URL).replace(/\/$/, "");
  const auth = String(token || "").trim();
  if (!auth) {
    throw new Error("Missing AI backend bearer token.");
  }
  const body = JSON.stringify({
    model: model || "default",
    contents: contents || [],
    tools: tools || null
  });
  const res = await fetch(`${root}/api/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      Authorization: `Bearer ${auth}`
    },
    body
  });
  const text = await res.text();
  if (!res.ok) {
    const err = new Error(parseErrorFromBody(text, res.status));
    err.httpStatus = res.status;
    throw err;
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error("AI backend returned non-JSON.");
  }
}

function pickIntentDecision(calls) {
  const reject = calls.find((c) => c.name === "reject_intent");
  if (reject) {
    const msg = String(reject.args?.message || "").trim() || "Please provide a real reason for this session.";
    return { type: "reject", message: msg };
  }
  const confirm = calls.find((c) => c.name === "prompt_long_session_confirmation");
  if (confirm) {
    const msg = String(confirm.args?.message || "").trim() || "Are you sure about this session length?";
    return { type: "confirm", message: msg };
  }
  const approve = calls.find((c) => c.name === "approve_intent");
  if (approve) {
    return { type: "approve" };
  }
  return null;
}

function intentValidationContentsInitial({ durationMinutes, reason }) {
  const d = Math.max(1, Number(durationMinutes) || 1);
  const r = JSON.stringify(String(reason || "").trim());
  const text = `You validate intents for a mindful browser extension.

The user wants to start a ${d}-minute browsing timer.
Their stated reason (JSON string): ${r}

Rules:
- If the reason is nonsense, jokes, filler, or not a real plan (e.g. random laughter with no purpose), call reject_intent with a short, kind user-facing message asking for a genuine reason.
- If the session is short (less than 5 minutes), be generous with what constitutes a "reason". As long as it's not too long, "I have time to wait" or "I want to check the news" is acceptable.
- If the reason is plausible but the duration is long (roughly 30+ minutes) and the reason feels vague or like a short task, call prompt_long_session_confirmation with a short question (e.g. are they sure they need that long).
- If the reason is a clear, legitimate intent for this duration, call approve_intent.

You must call exactly one tool: approve_intent, reject_intent, or prompt_long_session_confirmation.`;
  return [{ role: "user", parts: [{ text }] }];
}

function intentValidationContentsConfirmed({ durationMinutes, reason }) {
  const d = Math.max(1, Number(durationMinutes) || 1);
  const r = JSON.stringify(String(reason || "").trim());
  const text = `You validate intents for a mindful browser extension.

The user is starting a ${d}-minute session and already confirmed the session length.
Their stated reason (JSON string): ${r}

Decide whether the reason is a real, meaningful intent.
If the reason is nonsense, jokes, filler, or not a real browsing purpose, call reject_intent with a short, kind message.
Otherwise call approve_intent.

You must call exactly one tool: approve_intent or reject_intent.`;
  return [{ role: "user", parts: [{ text }] }];
}

async function validateIntent({ settings, durationMinutes, reason, confirmedLongSession }) {
  const baseUrl = settings.aiBackendBaseUrl || DEFAULT_AI_BACKEND_BASE_URL;
  const token = settings.aiBackendToken || "";
  const model = MINDFULTAB_AI_MODEL;
  const contents = confirmedLongSession
    ? intentValidationContentsConfirmed({ durationMinutes, reason })
    : intentValidationContentsInitial({ durationMinutes, reason });
  const tools = confirmedLongSession
    ? [buildToolsObject(
        fnDecl(
          "approve_intent",
          "Approve starting the timer after the user confirmed a long session."
        ),
        fnDecl(
          "reject_intent",
          "The reason is still not a real intent.",
          {
            type: "OBJECT",
            properties: {
              message: { type: "STRING", description: "User-facing message" }
            },
            required: ["message"]
          }
        )
      )]
    : [INTENT_TOOL_SCHEMA];

  let response;
  try {
    response = await mindfultabBackendGenerate({
      baseUrl,
      token,
      model,
      contents,
      tools
    });
  } catch (err) {
    if (err && err.httpStatus === 401) {
      const authErr = new Error("AI backend rejected the session token (401). Sign in with Google again.");
      authErr.httpStatus = 401;
      throw authErr;
    }
    throw err;
  }
  const calls = normalizeFunctionCalls(response);
  const decision = pickIntentDecision(calls);
  if (!decision) {
    const hint = String(response?.result || "").trim();
    throw new Error(
      hint
        ? `AI did not return a structured decision. Model said: ${hint.slice(0, 200)}`
        : "AI did not return a structured decision (no recognized function call). Try again."
    );
  }
  if (confirmedLongSession && decision.type === "confirm") {
    throw new Error("AI returned an unexpected confirmation request after you already confirmed length.");
  }
  return decision;
}

function extensionRequestContents({ session, userMessage }) {
  const reason = String(session?.reason || "").trim() || "(none)";
  const domain = String(session?.domain || "").trim() || "(unknown)";
  const endsAt = Number(session?.endsAt || 0);
  const ended = Boolean(session?.ended);
  const remainingMin = !ended && endsAt > Date.now() ? Math.max(1, Math.ceil((endsAt - Date.now()) / 60000)) : 0;
  const timerLine = ended
    ? "The timer has already ended. The user is asking to continue with more time."
    : `About ${remainingMin} minutes left (approximate).`;
  const msg = JSON.stringify(String(userMessage || "").trim());
  const text = `You help with mindful browsing timers.

Session:
- Domain context: ${domain}
- Declared intent: ${JSON.stringify(reason)}
- ${timerLine}

The user message (JSON string): ${msg}

If they deserve more time, call grantExtension with minutes (5–15 typical). If not, reply briefly in normal text only (no grantExtension) explaining why more time is not appropriate.`;
  return [{ role: "user", parts: [{ text }] }];
}

function parseGrantMinutes(response) {
  const calls = normalizeFunctionCalls(response);
  const grant = calls.find((c) => c.name === "grantExtension");
  if (!grant) return null;
  const m = Math.round(Number(grant.args?.minutes));
  if (!Number.isFinite(m) || m < 1) return null;
  return Math.min(120, m);
}

async function requestTimeExtension({ settings, session, userMessage }) {
  const baseUrl = settings.aiBackendBaseUrl || DEFAULT_AI_BACKEND_BASE_URL;
  const token = settings.aiBackendToken || "";
  const model = MINDFULTAB_AI_MODEL;
  const contents = extensionRequestContents({ session, userMessage });
  let response;
  try {
    response = await mindfultabBackendGenerate({
      baseUrl,
      token,
      model,
      contents,
      tools: [EXTENSION_GRANT_TOOLS]
    });
  } catch (err) {
    if (err && err.httpStatus === 401) {
      const authErr = new Error("AI backend rejected the session token (401). Sign in with Google again.");
      authErr.httpStatus = 401;
      throw authErr;
    }
    throw err;
  }
  const minutes = parseGrantMinutes(response);
  const reply = String(response?.result || "").trim();
  return { minutes, reply };
}

function shouldValidateIntent(settings, reason, isAutoBypassReasonFn) {
  if (!settings?.aiIntentValidationEnabled) return false;
  if (!String(reason || "").trim()) return false;
  if (typeof isAutoBypassReasonFn === "function" && isAutoBypassReasonFn(reason)) return false;
  return true;
}

self.MINDFULTAB_AI = {
  DEFAULT_AI_BACKEND_BASE_URL,
  MINDFULTAB_AI_MODEL,
  shouldValidateIntent,
  validateIntent,
  requestTimeExtension,
  exchangeGoogleIdTokenForAppToken,
  checkBackendAuthStatus
};
