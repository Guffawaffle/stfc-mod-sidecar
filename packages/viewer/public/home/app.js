const tiles = Array.from(document.querySelectorAll("[data-command-tile]"));
const panels = Array.from(document.querySelectorAll("[data-command-panel]"));

for (const tile of tiles) {
  tile.addEventListener("click", () => selectPanel(tile.dataset.commandPanelId));
}

function selectPanel(panelId) {
  if (!panelId) {
    return;
  }

  for (const tile of tiles) {
    const selected = tile.dataset.commandPanelId === panelId;
    tile.classList.toggle("is-selected", selected);
    tile.setAttribute("aria-selected", selected ? "true" : "false");
  }

  for (const panel of panels) {
    const selected = panel.id === panelId;
    panel.hidden = !selected;
    panel.classList.toggle("is-active", selected);
  }
}
