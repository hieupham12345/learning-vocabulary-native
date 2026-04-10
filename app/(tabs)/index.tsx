import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Modal,
  ActivityIndicator,
  StyleSheet,
  Alert,
  Platform,
  KeyboardAvoidingView,
  Pressable,
  Dimensions,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { VocabularyLearner } from "../../scripts/VocabularyLearner";
import * as Speech from 'expo-speech';
import { useFocusEffect } from 'expo-router';
import { localDict } from "@/scripts/LocalDictionary";
import { database } from "@/scripts/VocabularyDB";

// ─────────────────────────────────────────────
// TTS LANGUAGE MAP
// ─────────────────────────────────────────────
const LANG_TO_TTS: Record<string, string> = {
  Chinese:    "zh-CN",
  English:    "en-US",
  Japanese:   "ja-JP",
  Vietnamese: "vi-VN",
  Korean:     "ko-KR",
};

async function speakText(text: string, language: string, rate: number = 1.0): Promise<void> {
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

// ─────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────
interface ExampleItem {
  sentence: string;
  romanization?: string | null;
  translation: string;
  explanation: string;
  grammar_points: string[];
  difficulty_justification: string;
  difficulty_tag: string;
  tokens?: string[];
}

interface VocabOverview {
  meaning: string;
  romanization?: string | null;
  part_of_speech: string;
  register: string;
  usage: string;
  notes: string;
  collocations: string[];
}

interface VocabData {
  word: string;
  language: { input: string; output: string };
  overview: VocabOverview;
  examples: {
    easy?: ExampleItem[];
    medium?: ExampleItem[];
    hard?: ExampleItem[];
    super_hard?: ExampleItem[];
  };
  translation_cache?: Record<string, string>;
}

interface HistoryEntry {
  word: string;
  input_lang: string;
  output_lang: string;
  timestamp: string;
  data: VocabData;
}

interface QuizQuestion {
  difficulty: string;
  dimension: string;
  question: string;
  options: string[];
  answer: string;
  explanation: string;
}

interface QuizData {
  words: string[];
  quiz: QuizQuestion[];
}

interface QuizHistoryEntry {
  words: string[];
  score: number;
  total: number;
  timestamp: string;
  quiz_data: QuizData;
  user_answers: string[];
}

// ─────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────
const LANGUAGE_OPTIONS = ["Chinese", "English", "Japanese", "Vietnamese", "Korean"];
const DIFFICULTY_COLORS: Record<string, string> = {
  Easy:         "#2ECC71",
  Medium:       "#F1C40F",
  Hard:         "#E67E22",
  "Super Hard": "#E74C3C",
};
const HISTORY_KEY        = "@vocab_history";
const QUIZ_HISTORY_KEY   = "@quiz_history";
const CURRENT_WORD_KEY   = "@current_word_data";
const CURRENT_REVIEW_KEY = "@current_quiz_review";
const CURRENT_RETAKE_KEY = "@current_quiz_retake";
const SPEED_KEY          = "@tts_speed";

const PENDING_LESSON_WORD_KEY = "@pending_lesson_word";
const LAST_LEARNED_KEY        = "@last_learned_word";

const LESSON_NAVIGATION_KEY = "@lesson_navigation_context";

const SPEED_MIN  = 1.0;
const SPEED_MAX  = 2.0;
const SPEED_STEP = 0.1;

const learner = new VocabularyLearner();

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

/**
 * Flatten VocabData examples thành mảng phẳng ExampleItem[],
 * gán difficulty_tag đúng theo bucket.
 */
const prepareExamples = (data: VocabData): ExampleItem[] => {
  const order = ["easy", "medium", "hard", "super_hard"] as const;
  const result: ExampleItem[] = [];
  for (const diff of order) {
    (data.examples[diff] ?? []).forEach((ex) => {
      result.push({
        ...ex,
        difficulty_tag: diff.replace("_", " ").replace(/\b\w/g, (c) => c.toUpperCase()),
        tokens: ex.tokens ?? undefined,
      });
    });
  }
  return result;
};

/**
 * Tính lại vị trí (bucketName, indexInBucket) từ flatIndex.
 * Dùng khi cần patch token vào VocabData.examples.
 */
const flatIndexToBucketPos = (
  examples: VocabData["examples"],
  flatIndex: number
): { diff: "easy" | "medium" | "hard" | "super_hard"; j: number } | null => {
  const order = ["easy", "medium", "hard", "super_hard"] as const;
  let count = 0;
  for (const diff of order) {
    const bucket = examples[diff] ?? [];
    if (flatIndex < count + bucket.length) {
      return { diff, j: flatIndex - count };
    }
    count += bucket.length;
  }
  return null;
};

/**
 * Lưu history + đồng bộ LAST_LEARNED_KEY.
 * Tất cả nơi save history đều gọi hàm này để đảm bảo nhất quán.
 */
const saveHistoryEntry = async (entry: HistoryEntry): Promise<void> => {
  const raw = await AsyncStorage.getItem(HISTORY_KEY);
  const arr: HistoryEntry[] = raw ? JSON.parse(raw) : [];
  // Upsert: nếu đã có cùng word + lang thì replace, không thêm duplicate
  const existingIdx = arr.findIndex(
    (e) => e.word === entry.word && e.input_lang === entry.input_lang
  );
  let updated: HistoryEntry[];
  if (existingIdx !== -1) {
    updated = [entry, ...arr.filter((_, i) => i !== existingIdx)].slice(0, 50);
  } else {
    updated = [entry, ...arr].slice(0, 50);
  }
  await Promise.all([
    AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(updated)),
    AsyncStorage.setItem(LAST_LEARNED_KEY, JSON.stringify(entry)),
  ]);
};

// ─────────────────────────────────────────────
// SPEED CONTROL COMPONENT
// ─────────────────────────────────────────────
function SpeedControl({
  speed,
  onSpeedChange,
}: {
  speed: number;
  onSpeedChange: (v: number) => void;
}) {
  const dec = () => {
    const next = Math.round((speed - SPEED_STEP) * 10) / 10;
    if (next >= SPEED_MIN) onSpeedChange(next);
  };
  const inc = () => {
    const next = Math.round((speed + SPEED_STEP) * 10) / 10;
    if (next <= SPEED_MAX) onSpeedChange(next);
  };

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
  row: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 10, backgroundColor: "#0d1b2a", borderRadius: 10,
    paddingVertical: 8, paddingHorizontal: 14, marginBottom: 10,
  },
  icon: { fontSize: 18 },
  btn: {
    backgroundColor: "#1a4a7a", borderRadius: 6,
    paddingHorizontal: 14, paddingVertical: 4,
  },
  disabled: { opacity: 0.3 },
  btnText: { color: "#fff", fontSize: 20, fontWeight: "bold" },
  value: {
    color: "#2CC985", fontWeight: "bold", fontSize: 17,
    minWidth: 48, textAlign: "center",
  },
});

// ─────────────────────────────────────────────
// TTS BUTTON — reusable
// ─────────────────────────────────────────────
function TTSButton({
  onPress,
  size = 20,
  label,
}: {
  onPress: () => void;
  size?: number;
  label?: string;
}) {
  return (
    <TouchableOpacity style={styles.ttsBtn} onPress={onPress}>
      <Text style={[styles.ttsBtnText, { fontSize: size }]}>{label ?? "🔊"}</Text>
    </TouchableOpacity>
  );
}

