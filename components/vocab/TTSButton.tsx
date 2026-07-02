// components/vocab/TTSButton.tsx
import React from "react";
import { StyleSheet, Text, TouchableOpacity } from "react-native";
import { Palette } from "@/constants/palette";

export function TTSButton({ onPress, size = 20, label }: { onPress: () => void; size?: number; label?: string }) {
  return (
    <TouchableOpacity style={styles.ttsBtn} onPress={onPress}>
      <Text style={[styles.ttsBtnText, { fontSize: size }]}>{label ?? "🔊"}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  ttsBtn: { padding: 6, borderRadius: 8 },
  ttsBtnText: { color: Palette.accent },
});
