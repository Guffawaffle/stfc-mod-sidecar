const USE_SCOPELY_HOTKEYS_ID = "control.use_scopely_hotkeys";
const LOCKED_HARD_SETTING_IDS = Object.freeze([
    "control.hotkeys_enabled",
    "control.hotkeys_extended",
]);

export function buildHotkeyDependencyState(snapshot, draftHardSettings) {
    const hardSettings = Array.isArray(snapshot?.hardSettings) ? snapshot.hardSettings : [];
    const currentValues = new Map(hardSettings.map((setting) => [setting.id, setting.value]));
    for (const [id, value] of draftHardSettings ?? []) {
        currentValues.set(id, value);
    }

    const useScopelyHotkeys = Boolean(currentValues.get(USE_SCOPELY_HOTKEYS_ID));
    const lockedHardSettingIds = useScopelyHotkeys
        ? LOCKED_HARD_SETTING_IDS.filter((id) => currentValues.has(id))
        : [];

    return {
        useScopelyHotkeys,
        keybindingsAvailable: !useScopelyHotkeys,
        lockedHardSettingIds,
        hardSettingsMessage: useScopelyHotkeys
            ? "Use Scopely hotkeys keeps the game shortcut layer active. Mod hotkeys, Extended hotkeys, and custom keybindings stay saved but inactive until you turn it off."
            : "",
        keybindingsMessage: useScopelyHotkeys
            ? "Custom keybindings are inactive while Use Scopely hotkeys is enabled. Turn it off under Hard Settings to edit bindings again."
            : "",
        lockedSettingMessage: useScopelyHotkeys
            ? "Inactive while Use Scopely hotkeys is enabled."
            : "",
    };
}