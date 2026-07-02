// components/vocab/OverviewRow.tsx
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Palette } from "@/constants/palette";

export function OverviewRow({ icon, label, value }: { icon: string; label: string; value: string }) {
  if (!value || value === "N/A") return null;
  return (
    <View style={styles.overviewRow}>
      <Text style={styles.overviewKey}>{icon} {label}: </Text>
      <Text style={styles.overviewValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  overviewRow: { flexDirection: "row", flexWrap: "wrap", marginBottom: 6 },
  overviewKey: { color: Palette.info, fontWeight: "bold", fontSize: 13 },
  overviewValue: { color: "#E0E0E0", fontSize: 13, flex: 1, flexWrap: "wrap" },
});
