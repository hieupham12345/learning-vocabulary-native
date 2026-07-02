// components/vocab/SpeedControl.tsx
import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Palette } from "@/constants/palette";

export const SPEED_MIN = 1.0;
export const SPEED_MAX = 2.0;
export const SPEED_STEP = 0.1;

export function SpeedControl({ speed, onSpeedChange }: { speed: number; onSpeedChange: (v: number) => void }) {
  const dec = () => { const n = Math.round((speed - SPEED_STEP) * 10) / 10; if (n >= SPEED_MIN) onSpeedChange(n); };
  const inc = () => { const n = Math.round((speed + SPEED_STEP) * 10) / 10; if (n <= SPEED_MAX) onSpeedChange(n); };
  return (
    <View style={sc.row}>
      <Text style={sc.icon}>🐢</Text>
      <TouchableOpacity style={[sc.btn, speed <= SPEED_MIN && sc.disabled]} onPress={dec} disabled={speed <= SPEED_MIN}>
        <Text style={sc.btnText}>−</Text>
      </TouchableOpacity>
      <Text style={sc.value}>{speed.toFixed(1)}x</Text>
      <TouchableOpacity style={[sc.btn, speed >= SPEED_MAX && sc.disabled]} onPress={inc} disabled={speed >= SPEED_MAX}>
        <Text style={sc.btnText}>+</Text>
      </TouchableOpacity>
      <Text style={sc.icon}>🐇</Text>
    </View>
  );
}

const sc = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, backgroundColor: Palette.panel, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 14, marginBottom: 10 },
  icon: { fontSize: 18 },
  btn: { backgroundColor: Palette.primary, borderRadius: 6, paddingHorizontal: 14, paddingVertical: 4 },
  disabled: { opacity: 0.3 },
  btnText: { color: Palette.textPrimary, fontSize: 20, fontWeight: "bold" },
  value: { color: Palette.brand, fontWeight: "bold", fontSize: 17, minWidth: 48, textAlign: "center" },
});
