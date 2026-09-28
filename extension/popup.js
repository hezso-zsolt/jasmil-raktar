const DEFAULT_SETTINGS = {
  backendUrl: "http://localhost:3000",
  extensionToken: "",
  defaultWeightKg: 1.0,
};

const backendUrlInput = document.getElementById("backendUrl");
const extensionTokenInput = document.getElementById("extensionToken");
const defaultWeightInput = document.getElementById("defaultWeight");
const statusDot = document.getElementById("status-dot");
const statusText = document.getElementById("status-text");

async function loadSettings() {
  const stored = await chrome.storage.local.get(DEFAULT_SETTINGS);
  const settings = { ...DEFAULT_SETTINGS, ...stored };
  backendUrlInput.value = settings.backendUrl;
  extensionTokenInput.value = settings.extensionToken;
  defaultWeightInput.value = settings.defaultWeightKg;
  return settings;
}

async function saveSettings() {
  const settings = {
    backendUrl: backendUrlInput.value.trim() || DEFAULT_SETTINGS.backendUrl,
    extensionToken: extensionTokenInput.value.trim(),
    defaultWeightKg: Number(defaultWeightInput.value) || DEFAULT_SETTINGS.defaultWeightKg,
  };
  await chrome.storage.local.set(settings);
  return settings;
}

function setStatus(state, text) {
  statusDot.className = `dot dot-${state}`;
  statusText.textContent = text;
}

async function testConnection() {
  setStatus("unknown", "Kapcsolat ellenőrzése…");
  const settings = await loadSettings();
  try {
    const res = await fetch(`${settings.backendUrl}/api/health`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    setStatus("ok", data.mock_mode ? "Kapcsolódva (MOCK mód)" : "Kapcsolódva");
  } catch (err) {
    setStatus("error", `Nincs kapcsolat: ${err.message}`);
  }
}

document.getElementById("saveBtn").addEventListener("click", async () => {
  await saveSettings();
  await testConnection();
});

document.getElementById("testBtn").addEventListener("click", testConnection);

loadSettings().then(testConnection);
