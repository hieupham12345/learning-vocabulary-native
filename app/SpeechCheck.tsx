/**
 * SpeechCheck.tsx
 * 
 * Drop-in component: a microphone button that records audio, transcribes via
 * OpenAI Whisper (free-tier compatible), then colour-diff the result against
 * the target sentence.
 *
 * Usage:
 *   <SpeechCheck
 *     target="我喜欢学习中文"
 *     language="Chinese"
 *     apiKey={OPENAI_API_KEY}
 *     onResult={(ok) => console.log(ok ? "pass" : "fail")}
 *   />
 *
 * Dependencies already in the project:
 *   expo-av          – Audio recording
 *   (no new deps needed – fetch is built-in)
 *
 * Add to app.json permissions if not already present:
 *   iOS:     NSMicrophoneUsageDescription
 *   Android: RECORD_AUDIO
 */

import React, { useState, useRef, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  Platform,
  Alert,
} from "react-native";
import { Audio } from "expo-av";
import { Palette } from "@/constants/palette";

// ─── Language → Whisper language code ────────────────────────────────────────
const LANG_TO_WHISPER: Record<string, string> = {
  Chinese:    "zh",
  English:    "en",
  Japanese:   "ja",
  Vietnamese: "vi",
  Korean:     "ko",
};

// ─── Fuzzy token comparison ───────────────────────────────────────────────────

/**
 * Normalise a string for comparison:
 * - lowercase
 * - strip punctuation (keep CJK chars, latin letters, digits)
 * - collapse whitespace
 */
function normalise(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Levenshtein distance between two strings.
 */
export function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
  return dp[m][n];
}

/**
 * Character-level similarity ratio [0, 1].
 */
export function charSimilarity(a: string, b: string): number {
  if (a.length === 0 && b.length === 0) return 1;
  const dist = levenshtein(a, b);
  return 1 - dist / Math.max(a.length, b.length);
}

export interface DiffToken {
  text: string;
  /** "correct" | "wrong" | "missing" | "extra" */
  status: "correct" | "wrong" | "missing" | "extra";
}

export interface CompareResult {
  /** Overall similarity 0–1 */
  score: number;
  /** Whether score >= threshold (default 0.8) */
  passed: boolean;
  /** Diff tokens for the TARGET side (what was expected) */
  targetDiff: DiffToken[];
  /** Diff tokens for the TRANSCRIPT side (what was heard) */
  transcriptDiff: DiffToken[];
  /** Raw transcript returned by Whisper */
  transcript: string;
}

/**
 * Token-level comparison.
 *
 * For CJK we split by character; for others we split by whitespace.
 * We use a simple greedy alignment: for each target token we find the
 * best-matching unused transcript token within a window.
 */
export function compareTexts(target: string, transcript: string, threshold = 0.8): CompareResult {
  const isCJK = /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7a3]/.test(target);

  const tokenise = (s: string): string[] =>
    isCJK ? normalise(s).replace(/\s/g, "").split("") : normalise(s).split(" ").filter(Boolean);

  const tTokens = tokenise(target);
  const rTokens = tokenise(transcript);

  // Build edit-distance matrix at token level
  const m = tTokens.length, n = rTokens.length;
  type Cell = { d: number; op: "match" | "ins" | "del" | "sub" };
  const dp: Cell[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j): Cell => ({
      d: i === 0 ? j : j === 0 ? i : 0,
      op: i === 0 ? "ins" : "del",
    }))
  );
  dp[0][0] = { d: 0, op: "match" };

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const tokSim = charSimilarity(tTokens[i - 1], rTokens[j - 1]);
      const cost   = tokSim >= 0.85 ? 0 : 1; // treat near-match as correct
      const opts: Cell[] = [
        { d: dp[i - 1][j - 1].d + cost, op: cost === 0 ? "match" : "sub" },
        { d: dp[i - 1][j].d + 1,        op: "del" },  // target tok missing from transcript
        { d: dp[i][j - 1].d + 1,        op: "ins" },  // extra tok in transcript
      ];
      dp[i][j] = opts.reduce((a, b) => (a.d <= b.d ? a : b));
    }
  }

  // Back-track
  const targetDiff:     DiffToken[] = [];
  const transcriptDiff: DiffToken[] = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    const cell = dp[i][j];
    if (i > 0 && j > 0 && cell.op === "match") {
      targetDiff.unshift(    { text: tTokens[i - 1], status: "correct" });
      transcriptDiff.unshift({ text: rTokens[j - 1], status: "correct" });
      i--; j--;
    } else if (i > 0 && j > 0 && cell.op === "sub") {
      targetDiff.unshift(    { text: tTokens[i - 1], status: "wrong" });
      transcriptDiff.unshift({ text: rTokens[j - 1], status: "wrong" });
      i--; j--;
    } else if (i > 0 && cell.op === "del") {
      targetDiff.unshift({ text: tTokens[i - 1], status: "missing" });
      i--;
    } else {
      transcriptDiff.unshift({ text: rTokens[j - 1], status: "extra" });
      j--;
    }
  }

  const correct = targetDiff.filter(t => t.status === "correct").length;
  const score   = tTokens.length > 0 ? correct / tTokens.length : 1;

  return { score, passed: score >= threshold, targetDiff, transcriptDiff, transcript };
}

