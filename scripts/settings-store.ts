/**
 * settings-store.ts
 * Shared settings — persisted to AsyncStorage
 * Import `useSettings` hook or `getSettings()` anywhere in the app
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "app_settings_v1";

export interface AppSettings {
  api_key: string;
  chatgpt_api_key: string;     // <-- THÊM MỚI (Dành riêng cho Whisper)
  agent: string;
  model: string;
  easy_examples: number;       // 1–4
  medium_examples: number;     // 1–4
  hard_examples: number;       // 1–4
  super_hard_examples: number; // 1–4
}

export const DEFAULT_SETTINGS: AppSettings = {
  api_key: "",
  chatgpt_api_key: "",         // <-- THÊM MỚI
  agent: "chatgpt",
  model: "gpt-5.4-mini",
  easy_examples: 2,
  medium_examples: 3,
  hard_examples: 4,
  super_hard_examples: 0,
};

// ── In-memory cache so reads are synchronous after first load ──
let _cache: AppSettings | null = null;
const _listeners = new Set<(s: AppSettings) => void>();

export async function loadSettings(): Promise<AppSettings> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<AppSettings>) : {};
    _cache = { ...DEFAULT_SETTINGS, ...parsed };
    return _cache;
  } catch {
    _cache = { ...DEFAULT_SETTINGS };
    return _cache;
  }
}

export async function saveSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const current = _cache ?? { ...DEFAULT_SETTINGS };
  const next = { ...current, ...patch };
  _cache = next;
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  _listeners.forEach((fn) => fn(next));
  return next;
}

/** Synchronous read — returns cache or defaults. Call loadSettings() first. */
export function getSettings(): AppSettings {
  return _cache ?? { ...DEFAULT_SETTINGS };
}

export function subscribeSettings(fn: (s: AppSettings) => void): () => void {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}