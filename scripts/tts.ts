// tts.ts
// On-device text-to-speech via expo-speech. Shared by the learning screen and
// its practice modals so the language→locale map lives in one place.

import * as Speech from "expo-speech";
import { Alert } from "react-native";

export const LANG_TO_TTS: Record<string, string> = {
  Chinese: "zh-CN",
  English: "en-US",
  Japanese: "ja-JP",
  Vietnamese: "vi-VN",
  Korean: "ko-KR",
};

export async function speakText(text: string, language: string, rate = 1.0): Promise<void> {
  const langCode = LANG_TO_TTS[language] ?? "en-US";
  try {
    const isSpeaking = await Speech.isSpeakingAsync();
    if (isSpeaking) Speech.stop();
    Speech.speak(text, { language: langCode, rate, pitch: 1.0, volume: 1.0 });
  } catch (err: any) {
    console.warn("TTS error:", err);
    Alert.alert("TTS Error", "Could not play audio.");
  }
}
