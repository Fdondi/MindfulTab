const EXT_API = typeof browser !== "undefined" ? browser : chrome;

const ui = {
  refreshBtn: document.getElementById("refresh-btn"),
  domainList: document.getElementById("domain-list"),
  emptyState: document.getElementById("empty-state")
};

async function sendMessage(type, payload = {}) {
  return EXT_API.runtime.sendMessage({ type, payload });
}

function rowTemplate(domain, score, visits, optedOut) {
  return `
    <span class="domain">${domain}</span>
    <span class="num">${score > 0 ? `+${score}` : score}</span>
    <span class="num">${visits}</span>
    <span>${optedOut ? "Yes" : "No"}</span>
    <div class="actions">
      <button type="button" data-action="forgive" data-domain="${domain}">Forgive +1</button>
      <button type="button" class="${optedOut ? "" : "primary"}" data-action="toggle-optout" data-domain="${domain}">
        ${optedOut ? "Remove opt-out" : "Always allow"}
      </button>
    </div>
  `;
}

async function loadDomainSettings() {
  const response = await sendMessage("mindfultab/get-karma-settings");
  if (!response?.ok) return;

  const karmaByDomain = response.karmaByDomain || {};
  const optOutDomains = response.optOutDomains || {};
  const domainVisits = response.domainVisits || {};
  const domainSet = new Set([
    ...Object.keys(karmaByDomain),
    ...Object.keys(optOutDomains),
    ...Object.keys(domainVisits)
  ]);
  const domains = Array.from(domainSet).sort((a, b) => {
    const visitsDiff = Number(domainVisits[b] || 0) - Number(domainVisits[a] || 0);
    if (visitsDiff !== 0) return visitsDiff;
    return a.localeCompare(b);
  });

  ui.domainList.innerHTML = "";
  if (!domains.length) {
    ui.emptyState.classList.remove("hidden");
    return;
  }
  ui.emptyState.classList.add("hidden");

  for (const domain of domains) {
    const row = document.createElement("li");
    row.className = "domain-row";
    row.innerHTML = rowTemplate(
      domain,
      Number(karmaByDomain[domain] || 0),
      Number(domainVisits[domain] || 0),
      Boolean(optOutDomains[domain])
    );
    ui.domainList.appendChild(row);
  }
}

async function handleListClick(target) {
  const button = target?.closest?.("button[data-action][data-domain]");
  if (!button) return;

  const domain = String(button.dataset.domain || "").trim().toLowerCase();
  const action = button.dataset.action;
  if (!domain || !action) return;

  button.disabled = true;
  try {
    if (action === "forgive") {
      await sendMessage("mindfultab/forgive-karma", { domain });
    } else if (action === "toggle-optout") {
      const isRemoving = button.textContent.includes("Remove");
      await sendMessage("mindfultab/set-domain-opt-out", {
        domain,
        optedOut: !isRemoving
      });
    }
    await loadDomainSettings();
  } finally {
    button.disabled = false;
  }
}

function init() {
  ui.refreshBtn.addEventListener("click", () => {
    loadDomainSettings().catch(() => {});
  });
  ui.domainList.addEventListener("click", (event) => {
    handleListClick(event.target).catch(() => {});
  });
  loadDomainSettings().catch(() => {});
}

init();
