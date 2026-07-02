/**
 * settings.tsx
 * Settings tab — lưu AsyncStorage, broadcast qua subscribeSettings
 * Dark navy theme — nhất quán với các tab khác
 */

import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from "react-native";
import { useFocusEffect } from "expo-router";
import { useSettings } from "../../scripts/useSettings";
import { AppSettings } from "../../scripts/settings-store";
import { Palette } from "@/constants/palette";

// ── Stepper: chọn số từ 1–4 ──────────────────────────────────
function CountStepper({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <View style={s.stepperRow}>
      <Text style={s.stepperLabel}>{label}</Text>
      <View style={s.stepperControls}>
        {[0, 1, 2, 3, 4].map((n) => (
          <TouchableOpacity
            key={n}
            style={[s.stepperBtn, value === n && s.stepperBtnActive]}
            onPress={() => onChange(n)}
          >
            <Text style={[s.stepperBtnText, value === n && s.stepperBtnTextActive]}>
              {n}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

// ── Masked API key display ────────────────────────────────────
function maskKey(key: string): string {
  if (!key) return "";
  if (key.length <= 8) return "•".repeat(key.length);
  return key.slice(0, 4) + "•".repeat(Math.min(key.length - 8, 20)) + key.slice(-4);
}

// ─────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────
export default function SettingsScreen() {
  const { settings, updateSettings, loaded } = useSettings();

  // Local draft state — only commits on Save
  const [draft, setDraft] = useState<AppSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [showChatGptKey, setShowChatGptKey] = useState(false); // <-- Trạng thái show/hide cho key mới
  const [dirty, setDirty] = useState(false);

  // Sync draft when settings load / change from outside
  useFocusEffect(
    React.useCallback(() => {
      if (loaded) {
        setDraft({ ...settings });
        setDirty(false);
      }
    }, [loaded, settings])
  );

  if (!loaded || !draft) {
    return (
      <View style={s.loader}>
        <ActivityIndicator color={Palette.brand} size="large" />
      </View>
    );
  }

  const patch = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setDraft((prev) => (prev ? { ...prev, [key]: value } : prev));
    setDirty(true);
  };

  const handleSave = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      await updateSettings(draft);
      setDirty(false);
      Alert.alert("✅ Saved", "Settings updated successfully.");
    } catch {
      Alert.alert("Error", "Failed to save settings.");
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    Alert.alert("Reset to defaults?", "This will overwrite your current settings.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Reset",
        style: "destructive",
        onPress: async () => {
          const defaults: AppSettings = {
            api_key: "",
            chatgpt_api_key: "", // <-- Cập nhật default
            agent: "chatgpt",
            model: "gpt-5.4-mini",
            easy_examples: 2,
            medium_examples: 3,
            hard_examples: 4,
            super_hard_examples: 1,
          };
          setDraft(defaults);
          await updateSettings(defaults);
          setDirty(false);
          Alert.alert("✅ Reset", "Settings restored to defaults.");
        },
      },
    ]);
  };

  return (
    <ScrollView style={s.container} contentContainerStyle={s.content}>
      {/* ── Header ── */}
      <View style={s.header}>
        <Text style={s.headerTitle}>⚙️ Settings</Text>
        <Text style={s.headerSub}>Configure API, model & difficulty</Text>
      </View>

      {/* ── API Section ── */}
      <View style={s.section}>
        <Text style={s.sectionTitle}>🔑 API Configuration</Text>

        <Text style={s.fieldLabel}>API Key</Text>
        <View style={s.apiKeyRow}>
          <TextInput
            style={[s.input, s.inputFlex]}
            value={draft.api_key}
            onChangeText={(v) => patch("api_key", v)}
            placeholder="sk-…"
            placeholderTextColor="#333"
            secureTextEntry={!showKey}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <TouchableOpacity
            style={s.eyeBtn}
            onPress={() => setShowKey((p) => !p)}
          >
            <Text style={s.eyeIcon}>{showKey ? "🙈" : "👁️"}</Text>
          </TouchableOpacity>
        </View>
        {draft.api_key !== "" && !showKey && (
          <Text style={s.maskedKey}>{maskKey(draft.api_key)}</Text>
        )}

        {/* ── NEW: ChatGPT API Key (for Whisper) ── */}
        <Text style={s.fieldLabel}>ChatGPT API Key (for Whisper)</Text>
        <View style={s.apiKeyRow}>
          <TextInput
            style={[s.input, s.inputFlex]}
            value={draft.chatgpt_api_key}
            onChangeText={(v) => patch("chatgpt_api_key", v)}
            placeholder="sk-…"
            placeholderTextColor="#333"
            secureTextEntry={!showChatGptKey}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <TouchableOpacity
            style={s.eyeBtn}
            onPress={() => setShowChatGptKey((p) => !p)}
          >
            <Text style={s.eyeIcon}>{showChatGptKey ? "🙈" : "👁️"}</Text>
          </TouchableOpacity>
        </View>
        {draft.chatgpt_api_key !== "" && !showChatGptKey && (
          <Text style={s.maskedKey}>{maskKey(draft.chatgpt_api_key)}</Text>
        )}

        <Text style={s.fieldLabel}>Agent</Text>
        <TextInput
          style={s.input}
          value={draft.agent}
          onChangeText={(v) => patch("agent", v)}
          placeholder="chatgpt"
          placeholderTextColor="#333"
          autoCapitalize="none"
          autoCorrect={false}
        />

        <Text style={s.fieldLabel}>Model</Text>
        <TextInput
          style={s.input}
          value={draft.model}
          onChangeText={(v) => patch("model", v)}
          placeholder="gpt-5.4-mini"
          placeholderTextColor="#333"
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>

      {/* ── Examples per difficulty ── */}
      <View style={s.section}>
        <Text style={s.sectionTitle}>📚 Examples per Difficulty</Text>
        <Text style={s.sectionHint}>Number of example sentences generated for each level.</Text>

        <CountStepper
          label="⚡ Easy"
          value={draft.easy_examples}
          onChange={(v) => patch("easy_examples", v)}
        />
        <CountStepper
          label="📘 Medium"
          value={draft.medium_examples}
          onChange={(v) => patch("medium_examples", v)}
        />
        <CountStepper
          label="🔥 Hard"
          value={draft.hard_examples}
          onChange={(v) => patch("hard_examples", v)}
        />
        <CountStepper
          label="💀 Super Hard"
          value={draft.super_hard_examples}
          onChange={(v) => patch("super_hard_examples", v)}
        />
      </View>

      {/* ── Actions ── */}
      <View style={s.actions}>
        <TouchableOpacity
          style={[s.saveBtn, (!dirty || saving) && s.saveBtnDisabled]}
          onPress={handleSave}
          disabled={!dirty || saving}
        >
          {saving ? (
            <ActivityIndicator color={Palette.card} size="small" />
          ) : (
            <Text style={s.saveBtnText}>{dirty ? "💾 Save Changes" : "✅ Saved"}</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity style={s.resetBtn} onPress={handleReset}>
          <Text style={s.resetBtnText}>↩️ Reset to Defaults</Text>
        </TouchableOpacity>
      </View>

      {/* ── Info footer ── */}
      <View style={s.footer}>
        <Text style={s.footerText}>
          Settings are saved locally on your device and never sent to external servers.
        </Text>
      </View>
    </ScrollView>
  );
}

// ─────────────────────────────────────────────
// STYLES
// ─────────────────────────────────────────────
const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Palette.bg },
  content: { paddingBottom: 50 },
  loader: { flex: 1, backgroundColor: Palette.bg, justifyContent: "center", alignItems: "center" },

  header: { alignItems: "center", paddingTop: 28, paddingBottom: 16, paddingHorizontal: 16 },
  headerTitle: { fontSize: 26, fontWeight: "bold", color: Palette.accent },
  headerSub: { color: Palette.textDim, fontSize: 13, marginTop: 4 },

  section: {
    backgroundColor: Palette.card,
    borderRadius: 16,
    padding: 16,
    marginHorizontal: 16,
    marginBottom: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 5,
  },
  sectionTitle: { color: Palette.info, fontWeight: "bold", fontSize: 14, marginBottom: 12 },
  sectionHint: { color: Palette.textDim, fontSize: 12, marginBottom: 12, fontStyle: "italic" },

  fieldLabel: { color: Palette.textFaint, fontSize: 12, fontWeight: "600", marginBottom: 6, marginTop: 10 },

  input: {
    backgroundColor: Palette.inset,
    borderRadius: 8,
    paddingVertical: 11,
    paddingHorizontal: 13,
    color: Palette.brand,
    fontSize: 14,
    borderWidth: 1,
    borderColor: Palette.primary,
  },
  inputFlex: { flex: 1 },

  apiKeyRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  eyeBtn: {
    backgroundColor: Palette.inset,
    borderRadius: 8,
    width: 44,
    height: 44,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: Palette.primary,
  },
  eyeIcon: { fontSize: 18 },
  maskedKey: { color: "#444", fontSize: 12, marginTop: 4, fontFamily: "monospace" },

  // Stepper
  stepperRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#0d2040",
  },
  stepperLabel: { color: Palette.textSecondary, fontSize: 14, fontWeight: "600", flex: 1 },
  stepperControls: { flexDirection: "row", gap: 6 },
  stepperBtn: {
    width: 38,
    height: 38,
    borderRadius: 8,
    backgroundColor: Palette.inset,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: Palette.primary,
  },
  stepperBtnActive: { backgroundColor: Palette.primary, borderColor: Palette.brand },
  stepperBtnText: { color: Palette.textDim, fontWeight: "700", fontSize: 15 },
  stepperBtnTextActive: { color: Palette.brand },

  // Actions
  actions: { marginHorizontal: 16, gap: 10 },
  saveBtn: {
    backgroundColor: Palette.hard,
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: "center",
  },
  saveBtnDisabled: { backgroundColor: "#3a3a3a", opacity: 0.6 },
  saveBtnText: { color: Palette.textPrimary, fontWeight: "bold", fontSize: 16 },
  resetBtn: {
    backgroundColor: Palette.card,
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#922b21",
  },
  resetBtnText: { color: Palette.danger, fontWeight: "600", fontSize: 14 },

  // Footer
  footer: { marginTop: 20, paddingHorizontal: 24, alignItems: "center" },
  footerText: { color: "#333", fontSize: 11, textAlign: "center", lineHeight: 18 },
});