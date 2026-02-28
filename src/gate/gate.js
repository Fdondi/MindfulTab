const EXT_API = typeof browser !== "undefined" ? browser : chrome;

function getParams() {
  const params = new URLSearchParams(window.location.search);
  return {
    targetUrl: params.get("target") || "",
    domain: params.get("domain") || "",
    score: Number(params.get("score") || 0)
  };
}

async function continueAnyway() {
  const { targetUrl, domain } = getParams();
  const reflection = document.getElementById("reflection-input").value.trim();
  const current = await EXT_API.tabs.getCurrent();
  const tab = current || (await EXT_API.tabs.query({ active: true, currentWindow: true }))[0];

  await EXT_API.runtime.sendMessage({
    type: "mindfultab/continue-anyway",
    payload: {
      targetUrl,
      domain,
      reflection,
      tabId: tab?.id
    }
  });
}

function init() {
  const { domain, score } = getParams();
  const pill = document.getElementById("domain-pill");
  pill.textContent = `${domain} (karma ${score})`;

  const button = document.getElementById("continue-btn");
  button.addEventListener("click", () => {
    continueAnyway().catch(() => {
      button.textContent = "Try again";
    });
  });
}

init();
