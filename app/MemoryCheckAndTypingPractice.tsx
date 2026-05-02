/**
 * PATCH — drop these two components into VocabularyLearnerUI.tsx,
 * replacing the existing MemoryCheckModal and TypingPracticeModal.
 *
 * What's new:
 *  - Both modals now have a "🎙 Speech Check" tab alongside typing.
 *  - Speech tab: tap Start → speak → tap Stop → Whisper transcribes →
 *    diff shown (correct / wrong / missing / extra tokens, % score).
 *  - ≥ 80% score = PASS; auto-advances in MemoryCheck just like correct typing.
 *
 * Dependencies:
 *  - SpeechCheck.tsx (new file, lives next to this one)
 *  - expo-av must be installed: npx expo install expo-av
 *  - Add to app.json:
 *      "plugins": [["expo-av", { "microphonePermission": "Allow vocabulary app to use microphone." }]]
 *
 * Import at the top of VocabularyLearnerUI.tsx:
 *   import { SpeechCheck } from "./SpeechCheck";   // adjust path
 */

import React, { useState, useEffect } from "react";
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Platform,
} from "react-native";
import { SpeechCheck } from "./SpeechCheck";   // ← adjust to your actual path

// Re-use types / helpers already defined in VocabularyLearnerUI.tsx
// (paste these imports/stubs only if this file is standalone; normally
//  these would already be in scope inside the parent file)
interface ExampleItem {
  sentence: string;
  romanization?: string | null;
  translation: string;
  explanation: string;
  grammar_points: string[];
  difficulty_justification: string;
  difficulty_tag: string;
  tokens?: string[];
}

declare function speakText(text: string, language: string, rate?: number): Promise<void>;

const OPENAI_API_KEY = ""; // replace with your key or pass as prop

// ─────────────────────────────────────────────────────────────────────────────
// MEMORY CHECK MODAL
// ─────────────────────────────────────────────────────────────────────────────

