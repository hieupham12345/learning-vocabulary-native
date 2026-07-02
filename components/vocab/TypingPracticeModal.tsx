// components/vocab/TypingPracticeModal.tsx
import React, { useEffect, useState } from "react";
import { Modal, ScrollView, Text, TouchableOpacity, View } from "react-native";
import { SpeechCheck } from "@/app/SpeechCheck";
import { speakText } from "@/scripts/tts";
import type { ExampleItem } from "@/types/vocab";
import { ColoredInput } from "./ColoredInput";
import { TTSButton } from "./TTSButton";
import { mcStyles, styles } from "./styles";

export function TypingPracticeModal({
  example, currentScore, onClose, onCorrect, inputLang, ttsSpeed, apiKey = "",
}: {
  example: ExampleItem | null; currentScore: number;
  onClose: () => void; onCorrect: () => void;
  inputLang: string; ttsSpeed: number; apiKey?: string;
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

  const handleTypingChange = (text: string) => {
    setInput(text);
    if (text === target && target.length > 0) {
      onCorrect();
      setCompleted(true);
      setTimeout(() => { setInput(""); setCompleted(false); setSpeechKey(k => k + 1); }, 700);
    }
  };

  const handleSpeechResult = (passed: boolean) => {
    if (passed) {
      onCorrect();
      setCompleted(true);
      setTimeout(() => { setCompleted(false); setSpeechKey(k => k + 1); }, 1500);
    }
  };

  return (
    <Modal visible animationType="slide">
      <View style={styles.typingRoot}>
        <View style={styles.typingHeader}>
          <Text style={styles.typingTitle}>⌨️ Typing Practice</Text>
          <TouchableOpacity onPress={onClose}><Text style={styles.memCheckClose}>✕</Text></TouchableOpacity>
        </View>
        <ScrollView contentContainerStyle={styles.typingBody}>
          <Text style={styles.typingProgress}>Score: {currentScore}</Text>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <Text style={styles.typingPrompt}>Type the sentence exactly:</Text>
            <TTSButton onPress={() => speakText(target, inputLang, ttsSpeed)} size={17} label="🔊 Replay" />
          </View>
          <View style={styles.typingTargetBox}>
            <Text style={styles.typingTargetText}>{target || "No example available"}</Text>
          </View>
          <View style={mcStyles.tabs}>
            <TouchableOpacity style={[mcStyles.tab, tab === "typing" && mcStyles.tabActive]} onPress={() => setTab("typing")}>
              <Text style={[mcStyles.tabText, tab === "typing" && mcStyles.tabTextActive]}>⌨️ Typing</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[mcStyles.tab, tab === "speech" && mcStyles.tabActive]} onPress={() => setTab("speech")}>
              <Text style={[mcStyles.tabText, tab === "speech" && mcStyles.tabTextActive]}>🎙 Speech</Text>
            </TouchableOpacity>
          </View>
          {tab === "typing" ? (
            <ColoredInput input={input} target={target} placeholder="Type here..." onChangeText={handleTypingChange} autoFocus />
          ) : (
            <SpeechCheck key={speechKey} target={target} language={inputLang} apiKey={apiKey} onResult={handleSpeechResult} threshold={0.8} />
          )}
          {completed && (
            <View style={styles.typingSuccessBox}>
              <Text style={styles.typingSuccessText}>
                {tab === "speech" ? "✅ Great pronunciation!" : "✅ Correct! Keep going."}
              </Text>
            </View>
          )}
          <TouchableOpacity style={[styles.btnPrimary, { marginTop: 16 }]} onPress={onClose}>
            <Text style={styles.btnPrimaryText}>Close Practice</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    </Modal>
  );
}
