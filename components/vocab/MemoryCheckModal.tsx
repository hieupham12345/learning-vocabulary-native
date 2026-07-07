// components/vocab/MemoryCheckModal.tsx
import React, { useEffect, useMemo, useState } from "react";
import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SpeechCheck } from "@/app/SpeechCheck";
import { speakText } from "@/scripts/tts";
import type { ExampleItem } from "@/types/vocab";
import { ColoredInput } from "./ColoredInput";
import { TTSButton } from "./TTSButton";
import { mcStyles, styles } from "./styles";
import { Palette } from "@/constants/palette";

// ── Exercise plumbing ────────────────────────────────────────────────
type Exercise = "translate" | "wordbank" | "fillblank" | "mcq";

const coresOf = (ex: ExampleItem) => (ex.tokens ?? []).map(t => t.trim()).filter(Boolean);

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const sample = (pool: string[], n: number) => shuffle(pool).slice(0, n);

/** Assign one exercise type per card: weighted, no adjacent repeat, with fallbacks. */
function assignExercises(list: ExampleItem[]): Exercise[] {
  const n = list.length;
  const out: Exercise[] = [];
  let prev: Exercise | null = null;
  for (let i = 0; i < n; i++) {
    const hasTokens = coresOf(list[i]).length >= 2;
    const pool: Exercise[] = [];
    const add = (t: Exercise, w: number) => { for (let k = 0; k < w; k++) pool.push(t); };
    add("translate", 2);
    if (hasTokens) { add("wordbank", 3); add("fillblank", 2); }
    if (n >= 4) add("mcq", 2);
    let candidates = pool.filter(t => t !== prev);
    if (candidates.length === 0) candidates = pool;
    const pick = candidates[Math.floor(Math.random() * candidates.length)];
    out.push(pick);
    prev = pick;
  }
  return out;
}

