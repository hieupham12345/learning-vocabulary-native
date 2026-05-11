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
import * as Speech from "expo-speech";
import { useFocusEffect } from "expo-router";
import { localDict } from "@/scripts/LocalDictionary";
import { database } from "@/scripts/VocabularyDB";
import { SpeechCheck } from "@/app/SpeechCheck";
import { getSettings, loadSettings, subscribeSettings } from "@/scripts/settings-store";

import {
  initDatabase,
  migrateFromAsyncStorage,
  saveWord,
  loadLastLearned,
  loadWordByInputLang,
  listWordNames,
  countWords,
  updateExamples,
  updateTranslationCache,
  saveQuiz,
  saveQuizExplanation,
  loadQuizExplanations,
  kvGet,
  kvSet,
  type HistoryEntry,
  type QuizHistoryEntry,
} from "@/scripts/ExampleDB";

// ─────────────────────────────────────────────
// TTS
// ─────────────────────────────────────────────
const LANG_TO_TTS: Record<string, string> = {
  Chinese: "zh-CN", English: "en-US", Japanese: "ja-JP",
  Vietnamese: "vi-VN", Korean: "ko-KR",
};

async function speakText(text: string, language: string, rate = 1.0): Promise<void> {
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

interface VocabDataLocal {
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

interface QuizHistoryEntryLocal {
  id?: number;
  words: string[];
  score: number;
  total: number;
  timestamp: string;
  quiz_data: QuizData;
  user_answers: string[];
  input_lang?: string;
}

// ─────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────
const LANGUAGE_OPTIONS = ["Chinese", "English", "Japanese", "Vietnamese", "Korean"];
const DIFFICULTY_COLORS: Record<string, string> = {
  Easy: "#2ECC71", Medium: "#F1C40F", Hard: "#E67E22", "Super Hard": "#E74C3C",
};

const CURRENT_WORD_KEY        = "@current_word_data";
const CURRENT_REVIEW_KEY      = "@current_quiz_review";
const CURRENT_RETAKE_KEY      = "@current_quiz_retake";
const PENDING_LESSON_WORD_KEY = "@pending_lesson_word";
const LESSON_NAVIGATION_KEY   = "@lesson_navigation_context";
const KV_TTS_SPEED            = "tts_speed";

const SPEED_MIN  = 1.0;
const SPEED_MAX  = 2.0;
const SPEED_STEP = 0.1;

const learner = new VocabularyLearner();

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────
const prepareExamples = (data: VocabDataLocal): ExampleItem[] => {
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

const flatIndexToBucketPos = (
  examples: VocabDataLocal["examples"],
  flatIndex: number
): { diff: "easy" | "medium" | "hard" | "super_hard"; j: number } | null => {
  const order = ["easy", "medium", "hard", "super_hard"] as const;
  let count = 0;
  for (const diff of order) {
    const bucket = examples[diff] ?? [];
    if (flatIndex < count + bucket.length) return { diff, j: flatIndex - count };
    count += bucket.length;
  }
  return null;
};

// ─────────────────────────────────────────────
// SPEED CONTROL
// ─────────────────────────────────────────────
function SpeedControl({ speed, onSpeedChange }: { speed: number; onSpeedChange: (v: number) => void }) {
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
  row: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, backgroundColor: "#0d1b2a", borderRadius: 10, paddingVertical: 8, paddingHorizontal: 14, marginBottom: 10 },
  icon: { fontSize: 18 },
  btn: { backgroundColor: "#1a4a7a", borderRadius: 6, paddingHorizontal: 14, paddingVertical: 4 },
  disabled: { opacity: 0.3 },
  btnText: { color: "#fff", fontSize: 20, fontWeight: "bold" },
  value: { color: "#2CC985", fontWeight: "bold", fontSize: 17, minWidth: 48, textAlign: "center" },
});

function TTSButton({ onPress, size = 20, label }: { onPress: () => void; size?: number; label?: string }) {
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
  const [word, setWord]             = useState("");
  const [inputLang, setInputLang]   = useState("Chinese");
  const [outputLang, setOutputLang] = useState("Vietnamese");

  const [dbReady, setDbReady]     = useState(false);
  const [dbError, setDbError]     = useState(false);
  const [migrating, setMigrating] = useState(false);

  const [ttsSpeed, setTtsSpeed] = useState(1.5);

  const [currentData, setCurrentData]                 = useState<VocabDataLocal | null>(null);
  const [allExamples, setAllExamples]                 = useState<ExampleItem[]>([]);
  const [exampleIndex, setExampleIndex]               = useState(0);
  const [romanizationVisible, setRomanizationVisible] = useState(false);
  const [practiceSuccess, setPracticeSuccess]         = useState(0);
  const [practiceModalVisible, setPracticeModalVisible] = useState(false);
  const [loading, setLoading]                         = useState(false);
  const [quizLoading, setQuizLoading]                 = useState(false);
  const [status, setStatus]                           = useState("Initializing database...");

  const [tokenizeStatus, setTokenizeStatus] = useState<Record<number, "loading" | "done" | "error">>({});

  const [langPickerVisible, setLangPickerVisible]   = useState(false);
  const [langPickerTarget, setLangPickerTarget]     = useState<"input" | "output">("input");
  const [memoryCheckVisible, setMemoryCheckVisible] = useState(false);
  const [quizSetupVisible, setQuizSetupVisible]     = useState(false);
  const [quizWindowData, setQuizWindowData]         = useState<{
    data: QuizData; words: string[]; mode: "take" | "review"; pastAnswers?: string[]; quizId?: number;
  } | null>(null);
  const [translationPopup, setTranslationPopup] = useState<{ text: string; translation: string } | null>(null);

  const [quizWordCount, setQuizWordCount]         = useState(5);
  const [quizQuestionCount, setQuizQuestionCount] = useState(5);
  const [historyCount, setHistoryCount]           = useState(0);

  const [lessonNav, setLessonNav] = useState<{
    words: Array<{ id: number; word: string; language: string; level: string }>;
    currentIndex: number;
    language: string;
    level: string;
  } | null>(null);

  const [refreshKey, setRefreshKey] = useState(0);


  const [apiKey, setApiKey] = useState("");

  
  const hasDataRef       = useRef(false);
  const tokenizingSet    = useRef<Set<number>>(new Set());
  const tokenizeAbortRef = useRef<{ cancelled: boolean }>({ cancelled: false });
  const inflight         = useRef<Set<string>>(new Set());

  useEffect(() => { hasDataRef.current = currentData !== null; }, [currentData]);

  // ─────────────────────────────────────────────
  // DB INIT + MIGRATION
  // ─────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;
    const bootstrap = async () => {
      try {
        // Load settings TRƯỚC, song song với DB init
        const [_, settings] = await Promise.all([
          initDatabase(),
          loadSettings(),
        ]);
        
        if (cancelled) return;
        setApiKey(settings.chatgpt_api_key ?? "");
        const ok = await initDatabase();
        if (cancelled) return;
        if (!ok) { setDbError(true); setStatus("❌ Database init failed."); return; }

        const migDone = await kvGet<boolean>("migration_v1_done");
        if (!migDone) {
          if (!cancelled) { setMigrating(true); setStatus("⏳ Migrating to SQLite..."); }
          await migrateFromAsyncStorage(AsyncStorage);
          if (!cancelled) setMigrating(false);
        }

        if (cancelled) return;

        const savedSpeed = await kvGet<number>(KV_TTS_SPEED);
        if (!cancelled && savedSpeed && !isNaN(savedSpeed)) setTtsSpeed(savedSpeed);

        if (!cancelled) { setDbReady(true); setStatus("Ready to learn!"); }
      } catch (err) {
        console.error("[bootstrap]", err);
        if (!cancelled) { setDbError(true); setStatus("❌ Startup error."); }
      }
    };
    bootstrap();
    return () => { cancelled = true; };
  }, []);


  // Thêm useEffect riêng để subscribe:
  useEffect(() => {
    const unsub = subscribeSettings((s) => {
      setApiKey(s.chatgpt_api_key ?? "");
    });
    return unsub;
  }, []);

  // ─────────────────────────────────────────────
  // FOCUS EFFECT
  // ─────────────────────────────────────────────
  useFocusEffect(
    useCallback(() => {
      if (!dbReady) return;

      const load = async () => {
        try {
          const [reviewData, retakeData, pendingWordRaw, lessonNavRaw] = await Promise.all([
            AsyncStorage.getItem(CURRENT_REVIEW_KEY),
            AsyncStorage.getItem(CURRENT_RETAKE_KEY),
            AsyncStorage.getItem(PENDING_LESSON_WORD_KEY),
            AsyncStorage.getItem(LESSON_NAVIGATION_KEY),
          ]);

          if (lessonNavRaw) setLessonNav(JSON.parse(lessonNavRaw));

          if (reviewData) {
            const entry: QuizHistoryEntryLocal = JSON.parse(reviewData);
            setQuizWindowData({ data: entry.quiz_data, words: entry.words, mode: "review", pastAnswers: entry.user_answers });
            await AsyncStorage.removeItem(CURRENT_REVIEW_KEY);
            return;
          }

          if (retakeData) {
            const entry: QuizHistoryEntryLocal = JSON.parse(retakeData);
            setQuizWindowData({ data: entry.quiz_data, words: entry.words, mode: "take" });
            await AsyncStorage.removeItem(CURRENT_RETAKE_KEY);
            return;
          }

          if (pendingWordRaw) {
            await AsyncStorage.removeItem(PENDING_LESSON_WORD_KEY);
            const pending = JSON.parse(pendingWordRaw) as { word: string; id: number; language: string; level: string };
            setWord(pending.word);
            setInputLang(pending.language);

            const cached = await loadWordByInputLang(pending.word, pending.language);
            if (cached) {
              applyHistoryEntry(cached, "⚡");
              setStatus(`⚡ Loaded '${pending.word}' from cache`);
              if (pending.id) { await database.initDB(); await database.setLearned(pending.id, true); }
            } else {
              await fetchAndApplyWord(pending.word, pending.language, outputLang, async () => {
                if (pending.id) { await database.initDB(); await database.setLearned(pending.id, true); }
              });
            }
            return;
          }

          const wordData = await AsyncStorage.getItem(CURRENT_WORD_KEY);
          if (wordData) {
            const entry: HistoryEntry = JSON.parse(wordData);
            applyHistoryEntry(entry);
            setWord(entry.word);
            setInputLang(entry.input_lang);
            setOutputLang(entry.output_lang);
            setStatus(`Loaded '${entry.word}' from history`);
            await AsyncStorage.removeItem(CURRENT_WORD_KEY);
            return;
          }

          if (!hasDataRef.current) {
            const last = await loadLastLearned();
            if (last) {
              applyHistoryEntry(last);
              setWord(last.word);
              setInputLang(last.input_lang);
              setOutputLang(last.output_lang);
              setStatus(`📂 Restored '${last.word}' from last session`);
            }
          }
        } catch (e) {
          console.error("[loadPendingActions]", e);
        }
      };

      load();
    }, [dbReady])
  );

  const applyHistoryEntry = (entry: HistoryEntry, _prefix?: string) => {
    const examples = prepareExamples(entry.data as any);
    setCurrentData(entry.data as any);
    setAllExamples(examples);
    setRefreshKey(k => k + 1);
    setExampleIndex(0);
    setTokenizeStatus({});
    setRomanizationVisible(false);
    setPracticeSuccess(0);
    if (entry.output_lang) setOutputLang(entry.output_lang);
  };

  const fetchAndApplyWord = async (
    w: string,
    iLang: string,
    oLang: string,
    onSuccess?: () => Promise<void>
  ) => {
    setLoading(true);
    setStatus(`🔄 Learning '${w}'...`);
    try {
      const data = await learner.learnWord(w, iLang, oLang);
      if (!data.error) {
        const examples = prepareExamples(data);
        setCurrentData(data);
        setAllExamples(examples);
        setRefreshKey(k => k + 1);
        setExampleIndex(0);
        setTokenizeStatus({});
        setRomanizationVisible(false);
        setPracticeSuccess(0);
        setStatus(`✅ Ready to learn '${w}'!`);
        await saveWord(w, iLang, oLang, data);
        if (onSuccess) await onSuccess();
      }
    } catch (e: any) {
      console.error("[fetchAndApplyWord]", e);
      setStatus("❌ Error loading word.");
    } finally {
      setLoading(false);
    }
  };

  // ─────────────────────────────────────────────
  // SPEED
  // ─────────────────────────────────────────────
  const handleSpeedChange = useCallback(async (v: number) => {
    setTtsSpeed(v);
    try { await kvSet(KV_TTS_SPEED, v); }
    catch (err) { console.warn("[handleSpeedChange]", err); }
  }, []);

  // ─────────────────────────────────────────────
  // TOKENIZE
  // ─────────────────────────────────────────────
  useEffect(() => {
    if (allExamples.length === 0 || !currentData) return;

    tokenizeAbortRef.current = { cancelled: false };
    tokenizingSet.current    = new Set();
    const abortToken         = tokenizeAbortRef.current;

    const pendingIndices = allExamples
      .map((ex, i) => (!ex.tokens || ex.tokens.length === 0 ? i : -1))
      .filter((i) => i !== -1);

    if (pendingIndices.length === 0) return;

    setTokenizeStatus((prev) => {
      const next = { ...prev };
      for (const i of pendingIndices) next[i] = "loading";
      return next;
    });

    const tokenizeOne = async (i: number): Promise<{ i: number; tokens: string[] }> => {
      if (tokenizingSet.current.has(i)) throw new Error(`skip:${i}`);
      tokenizingSet.current.add(i);
      const tokens = await learner.tokenizeSentence(
        allExamples[i].sentence,
        currentData.language.input ?? inputLang
      );
      return { i, tokens };
    };

    Promise.allSettled(pendingIndices.map((i) => tokenizeOne(i))).then(async (results) => {
      if (abortToken.cancelled) return;

      const successMap: Record<number, string[]> = {};
      for (const r of results) {
        if (r.status === "fulfilled") successMap[r.value.i] = r.value.tokens;
      }

      const successIndices = Object.keys(successMap).map(Number);
      if (successIndices.length === 0 || abortToken.cancelled) return;

      setAllExamples((prev) => {
        const copy = [...prev];
        for (const i of successIndices) {
          if (!copy[i].tokens || copy[i].tokens!.length === 0)
            copy[i] = { ...copy[i], tokens: successMap[i] };
        }
        return copy;
      });

      setTokenizeStatus((prev) => {
        const next = { ...prev };
        for (const i of successIndices) next[i] = "done";
        return next;
      });

      setCurrentData((prevData) => {
        if (!prevData) return prevData;
        let updated = { ...prevData, examples: { ...prevData.examples } };
        for (const i of successIndices) {
          const pos = flatIndexToBucketPos(prevData.examples, i);
          if (!pos) continue;
          const bucket = [...(updated.examples[pos.diff] ?? [])];
          bucket[pos.j] = { ...bucket[pos.j], tokens: successMap[i] };
          updated.examples = { ...updated.examples, [pos.diff]: bucket };
        }
        const snapshot = updated;
        setTimeout(async () => {
          if (abortToken.cancelled) return;
          try {
            await updateExamples(
              snapshot.word, snapshot.language.input, snapshot.language.output,
              snapshot.examples
            );
          } catch (e) { console.warn("[tokenize persist]", e); }
        }, 0);
        return updated;
      });
    });

    return () => { abortToken.cancelled = true; tokenizingSet.current.clear(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allExamples.length, currentData?.word, refreshKey]);

  // ─────────────────────────────────────────────
  // LEARN WORD
  // ─────────────────────────────────────────────
  const handleLearnWord = async () => {
    if (!dbReady) { Alert.alert("Not Ready", "Database is still initializing."); return; }
    if (!word.trim()) { Alert.alert("Error", "Please enter a word."); return; }

    const key = `learn:${word.trim()}:${inputLang}:${outputLang}`;
    if (inflight.current.has(key)) { setStatus(`⏳ Already fetching '${word.trim()}'…`); return; }
    inflight.current.add(key);

    if (lessonNav && lessonNav.words[lessonNav.currentIndex]?.word !== word.trim()) {
      setLessonNav(null);
      AsyncStorage.removeItem(LESSON_NAVIGATION_KEY).catch(() => {});
    }

    setLoading(true);
    setStatus(`🔄 Learning '${word}'...`);
    try {
      const data = await learner.learnWord(word.trim(), inputLang, outputLang);
      if (data.error) { Alert.alert("API Error", data.error); setStatus("Error occurred."); return; }
      const examples = prepareExamples(data);
      setCurrentData(data);
      setAllExamples(examples);
      setRefreshKey(k => k + 1);
      setExampleIndex(0);
      setTokenizeStatus({});
      setRomanizationVisible(false);
      setPracticeSuccess(0);
      setStatus(`✅ Ready to learn '${word}' — ${examples.length} examples!`);
      await saveWord(word.trim(), inputLang, outputLang, data);
    } catch (e: any) {
      Alert.alert("Error", e.message ?? "Unknown error");
      setStatus("Error occurred.");
    } finally {
      setLoading(false);
      inflight.current.delete(key);
    }
  };

  // ─────────────────────────────────────────────
  // LESSON NAVIGATION
  // ─────────────────────────────────────────────
  const navigateLesson = useCallback(async (direction: "prev" | "next") => {
    if (!lessonNav || !dbReady) return;
    const { words, currentIndex, language } = lessonNav;
    const nextIndex = direction === "next" ? currentIndex + 1 : currentIndex - 1;
    if (nextIndex < 0 || nextIndex >= words.length) return;

    const target = words[nextIndex];
    const newNav = { ...lessonNav, currentIndex: nextIndex };
    setLessonNav(newNav);
    await AsyncStorage.setItem(LESSON_NAVIGATION_KEY, JSON.stringify(newNav)).catch(() => {});

    setWord(target.word);
    setInputLang(language);

    const cached = await loadWordByInputLang(target.word, language);
    if (cached) {
      applyHistoryEntry(cached);
      setStatus(`⚡ [${lessonNav.level}] ${nextIndex + 1}/${words.length} — from cache`);
      try {
        await kvSet("last_learned_ptr", {
          word: cached.word, input_lang: cached.input_lang,
          output_lang: cached.output_lang, learned_at: cached.timestamp,
        });
      } catch {}
      if (target.id) { await database.initDB(); await database.setLearned(target.id, true); }
    } else {
      setLoading(true);
      setStatus(`🔄 [${lessonNav.level}] ${nextIndex + 1}/${words.length} — '${target.word}'...`);
      try {
        const data = await learner.learnWord(target.word, language, outputLang);
        if (!data.error) {
          const examples = prepareExamples(data);
          setCurrentData(data);
          setAllExamples(examples);
          setRefreshKey(k => k + 1);
          setExampleIndex(0);
          setTokenizeStatus({});
          setRomanizationVisible(false);
          setPracticeSuccess(0);
          setStatus(`✅ [${lessonNav.level}] ${nextIndex + 1}/${words.length} — '${target.word}'`);
          if (target.id) { await database.initDB(); await database.setLearned(target.id, true); }
          await saveWord(target.word, language, outputLang, data);
        }
      } catch (e) {
        console.error("[navigateLesson]", e);
        setStatus("❌ Error loading word.");
      } finally {
        setLoading(false);
      }
    }
  }, [lessonNav, outputLang, dbReady]);

  // ─────────────────────────────────────────────
  // TRANSLATION POPUP
  // ─────────────────────────────────────────────
  const currentExample = allExamples[exampleIndex] ?? null;

  const handleTokenPress = async (token: string) => {
    const key = `translate:${token}:${inputLang}:${outputLang}`;
    if (inflight.current.has(key)) { speakText(token, inputLang, ttsSpeed); return; }
    inflight.current.add(key);

    speakText(token, inputLang, ttsSpeed);

    const memCached = currentData?.translation_cache?.[token];
    if (memCached) {
      setTranslationPopup({ text: token, translation: memCached });
      inflight.current.delete(key);
      return;
    }

    setTranslationPopup({ text: token, translation: "⏳ Translating..." });
    try {
      const result = await localDict.translateToken(
        token, inputLang, outputLang,
        async () => {
          const res = await learner.translateText(token, inputLang, outputLang);
          if (!res || res.startsWith("[Lỗi") || res.startsWith("❌") || res.startsWith("[Error")) {
            throw new Error(res);
          }
          return res;
        }
      );
      setTranslationPopup({ text: token, translation: result });

      // Chỉ cache khi thành công
      setCurrentData((prev) => {
        if (!prev) return prev;
        return { ...prev, translation_cache: { ...(prev.translation_cache ?? {}), [token]: result } };
      });

      if (currentData) {
        updateTranslationCache(
          currentData.word, currentData.language.input, currentData.language.output,
          { [token]: result }
        ).catch((e) => console.warn("[persist translation cache]", e));
      }
    } catch {
      // Không cache, xóa khỏi memCached nếu đã lỡ lưu
      localDict.evictFromCache(token, inputLang, outputLang);
      setTranslationPopup({ text: token, translation: "❌ Translation failed. Tap to retry." });
    } finally {
      inflight.current.delete(key);
    }
  };

  useEffect(() => { setTranslationPopup(null); }, [exampleIndex, currentData?.word]);
  useEffect(() => { inflight.current.clear(); }, [currentData?.word]);

  // ─────────────────────────────────────────────
  // QUIZ
  // ─────────────────────────────────────────────
  const handleGenerateQuiz = async () => {
    if (!dbReady) { Alert.alert("Not Ready", "Database is still initializing."); return; }
    const quizLang = currentData?.language?.input ?? inputLang;
    const count    = await countWords(quizLang);
    if (count === 0) {
      Alert.alert("No Words Found",
        `You haven't learned any ${quizLang} words yet.\n\nLearn at least 1 word first.`);
      return;
    }
    setHistoryCount(count);
    setQuizWordCount(Math.min(5, count));
    setQuizSetupVisible(true);
  };

  const startQuizGeneration = async () => {
    setQuizSetupVisible(false);
    const quizLang = currentData?.language?.input ?? inputLang;
    const words    = await listWordNames(quizLang, quizWordCount);
    if (words.length === 0) {
      Alert.alert("No Words Found", `No ${quizLang} words in history.`);
      return;
    }

    const key = `quiz:${words.join("|")}:${quizQuestionCount}`;
    if (inflight.current.has(key)) { setStatus("⏳ Quiz đang được tạo…"); return; }
    inflight.current.add(key);

    setQuizLoading(true);
    setStatus(`🔄 Generating ${quizQuestionCount}-question ${quizLang} quiz...`);
    try {
      const data = await learner.generateQuiz(words, quizLang, outputLang, quizQuestionCount);
      if (data.error) { Alert.alert("Error", data.error); return; }
      setQuizWindowData({ data, words, mode: "take" });
    } catch (e: any) {
      Alert.alert("Error", e.message ?? "Unknown error");
    } finally {
      setQuizLoading(false);
      setStatus("Ready to learn!");
      inflight.current.delete(key);
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
            {(ov.collocations ?? []).map((col, i) => (
              <TouchableOpacity key={i} onPress={() => handleTokenPress(col)}>
                <Text style={styles.collocToken}>
                  {col}{i < (ov.collocations?.length ?? 0) - 1 ? ", " : ""}
                </Text>
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
    const tokens       = currentExample.tokens;

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

  if (dbError) {
    return (
      <View style={[styles.root, { justifyContent: "center", alignItems: "center", padding: 30 }]}>
        <Text style={{ color: "#E74C3C", fontSize: 18, textAlign: "center", marginBottom: 16 }}>❌ Database Error</Text>
        <Text style={{ color: "#aaa", textAlign: "center", lineHeight: 22 }}>
          Could not initialize the local database.{"\n"}Please restart the app.
        </Text>
      </View>
    );
  }

  // ─────────────────────────────────────────────
  // MAIN RENDER
  // ─────────────────────────────────────────────
  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        onTouchStart={() => { if (translationPopup) setTranslationPopup(null); }}
      >
        <View style={styles.header}>
          <Text style={styles.headerTitle}>🌟 Vocabulary Learning</Text>
          {migrating && (
            <View style={styles.migrationBanner}>
              <ActivityIndicator size="small" color="#F1C40F" style={{ marginRight: 8 }} />
              <Text style={styles.migrationText}>Migrating data to SQLite…</Text>
            </View>
          )}
        </View>

        <View style={styles.card}>
          {/* Word input + lesson nav */}
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
                    AsyncStorage.removeItem(LESSON_NAVIGATION_KEY).catch(() => {});
                  }
                }}
                editable={dbReady}
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

          {/* Language pickers */}
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

          {/* Action buttons */}
          <View style={styles.actionRow}>
            <TouchableOpacity
              style={[styles.btnPrimary, (!dbReady || loading) && styles.btnDisabled]}
              onPress={handleLearnWord}
              disabled={!dbReady || loading}
            >
              {loading
                ? <ActivityIndicator color="#fff" size="small" />
                : <Text style={styles.btnPrimaryText}>🎓 Learn Word</Text>}
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.btnQuiz, (!dbReady || loading || quizLoading) && styles.btnDisabled]}
              onPress={handleGenerateQuiz}
              disabled={!dbReady || loading || quizLoading}
            >
              {quizLoading
                ? <ActivityIndicator color="#fff" size="small" />
                : <Text style={styles.btnPrimaryText}>📝 Quiz</Text>}
            </TouchableOpacity>
          </View>
          <Text style={styles.statusText}>{status}</Text>
        </View>

        {/* ── Word data card ── */}
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
                  <TTSButton onPress={() => speakText(currentExample.sentence, inputLang, ttsSpeed)} size={17} label="🔊 Play" />
                </View>
                <View style={styles.sentenceBox}>{renderSentenceTokens()}</View>
                {translationPopup && (
                  <View style={[styles.translationPopup, { maxHeight: 250 }]} onTouchStart={(e) => e.stopPropagation()}>
                    <View style={styles.translationPopupHeader}>
                      <Text style={styles.translationPopupWord}>{translationPopup.text}</Text>
                      <TTSButton onPress={() => speakText(translationPopup.text, inputLang, ttsSpeed)} size={15} />
                    </View>
                    <ScrollView nestedScrollEnabled style={{ marginVertical: 8 }} showsVerticalScrollIndicator>
                      <Text style={styles.translationPopupText}>{translationPopup.translation}</Text>
                    </ScrollView>
                    <TouchableOpacity onPress={() => setTranslationPopup(null)}>
                      <Text style={styles.translationPopupClose}>✕ Close</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            )}

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

      {/* ── MODALS ── */}
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

      {memoryCheckVisible && (
        <MemoryCheckModal
          examples={allExamples}
          inputLang={inputLang}
          ttsSpeed={ttsSpeed}
          onClose={() => setMemoryCheckVisible(false)}
          apiKey={apiKey}
        />
      )}

      <Modal visible={quizSetupVisible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.quizSetupBox}>
            <Text style={styles.quizSetupTitle}>⚙️ Quiz Setup</Text>
            <View style={styles.quizLangBadge}>
              <Text style={styles.quizLangBadgeText}>🌐 Language: {currentData?.language?.input ?? inputLang}</Text>
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
              <TouchableOpacity style={styles.stepperBtn} onPress={() => setQuizQuestionCount((n) => Math.min(30, n + 1))}>
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

      {practiceModalVisible && (
        <TypingPracticeModal
          example={currentExample}
          currentScore={practiceSuccess}
          onClose={() => setPracticeModalVisible(false)}
          onCorrect={() => setPracticeSuccess((n) => n + 1)}
          inputLang={inputLang}
          ttsSpeed={ttsSpeed}
          apiKey={apiKey}
        />
      )}

      {quizWindowData && (
        <QuizModal
          quizData={quizWindowData.data}
          words={quizWindowData.words}
          mode={quizWindowData.mode}
          pastAnswers={quizWindowData.pastAnswers}
          quizId={quizWindowData.quizId}
          onClose={() => setQuizWindowData(null)}
          onSaveResult={async (entry) => {
            try {
              return await saveQuiz({ ...entry, input_lang: currentData?.language?.input ?? inputLang });
            } catch (e) {
              console.error("[QuizModal saveQuiz]", e);
              return undefined;
            }
          }}
          inputLang={currentData?.language?.input ?? inputLang}
          outputLang={currentData?.language?.output ?? outputLang}
        />
      )}
    </KeyboardAvoidingView>
  );
}