// ─────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────
export default function VocabularyLearnerUI() {
  // ── Input ──
  const [word, setWord]             = useState("");
  const [inputLang, setInputLang]   = useState("Chinese");
  const [outputLang, setOutputLang] = useState("Vietnamese");
  const [genMode, setGenMode]       = useState<"easy" | "hard">("easy");

  // ── TTS Speed ──
  const [ttsSpeed, setTtsSpeed] = useState(1.5);

  // ── Learning ──
  const [currentData, setCurrentData]                 = useState<VocabData | null>(null);
  const [allExamples, setAllExamples]                 = useState<ExampleItem[]>([]);
  const [exampleIndex, setExampleIndex]               = useState(0);
  const [romanizationVisible, setRomanizationVisible] = useState(false);
  const [practiceSuccess, setPracticeSuccess]         = useState(0);
  const [practiceModalVisible, setPracticeModalVisible] = useState(false);
  const [loading, setLoading]                         = useState(false);
  const [quizLoading, setQuizLoading]                 = useState(false);
  const [status, setStatus]                           = useState("Ready to learn!");

  // ── Tokenization status per exampleIndex ──
  const [tokenizeStatus, setTokenizeStatus] = useState<Record<number, "loading" | "done" | "error">>({});

  // ── Modals ──
  const [langPickerVisible, setLangPickerVisible]   = useState(false);
  const [langPickerTarget, setLangPickerTarget]     = useState<"input" | "output">("input");
  const [memoryCheckVisible, setMemoryCheckVisible] = useState(false);
  const [quizSetupVisible, setQuizSetupVisible]     = useState(false);
  const [quizWindowData, setQuizWindowData]         = useState<{
    data: QuizData; words: string[]; mode: "take" | "review"; pastAnswers?: string[];
  } | null>(null);
  const [translationPopup, setTranslationPopup] = useState<{ text: string; translation: string } | null>(null);

  // ── Quiz setup ──
  const [quizWordCount, setQuizWordCount]         = useState(5);
  const [quizQuestionCount, setQuizQuestionCount] = useState(5);

  const [lessonNav, setLessonNav] = useState<{
    words: Array<{ id: number; word: string; language: string; level: string }>;
    currentIndex: number;
    language: string;
    level: string;
  } | null>(null);

  const [historyCount, setHistoryCount] = useState(0);
  // Ref để track synchronous xem đã có currentData chưa
  // (tránh stale closure trong useFocusEffect)
  const hasDataRef = useRef(false);

  // Sync hasDataRef mỗi khi currentData thay đổi
  useEffect(() => {
    hasDataRef.current = currentData !== null;
  }, [currentData]);


  // ─────────────────────────────────────────────
  // INIT — load TTS speed
  // ─────────────────────────────────────────────
  useEffect(() => {
    AsyncStorage.getItem(SPEED_KEY).then((val) => {
      if (val) {
        const n = parseFloat(val);
        if (!isNaN(n)) setTtsSpeed(n);
      }
    });
  }, []);

  useFocusEffect(
    useCallback(() => {
      const loadPendingActions = async () => {
        try {
          const [wordData, reviewData, retakeData, pendingWordRaw, lastLearnedRaw, lessonNavRaw] =
            await Promise.all([
              AsyncStorage.getItem(CURRENT_WORD_KEY),
              AsyncStorage.getItem(CURRENT_REVIEW_KEY),
              AsyncStorage.getItem(CURRENT_RETAKE_KEY),
              AsyncStorage.getItem(PENDING_LESSON_WORD_KEY),
              AsyncStorage.getItem(LAST_LEARNED_KEY),
              AsyncStorage.getItem(LESSON_NAVIGATION_KEY),
            ]);

          if (lessonNavRaw) setLessonNav(JSON.parse(lessonNavRaw));

          if (reviewData) {
            const entry: QuizHistoryEntry = JSON.parse(reviewData);
            setQuizWindowData({ data: entry.quiz_data, words: entry.words, mode: "review", pastAnswers: entry.user_answers });
            await AsyncStorage.removeItem(CURRENT_REVIEW_KEY);
            return;
          }

          if (retakeData) {
            const entry: QuizHistoryEntry = JSON.parse(retakeData);
            setQuizWindowData({ data: entry.quiz_data, words: entry.words, mode: "take" });
            await AsyncStorage.removeItem(CURRENT_RETAKE_KEY);
            return;
          }

          if (pendingWordRaw) {
            await AsyncStorage.removeItem(PENDING_LESSON_WORD_KEY);
            const pending = JSON.parse(pendingWordRaw) as {
              word: string; id: number; language: string; level: string;
            };
            setWord(pending.word);
            setInputLang(pending.language);

            const raw = await AsyncStorage.getItem(HISTORY_KEY);
            const arr: HistoryEntry[] = raw ? JSON.parse(raw) : [];
            const cached = arr.find(
              (e) => e.word === pending.word && e.input_lang === pending.language
            );

            if (cached) {
              const examples = prepareExamples(cached.data);
              setCurrentData(cached.data);
              setAllExamples(examples);
              setExampleIndex(0);
              setTokenizeStatus({});
              setRomanizationVisible(false);
              setPracticeSuccess(0);
              setOutputLang(cached.output_lang);
              setStatus(`⚡ Loaded '${pending.word}' from history cache`);
              if (pending.id) { await database.initDB(); await database.setLearned(pending.id, true); }
            } else {
              setStatus(`🔄 Auto-learning '${pending.word}' from Lessons...`);
              setLoading(true);
              try {
                const data = await learner.learnWord(pending.word, pending.language, outputLang, genMode);
                if (!data.error) {
                  const examples = prepareExamples(data);
                  setCurrentData(data);
                  setAllExamples(examples);
                  setExampleIndex(0);
                  setTokenizeStatus({});
                  setRomanizationVisible(false);
                  setPracticeSuccess(0);
                  setStatus(`✅ Ready to learn '${pending.word}'!`);
                  if (pending.id) { await database.initDB(); await database.setLearned(pending.id, true); }
                  const entry: HistoryEntry = {
                    word: pending.word, input_lang: pending.language, output_lang: outputLang,
                    timestamp: new Date().toISOString(), data,
                  };
                  await saveHistoryEntry(entry);
                }
              } catch {
                setStatus("❌ Error loading word from Lessons.");
              } finally {
                setLoading(false);
              }
            }
            return;
          }

          if (wordData) {
            const entry: HistoryEntry = JSON.parse(wordData);
            const examples = prepareExamples(entry.data);
            setCurrentData(entry.data);
            setAllExamples(examples);
            setExampleIndex(0);
            setTokenizeStatus({});
            setRomanizationVisible(false);
            setPracticeSuccess(0);
            setWord(entry.word);
            setInputLang(entry.input_lang);
            setOutputLang(entry.output_lang);
            setStatus(`Loaded '${entry.word}' from history`);
            await AsyncStorage.removeItem(CURRENT_WORD_KEY);
            return;
          }

          // Restore last session — chỉ khi không có data nào khác
          if (lastLearnedRaw && !hasDataRef.current) {
            const entry: HistoryEntry = JSON.parse(lastLearnedRaw);
            const examples = prepareExamples(entry.data);
            setCurrentData(entry.data);
            setAllExamples(examples);
            setExampleIndex(0);
            setTokenizeStatus({});
            setRomanizationVisible(false);
            setPracticeSuccess(0);
            setWord(entry.word);
            setInputLang(entry.input_lang);
            setOutputLang(entry.output_lang);
            setStatus(`📂 Restored '${entry.word}' from last session`);
          }
        } catch (e) {
          console.error("Error loading pending history actions:", e);
        }
      };

      loadPendingActions();
    }, []) // empty deps: chỉ dùng refs/setters, không cần deps ngoài
  );

  const handleSpeedChange = useCallback(async (v: number) => {
    setTtsSpeed(v);
    await AsyncStorage.setItem(SPEED_KEY, String(v));
  }, []);

  // ─────────────────────────────────────────────
  // TOKENIZE — parallel (Promise.allSettled), không side-effect trong setState
  // ─────────────────────────────────────────────
  // Ref để track indices đang được tokenize → tránh duplicate API call khi parallel
  const tokenizingSet = useRef<Set<number>>(new Set());
  const tokenizeAbortRef = useRef<{ cancelled: boolean }>({ cancelled: false });

  useEffect(() => {
    if (allExamples.length === 0 || !currentData) return;

    // Reset abort token và in-flight set mỗi khi word thay đổi
    tokenizeAbortRef.current = { cancelled: false };
    tokenizingSet.current = new Set();
    const abortToken = tokenizeAbortRef.current;

    // Xác định các index cần tokenize (chưa có tokens)
    const pendingIndices = allExamples
      .map((ex, i) => (!ex.tokens || ex.tokens.length === 0 ? i : -1))
      .filter((i) => i !== -1);

    if (pendingIndices.length === 0) return;

    // Mark tất cả là "loading" ngay lập tức (1 setState duy nhất)
    setTokenizeStatus((prev) => {
      const next = { ...prev };
      for (const i of pendingIndices) next[i] = "loading";
      return next;
    });

    // Tạo promise cho từng index, chạy song song
    const tokenizeOne = async (i: number): Promise<{ i: number; tokens: string[] }> => {
      // Guard: đánh dấu đang xử lý để tránh double call
      if (tokenizingSet.current.has(i)) {
        throw new Error(`skip:${i}`);
      }
      tokenizingSet.current.add(i);

      const tokens = await learner.tokenizeSentence(
        allExamples[i].sentence,
        currentData.language.input ?? inputLang
      );
      return { i, tokens };
    };

    Promise.allSettled(pendingIndices.map((i) => tokenizeOne(i))).then(async (results) => {
      if (abortToken.cancelled) return;

      // Tổng hợp kết quả
      const successMap: Record<number, string[]> = {};
      const failedIndices: number[] = [];

      for (const result of results) {
        if (result.status === "fulfilled") {
          successMap[result.value.i] = result.value.tokens;
        } else {
          const msg = String(result.reason?.message ?? "");
          if (!msg.startsWith("skip:")) {
            // Tìm lại index từ message nếu có, nếu không thì skip
            const match = msg.match(/skip:(\d+)/);
            if (!match) {
              // Không biết index nào lỗi → bỏ qua (sẽ không update status)
            }
          }
        }
      }

      if (abortToken.cancelled) return;

      const successIndices = Object.keys(successMap).map(Number);
      if (successIndices.length === 0) return;

      // Update allExamples — 1 setState duy nhất cho toàn bộ batch
      setAllExamples((prev) => {
        const copy = [...prev];
        for (const i of successIndices) {
          if (!copy[i].tokens || copy[i].tokens!.length === 0) {
            copy[i] = { ...copy[i], tokens: successMap[i] };
          }
        }
        return copy;
      });

      // Update tokenizeStatus — 1 setState duy nhất
      setTokenizeStatus((prev) => {
        const next = { ...prev };
        for (const i of successIndices) next[i] = "done";
        return next;
      });

      // ─── Patch VocabData và persist vào AsyncStorage ───
      // Đọc currentData một lần qua ref để tránh stale closure
      setCurrentData((prevData) => {
        if (!prevData) return prevData;

        let updatedData = { ...prevData, examples: { ...prevData.examples } };
        for (const i of successIndices) {
          const pos = flatIndexToBucketPos(prevData.examples, i);
          if (!pos) continue;
          const bucket = [...(updatedData.examples[pos.diff] ?? [])];
          bucket[pos.j] = { ...bucket[pos.j], tokens: successMap[i] };
          updatedData.examples = { ...updatedData.examples, [pos.diff]: bucket };
        }

        // Persist async — ngoài setState để không vi phạm quy tắc pure updater
        // Dùng setTimeout 0 để thoát khỏi render cycle
        const snapshot = updatedData;
        setTimeout(async () => {
          if (abortToken.cancelled) return;
          try {
            const raw = await AsyncStorage.getItem(HISTORY_KEY);
            if (!raw) return;
            const arr: HistoryEntry[] = JSON.parse(raw);
            const idx = arr.findIndex(
              (e) => e.word === snapshot.word && e.input_lang === snapshot.language.input
            );
            if (idx === -1) return;
            arr[idx] = { ...arr[idx], data: snapshot };
            await Promise.all([
              AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(arr)),
              // Sync LAST_LEARNED_KEY nếu đây là từ đang học
              AsyncStorage.getItem(LAST_LEARNED_KEY).then((lastRaw) => {
                if (!lastRaw) return;
                const last: HistoryEntry = JSON.parse(lastRaw);
                if (last.word === snapshot.word && last.input_lang === snapshot.language.input) {
                  return AsyncStorage.setItem(
                    LAST_LEARNED_KEY,
                    JSON.stringify({ ...arr[idx] })
                  );
                }
              }),
            ]);
          } catch (e) {
            console.warn("Tokenize persist error:", e);
          }
        }, 0);

        return updatedData;
      });
    });

    return () => {
      abortToken.cancelled = true;
      tokenizingSet.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allExamples.length, currentData?.word]);

  // ─────────────────────────────────────────────
  // LEARN WORD
  // ─────────────────────────────────────────────
  const handleLearnWord = async () => {
    if (!word.trim()) { Alert.alert("Error", "Please enter a word."); return; }

    // [FIX v6] Clear lessonNav khi user learn word mới thủ công
    if (lessonNav) {
      const navWord = lessonNav.words[lessonNav.currentIndex]?.word;
      if (navWord !== word.trim()) {
        setLessonNav(null);
        await AsyncStorage.removeItem(LESSON_NAVIGATION_KEY);
      }
    }

    setLoading(true);
    setStatus(`🔄 Learning '${word}' (${genMode} mode)...`);
    try {
      const data = await learner.learnWord(word.trim(), inputLang, outputLang, genMode);
      if (data.error) { Alert.alert("API Error", data.error); setStatus("Error occurred."); return; }
      const examples = prepareExamples(data);
      setCurrentData(data);
      setAllExamples(examples);
      setExampleIndex(0);
      setTokenizeStatus({});
      setRomanizationVisible(false);
      setPracticeSuccess(0);
      setStatus(`✅ Ready to learn '${word}' — ${examples.length} examples!`);

      const entry: HistoryEntry = {
        word: word.trim(), input_lang: inputLang, output_lang: outputLang,
        timestamp: new Date().toISOString(), data,
      };
      await saveHistoryEntry(entry); // [FIX v6] dùng helper thống nhất
    } catch (e: any) {
      Alert.alert("Error", e.message);
      setStatus("Error occurred.");
    } finally {
      setLoading(false);
    }
  };

  // ─────────────────────────────────────────────
  // LESSON NAVIGATION
  // ─────────────────────────────────────────────
  const navigateLesson = useCallback(async (direction: "prev" | "next") => {
    if (!lessonNav) return;
    const { words, currentIndex, language, level } = lessonNav;

    const nextIndex = direction === "next" ? currentIndex + 1 : currentIndex - 1;
    if (nextIndex < 0 || nextIndex >= words.length) return;

    const target = words[nextIndex];
    const newNav = { ...lessonNav, currentIndex: nextIndex };
    setLessonNav(newNav);
    await AsyncStorage.setItem(LESSON_NAVIGATION_KEY, JSON.stringify(newNav));

    setWord(target.word);
    setInputLang(language);

    const raw = await AsyncStorage.getItem(HISTORY_KEY);
    const arr: HistoryEntry[] = raw ? JSON.parse(raw) : [];
    const cached = arr.find((e) => e.word === target.word && e.input_lang === language);

    if (cached) {
      const examples = prepareExamples(cached.data);
      setCurrentData(cached.data);
      setAllExamples(examples);
      setExampleIndex(0);
      setTokenizeStatus({});
      setRomanizationVisible(false);
      setPracticeSuccess(0);
      setOutputLang(cached.output_lang);
      setStatus(`⚡ [${level}] ${nextIndex + 1}/${words.length} — from cache`);
      // [FIX v6] Sync LAST_LEARNED_KEY khi navigate
      await AsyncStorage.setItem(LAST_LEARNED_KEY, JSON.stringify(cached));
      await database.initDB();
      if (target.id) await database.setLearned(target.id, true);
    } else {
      setLoading(true);
      setStatus(`🔄 [${level}] ${nextIndex + 1}/${words.length} — loading '${target.word}'...`);
      try {
        const data = await learner.learnWord(target.word, language, outputLang, genMode);
        if (!data.error) {
          const examples = prepareExamples(data);
          setCurrentData(data);
          setAllExamples(examples);
          setExampleIndex(0);
          setTokenizeStatus({});
          setRomanizationVisible(false);
          setPracticeSuccess(0);
          setStatus(`✅ [${level}] ${nextIndex + 1}/${words.length} — '${target.word}'`);
          await database.initDB();
          if (target.id) await database.setLearned(target.id, true);
          const entry: HistoryEntry = {
            word: target.word, input_lang: language, output_lang: outputLang,
            timestamp: new Date().toISOString(), data,
          };
          await saveHistoryEntry(entry); // [FIX v6] dùng helper, tự sync LAST_LEARNED
        }
      } catch {
        setStatus("❌ Error loading word.");
      } finally {
        setLoading(false);
      }
    }
  }, [lessonNav, outputLang, genMode]);

  // ─────────────────────────────────────────────
  // TRANSLATION POPUP
  // ─────────────────────────────────────────────
  const currentExample = allExamples[exampleIndex] ?? null;

  const handleTokenPress = async (token: string) => {
    speakText(token, inputLang, ttsSpeed);
    setTranslationPopup({ text: token, translation: "⏳ Translating..." });
    try {
      const result = await localDict.translateToken(
        token,
        inputLang,
        outputLang,
        () => learner.translateText(token, inputLang, outputLang)
      );
      setTranslationPopup({ text: token, translation: result });
    } catch {
      setTranslationPopup({ text: token, translation: "❌ Translation failed." });
    }
  };

  useEffect(() => {
    setTranslationPopup(null);
  }, [exampleIndex, currentData?.word]);

  // ─────────────────────────────────────────────
  // QUIZ — lọc theo ngôn ngữ hiện tại
  // ─────────────────────────────────────────────
  const handleGenerateQuiz = async () => {
    const currentHistory = await AsyncStorage.getItem(HISTORY_KEY);
    const historyArray: HistoryEntry[] = currentHistory ? JSON.parse(currentHistory) : [];

    if (historyArray.length === 0) {
      Alert.alert("Empty History", "Learn some words first!");
      return;
    }

    const quizLang = currentData?.language?.input ?? inputLang;
    const filteredByLang = historyArray.filter((e) => e.input_lang === quizLang);

    if (filteredByLang.length === 0) {
      Alert.alert(
        "No Words Found",
        `You haven't learned any ${quizLang} words yet.\n\nLearn at least 1 ${quizLang} word before generating a quiz.`
      );
      return;
    }

    setHistoryCount(filteredByLang.length);
    setQuizWordCount(Math.min(5, filteredByLang.length));
    setQuizSetupVisible(true);
  };

  const startQuizGeneration = async () => {
    setQuizSetupVisible(false);
    const currentHistory = await AsyncStorage.getItem(HISTORY_KEY);
    const historyArray: HistoryEntry[] = currentHistory ? JSON.parse(currentHistory) : [];

    const quizLang = currentData?.language?.input ?? inputLang;
    const filteredByLang = historyArray.filter((e) => e.input_lang === quizLang);

    if (filteredByLang.length === 0) {
      Alert.alert("No Words Found", `No ${quizLang} words in history.`);
      return;
    }

    const words = filteredByLang.slice(0, quizWordCount).map((e) => e.word);
    setQuizLoading(true);
    setStatus(`🔄 Generating ${quizQuestionCount}-question ${quizLang} quiz...`);
    try {
      const data = await learner.generateQuiz(words, quizLang, outputLang, quizQuestionCount, genMode);
      if (data.error) { Alert.alert("Error", data.error); return; }
      setQuizWindowData({ data, words, mode: "take" });
    } catch (e: any) {
      Alert.alert("Error", e.message);
    } finally {
      setQuizLoading(false);
      setStatus("Ready to learn!");
    }
  };

  // ─────────────────────────────────────────────
  // RENDER HELPERS
  // ─────────────────────────────────────────────
  const renderOverview = () => {
    if (!currentData) return null;
    if (romanizationVisible && currentExample) {
      return (
        <View>
          <OverviewRow icon="🔤" label="Romanization" value={currentExample.romanization ?? "N/A"} />
          <OverviewRow icon="📖" label="Translation"  value={currentExample.translation} />
          <OverviewRow icon="💡" label="Explanation"  value={currentExample.explanation} />
          <OverviewRow icon="📚" label="Grammar"      value={currentExample.grammar_points.join(", ")} />
        </View>
      );
    }
    const ov = currentData.overview;
    return (
      <View>
        <OverviewRow icon="🎯" label="Meaning"        value={ov.meaning} />
        <OverviewRow icon="💪" label="Part of Speech" value={ov.part_of_speech} />
        <OverviewRow icon="📌" label="Usage"          value={ov.usage} />
        <OverviewRow icon="📝" label="Notes"          value={ov.notes} />
        <View style={styles.rowWrap}>
          <Text style={styles.overviewKey}>🔗 Collocations: </Text>
          <View style={styles.collocRow}>
            {ov.collocations.map((col, i) => (
              <TouchableOpacity key={i} onPress={() => handleTokenPress(col)}>
                <Text style={styles.collocToken}>{col}{i < ov.collocations.length - 1 ? ", " : ""}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </View>
    );
  };

  const renderSentenceTokens = () => {
    if (!currentExample) return null;
    const isTokenizing = tokenizeStatus[exampleIndex] === "loading";
    const tokens = currentExample.tokens;

    if (!tokens && isTokenizing) {
      return (
        <View style={styles.tokenizingRow}>
          <ActivityIndicator size="small" color="#F1C40F" />
          <Text style={styles.tokenizingText}> Tokenizing…</Text>
        </View>
      );
    }

    const displayTokens = tokens ?? [currentExample.sentence];
    return (
      <Text style={styles.sentenceText}>
        {displayTokens.map((token, i) => {
          const core = token.trim();
          if (!core) return <Text key={i}>{token}</Text>;
          return (
            <Text key={i} style={styles.tokenText} onPress={() => handleTokenPress(core)}>
              {token}
            </Text>
          );
        })}
      </Text>
    );
  };

  // ─────────────────────────────────────────────
  // MAIN RENDER
  // ─────────────────────────────────────────────
  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        onTouchStart={() => {
          if (translationPopup) setTranslationPopup(null);
        }}
      >
        {/* HEADER */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>🌟 Vocabulary Learning</Text>
        </View>

        {/* INPUT CARD */}
        <View style={styles.card}>
          <View style={styles.wordInputRow}>
            <TouchableOpacity
              style={[styles.lessonNavArrow, (!lessonNav || lessonNav.currentIndex <= 0) && styles.btnDisabled]}
              onPress={() => navigateLesson("prev")}
              disabled={!lessonNav || lessonNav.currentIndex <= 0}
            >
              <Text style={styles.lessonNavArrowText}>◀</Text>
            </TouchableOpacity>

            <View style={{ flex: 1 }}>
              <TextInput
                style={styles.wordInput}
                placeholder="Enter a word..."
                placeholderTextColor="#666"
                value={word}
                onChangeText={(text) => {
                  setWord(text);
                  if (lessonNav && text !== lessonNav.words[lessonNav.currentIndex]?.word) {
                    setLessonNav(null);
                    AsyncStorage.removeItem(LESSON_NAVIGATION_KEY);
                  }
                }}
              />
              {lessonNav && (
                <Text style={styles.lessonNavHint}>
                  📚 {lessonNav.level} — {lessonNav.currentIndex + 1}/{lessonNav.words.length}
                </Text>
              )}
            </View>

            <TouchableOpacity
              style={[styles.lessonNavArrow, (!lessonNav || lessonNav.currentIndex >= lessonNav.words.length - 1) && styles.btnDisabled]}
              onPress={() => navigateLesson("next")}
              disabled={!lessonNav || lessonNav.currentIndex >= lessonNav.words.length - 1}
            >
              <Text style={styles.lessonNavArrowText}>▶</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.langRow}>
            <View style={styles.langBlock}>
              <Text style={styles.langLabel}>From</Text>
              <TouchableOpacity style={styles.langPicker} onPress={() => { setLangPickerTarget("input"); setLangPickerVisible(true); }}>
                <Text style={styles.langPickerText}>{inputLang} ▼</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.langArrow}>→</Text>
            <View style={styles.langBlock}>
              <Text style={styles.langLabel}>To</Text>
              <TouchableOpacity style={styles.langPicker} onPress={() => { setLangPickerTarget("output"); setLangPickerVisible(true); }}>
                <Text style={styles.langPickerText}>{outputLang} ▼</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.modeRow}>
            <Text style={styles.modeLabel}>Mode:</Text>
            {(["easy", "hard"] as const).map((m) => (
              <TouchableOpacity key={m} style={[styles.modeBtn, genMode === m && styles.modeBtnActive]} onPress={() => setGenMode(m)}>
                <Text style={[styles.modeBtnText, genMode === m && styles.modeBtnTextActive]}>
                  {m === "easy" ? "😊 Easy" : "💪 Hard"}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={styles.actionRow}>
            <TouchableOpacity style={[styles.btnPrimary, loading && styles.btnDisabled]} onPress={handleLearnWord} disabled={loading}>
              {loading ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.btnPrimaryText}>🎓 Learn Word</Text>}
            </TouchableOpacity>
            <TouchableOpacity style={[styles.btnQuiz, (loading || quizLoading) && styles.btnDisabled]} onPress={handleGenerateQuiz} disabled={loading || quizLoading}>
              {quizLoading ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.btnPrimaryText}>📝 Quiz</Text>}
            </TouchableOpacity>
          </View>
          <Text style={styles.statusText}>{status}</Text>
        </View>

        {/* LEARNING CARD */}
        {currentData && (
          <View style={styles.card}>
            <SpeedControl speed={ttsSpeed} onSpeedChange={handleSpeedChange} />

            <View style={styles.wordRow}>
              <Text style={styles.wordDisplay}>{currentData.word}</Text>
              <TTSButton onPress={() => speakText(currentData.word, inputLang, ttsSpeed)} size={28} />
            </View>

            <View style={styles.overviewBox}>{renderOverview()}</View>

            {currentExample && (
              <View style={styles.exampleBox}>
                <View style={styles.diffRow}>
                  <Text style={styles.diffTag}>
                    📊 Level:{" "}
                    <Text style={{ color: DIFFICULTY_COLORS[currentExample.difficulty_tag] ?? "#fff" }}>
                      {currentExample.difficulty_tag}
                    </Text>
                  </Text>
                  <TTSButton
                    onPress={() => speakText(currentExample.sentence, inputLang, ttsSpeed)}
                    size={17}
                    label="🔊 Play"
                  />
                </View>

                <View style={styles.sentenceBox}>{renderSentenceTokens()}</View>

                {translationPopup && (
                  <View
                    style={[styles.translationPopup, { maxHeight: 250 }]}
                    onTouchStart={(e) => e.stopPropagation()}
                  >
                    <View style={styles.translationPopupHeader}>
                      <Text style={styles.translationPopupWord}>{translationPopup.text}</Text>
                      <TTSButton onPress={() => speakText(translationPopup.text, inputLang, ttsSpeed)} size={15} />
                    </View>
                    <ScrollView
                      nestedScrollEnabled={true}
                      style={{ marginVertical: 8 }}
                      showsVerticalScrollIndicator={true}
                    >
                      <Text style={styles.translationPopupText}>{translationPopup.translation}</Text>
                    </ScrollView>
                    <TouchableOpacity onPress={() => setTranslationPopup(null)}>
                      <Text style={styles.translationPopupClose}>✕ Close</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            )}

            {/* Navigation */}
            <View style={styles.navRow}>
              <TouchableOpacity
                style={[styles.navBtn, exampleIndex === 0 && styles.btnDisabled]}
                onPress={() => setExampleIndex((i) => Math.max(0, i - 1))}
                disabled={exampleIndex === 0}
              >
                <Text style={styles.navBtnText}>⬅️ Prev</Text>
              </TouchableOpacity>
              <Text style={styles.counterText}>{exampleIndex + 1}/{allExamples.length}</Text>
              <TouchableOpacity
                style={[styles.navBtn, exampleIndex >= allExamples.length - 1 && styles.btnDisabled]}
                onPress={() => setExampleIndex((i) => Math.min(allExamples.length - 1, i + 1))}
                disabled={exampleIndex >= allExamples.length - 1}
              >
                <Text style={styles.navBtnText}>Next ➡️</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.controlRow}>
              <TouchableOpacity style={styles.ctrlBtn} onPress={() => setRomanizationVisible((v) => !v)}>
                <Text style={styles.ctrlBtnText}>{romanizationVisible ? "Hide Romanization" : "Show Romanization"}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.ctrlBtn, styles.ctrlBtnMemory]} onPress={() => setMemoryCheckVisible(true)} disabled={allExamples.length === 0}>
                <Text style={styles.ctrlBtnText}>Memory Check</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.ctrlBtn, styles.ctrlBtnPractice]} onPress={() => setPracticeModalVisible(true)} disabled={!currentExample}>
                <Text style={styles.ctrlBtnText}>Typing Practice</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </ScrollView>

      {/* ═══════════════ MODALS ═══════════════ */}

      {/* Language Picker */}
      <Modal visible={langPickerVisible} transparent animationType="slide">
        <Pressable style={styles.modalOverlay} onPress={() => setLangPickerVisible(false)}>
          <View style={styles.pickerSheet}>
            <Text style={styles.pickerTitle}>Select {langPickerTarget === "input" ? "Source" : "Target"} Language</Text>
            {LANGUAGE_OPTIONS.map((lang) => (
              <TouchableOpacity key={lang} style={styles.pickerItem} onPress={() => {
                if (langPickerTarget === "input") setInputLang(lang); else setOutputLang(lang);
                setLangPickerVisible(false);
              }}>
                <Text style={styles.pickerItemText}>{lang}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </Pressable>
      </Modal>

      {/* Memory Check */}
      {memoryCheckVisible && (
        <MemoryCheckModal
          examples={allExamples}
          inputLang={inputLang}
          ttsSpeed={ttsSpeed}
          onClose={() => setMemoryCheckVisible(false)}
        />
      )}

      {/* Quiz Setup */}
      <Modal visible={quizSetupVisible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.quizSetupBox}>
            <Text style={styles.quizSetupTitle}>⚙️ Quiz Setup</Text>
            <View style={styles.quizLangBadge}>
              <Text style={styles.quizLangBadgeText}>
                🌐 Language: {currentData?.language?.input ?? inputLang}
              </Text>
            </View>
            <Text style={styles.setupLabel}>Recent words to test: {quizWordCount} / {historyCount}</Text>
            <View style={styles.stepperRow}>
              <TouchableOpacity style={styles.stepperBtn} onPress={() => setQuizWordCount((n) => Math.max(1, n - 1))}>
                <Text style={styles.stepperText}>−</Text>
              </TouchableOpacity>
              <Text style={styles.stepperValue}>{quizWordCount}</Text>
              <TouchableOpacity style={styles.stepperBtn} onPress={() => setQuizWordCount((n) => Math.min(historyCount, n + 1))}>
                <Text style={styles.stepperText}>+</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.setupLabel}>Number of questions: {quizQuestionCount}</Text>
            <View style={styles.stepperRow}>
              <TouchableOpacity style={styles.stepperBtn} onPress={() => setQuizQuestionCount((n) => Math.max(5, n - 1))}>
                <Text style={styles.stepperText}>−</Text>
              </TouchableOpacity>
              <Text style={styles.stepperValue}>{quizQuestionCount}</Text>
              <TouchableOpacity style={styles.stepperBtn} onPress={() => setQuizQuestionCount((n) => Math.min(10, n + 1))}>
                <Text style={styles.stepperText}>+</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.setupBtnRow}>
              <TouchableOpacity style={styles.btnPrimary} onPress={startQuizGeneration}>
                <Text style={styles.btnPrimaryText}>🚀 Generate Quiz</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.btnCancel} onPress={() => setQuizSetupVisible(false)}>
                <Text style={styles.btnCancelText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Typing Practice Modal */}
      {practiceModalVisible && (
        <TypingPracticeModal
          example={currentExample}
          currentScore={practiceSuccess}
          onClose={() => setPracticeModalVisible(false)}
          onCorrect={() => setPracticeSuccess((n) => n + 1)}
          inputLang={inputLang}
          ttsSpeed={ttsSpeed}
        />
      )}

      {/* Quiz Window */}
      {quizWindowData && (
        <QuizModal
          quizData={quizWindowData.data}
          words={quizWindowData.words}
          mode={quizWindowData.mode}
          pastAnswers={quizWindowData.pastAnswers}
          onClose={() => setQuizWindowData(null)}
          onSaveResult={async (entry) => {
            try {
              const currentQuizHistory = await AsyncStorage.getItem(QUIZ_HISTORY_KEY);
              const quizHistoryArray = currentQuizHistory ? JSON.parse(currentQuizHistory) : [];
              await AsyncStorage.setItem(QUIZ_HISTORY_KEY, JSON.stringify([entry, ...quizHistoryArray]));
            } catch (e) {
              console.error("Error saving quiz history:", e);
            }
          }}
        />
      )}
    </KeyboardAvoidingView>
  );
}

