/**
 * StreakPill.tsx
 * Pill gọn hiển thị 🔥 streak + tiến độ mục tiêu hôm nay. Bấm → tab Stats.
 */

import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { useProgress } from "../../scripts/useProgress";
import { Palette } from "@/constants/palette";

export function StreakPill() {
  const router = useRouter();
  const { progress } = useProgress();

  return (
    <TouchableOpacity
      style={s.pill}
      activeOpacity={0.8}
      onPress={() => router.push("/(tabs)/stats")}
    >
      <View style={s.group}>
        <Text style={s.flame}>🔥</Text>
        <Text style={s.streak}>{progress.streak}</Text>
      </View>
      <View style={s.divider} />
      <Text style={[s.goal, progress.goalMetToday && { color: Palette.success }]}>
        {progress.todayCount}/{progress.goal}
        {progress.goalMetToday ? " ✅" : ""}
      </Text>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  pill: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "center",
    backgroundColor: Palette.card,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 6,
    marginTop: 8,
    gap: 10,
    borderWidth: 1,
    borderColor: Palette.border,
  },
  group: { flexDirection: "row", alignItems: "center", gap: 4 },
  flame: { fontSize: 16 },
  streak: { color: Palette.hard, fontWeight: "bold", fontSize: 15 },
  divider: { width: 1, height: 16, backgroundColor: Palette.border },
  goal: { color: Palette.brand, fontWeight: "600", fontSize: 13 },
});