// ── Main modal ───────────────────────────────────────────────────────
export function MemoryCheckModal({
  examples, inputLang, ttsSpeed, onClose,
}: {
  examples: ExampleItem[]; inputLang: string; ttsSpeed: number;
  onClose: () => void;
}) {
  const [shuffled] = useState<ExampleItem[]>(() => shuffle(examples));
  const [plan]     = useState<Exercise[]>(() => assignExercises(shuffled));
  const [idx, setIdx] = useState(0);
  const [done, setDone] = useState(false);

  const current = shuffled[idx];
  const kind    = plan[idx];

  const allCores = useMemo(
    () => Array.from(new Set(shuffled.flatMap(coresOf))),
    [shuffled],
  );
  const allTranslations = useMemo(
    () => Array.from(new Set(shuffled.map(e => e.translation?.trim()).filter(Boolean) as string[])),
    [shuffled],
  );

  useEffect(() => {
    if (!current?.sentence) return;
    const t = setTimeout(() => speakText(current.sentence, inputLang, ttsSpeed), 350);
    return () => clearTimeout(t);
  }, [idx]);

  const advance = () => {
    const next = idx + 1;
    if (next >= shuffled.length) setDone(true);
    else setTimeout(() => setIdx(next), 550);
  };

  const replay = () => speakText(current?.sentence ?? "", inputLang, ttsSpeed);

  // Per-card distractor pools (exclude the current card's own content).
  const cores      = coresOf(current ?? ({} as ExampleItem));
  const rawTokens  = current?.tokens ?? [];
  const otherCores = allCores.filter(c => !cores.includes(c));
  const otherTrans = allTranslations.filter(t => t !== current?.translation?.trim());

  const renderExercise = () => {
    switch (kind) {
      case "wordbank":
        return (
          <WordBankExercise key={idx} cores={cores} translation={current.translation}
            distractors={sample(otherCores, 3)} replay={replay} onCorrect={advance} />
        );
      case "fillblank":
        return (
          <FillBlankExercise key={idx} rawTokens={rawTokens} translation={current.translation}
            otherCores={otherCores} replay={replay} onCorrect={advance} />
        );
      case "mcq":
        return (
          <McqExercise key={idx} sentence={current.sentence} romanization={current.romanization}
            answer={current.translation.trim()} distractors={sample(otherTrans, 3)}
            replay={replay} onCorrect={advance} />
        );
      default:
        return (
          <TranslateExercise key={idx} target={current.sentence.trim()} translation={current.translation}
            inputLang={inputLang} replay={replay} onCorrect={advance} />
        );
    }
  };

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
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
            <View style={ex.progressTrack}>
              <View style={[ex.progressFill, { width: `${((idx + 1) / shuffled.length) * 100}%` }]} />
            </View>
            <Text style={styles.memCheckProgress}>Progress: {idx + 1}/{shuffled.length}</Text>
            {renderExercise()}
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

// ── Translate (typing + speech, the original exercise) ───────────────
function TranslateExercise({
  target, translation, inputLang, replay, onCorrect,
}: {
  target: string; translation: string; inputLang: string;
  replay: () => void; onCorrect: () => void;
}) {
  const [input, setInput] = useState("");
  const [tab, setTab] = useState<"typing" | "speech">("typing");
  const [showHint, setShowHint] = useState(false);
  const [solved, setSolved] = useState(false);

  const handleTypingChange = (text: string) => {
    setInput(text);
    if (!solved && text === target && target.length > 0) { setSolved(true); onCorrect(); }
  };
  const handleSpeechResult = (passed: boolean) => {
    if (passed && !solved) { setSolved(true); setTimeout(onCorrect, 900); }
  };

  return (
    <>
      <View style={ex.instructionRow}>
        <Text style={ex.instruction}>Translate back to the original language:</Text>
        <TTSButton onPress={replay} size={17} label="🔊 Replay" />
      </View>
      <Text style={ex.prompt}>{translation}</Text>
      {showHint && (
        <View style={[styles.typingTargetBox, { borderColor: Palette.hard }]}>
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
        <SpeechCheck target={target} language={inputLang} onResult={handleSpeechResult} threshold={0.8} />
      )}
      <View style={styles.memCheckBtnRow}>
        <TouchableOpacity style={styles.hintBtn} onPressIn={() => setShowHint(true)} onPressOut={() => setShowHint(false)}>
          <Text style={styles.hintBtnText}>💡 Hold for Hint</Text>
        </TouchableOpacity>
      </View>
    </>
  );
}

// ── Word Bank: tap tiles to rebuild the sentence ─────────────────────
function WordBankExercise({
  cores, translation, distractors, replay, onCorrect,
}: {
  cores: string[]; translation: string; distractors: string[];
  replay: () => void; onCorrect: () => void;
}) {
  const tiles = useMemo(
    () => shuffle([
      ...cores.map((core, i) => ({ id: i, core })),
      ...distractors.map((core, i) => ({ id: 1000 + i, core })),
    ]),
    [],
  );
  const [placed, setPlaced] = useState<number[]>([]);
  const [wrong, setWrong] = useState(false);
  const [solved, setSolved] = useState(false);
  const byId = (id: number) => tiles.find(t => t.id === id)!;
  const remaining = tiles.filter(t => !placed.includes(t.id));

  const tap = (id: number) => {
    if (solved) return;
    const next = [...placed, id];
    setPlaced(next);
    setWrong(false);
    if (next.length === cores.length) {
      const ok = next.every((pid, i) => byId(pid).core === cores[i]);
      if (ok) { setSolved(true); onCorrect(); }
      else setWrong(true);
    }
  };
  const unplace = (id: number) => {
    if (solved) return;
    setWrong(false);
    setPlaced(p => p.filter(x => x !== id));
  };

  return (
    <>
      <View style={ex.instructionRow}>
        <Text style={ex.instruction}>Tap the words to build the sentence:</Text>
        <TTSButton onPress={replay} size={17} label="🔊 Replay" />
      </View>
      <Text style={ex.prompt}>{translation}</Text>
      <View style={[ex.builtRow, wrong && ex.builtWrong, solved && ex.builtSolved]}>
        {placed.map(id => (
          <TouchableOpacity key={id} style={[ex.tile, ex.tilePlaced]} onPress={() => unplace(id)}>
            <Text style={ex.tileText}>{byId(id).core}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <View style={ex.bank}>
        {remaining.map(t => (
          <TouchableOpacity key={t.id} style={ex.tile} onPress={() => tap(t.id)}>
            <Text style={ex.tileText}>{t.core}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {wrong && <Text style={[ex.feedback, ex.wrongText]}>❌ Not quite — tap a word to remove it and try again.</Text>}
      {solved && <Text style={[ex.feedback, ex.correctText]}>✅ Correct!</Text>}
    </>
  );
}

// ── Fill in the blank: pick the missing word ─────────────────────────
function FillBlankExercise({
  rawTokens, translation, otherCores, replay, onCorrect,
}: {
  rawTokens: string[]; translation: string; otherCores: string[];
  replay: () => void; onCorrect: () => void;
}) {
  // Blank a content token (longest, to avoid particles/punctuation).
  const blankIdx = useMemo(() => {
    const contentIdx = rawTokens
      .map((raw, i) => ({ i, len: raw.trim().length }))
      .filter(x => x.len > 0);
    if (contentIdx.length === 0) return 0;
    const longest = Math.max(...contentIdx.map(x => x.len));
    const best = contentIdx.filter(x => x.len === longest);
    return best[Math.floor(Math.random() * best.length)].i;
  }, []);
  const answer  = rawTokens[blankIdx]?.trim() ?? "";
  const options = useMemo(() => shuffle([answer, ...sample(otherCores, 3)]), []);
  const [picked, setPicked] = useState<string | null>(null);
  const [solved, setSolved] = useState(false);

  const choose = (opt: string) => {
    if (solved) return;
    setPicked(opt);
    if (opt === answer) { setSolved(true); onCorrect(); }
  };

  return (
    <>
      <View style={ex.instructionRow}>
        <Text style={ex.instruction}>Choose the missing word:</Text>
        <TTSButton onPress={replay} size={17} label="🔊 Replay" />
      </View>
      <Text style={ex.blankSentence}>
        {rawTokens.map((raw, i) =>
          i === blankIdx
            ? <Text key={i} style={ex.blank}>{solved ? raw : " ____ "}</Text>
            : <Text key={i}>{raw}</Text>,
        )}
      </Text>
      <Text style={ex.prompt}>{translation}</Text>
      {options.map((opt, i) => {
        const isWrong = picked === opt && opt !== answer;
        const isRight = solved && opt === answer;
        return (
          <TouchableOpacity key={`${opt}-${i}`} disabled={solved}
            style={[ex.option, isWrong && ex.optionWrong, isRight && ex.optionCorrect]}
            onPress={() => choose(opt)}>
            <Text style={ex.optionText}>{opt}</Text>
          </TouchableOpacity>
        );
      })}
    </>
  );
}

// ── Multiple choice: pick the correct translation ────────────────────
function McqExercise({
  sentence, romanization, answer, distractors, replay, onCorrect,
}: {
  sentence: string; romanization?: string | null; answer: string;
  distractors: string[]; replay: () => void; onCorrect: () => void;
}) {
  const options = useMemo(() => shuffle([answer, ...distractors]), []);
  const [picked, setPicked] = useState<string | null>(null);
  const [solved, setSolved] = useState(false);

  const choose = (opt: string) => {
    if (solved) return;
    setPicked(opt);
    if (opt === answer) { setSolved(true); onCorrect(); }
  };

  return (
    <>
      <View style={ex.instructionRow}>
        <Text style={ex.instruction}>Choose the correct translation:</Text>
        <TTSButton onPress={replay} size={17} label="🔊 Replay" />
      </View>
      <Text style={ex.sentence}>{sentence}</Text>
      {!!romanization && <Text style={ex.roman}>{romanization}</Text>}
      {options.map((opt, i) => {
        const isWrong = picked === opt && opt !== answer;
        const isRight = solved && opt === answer;
        return (
          <TouchableOpacity key={`${opt}-${i}`} disabled={solved}
            style={[ex.option, isWrong && ex.optionWrong, isRight && ex.optionCorrect]}
            onPress={() => choose(opt)}>
            <Text style={ex.optionText}>{opt}</Text>
          </TouchableOpacity>
        );
      })}
    </>
  );
}

const ex = StyleSheet.create({
  progressTrack:  { height: 6, borderRadius: 3, backgroundColor: Palette.panel, marginBottom: 12, overflow: "hidden" },
  progressFill:   { height: 6, borderRadius: 3, backgroundColor: Palette.brand },
  instructionRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  instruction:    { color: Palette.textMuted, fontSize: 14, flex: 1, marginRight: 8 },
  prompt:         { color: Palette.accent, fontSize: 18, fontStyle: "italic", lineHeight: 26, marginBottom: 16 },
  sentence:       { color: Palette.textPrimary, fontSize: 20, lineHeight: 30, marginBottom: 6 },
  roman:          { color: Palette.textFaint, fontSize: 14, fontStyle: "italic", marginBottom: 16 },
  blankSentence:  { color: Palette.textPrimary, fontSize: 20, lineHeight: 32, marginBottom: 16 },
  blank:          { color: Palette.accent, fontWeight: "bold" },
  builtRow:       { minHeight: 54, borderWidth: 1, borderColor: Palette.border, borderRadius: 10, padding: 8, flexDirection: "row", flexWrap: "wrap", gap: 8, backgroundColor: Palette.panel, marginBottom: 16 },
  builtWrong:     { borderColor: Palette.danger },
  builtSolved:    { borderColor: Palette.success },
  bank:           { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tile:           { paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10, backgroundColor: Palette.inputBg, borderWidth: 1, borderColor: Palette.border },
  tilePlaced:     { backgroundColor: Palette.primary },
  tileText:       { color: Palette.textPrimary, fontSize: 16 },
  option:         { paddingVertical: 14, paddingHorizontal: 16, borderRadius: 10, borderWidth: 1, borderColor: Palette.border, backgroundColor: Palette.panel, marginBottom: 10 },
  optionText:     { color: Palette.textPrimary, fontSize: 16, lineHeight: 22 },
  optionWrong:    { borderColor: Palette.danger, backgroundColor: "#3a1a1a" },
  optionCorrect:  { borderColor: Palette.success, backgroundColor: "#12331f" },
  feedback:       { fontSize: 15, fontWeight: "600", marginTop: 12 },
  wrongText:      { color: Palette.danger },
  correctText:    { color: Palette.success },
});