// ─────────────────────────────────────────────
// SUB-COMPONENTS
// ─────────────────────────────────────────────

function ColoredInput({
  input,
  target,
  placeholder,
  onChangeText,
  autoFocus = false,
}: {
  input: string;
  target: string;
  placeholder?: string;
  onChangeText: (text: string) => void;
  autoFocus?: boolean;
}) {
  // Overlay hiển thị từng ký tự với màu đúng/sai
  const renderChars = () => {
    if (input.length === 0) return null;
    return (
      <Text style={overlayStyle.text} pointerEvents="none">
        {input.split("").map((char, i) => {
          const correct = i < target.length && char === target[i];
          return (
            <Text key={i} style={{ color: correct ? "#2ECC71" : "#E74C3C" }}>
              {char}
            </Text>
          );
        })}
      </Text>
    );
  };

  return (
    <View style={overlayStyle.wrapper}>
      {renderChars()}
      <TextInput
        style={[overlayStyle.input, input.length > 0 && overlayStyle.inputTransparentText]}
        value={input}
        onChangeText={onChangeText}
        placeholder={input.length === 0 ? (placeholder ?? "Type here...") : ""}
        placeholderTextColor="#555"
        multiline
        autoCapitalize="none"
        autoCorrect={false}
        autoFocus={autoFocus}
      />
    </View>
  );
}

