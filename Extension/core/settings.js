import "./settings-core.js";

const api = globalThis.browser ?? globalThis.chrome;

export const { DEFAULT_SETTINGS, sanitizeSettings } = globalThis.ImmerseFreeSettingsCore;

export async function getSettings() {
  const stored = await api.storage.local.get(DEFAULT_SETTINGS);
  return sanitizeSettings(stored);
}

export async function saveSettings(next) {
  const settings = sanitizeSettings({ ...DEFAULT_SETTINGS, ...next });
  await api.storage.local.set(settings);
  return settings;
}
