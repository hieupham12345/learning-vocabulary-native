// components/vocab/ColoredInput.tsx
// Transparent TextInput with a colored overlay: each typed char turns green if
// it matches the target at that position, red otherwise. Used by the typing
// practice / memory-check flows.
import React from "react";
import { Platform, StyleSheet, Text, TextInput, View } from "react-native";
import { Palette } from "@/constants/palette";

export function ColoredInput({ input, target, placeholder, onChangeText, autoFocus = false }: {
  input: string; target: string; placeholder?: string;
  onChangeText: (t: string) => void; autoFocus?: boolean;
}) {
  return (
    <View style={overlayStyle.wrapper}>
      <TextInput
        style={overlayStyle.input}
        value={input}
        onChangeText={onChangeText}
        placeholder={placeholder ?? "Type here..."}
        placeholderTextColor={Palette.textDim}
        multiline
        autoCapitalize="none"
        autoCorrect={false}
        autoFocus={autoFocus}
      />
      {input.length > 0 && (
        <Text style={overlayStyle.text} pointerEvents="none">
          {input.split("").map((char, i) => (
            <Text key={i} style={{ color: i < target.length && char === target[i] ? Palette.success : Palette.danger }}>{char}</Text>
          ))}
        </Text>
      )}
    </View>
  );
}

const overlayStyle = StyleSheet.create({
  wrapper: { backgroundColor: "#111", borderRadius: 10, borderWidth: 1, borderColor: "#333", justifyContent: "center", marginTop: 12, position: "relative" },
  text: {
    position: "absolute", top: 5, left: 0, right: 0, bottom: 0,
    fontSize: 16, lineHeight: 22,
    paddingTop: Platform.OS === "android" ? 12 : 14,
    paddingHorizontal: 14,
    zIndex: 2, flexWrap: "wrap",
    fontFamily: Platform.OS === "ios" ? "Courier" : "monospace",
  },
  input: {
    fontSize: 16, lineHeight: 22,
    padding: 14,
    paddingTop: Platform.OS === "android" ? 12 : 14,
    color: "transparent",
    minHeight: 60,
    textAlignVertical: "top",
    fontFamily: Platform.OS === "ios" ? "Courier" : "monospace",
    top: 5,
  },
});
