// components/vocab/MemoryCheckModal.tsx
import React, { useEffect, useState } from "react";
import { Modal, ScrollView, Text, TouchableOpacity, View } from "react-native";
import { SpeechCheck } from "@/app/SpeechCheck";
import { speakText } from "@/scripts/tts";
import type { ExampleItem } from "@/types/vocab";
import { ColoredInput } from "./ColoredInput";
import { TTSButton } from "./TTSButton";
import { mcStyles, styles } from "./styles";
import { Palette } from "@/constants/palette";

export function MemoryCheckModal({
  examples, inputLang, ttsSpeed, onClose, apiKey = "",
}: {
  examples: ExampleItem[]; inputLang: string; ttsSpeed: number;
  onClose: () => void; apiKey?: string;
}) {
  const [shuffled]        = useState<ExampleItem[]>(() => [...examples].sort(() => Math.random() - 0.5));
  const [idx, setIdx]     = useState(0);
  const [input, setInput] = useState("");
  const [showHint, setShowHint] = useState(false);
  const [done, setDone]   = useState(false);
  const [tab, setTab]     = useState<"typing" | "speech">("typing");
  const [speechKey, setSpeechKey] = useState(0);

  const current = shuffled[idx];
  const target  = current?.sentence?.trim() ?? "";

  useEffect(() => {
    if (!current?.sentence) return;
    const t = setTimeout(() => speakText(current.sentence, inputLang, ttsSpeed), 350);
    return () => clearTimeout(t);
  }, [idx]);

  useEffect(() => { setInput(""); setShowHint(false); setSpeechKey(k => k + 1); }, [idx]);

  const advance = () => {
    const next = idx + 1;
    if (next >= shuffled.length) setDone(true);
    else setTimeout(() => setIdx(next), 500);
  };

  const handleTypingChange = (text: string) => {
    setInput(text);
    if (text === target && target.length > 0) advance();
  };

  const handleSpeechResult = (passed: boolean) => {
    if (passed) setTimeout(() => advance(), 1200);
  };

  return (
    <Modal visible animationType="slide">
      <View style={styles.memCheckRoot}>
        <View style={styles.memCheckHeader}>
          <Text style={styles.memCheckTitle}>🧠 Memory Check</Text>
          <TouchableOpacity onPress={onClose}><Text style={styles.memCheckClose}>✕</Text></TouchableOpacity>
        </View>
        {done ? (
          <View style={styles.memCheckDone}>
            <Text style={styles.memCheckDoneText}>🎉 Amazing! You&apos;ve recalled all examples!</Text>
            <TouchableOpacity style={[styles.btnPrimary, { flex: 0, paddingHorizontal: 40 }]} onPress={onClose}>
              <Text style={styles.btnPrimaryText}>Close</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.memCheckBody}>
            <Text style={styles.memCheckProgress}>Progress: {idx + 1}/{shuffled.length}</Text>
            <View style={styles.memCheckTtsRow}>
              <Text style={styles.memCheckInstruction}>Translate back to the original language:</Text>
              <TTSButton onPress={() => speakText(current?.sentence ?? "", inputLang, ttsSpeed)} size={17} label="🔊 Replay" />
            </View>
            <Text style={styles.memCheckTranslation}>{current?.translation}</Text>
            {showHint && (
              <View style={[styles.typingTargetBox, { marginBottom: 12, borderColor: Palette.hard }]}>
                <Text style={[styles.typingTargetText, { color: Palette.hard }]}>{target}</Text>
              </View>
            )}
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
            <View style={styles.memCheckBtnRow}>
              <TouchableOpacity style={styles.hintBtn} onPressIn={() => setShowHint(true)} onPressOut={() => setShowHint(false)}>
                <Text style={styles.hintBtnText}>💡 Hold for Hint</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}