// ─────────────────────────────────────────────
// SUB-COMPONENTS (unchanged from original)
// ─────────────────────────────────────────────
function ColoredInput({ input, target, placeholder, onChangeText, autoFocus = false }: {
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
        placeholderTextColor="#555"
        multiline
        autoCapitalize="none"
        autoCorrect={false}
        autoFocus={autoFocus}
      />
      {input.length > 0 && (
        <Text style={overlayStyle.text} pointerEvents="none">
          {input.split("").map((char, i) => (
            <Text key={i} style={{ color: i < target.length && char === target[i] ? "#2ECC71" : "#E74C3C" }}>{char}</Text>
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

function OverviewRow({ icon, label, value }: { icon: string; label: string; value: string }) {
  if (!value || value === "N/A") return null;
  return (
    <View style={styles.overviewRow}>
      <Text style={styles.overviewKey}>{icon} {label}: </Text>
      <Text style={styles.overviewValue}>{value}</Text>
    </View>
  );
}

function MemoryCheckModal({
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
            <Text style={styles.memCheckDoneText}>🎉 Amazing! You've recalled all examples!</Text>
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
              <View style={[styles.typingTargetBox, { marginBottom: 12, borderColor: "#E67E22" }]}>
                <Text style={[styles.typingTargetText, { color: "#E67E22" }]}>{target}</Text>
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

function TypingPracticeModal({
  example, currentScore, onClose, onCorrect, inputLang, ttsSpeed, apiKey = "",
}: {
  example: ExampleItem | null; currentScore: number;
  onClose: () => void; onCorrect: () => void;
  inputLang: string; ttsSpeed: number; apiKey?: string;
}) {
  const [input,     setInput]     = useState("");
  const [completed, setCompleted] = useState(false);
  const [tab,       setTab]       = useState<"typing" | "speech">("typing");
  const [speechKey, setSpeechKey] = useState(0);

  const target = example?.sentence?.trim() ?? "";

  useEffect(() => {
    if (!example?.sentence) return;
    const t = setTimeout(() => speakText(example.sentence, inputLang, ttsSpeed), 350);
    return () => clearTimeout(t);
  }, [example?.sentence]);

  const handleTypingChange = (text: string) => {
    setInput(text);
    if (text === target && target.length > 0) {
      onCorrect();
      setCompleted(true);
      setTimeout(() => { setInput(""); setCompleted(false); setSpeechKey(k => k + 1); }, 700);
    }
  };

  const handleSpeechResult = (passed: boolean) => {
    if (passed) {
      onCorrect();
      setCompleted(true);
      setTimeout(() => { setCompleted(false); setSpeechKey(k => k + 1); }, 1500);
    }
  };

  return (
    <Modal visible animationType="slide">
      <View style={styles.typingRoot}>
        <View style={styles.typingHeader}>
          <Text style={styles.typingTitle}>⌨️ Typing Practice</Text>
          <TouchableOpacity onPress={onClose}><Text style={styles.memCheckClose}>✕</Text></TouchableOpacity>
        </View>
        <ScrollView contentContainerStyle={styles.typingBody}>
          <Text style={styles.typingProgress}>Score: {currentScore}</Text>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <Text style={styles.typingPrompt}>Type the sentence exactly:</Text>
            <TTSButton onPress={() => speakText(target, inputLang, ttsSpeed)} size={17} label="🔊 Replay" />
          </View>
          <View style={styles.typingTargetBox}>
            <Text style={styles.typingTargetText}>{target || "No example available"}</Text>
          </View>
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
          {completed && (
            <View style={styles.typingSuccessBox}>
              <Text style={styles.typingSuccessText}>
                {tab === "speech" ? "✅ Great pronunciation!" : "✅ Correct! Keep going."}
              </Text>
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

function QuizModal({ quizData, words, mode, pastAnswers, quizId, onClose, onSaveResult, inputLang, outputLang }: {
  quizData: QuizData; words: string[]; mode: "take" | "review";
  pastAnswers?: string[];
  quizId?: number;
  onClose: () => void;
  onSaveResult: (entry: QuizHistoryEntryLocal) => Promise<number | undefined>;
  inputLang: string;
  outputLang: string;
}) {
  const questions = quizData.quiz ?? [];
  const [answers, setAnswers]     = useState<string[]>(pastAnswers ?? questions.map(() => ""));
  const [submitted, setSubmitted] = useState(mode === "review");
  const [score, setScore]         = useState(0);
  const [savedQuizId, setSavedQuizId] = useState<number | undefined>(quizId);
  const [explanations, setExplanations] = useState<Record<number, string | "loading">>({});

  useEffect(() => {
    if (mode === "review") {
      setScore(questions.reduce((acc, q, i) => acc + (pastAnswers?.[i] === q.answer ? 1 : 0), 0));
    }
  }, []);

  useEffect(() => {
    if (!savedQuizId) return;
    loadQuizExplanations(savedQuizId).then((cached) => {
      if (Object.keys(cached).length > 0) setExplanations(cached);
    }).catch(() => {});
  }, [savedQuizId]);

  const handleSubmit = async () => {
    const s = questions.reduce((acc, q, i) => acc + (answers[i] === q.answer ? 1 : 0), 0);
    setScore(s);
    setSubmitted(true);
    const newId = await onSaveResult({
      words, score: s, total: questions.length,
      timestamp: new Date().toISOString(), quiz_data: quizData, user_answers: answers,
    });
    if (newId !== undefined) setSavedQuizId(newId);
    Alert.alert("Result", `You got ${s} out of ${questions.length} correct!`);
  };

  const handleExplain = async (i: number) => {
    if (explanations[i] && explanations[i] !== "loading") return;
    setExplanations(prev => ({ ...prev, [i]: "loading" }));
    const q = questions[i];
    try {
      const text = await learner.explainQuizQuestion(
        q.question, q.options, q.answer,
        (q as any).word_tested ?? "", inputLang, outputLang
      );
      setExplanations(prev => ({ ...prev, [i]: text }));
      if (savedQuizId !== undefined) {
        saveQuizExplanation(savedQuizId, i, text).catch(() => {});
      }
    } catch (e: any) {
      setExplanations(prev => ({ ...prev, [i]: `❌ ${e.message}` }));
    }
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
            const expState  = explanations[i];
            return (
              <View key={i} style={[
                styles.quizQuestionCard,
                submitted && isCorrect && { borderColor: "#2ECC71", borderWidth: 2 },
                submitted && isWrong   && { borderColor: "#E74C3C", borderWidth: 2 },
              ]}>
                <Text style={[styles.quizQuestionText, { color: diffColor(q.difficulty) }]}>Q{i + 1}: {q.question}</Text>
                {q.options.map((opt) => {
                  const val          = opt[0];
                  const isSelected   = userAns === val;
                  const isCorrectOpt = submitted && val === q.answer;
                  const isWrongOpt   = submitted && isSelected && val !== q.answer;
                  return (
                    <View key={val} style={styles.quizOptionWrapper}>
                      <TouchableOpacity
                        style={[styles.quizOption, isSelected && !submitted && styles.quizOptionSelected, isCorrectOpt && styles.quizOptionCorrect, isWrongOpt && styles.quizOptionWrong]}
                        onPress={() => { if (submitted) return; const u = [...answers]; u[i] = val; setAnswers(u); }}
                        disabled={submitted}
                      >
                        <Text style={[styles.quizOptionText, isCorrectOpt && { color: "#2ECC71", fontWeight: "bold" }, isWrongOpt && { color: "#E74C3C" }]}>{opt}</Text>
                      </TouchableOpacity>
                      {submitted && isCorrectOpt && <Text style={styles.quizOptionMeta}>Correct answer</Text>}
                      {submitted && isWrongOpt   && <Text style={styles.quizOptionMeta}>Your answer</Text>}
                    </View>
                  );
                })}
                {submitted && (
                  <View style={{ marginTop: 10 }}>
                    {!expState ? (
                      <TouchableOpacity style={styles.explainBtn} onPress={() => handleExplain(i)}>
                        <Text style={styles.explainBtnText}>💬 Explain</Text>
                      </TouchableOpacity>
                    ) : expState === "loading" ? (
                      <View style={styles.explainLoading}>
                        <ActivityIndicator size="small" color="#F39C12" />
                        <Text style={styles.explainLoadingText}> Generating explanation…</Text>
                      </View>
                    ) : (
                      <View style={styles.quizExplanationBox}>
                        <Text style={styles.quizExplanation}>{expState}</Text>
                      </View>
                    )}
                  </View>
                )}
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
  migrationBanner: { flexDirection: "row", alignItems: "center", marginTop: 8, backgroundColor: "#0d1b2a", borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 },
  migrationText: { color: "#F1C40F", fontSize: 13 },
  card: { backgroundColor: "#16213e", borderRadius: 16, padding: 16, marginBottom: 16, shadowColor: "#000", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 8, elevation: 6 },
  langRow: { flexDirection: "row", alignItems: "center", marginBottom: 12 },
  langBlock: { flex: 1 },
  langLabel: { color: "#aaa", fontSize: 12, marginBottom: 4 },
  langPicker: { backgroundColor: "#0f3460", borderRadius: 8, paddingVertical: 10, paddingHorizontal: 12, borderWidth: 1, borderColor: "#1a4a7a" },
  langPickerText: { color: "#2CC985", fontWeight: "600" },
  langArrow: { color: "#555", fontSize: 20, marginHorizontal: 12, alignSelf: "flex-end", marginBottom: 8 },
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
  explainBtn: { backgroundColor: "#1a3a5c", borderRadius: 8, paddingVertical: 8, paddingHorizontal: 14, alignSelf: "flex-start", marginTop: 2, borderWidth: 1, borderColor: "#2980b9" },
  explainBtnText: { color: "#5DADE2", fontWeight: "600", fontSize: 13 },
  explainLoading: { flexDirection: "row", alignItems: "center", marginTop: 6 },
  explainLoadingText: { color: "#F39C12", fontSize: 13, fontStyle: "italic" },
  quizExplanationBox: { backgroundColor: "#1a1a1a", borderRadius: 8, padding: 10, marginTop: 4, borderLeftWidth: 3, borderLeftColor: "#F39C12" },
  wordInputRow: { flexDirection: "row", alignItems: "center", marginBottom: 14, gap: 8 },
  wordInput: { backgroundColor: "#0f3460", color: "#fff", borderRadius: 10, padding: 14, fontSize: 18, borderWidth: 1, borderColor: "#1a4a7a" },
  lessonNavArrow: { backgroundColor: "#1a4a7a", borderRadius: 10, width: 42, height: 74, alignItems: "center", justifyContent: "center" },
  lessonNavArrowText: { color: "#2CC985", fontSize: 18, fontWeight: "bold" },
  lessonNavHint: { color: "#5DADE2", fontSize: 11, marginTop: 4, marginLeft: 4, fontStyle: "italic" },
});

const mcStyles = StyleSheet.create({
  tabs:          { flexDirection: "row", gap: 10, marginTop: 16, marginBottom: 4 },
  tab:           { flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: "center", backgroundColor: "#0d1b2a", borderWidth: 1, borderColor: "#1a3a5c" },
  tabActive:     { backgroundColor: "#1a4a7a", borderColor: "#2CC985" },
  tabText:       { color: "#888", fontWeight: "600", fontSize: 14 },
  tabTextActive: { color: "#2CC985" },
});
