import { DEFAULT_SETTINGS, type Settings } from '../types';
import { createStore } from './createStore';

const SETTINGS_KEY = 'tcard-planner.settings.v1';
// Set once the card surface has been moved over to the modal default, so a
// later choice of the drawer in Settings sticks.
const MODAL_DEFAULT_KEY = 'tcard-planner.modal-default.v1';

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    const stored = raw ? (JSON.parse(raw) as Partial<Settings>) : {};
    const moveToModal = !localStorage.getItem(MODAL_DEFAULT_KEY);
    if (moveToModal) delete stored.cardSurface;
    const preferDark = typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches;
    const settings: Settings = {
      ...DEFAULT_SETTINGS,
      theme: preferDark ? 'dark' : 'light',
      ...stored,
      m365: { ...DEFAULT_SETTINGS.m365, ...(stored.m365 ?? {}) },
    };
    if (moveToModal) {
      if (raw) saveSettings(settings);
      localStorage.setItem(MODAL_DEFAULT_KEY, '1');
    }
    return settings;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Quota or private-browsing errors shouldn't crash the app
  }
}

interface SettingsStoreState {
  settings: Settings;
  updateSettings: (patch: Partial<Settings>) => void;
}

const initialSettings = loadSettings();

export const settingsStore = createStore<SettingsStoreState>({
  settings: initialSettings,
  updateSettings: (patch: Partial<Settings>) => {
    const current = settingsStore.getState().settings;
    const next: Settings = {
      ...current,
      ...patch,
      m365: patch.m365 ? { ...current.m365, ...patch.m365 } : current.m365,
    };
    saveSettings(next);
    if (typeof document !== 'undefined') {
      document.documentElement.dataset.theme = next.theme;
      document.documentElement.dataset.skin = next.skin;
    }
    settingsStore.setState({ settings: next });
  },
});

// Sync initial document attributes
if (typeof document !== 'undefined') {
  document.documentElement.dataset.theme = initialSettings.theme;
  document.documentElement.dataset.skin = initialSettings.skin;
}

export function useSettings<T = Settings>(
  selector: (settings: Settings) => T = (s) => s as unknown as T,
): T {
  return settingsStore.useStore((state) => selector(state.settings));
}

export function useSettingsActions() {
  return {
    updateSettings: settingsStore.getState().updateSettings,
  };
}
