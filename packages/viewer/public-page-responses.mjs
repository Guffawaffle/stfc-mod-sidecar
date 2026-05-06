export function buildCapabilityUnavailablePage(options = {}) {
    const title = stringOr(options.title, "Feature unavailable");
    const eyebrow = stringOr(options.eyebrow, "Profile boundary");
    const heading = stringOr(options.heading, "Feature unavailable");
    const message = stringOr(options.message, "This feature is not available for the active profile.");
    const details = Array.isArray(options.details)
        ? options.details.map((detail) => stringOr(detail, "")).filter(Boolean)
        : [];
    const primaryHref = stringOr(options.primaryHref, "/");
    const primaryLabel = stringOr(options.primaryLabel, "Go home");
    const secondaryHref = stringOr(options.secondaryHref, "/settings/");
    const secondaryLabel = stringOr(options.secondaryLabel, "Open Settings");

    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>STFC Sidecar Viewer | ${escapeHtml(title)}</title>
    <link rel="stylesheet" href="/styles.css" />
  </head>
  <body>
    <main class="shell site-shell">
      <nav class="site-nav" aria-label="viewer navigation" data-viewer-nav></nav>

      <section class="module-grid" aria-label="unavailable feature">
        <article class="module-card module-card--primary">
          <p class="eyebrow">${escapeHtml(eyebrow)}</p>
          <h1>${escapeHtml(heading)}</h1>
          <p class="page-copy">${escapeHtml(message)}</p>
          ${details.length ? `<ul class="module-list">${details.map((detail) => `<li>${escapeHtml(detail)}</li>`).join("")}</ul>` : ""}
          <div class="diagnostics-actions">
            <a class="link-button" href="${escapeAttribute(primaryHref)}">${escapeHtml(primaryLabel)}</a>
            <a class="link-button link-button--secondary" href="${escapeAttribute(secondaryHref)}">${escapeHtml(secondaryLabel)}</a>
          </div>
        </article>
      </section>
    </main>
    <script type="module" src="/shared/shell.js"></script>
  </body>
</html>`;
}

function stringOr(value, fallback) {
    const text = String(value ?? "").trim();
    return text || fallback;
}

function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

function escapeAttribute(value) {
    const text = stringOr(value, "#");
    if (!text.startsWith("/") && !text.startsWith("#")) {
        return "#";
    }

    return escapeHtml(text);
}