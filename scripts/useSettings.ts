/**
 * useSettings.ts
 * React hook — returns live settings + updater
 * Usage:
 *   const { settings, updateSettings } = useSettings();
 */

import { useState, useEffect } from "react";
import {
  AppSettings,
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
  subscribeSettings,
} from "./settings-store";

export function useSettings() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    loadSettings().then((s) => {
      setSettings(s);
      setLoaded(true);
    });
    const unsub = subscribeSettings((s) => setSettings(s));
    return unsub;
  }, []);

  const updateSettings = async (patch: Partial<AppSettings>) => {
    await saveSettings(patch);
    // subscribeSettings fires setSettings above
  };

  return { settings, updateSettings, loaded };
}