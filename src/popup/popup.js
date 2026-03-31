const EXT_API = typeof browser !== "undefined" ? browser : chrome;

const summaryEl = document.getElementById("popup-session-summary");
const messageEl = document.getElementById("popup-extension-message");
const sendBtn = document.getElementById("popup-send-btn");
const replyEl = document.getElementById("popup-reply");

function formatRemaining(endsAt) {
  const ms = Number(endsAt) - Date.now();
  if (ms <= 0) return "0:00";
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

async function getActiveTabId() {
  const tabs = await EXT_API.tabs.query({ active: true, lastFocusedWindow: true });
  return tabs?.[0]?.id ?? null;
}

async function refreshSummary() {
  summaryEl.textContent = "Loading…";
  replyEl.textContent = "";
  const tabId = await getActiveTabId();
  if (tabId == null) {
    summaryEl.textContent = "No active tab.";
    sendBtn.disabled = true;
    return;
  }
  const resp = await EXT_API.runtime
    .sendMessage({ type: "mindfultab/get-state", payload: { forTabId: tabId } })
    .catch(() => null);
  if (!resp?.ok) {
    summaryEl.textContent = "Could not load timer state.";
    sendBtn.disabled = true;
    return;
  }
  const session = resp.session;
  if (!session || session.ended) {
    summaryEl.textContent = "No active timer on this tab. Start one from the new tab page.";
    sendBtn.disabled = true;
    return;
  }
  const reason = String(session.reason || "").trim() || "(no intent text)";
  const domain = String(session.domain || "").trim() || "this tab";
  summaryEl.textContent = `${formatRemaining(session.endsAt)} left on ${domain}. Intent: ${reason}`;
  sendBtn.disabled = false;
}

sendBtn.addEventListener("click", async () => {
  const text = messageEl.value.trim();
  if (!text) {
    replyEl.textContent = "Write a short message first.";
    return;
  }
  const tabId = await getActiveTabId();
  if (tabId == null) {
    replyEl.textContent = "No active tab.";
    return;
  }
  sendBtn.disabled = true;
  replyEl.textContent = "Waiting for AI…";
  try {
    const out = await EXT_API.runtime.sendMessage({
      type: "mindfultab/request-time-extension",
      payload: { userMessage: text, tabId }
    });
    if (!out?.ok) {
      replyEl.textContent =
        out?.code === "need_google_sign_in"
          ? `${out.error || "Sign in under MindfulTab settings → AI."}`
          : out?.error || "Request failed.";
      sendBtn.disabled = false;
      return;
    }
    if (out.granted) {
      replyEl.textContent = out.reply || `Granted ${out.minutes} more minutes.`;
      messageEl.value = "";
    } else {
      replyEl.textContent = out.reply || "No extra time was granted.";
    }
  } catch (err) {
    replyEl.textContent = String(err);
  }
  sendBtn.disabled = false;
  await refreshSummary();
});

refreshSummary().catch(() => {
  summaryEl.textContent = "Could not initialize popup.";
});