// ─── Whisper transcription ────────────────────────────────────────────────────

async function transcribeWhisper(
  uri: string,
  language: string,
  apiKey: string
): Promise<string> {
  const whisperLang = LANG_TO_WHISPER[language] ?? "zh";

  // Read audio file as blob
  const response = await fetch(uri);
  const blob     = await response.blob();

  const form = new FormData();
  // expo-av records as m4a on iOS, webm/ogg on Android
  const ext      = Platform.OS === "ios" ? "m4a" : "webm";
  const mimeType = Platform.OS === "ios" ? "audio/m4a" : "audio/webm";
  form.append("file",     { uri, name: `audio.${ext}`, type: mimeType } as any);
  form.append("model",    "whisper-1");
  form.append("language", whisperLang);

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Whisper API ${res.status}: ${err}`);
  }

  const data = await res.json();
  return (data.text ?? "").trim();
}

// ─── DiffView ─────────────────────────────────────────────────────────────────

export function DiffView({ result }: { result: CompareResult }) {
  const pct = Math.round(result.score * 100);
  const color = result.passed ? Palette.success : result.score >= 0.6 ? Palette.accent : Palette.danger;

  const STATUS_COLORS: Record<DiffToken["status"], string> = {
    correct: Palette.success,
    wrong:   Palette.danger,
    missing: Palette.danger,
    extra:   Palette.hard,
  };

  return (
    <View style={dv.root}>
      {/* Score badge */}
      <View style={[dv.scoreBadge, { borderColor: color }]}>
        <Text style={[dv.scoreNum, { color }]}>{pct}%</Text>
        <Text style={[dv.scoreLabel, { color }]}>
          {result.passed ? "✅ PASS" : "❌ FAIL"}
        </Text>
      </View>

      {/* What you said */}
      <Text style={dv.sectionLabel}>🎙 What you said:</Text>
      <View style={dv.diffRow}>
        {result.transcriptDiff.map((tok, i) => (
          <Text
            key={i}
            style={[dv.tok, { color: STATUS_COLORS[tok.status] ?? Palette.textPrimary }]}
          >
            {tok.text}
            {tok.status === "extra"   ? " ✗" : ""}
          </Text>
        ))}
        {result.transcriptDiff.length === 0 && (
          <Text style={dv.empty}>(nothing detected)</Text>
        )}
      </View>

      {/* Expected */}
      <Text style={dv.sectionLabel}>📋 Expected:</Text>
      <View style={dv.diffRow}>
        {result.targetDiff.map((tok, i) => (
          <Text
            key={i}
            style={[dv.tok, { color: STATUS_COLORS[tok.status] ?? Palette.textPrimary }]}
          >
            {tok.text}
            {tok.status === "missing" ? " ✗" : ""}
          </Text>
        ))}
      </View>

      {/* Legend */}
      <View style={dv.legend}>
        {[
          { color: Palette.success, label: "Correct" },
          { color: Palette.danger, label: "Wrong / Missing" },
          { color: Palette.hard, label: "Extra" },
        ].map(({ color: c, label }) => (
          <View key={label} style={dv.legendItem}>
            <View style={[dv.dot, { backgroundColor: c }]} />
            <Text style={dv.legendText}>{label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const dv = StyleSheet.create({
  root:         { backgroundColor: Palette.panel, borderRadius: 12, padding: 14, marginTop: 10, borderWidth: 1, borderColor: Palette.border },
  scoreBadge:   { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, borderWidth: 2, borderRadius: 10, paddingVertical: 8, marginBottom: 12 },
  scoreNum:     { fontSize: 26, fontWeight: "bold" },
  scoreLabel:   { fontSize: 16, fontWeight: "bold" },
  sectionLabel: { color: Palette.info, fontWeight: "bold", fontSize: 12, marginBottom: 4, marginTop: 6 },
  diffRow:      { flexDirection: "row", flexWrap: "wrap", gap: 4, marginBottom: 6 },
  tok:          { fontSize: 16, fontWeight: "600", lineHeight: 24 },
  empty:        { color: Palette.textDim, fontStyle: "italic", fontSize: 14 },
  legend:       { flexDirection: "row", gap: 14, marginTop: 8, flexWrap: "wrap" },
  legendItem:   { flexDirection: "row", alignItems: "center", gap: 4 },
  dot:          { width: 8, height: 8, borderRadius: 4 },
  legendText:   { color: Palette.textFaint, fontSize: 11 },
});

// ─── SpeechCheck Component ────────────────────────────────────────────────────

interface SpeechCheckProps {
  target: string;
  language: string;
  apiKey: string;
  /** Called with true/false once a result is obtained */
  onResult?: (passed: boolean, result: CompareResult) => void;
  /** 0–1, default 0.8 */
  threshold?: number;
}

type RecordState = "idle" | "recording" | "processing" | "done" | "error";

export function SpeechCheck({
  target,
  language,
  apiKey,
  onResult,
  threshold = 0.8,
}: SpeechCheckProps) {
  const [state,      setState]      = useState<RecordState>("idle");
  const [result,     setResult]     = useState<CompareResult | null>(null);
  const [errorMsg,   setErrorMsg]   = useState("");
  const recordingRef = useRef<Audio.Recording | null>(null);

  const startRecording = useCallback(async () => {
    try {
      setResult(null);
      setErrorMsg("");

      const { granted } = await Audio.requestPermissionsAsync();
      if (!granted) {
        Alert.alert("Permission required", "Microphone permission is needed to use Speech Check.");
        return;
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );
      recordingRef.current = recording;
      setState("recording");
    } catch (e: any) {
      setErrorMsg(e.message ?? "Could not start recording.");
      setState("error");
    }
  }, []);

  const stopAndTranscribe = useCallback(async () => {
    const rec = recordingRef.current;
    if (!rec) return;

    setState("processing");
    try {
      await rec.stopAndUnloadAsync();
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
      const uri = rec.getURI();
      recordingRef.current = null;

      if (!uri) throw new Error("No audio URI returned.");
      if (!apiKey) throw new Error("No API key configured for speech transcription.");

      const transcript = await transcribeWhisper(uri, language, apiKey);
      const cmp        = compareTexts(target, transcript, threshold);
      setResult(cmp);
      setState("done");
      onResult?.(cmp.passed, cmp);
    } catch (e: any) {
      setErrorMsg(e.message ?? "Transcription failed.");
      setState("error");
      recordingRef.current = null;
    }
  }, [target, language, apiKey, threshold, onResult]);

  const reset = () => { setState("idle"); setResult(null); setErrorMsg(""); };

  return (
    <View style={sc2.root}>
      <View style={sc2.row}>
        {/* Mic button */}
        {state === "idle" && (
          <TouchableOpacity style={sc2.micBtn} onPress={startRecording}>
            <Text style={sc2.micIcon}>🎙</Text>
            <Text style={sc2.micLabel}>Start Speaking</Text>
          </TouchableOpacity>
        )}

        {state === "recording" && (
          <TouchableOpacity style={[sc2.micBtn, sc2.micBtnRecording]} onPress={stopAndTranscribe}>
            <RecordingPulse />
            <Text style={sc2.micLabel}>Stop Recording</Text>
          </TouchableOpacity>
        )}

        {state === "processing" && (
          <View style={[sc2.micBtn, sc2.micBtnProcessing]}>
            <ActivityIndicator color={Palette.accent} size="small" />
            <Text style={[sc2.micLabel, { color: Palette.accent }]}>Transcribing…</Text>
          </View>
        )}

        {(state === "done" || state === "error") && (
          <TouchableOpacity style={[sc2.micBtn, sc2.micBtnReset]} onPress={reset}>
            <Text style={sc2.micIcon}>🔄</Text>
            <Text style={sc2.micLabel}>Try Again</Text>
          </TouchableOpacity>
        )}
      </View>

      {state === "error" && (
        <Text style={sc2.errText}>⚠ {errorMsg}</Text>
      )}

      {result && <DiffView result={result} />}
    </View>
  );
}

function RecordingPulse() {
  // Simple animated dot using repeated re-render trick
  const [frame, setFrame] = useState(0);
  React.useEffect(() => {
    const id = setInterval(() => setFrame(f => (f + 1) % 3), 500);
    return () => clearInterval(id);
  }, []);
  const dots = ["●", "●●", "●●●"][frame];
  return <Text style={{ color: Palette.danger, fontSize: 20, letterSpacing: 2 }}>{dots}</Text>;
}

const sc2 = StyleSheet.create({
  root:              { marginTop: 10 },
  row:               { flexDirection: "row", justifyContent: "center" },
  micBtn:            { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: Palette.inputBg, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 20, borderWidth: 1, borderColor: Palette.primary },
  micBtnRecording:   { backgroundColor: "#2d0a0a", borderColor: Palette.danger },
  micBtnProcessing:  { backgroundColor: "#1a1a00", borderColor: Palette.accent },
  micBtnReset:       { backgroundColor: "#112244", borderColor: Palette.info },
  micIcon:           { fontSize: 20 },
  micLabel:          { color: Palette.textPrimary, fontWeight: "600", fontSize: 14 },
  errText:           { color: Palette.danger, fontSize: 12, marginTop: 8, textAlign: "center" },
});