export function MemoryCheckModal({
  examples,
  inputLang,
  ttsSpeed,
  onClose,
  apiKey = OPENAI_API_KEY,
}: {
  examples: ExampleItem[];
  inputLang: string;
  ttsSpeed: number;
  onClose: () => void;
  apiKey?: string;
}) {
  const [shuffled]   = useState<ExampleItem[]>(() => [...examples].sort(() => Math.random() - 0.5));
  const [idx, setIdx]   = useState(0);
  const [input, setInput] = useState("");
  const [showHint, setShowHint] = useState(false);
  const [done, setDone]   = useState(false);
  const [tab, setTab]     = useState<"typing" | "speech">("typing");
  const [speechKey, setSpeechKey] = useState(0); // forces SpeechCheck remount on new example

  const current = shuffled[idx];
  const target  = current?.sentence?.trim() ?? "";

  useEffect(() => {
    if (!current?.sentence) return;
    const t = setTimeout(() => speakText(current.sentence, inputLang, ttsSpeed), 350);
    return () => clearTimeout(t);
  }, [idx]);

  // Reset per-card state when example changes
  useEffect(() => {
    setInput("");
    setShowHint(false);
    setSpeechKey(k => k + 1);
  }, [idx]);

  const advance = () => {
    const next = idx + 1;
    if (next >= shuffled.length) setDone(true);
    else setTimeout(() => setIdx(next), 500);
  };

  /* ── Typing ── */
  const handleTypingChange = (text: string) => {
    setInput(text);
    if (text === target && target.length > 0) advance();
  };

  /* ── Speech ── */
  const handleSpeechResult = (passed: boolean) => {
    if (passed) setTimeout(() => advance(), 1200);
  };

  return (
    <Modal visible animationType="slide">
      <View style={s.root}>
        {/* Header */}
        <View style={s.header}>
          <Text style={s.title}>🧠 Memory Check</Text>
          <TouchableOpacity onPress={onClose}>
            <Text style={s.close}>✕</Text>
          </TouchableOpacity>
        </View>

        {done ? (
          <View style={s.doneBox}>
            <Text style={s.doneText}>🎉 Amazing! You've recalled all examples!</Text>
            <TouchableOpacity style={s.btnPrimary} onPress={onClose}>
              <Text style={s.btnPrimaryText}>Close</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <ScrollView contentContainerStyle={s.body}>
            <Text style={s.progress}>Progress: {idx + 1}/{shuffled.length}</Text>

            {/* Prompt */}
            <View style={s.promptRow}>
              <Text style={s.instruction}>Translate back to {inputLang}:</Text>
              <TouchableOpacity onPress={() => speakText(current?.sentence ?? "", inputLang, ttsSpeed)}>
                <Text style={s.replayBtn}>🔊 Replay</Text>
              </TouchableOpacity>
            </View>
            <Text style={s.translation}>{current?.translation}</Text>

            {/* Hint */}
            {showHint && (
              <View style={s.hintBox}>
                <Text style={s.hintText}>{target}</Text>
              </View>
            )}

            {/* Tab switcher */}
            <View style={s.tabs}>
              <TouchableOpacity
                style={[s.tab, tab === "typing" && s.tabActive]}
                onPress={() => setTab("typing")}
              >
                <Text style={[s.tabText, tab === "typing" && s.tabTextActive]}>⌨️ Typing</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.tab, tab === "speech" && s.tabActive]}
                onPress={() => setTab("speech")}
              >
                <Text style={[s.tabText, tab === "speech" && s.tabTextActive]}>🎙 Speech</Text>
              </TouchableOpacity>
            </View>

            {/* Tab content */}
            {tab === "typing" ? (
              <ColoredInput
                input={input}
                target={target}
                placeholder="Type here..."
                onChangeText={handleTypingChange}
                autoFocus
              />
            ) : (
              <SpeechCheck
                key={speechKey}
                target={target}
                language={inputLang}
                apiKey={apiKey}
                onResult={handleSpeechResult}
                threshold={0.8}
              />
            )}

            {/* Hint button */}
            <View style={s.btnRow}>
              <TouchableOpacity
                style={s.hintBtn}
                onPressIn={() => setShowHint(true)}
                onPressOut={() => setShowHint(false)}
              >
                <Text style={s.hintBtnText}>💡 Hold for Hint</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TYPING PRACTICE MODAL
// ─────────────────────────────────────────────────────────────────────────────

export function TypingPracticeModal({
  example,
  currentScore,
  onClose,
  onCorrect,
  inputLang,
  ttsSpeed,
  apiKey = OPENAI_API_KEY,
}: {
  example: ExampleItem | null;
  currentScore: number;
  onClose: () => void;
  onCorrect: () => void;
  inputLang: string;
  ttsSpeed: number;
  apiKey?: string;
}) {
  const [input,     setInput]     = useState("");
  const [completed, setCompleted] = useState(false);
  const [tab,       setTab]       = useState<"typing" | "speech">("typing");
  const [speechKey, setSpeechKey] = useState(0);

  const target = example?.sentence?.trim() ?? "";

  useEffect(() => {
    if (!example?.sentence) return;
    const t = setTimeout(() => speakText(example.sentence, inputLang, ttsSpeed), 350);
    return () => clearTimeout(t);
  }, [example?.sentence]);

  /* ── Typing ── */
  const handleTypingChange = (text: string) => {
    setInput(text);
    if (text === target && target.length > 0) {
      onCorrect();
      setCompleted(true);
      setTimeout(() => { setInput(""); setCompleted(false); setSpeechKey(k => k + 1); }, 700);
    }
  };

  /* ── Speech ── */
  const handleSpeechResult = (passed: boolean) => {
    if (passed) {
      onCorrect();
      setCompleted(true);
      setTimeout(() => { setCompleted(false); setSpeechKey(k => k + 1); }, 1500);
    }
  };

  return (
    <Modal visible animationType="slide">
      <View style={s.root}>
        {/* Header */}
        <View style={s.header}>
          <Text style={s.title}>⌨️ Typing Practice</Text>
          <TouchableOpacity onPress={onClose}>
            <Text style={s.close}>✕</Text>
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={s.body}>
          <Text style={s.progress}>Score: {currentScore}</Text>

          {/* Prompt */}
          <View style={s.promptRow}>
            <Text style={s.instruction}>Reproduce the sentence:</Text>
            <TouchableOpacity onPress={() => speakText(target, inputLang, ttsSpeed)}>
              <Text style={s.replayBtn}>🔊 Replay</Text>
            </TouchableOpacity>
          </View>
          <View style={s.targetBox}>
            <Text style={s.targetText}>{target || "No example available"}</Text>
          </View>

          {/* Tab switcher */}
          <View style={s.tabs}>
            <TouchableOpacity
              style={[s.tab, tab === "typing" && s.tabActive]}
              onPress={() => setTab("typing")}
            >
              <Text style={[s.tabText, tab === "typing" && s.tabTextActive]}>⌨️ Typing</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.tab, tab === "speech" && s.tabActive]}
              onPress={() => setTab("speech")}
            >
              <Text style={[s.tabText, tab === "speech" && s.tabTextActive]}>🎙 Speech</Text>
            </TouchableOpacity>
          </View>

          {/* Tab content */}
          {tab === "typing" ? (
            <ColoredInput
              input={input}
              target={target}
              placeholder="Type here..."
              onChangeText={handleTypingChange}
              autoFocus
            />
          ) : (
            <SpeechCheck
              key={speechKey}
              target={target}
              language={inputLang}
              apiKey={apiKey}
              onResult={handleSpeechResult}
              threshold={0.8}
            />
          )}

          {completed && (
            <View style={s.successBox}>
              <Text style={s.successText}>✅ {tab === "speech" ? "Great pronunciation!" : "Correct! Keep going."}</Text>
            </View>
          )}

          <TouchableOpacity style={[s.btnPrimary, { marginTop: 16 }]} onPress={onClose}>
            <Text style={s.btnPrimaryText}>Close Practice</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// COLORED INPUT (unchanged from original, copied here for completeness)
// ─────────────────────────────────────────────────────────────────────────────

import { TextInput } from "react-native";

function ColoredInput({
  input, target, placeholder, onChangeText, autoFocus = false,
}: {
  input: string; target: string; placeholder?: string;
  onChangeText: (t: string) => void; autoFocus?: boolean;
}) {
  return (
    <View style={ov.wrapper}>
      <TextInput
        style={ov.input}
        value={input}
        onChangeText={onChangeText}
        placeholder={placeholder ?? "Type here..."}
        placeholderTextColor="#555"
        multiline
        autoCapitalize="none"
        autoCorrect={false}
        autoFocus={autoFocus}
      />
      {input.length > 0 && (
        <Text style={ov.overlay} pointerEvents="none">
          {input.split("").map((char, i) => (
            <Text key={i} style={{ color: i < target.length && char === target[i] ? "#2ECC71" : "#E74C3C" }}>
              {char}
            </Text>
          ))}
        </Text>
      )}
    </View>
  );
}

const ov = StyleSheet.create({
  wrapper: {
    backgroundColor: "#111", borderRadius: 10, borderWidth: 1,
    borderColor: "#333", justifyContent: "center", marginTop: 12, position: "relative",
  },
  overlay: {
    position: "absolute", top: 5, left: 0, right: 0, bottom: 0,
    fontSize: 16, lineHeight: 22,
    paddingTop: Platform.OS === "android" ? 12 : 14,
    paddingHorizontal: 14,
    zIndex: 2, flexWrap: "wrap",
    fontFamily: Platform.OS === "ios" ? "Courier" : "monospace",
  },
  input: {
    fontSize: 16, lineHeight: 22, padding: 14,
    paddingTop: Platform.OS === "android" ? 12 : 14,
    color: "transparent", minHeight: 60, textAlignVertical: "top",
    fontFamily: Platform.OS === "ios" ? "Courier" : "monospace", top: 5,
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// SHARED STYLES
// ─────────────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root:          { flex: 1, backgroundColor: "#1a1a2e" },
  header:        { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 20, borderBottomWidth: 1, borderBottomColor: "#222", backgroundColor: "#16213e" },
  title:         { color: "#F1C40F", fontSize: 20, fontWeight: "bold" },
  close:         { color: "#E74C3C", fontSize: 22, fontWeight: "bold" },
  body:          { padding: 20, paddingBottom: 40 },
  progress:      { color: "#5DADE2", fontWeight: "bold", marginBottom: 10 },
  promptRow:     { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  instruction:   { color: "#aaa", fontSize: 14, flex: 1 },
  replayBtn:     { color: "#F1C40F", fontWeight: "600", fontSize: 14 },
  translation:   { color: "#F1C40F", fontSize: 18, fontStyle: "italic", marginBottom: 16, lineHeight: 26 },
  hintBox:       { backgroundColor: "#111", borderRadius: 10, padding: 12, marginBottom: 12, borderWidth: 1, borderColor: "#E67E22" },
  hintText:      { color: "#E67E22", fontSize: 15 },
  targetBox:     { backgroundColor: "#111", borderRadius: 10, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: "#333" },
  targetText:    { color: "#fff", fontSize: 16, lineHeight: 22 },
  tabs:          { flexDirection: "row", gap: 10, marginTop: 16, marginBottom: 4 },
  tab:           { flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: "center", backgroundColor: "#0d1b2a", borderWidth: 1, borderColor: "#1a3a5c" },
  tabActive:     { backgroundColor: "#1a4a7a", borderColor: "#2CC985" },
  tabText:       { color: "#888", fontWeight: "600", fontSize: 14 },
  tabTextActive: { color: "#2CC985" },
  btnRow:        { flexDirection: "row", gap: 10, marginTop: 16 },
  hintBtn:       { flex: 1, backgroundColor: "#5d6d7e", borderRadius: 8, paddingVertical: 10, alignItems: "center" },
  hintBtnText:   { color: "#fff", fontWeight: "600" },
  successBox:    { backgroundColor: "#223d1f", padding: 12, borderRadius: 10, marginTop: 12, marginBottom: 16 },
  successText:   { color: "#2ECC71", fontSize: 16, textAlign: "center" },
  doneBox:       { flex: 1, justifyContent: "center", alignItems: "center", padding: 30 },
  doneText:      { color: "#2ECC71", fontSize: 18, textAlign: "center", marginBottom: 30, lineHeight: 28 },
  btnPrimary:    { backgroundColor: "#1a4a7a", paddingVertical: 14, borderRadius: 10, alignItems: "center", paddingHorizontal: 40 },
  btnPrimaryText:{ color: "#fff", fontWeight: "bold", fontSize: 15 },
});