const overlayStyle = StyleSheet.create({
  wrapper: {
    position: "relative",
    backgroundColor: "#1a1a1a",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#333",
    minHeight: 60,
  },
  text: {
    position: "absolute",
    top: 10,
    left: 10,
    right: 10,
    fontSize: 17,
    lineHeight: 24,
    zIndex: 2,
    flexWrap: "wrap",
    fontFamily: Platform.OS === "ios" ? "Courier" : "monospace",
  },
  input: {
    fontSize: 17,
    lineHeight: 24,
    padding: 10,
    color: "#fff",
    minHeight: 60,
    zIndex: 1,
    fontFamily: Platform.OS === "ios" ? "Courier" : "monospace",
  },
  // Khi có nội dung, làm chữ TextInput trong suốt để overlay hiện lên
  inputTransparentText: {
    color: "transparent",
  },
});


function OverviewRow({ icon, label, value }: { icon: string; label: string; value: string }) {
  if (!value || value === "N/A") return null;
  return (
    <View style={styles.overviewRow}>
      <Text style={styles.overviewKey}>{icon} {label}: </Text>
      <Text style={styles.overviewValue}>{value}</Text>
    </View>
  );
}

// ── Memory Check Modal ──
function MemoryCheckModal({
  examples, inputLang, ttsSpeed, onClose,
}: {
  examples: ExampleItem[];
  inputLang: string;
  ttsSpeed: number;
  onClose: () => void;
}) {
  const [shuffled]        = useState<ExampleItem[]>(() => [...examples].sort(() => Math.random() - 0.5));
  const [idx, setIdx]     = useState(0);
  const [input, setInput] = useState("");
  const [showHint, setShowHint] = useState(false);
  const [done, setDone]   = useState(false);

  const current = shuffled[idx];
  const target  = current?.sentence?.trim() ?? "";

  useEffect(() => {
    if (!current?.sentence) return;
    const t = setTimeout(() => speakText(current.sentence, inputLang, ttsSpeed), 350);
    return () => clearTimeout(t);
  }, [idx]);

  const handleChange = (text: string) => {
    setInput(text);
    if (text === target && target.length > 0) {
      const next = idx + 1;
      if (next >= shuffled.length) {
        setDone(true);
      } else {
        setTimeout(() => {
          setIdx(next);
          setInput("");
          setShowHint(false);
        }, 500);
      }
    }
  };

  return (
    <Modal visible animationType="slide">
      <View style={styles.memCheckRoot}>
        <View style={styles.memCheckHeader}>
          <Text style={styles.memCheckTitle}>🧠 Memory Check</Text>
          <TouchableOpacity onPress={onClose}>
            <Text style={styles.memCheckClose}>✕</Text>
          </TouchableOpacity>
        </View>

        {done ? (
          <View style={styles.memCheckDone}>
            <Text style={styles.memCheckDoneText}>🎉 Amazing! You've recalled all examples!</Text>
            <TouchableOpacity style={styles.btnPrimary} onPress={onClose}>
              <Text style={styles.btnPrimaryText}>Close</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.memCheckBody}>
            <Text style={styles.memCheckProgress}>Progress: {idx + 1}/{shuffled.length}</Text>

            <View style={styles.memCheckTtsRow}>
              <Text style={styles.memCheckInstruction}>Translate back to the original language:</Text>
              <TTSButton
                onPress={() => speakText(current?.sentence ?? "", inputLang, ttsSpeed)}
                size={17} label="🔊 Replay"
              />
            </View>

            {/* CHỈ hiện bản dịch — KHÔNG hiện câu gốc */}
            <Text style={styles.memCheckTranslation}>{current?.translation}</Text>

            {/* Hint: chỉ show khi giữ nút, và chỉ show câu gốc */}
            {showHint && (
              <View style={[styles.typingTargetBox, { marginBottom: 12, borderColor: "#E67E22" }]}>
                <Text style={[styles.typingTargetText, { color: "#E67E22" }]}>{target}</Text>
              </View>
            )}

            {/* Input với overlay màu từng ký tự */}
            <ColoredInput
              input={input}
              target={target}
              placeholder="Type here..."
              onChangeText={handleChange}
              autoFocus
            />

            <View style={styles.memCheckBtnRow}>
              <TouchableOpacity
                style={styles.hintBtn}
                onPressIn={() => setShowHint(true)}
                onPressOut={() => setShowHint(false)}
              >
                <Text style={styles.hintBtnText}>💡 Hold for Hint</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}


// ── Typing Practice Modal ──
function TypingPracticeModal({
  example, currentScore, onClose, onCorrect, inputLang, ttsSpeed,
}: {
  example: ExampleItem | null;
  currentScore: number;
  onClose: () => void;
  onCorrect: () => void;
  inputLang: string;
  ttsSpeed: number;
}) {
  const [input, setInput]         = useState("");
  const [completed, setCompleted] = useState(false);
  const target = example?.sentence?.trim() ?? "";

  useEffect(() => {
    if (!example?.sentence) return;
    const timeout = setTimeout(() => speakText(example.sentence, inputLang, ttsSpeed), 350);
    return () => clearTimeout(timeout);
  }, [example?.sentence]);

  const handleChange = (text: string) => {
    setInput(text);
    if (text === target && target.length > 0) {
      onCorrect();
      setCompleted(true);
      setTimeout(() => { setInput(""); setCompleted(false); }, 700);
    }
  };

  return (
    <Modal visible animationType="slide">
      <View style={styles.typingRoot}>
        <View style={styles.typingHeader}>
          <Text style={styles.typingTitle}>⌨️ Typing Practice</Text>
          <TouchableOpacity onPress={onClose}>
            <Text style={styles.memCheckClose}>✕</Text>
          </TouchableOpacity>
        </View>
        <ScrollView contentContainerStyle={styles.typingBody}>
          <Text style={styles.typingProgress}>Score: {currentScore}</Text>

          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <Text style={styles.typingPrompt}>Type the sentence exactly:</Text>
            <TTSButton onPress={() => speakText(target, inputLang, ttsSpeed)} size={17} label="🔊 Replay" />
          </View>

          {/* Câu gốc hiện rõ để user nhìn mà gõ */}
          <View style={styles.typingTargetBox}>
            <Text style={styles.typingTargetText}>{target || "No example available"}</Text>
          </View>

          {/* Input với overlay màu từng ký tự */}
          <ColoredInput
            input={input}
            target={target}
            placeholder="Type here..."
            onChangeText={handleChange}
            autoFocus
          />

          {completed && (
            <View style={styles.typingSuccessBox}>
              <Text style={styles.typingSuccessText}>✅ Correct! Keep going.</Text>
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

// ── Quiz Modal ──
function QuizModal({
  quizData, words, mode, pastAnswers, onClose, onSaveResult,
}: {
  quizData: QuizData; words: string[]; mode: "take" | "review";
  pastAnswers?: string[];
  onClose: () => void;
  onSaveResult: (entry: QuizHistoryEntry) => Promise<void>;
}) {
  const questions = quizData.quiz ?? [];
  const [answers, setAnswers]     = useState<string[]>(pastAnswers ?? questions.map(() => ""));
  const [submitted, setSubmitted] = useState(mode === "review");
  const [score, setScore]         = useState(0);

  useEffect(() => {
    if (mode === "review") {
      setScore(questions.reduce((acc, q, i) => acc + (pastAnswers?.[i] === q.answer ? 1 : 0), 0));
    }
  }, []);

  const handleSubmit = async () => {
    const s = questions.reduce((acc, q, i) => acc + (answers[i] === q.answer ? 1 : 0), 0);
    setScore(s);
    setSubmitted(true);
    await onSaveResult({
      words, score: s, total: questions.length,
      timestamp: new Date().toISOString(), quiz_data: quizData, user_answers: answers,
    });
    Alert.alert("Result", `You got ${s} out of ${questions.length} correct!`);
  };

  const isReview = mode === "review";
  const diffColor = (d: string) =>
    ({ easy: "#2ECC71", medium: "#F1C40F", hard: "#E67E22", super_hard: "#E74C3C", very_hard: "#E74C3C" }[d] ?? "#fff");

  return (
    <Modal visible animationType="slide">
      <View style={styles.quizRoot}>
        <View style={styles.quizHeader}>
          <Text style={styles.quizTitle} numberOfLines={1}>
            {isReview ? "🔍 Review Quiz" : "📝 Quiz"}: {words.slice(0, 3).join(", ")}
          </Text>
          <TouchableOpacity onPress={onClose}><Text style={styles.memCheckClose}>✕</Text></TouchableOpacity>
        </View>
        <ScrollView contentContainerStyle={styles.quizBody}>
          {questions.map((q, i) => {
            const userAns   = answers[i];
            const isCorrect = submitted && userAns === q.answer;
            const isWrong   = submitted && userAns !== q.answer;
            return (
              <View key={i} style={[
                styles.quizQuestionCard,
                submitted && isCorrect && { borderColor: "#2ECC71", borderWidth: 2 },
                submitted && isWrong   && { borderColor: "#E74C3C", borderWidth: 2 },
              ]}>
                <Text style={[styles.quizQuestionText, { color: diffColor(q.difficulty) }]}>
                  Q{i + 1}: {q.question}
                </Text>
                {q.options.map((opt) => {
                  const val          = opt[0];
                  const isSelected   = userAns === val;
                  const isCorrectOpt = submitted && val === q.answer;
                  const isWrongOpt   = submitted && isSelected && val !== q.answer;
                  return (
                    <View key={val} style={styles.quizOptionWrapper}>
                      <TouchableOpacity
                        style={[
                          styles.quizOption,
                          isSelected && !submitted && styles.quizOptionSelected,
                          isCorrectOpt && styles.quizOptionCorrect,
                          isWrongOpt   && styles.quizOptionWrong,
                        ]}
                        onPress={() => { if (submitted) return; const u = [...answers]; u[i] = val; setAnswers(u); }}
                        disabled={submitted}
                      >
                        <Text style={[
                          styles.quizOptionText,
                          isCorrectOpt && { color: "#2ECC71", fontWeight: "bold" },
                          isWrongOpt   && { color: "#E74C3C" },
                        ]}>{opt}</Text>
                      </TouchableOpacity>
                      {submitted && isCorrectOpt && <Text style={styles.quizOptionMeta}>Correct answer</Text>}
                      {submitted && isWrongOpt && <Text style={styles.quizOptionMeta}>Your answer</Text>}
                    </View>
                  );
                })}
                {submitted && <Text style={styles.quizExplanation}>💡 {q.explanation}</Text>}
              </View>
            );
          })}
        </ScrollView>
        {!submitted && (
          <TouchableOpacity style={styles.quizSubmitBtn} onPress={handleSubmit}>
            <Text style={styles.btnPrimaryText}>✅ Submit & Grade</Text>
          </TouchableOpacity>
        )}
        {submitted && (
          <View style={styles.quizScoreBar}>
            <Text style={styles.quizScoreText}>🎯 Score: {score}/{questions.length}</Text>
          </View>
        )}
      </View>
    </Modal>
  );
}

// ─────────────────────────────────────────────
// STYLES
// ─────────────────────────────────────────────
const { width } = Dimensions.get("window");

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#1a1a2e" },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 40 },
  header: { alignItems: "center", paddingVertical: 20 },
  headerTitle: { fontSize: 26, fontWeight: "bold", color: "#F1C40F" },
  card: {
    backgroundColor: "#16213e", borderRadius: 16, padding: 16, marginBottom: 16,
    shadowColor: "#000", shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4, shadowRadius: 8, elevation: 6,
  },
  langRow: { flexDirection: "row", alignItems: "center", marginBottom: 12 },
  langBlock: { flex: 1 },
  langLabel: { color: "#aaa", fontSize: 12, marginBottom: 4 },
  langPicker: { backgroundColor: "#0f3460", borderRadius: 8, paddingVertical: 10, paddingHorizontal: 12, borderWidth: 1, borderColor: "#1a4a7a" },
  langPickerText: { color: "#2CC985", fontWeight: "600" },
  langArrow: { color: "#555", fontSize: 20, marginHorizontal: 12, alignSelf: "flex-end", marginBottom: 8 },
  modeRow: { flexDirection: "row", alignItems: "center", marginBottom: 14, gap: 10 },
  modeLabel: { color: "#aaa", fontSize: 14, marginRight: 6 },
  modeBtn: { paddingVertical: 7, paddingHorizontal: 16, borderRadius: 20, borderWidth: 1, borderColor: "#333", backgroundColor: "#111" },
  modeBtnActive: { backgroundColor: "#1a4a7a", borderColor: "#2CC985" },
  modeBtnText: { color: "#888", fontSize: 13 },
  modeBtnTextActive: { color: "#2CC985", fontWeight: "bold" },
  actionRow: { flexDirection: "row", gap: 10 },
  btnPrimary: { flex: 1, backgroundColor: "#1a4a7a", paddingVertical: 14, borderRadius: 10, alignItems: "center" },
  btnQuiz: { flex: 1, backgroundColor: "#6c3483", paddingVertical: 14, borderRadius: 10, alignItems: "center" },
  btnDisabled: { opacity: 0.5 },
  btnPrimaryText: { color: "#fff", fontWeight: "bold", fontSize: 15 },
  btnCancel: { flex: 1, backgroundColor: "#333", paddingVertical: 14, borderRadius: 10, alignItems: "center" },
  btnCancelText: { color: "#aaa", fontWeight: "bold", fontSize: 15 },
  statusText: { color: "#777", fontSize: 12, marginTop: 10, textAlign: "center" },
  wordRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", marginBottom: 12, gap: 12 },
  wordDisplay: { fontSize: 36, fontWeight: "bold", color: "#2CC985" },
  ttsBtn: { padding: 6, borderRadius: 8 },
  ttsBtnText: { color: "#F1C40F" },
  overviewBox: { backgroundColor: "#0d1b2a", borderRadius: 10, padding: 12, marginBottom: 12 },
  overviewRow: { flexDirection: "row", flexWrap: "wrap", marginBottom: 6 },
  rowWrap: { flexDirection: "row", flexWrap: "wrap", marginBottom: 6 },
  overviewKey: { color: "#5DADE2", fontWeight: "bold", fontSize: 13 },
  overviewValue: { color: "#E0E0E0", fontSize: 13, flex: 1, flexWrap: "wrap" },
  collocRow: { flexDirection: "row", flexWrap: "wrap" },
  collocToken: { color: "#E67E22", textDecorationLine: "underline", fontSize: 13 },
  exampleBox: { backgroundColor: "#0a1628", borderRadius: 10, padding: 12, marginBottom: 10 },
  diffRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  diffTag: { color: "#5DADE2", fontWeight: "bold", fontSize: 13 },
  sentenceBox: { backgroundColor: "#111d30", borderRadius: 8, padding: 12, marginBottom: 8 },
  sentenceText: { fontSize: 20, color: "#F1C40F", fontWeight: "bold", lineHeight: 32, flexWrap: "wrap" },
  tokenText: { color: "#F1C40F", textDecorationLine: "underline" },
  tokenizingRow: { flexDirection: "row", alignItems: "center", paddingVertical: 8 },
  tokenizingText: { color: "#888", fontSize: 14, fontStyle: "italic" },
  translationPopup: { backgroundColor: "#1a1a1a", borderRadius: 10, padding: 12, borderWidth: 1, borderColor: "#2ECC71", marginTop: 8 },
  translationPopupHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 },
  translationPopupWord: { color: "#888", fontSize: 12, fontStyle: "italic" },
  translationPopupText: { color: "#2ECC71", fontSize: 14, fontWeight: "bold" },
  translationPopupClose: { color: "#E74C3C", marginTop: 8, textAlign: "right" },
  navRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", marginVertical: 10, gap: 20 },
  navBtn: { backgroundColor: "#1a4a7a", borderRadius: 8, paddingVertical: 8, paddingHorizontal: 20 },
  navBtnText: { color: "#fff", fontWeight: "bold" },
  counterText: { color: "#fff", fontWeight: "bold", fontSize: 16 },
  controlRow: { flexDirection: "row", gap: 10, marginBottom: 10 },
  ctrlBtn: { flex: 1, backgroundColor: "#4a235a", borderRadius: 8, paddingVertical: 12, alignItems: "center", justifyContent: "center", minHeight: 44 },
  ctrlBtnMemory: { backgroundColor: "#7d3c1b" },
  ctrlBtnPractice: { backgroundColor: "#2d3f6f" },
  ctrlBtnText: { color: "#fff", fontSize: 14, fontWeight: "700", letterSpacing: 0.2, textAlign: "center" },
  practiceInput: { backgroundColor: "#1a1a1a", color: "#fff", borderRadius: 8, padding: 10, fontSize: 17, borderWidth: 1, borderColor: "#333", minHeight: 60 },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.7)", justifyContent: "flex-end" },
  pickerSheet: { backgroundColor: "#16213e", borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20 },
  pickerTitle: { color: "#F1C40F", fontSize: 18, fontWeight: "bold", marginBottom: 16, textAlign: "center" },
  pickerItem: { paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: "#222" },
  pickerItemText: { color: "#fff", fontSize: 16, textAlign: "center" },
  memCheckRoot: { flex: 1, backgroundColor: "#1a1a2e" },
  memCheckHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 20, borderBottomWidth: 1, borderBottomColor: "#222", backgroundColor: "#16213e" },
  memCheckTitle: { color: "#F1C40F", fontSize: 20, fontWeight: "bold" },
  memCheckClose: { color: "#E74C3C", fontSize: 22, fontWeight: "bold" },
  memCheckBody: { padding: 20 },
  memCheckProgress: { color: "#5DADE2", fontWeight: "bold", marginBottom: 10 },
  memCheckTtsRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  memCheckInstruction: { color: "#aaa", fontSize: 14, flex: 1 },
  memCheckTranslation: { color: "#F1C40F", fontSize: 18, fontStyle: "italic", marginBottom: 16, lineHeight: 26 },
  memCheckHint: { color: "#E67E22", fontSize: 16, fontWeight: "bold", marginBottom: 12, lineHeight: 24 },
  memCheckBtnRow: { flexDirection: "row", gap: 10, marginTop: 16 },
  memCheckDone: { flex: 1, justifyContent: "center", alignItems: "center", padding: 30 },
  memCheckDoneText: { color: "#2ECC71", fontSize: 18, textAlign: "center", marginBottom: 30, lineHeight: 28 },
  hintBtn: { flex: 1, backgroundColor: "#5d6d7e", borderRadius: 8, paddingVertical: 10, alignItems: "center" },
  hintBtnText: { color: "#fff", fontWeight: "600" },
  typingRoot: { flex: 1, backgroundColor: "#1a1a2e" },
  typingHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 20, borderBottomWidth: 1, borderBottomColor: "#222", backgroundColor: "#16213e" },
  typingTitle: { color: "#F1C40F", fontSize: 20, fontWeight: "bold" },
  typingBody: { padding: 20 },
  typingProgress: { color: "#5DADE2", fontWeight: "bold", marginBottom: 10 },
  typingPrompt: { color: "#aaa", fontSize: 14, marginBottom: 10 },
  typingTargetBox: { backgroundColor: "#111", borderRadius: 10, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: "#333" },
  typingTargetText: { color: "#fff", fontSize: 16, lineHeight: 22 },
  typingSuccessBox: { backgroundColor: "#223d1f", padding: 12, borderRadius: 10, marginTop: 12, marginBottom: 16 },
  typingSuccessText: { color: "#2ECC71", fontSize: 16, textAlign: "center" },
  quizSetupBox: { backgroundColor: "#16213e", borderRadius: 20, padding: 24, margin: 24, alignSelf: "center", width: width - 48 },
  quizSetupTitle: { color: "#F1C40F", fontSize: 20, fontWeight: "bold", marginBottom: 12, textAlign: "center" },
  quizLangBadge: { backgroundColor: "#0d2a1a", borderRadius: 8, borderWidth: 1, borderColor: "#2CC985", paddingVertical: 6, paddingHorizontal: 12, alignSelf: "center", marginBottom: 14 },
  quizLangBadgeText: { color: "#2CC985", fontSize: 13, fontWeight: "600" },
  setupLabel: { color: "#aaa", fontSize: 14, marginBottom: 8, marginTop: 10 },
  stepperRow: { flexDirection: "row", alignItems: "center", gap: 20, marginBottom: 4 },
  stepperBtn: { backgroundColor: "#1a4a7a", borderRadius: 8, paddingHorizontal: 18, paddingVertical: 8 },
  stepperText: { color: "#fff", fontSize: 20, fontWeight: "bold" },
  stepperValue: { color: "#2CC985", fontSize: 22, fontWeight: "bold", minWidth: 40, textAlign: "center" },
  setupBtnRow: { flexDirection: "row", gap: 10, marginTop: 24 },
  quizRoot: { flex: 1, backgroundColor: "#1a1a2e" },
  quizHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 20, backgroundColor: "#16213e", borderBottomWidth: 1, borderBottomColor: "#222" },
  quizTitle: { color: "#F1C40F", fontSize: 18, fontWeight: "bold", flex: 1 },
  quizBody: { padding: 16, paddingBottom: 40 },
  quizQuestionCard: { backgroundColor: "#16213e", borderRadius: 12, padding: 16, marginBottom: 16 },
  quizQuestionText: { fontSize: 17, fontWeight: "bold", marginBottom: 14, lineHeight: 24 },
  quizOptionWrapper: { marginBottom: 6 },
  quizOption: { backgroundColor: "#0a1628", borderRadius: 8, paddingVertical: 12, paddingHorizontal: 16, marginBottom: 2, borderWidth: 1, borderColor: "#222" },
  quizOptionSelected: { borderColor: "#5DADE2", backgroundColor: "#112244" },
  quizOptionCorrect: { borderColor: "#2ECC71", backgroundColor: "#0d3320" },
  quizOptionWrong: { borderColor: "#E74C3C", backgroundColor: "#2d0a0a" },
  quizOptionText: { color: "#ccc", fontSize: 15 },
  quizOptionMeta: { color: "#aaa", fontSize: 12, marginTop: 4, marginLeft: 12 },
  quizExplanation: { color: "#F39C12", fontSize: 13, fontStyle: "italic", marginTop: 10, lineHeight: 20, backgroundColor: "#1a1a1a", padding: 10, borderRadius: 6 },
  quizSubmitBtn: { backgroundColor: "#27ae60", margin: 16, paddingVertical: 16, borderRadius: 12, alignItems: "center" },
  quizScoreBar: { backgroundColor: "#1a4a7a", margin: 16, paddingVertical: 16, borderRadius: 12, alignItems: "center" },
  quizScoreText: { color: "#fff", fontSize: 18, fontWeight: "bold" },
  wordInputRow: { flexDirection: "row", alignItems: "center", marginBottom: 14, gap: 8 },
  wordInput: { backgroundColor: "#0f3460", color: "#fff", borderRadius: 10, padding: 14, fontSize: 18, borderWidth: 1, borderColor: "#1a4a7a" },
  lessonNavArrow: { backgroundColor: "#1a4a7a", borderRadius: 10, width: 42, height: 74, alignItems: "center", justifyContent: "center" },
  lessonNavArrowText: { color: "#2CC985", fontSize: 18, fontWeight: "bold" },
  lessonNavHint: { color: "#5DADE2", fontSize: 11, marginTop: 4, marginLeft: 4, fontStyle: "italic" },
});
