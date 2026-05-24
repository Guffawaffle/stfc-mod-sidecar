for (const toggle of document.querySelectorAll("[data-detail-toggle]")) {
  toggle.addEventListener("click", () => {
    const panelId = toggle.getAttribute("aria-controls");
    const panel = panelId ? document.getElementById(panelId) : null;
    if (!panel) {
      return;
    }

    const expanded = toggle.getAttribute("aria-expanded") === "true";
    toggle.setAttribute("aria-expanded", expanded ? "false" : "true");
    if (expanded) {
      panel.classList.remove("is-open");
      window.setTimeout(() => {
        if (!panel.classList.contains("is-open")) {
          panel.hidden = true;
        }
      }, 180);
      return;
    }

    panel.hidden = false;
    const run = window.requestAnimationFrame ?? ((callback) => window.setTimeout(callback, 0));
    run(() => panel.classList.add("is-open"));
  });
}

const diagnosticsElements = {
  copy: document.querySelector("#copy-diagnostics"),
  download: document.querySelector("#download-diagnostics"),
  preview: document.querySelector("#preview-diagnostics"),
  previewPanel: document.querySelector("#diagnostics-preview"),
  state: document.querySelector("#diagnostics-state"),
};

diagnosticsElements.preview?.addEventListener("click", () => void previewDiagnostics());
diagnosticsElements.copy?.addEventListener("click", () => void copyDiagnostics());
diagnosticsElements.download?.addEventListener("click", () => void downloadDiagnostics());

async function previewDiagnostics() {
  setDiagnosticsState("Generating preview...");
  try {
    const bundle = await fetchDiagnosticsJson();
    diagnosticsElements.previewPanel.textContent = JSON.stringify(bundle, null, 2);
    diagnosticsElements.previewPanel.hidden = false;
    setDiagnosticsState("Preview ready");
  } catch (error) {
    setDiagnosticsState(error instanceof Error ? error.message : String(error));
  }
}

async function copyDiagnostics() {
  setDiagnosticsState("Generating Markdown...");
  try {
    const markdown = await fetchDiagnosticsMarkdown();
    await navigator.clipboard.writeText(markdown);
    setDiagnosticsState("Markdown copied");
  } catch (error) {
    setDiagnosticsState(error instanceof Error ? error.message : String(error));
  }
}

async function downloadDiagnostics() {
  setDiagnosticsState("Preparing download...");
  try {
    const bundle = await fetchDiagnosticsJson();
    const blob = new Blob([`${JSON.stringify(bundle, null, 2)}\n`], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `stfc-sidecar-diagnostics-${safeTimestamp(bundle.generatedAt)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setDiagnosticsState("Download ready");
  } catch (error) {
    setDiagnosticsState(error instanceof Error ? error.message : String(error));
  }
}

async function fetchDiagnosticsJson() {
  const response = await fetch("/api/diagnostics/bundle", { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Diagnostics request failed: ${response.status}`);
  }

  return response.json();
}

async function fetchDiagnosticsMarkdown() {
  const response = await fetch("/api/diagnostics/bundle?format=markdown", { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Diagnostics request failed: ${response.status}`);
  }

  return response.text();
}

function setDiagnosticsState(message) {
  if (diagnosticsElements.state) {
    diagnosticsElements.state.textContent = message;
  }
}

function safeTimestamp(value) {
  return String(value ?? new Date().toISOString()).replace(/[^0-9A-Za-z]+/g, "-").replace(/^-|-$/g, "");
}
