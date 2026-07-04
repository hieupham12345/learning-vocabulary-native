import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Modal,
  ActivityIndicator,
  Alert,
  Platform,
  KeyboardAvoidingView,
  Pressable,
  Animated
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { VocabularyLearner } from "../../scripts/VocabularyLearner";
import { useFocusEffect } from "expo-router";
import { localDict } from "@/scripts/LocalDictionary";
import { database } from "@/scripts/VocabularyDB";
import { loadSettings, subscribeSettings } from "@/scripts/settings-store";
import { bumpActivity, refreshProgress } from "@/scripts/progress-store";
import { StreakPill } from "@/components/progress/StreakPill";
import { speakText } from "@/scripts/tts";
import { DIFFICULTY_COLORS } from "@/constants/palette";
import type {
  ExampleItem,
  VocabDataLocal,
  QuizData,
  QuizHistoryEntryLocal,
} from "@/types/vocab";
import { SpeedControl } from "@/components/vocab/SpeedControl";
import { TTSButton } from "@/components/vocab/TTSButton";
import { OverviewRow } from "@/components/vocab/OverviewRow";
import { MemoryCheckModal } from "@/components/vocab/MemoryCheckModal";
import { TypingPracticeModal } from "@/components/vocab/TypingPracticeModal";
import { QuizModal } from "@/components/vocab/QuizModal";
import { styles } from "@/components/vocab/styles";

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
  kvGet,
  kvSet,
  type HistoryEntry,
} from "@/scripts/ExampleDB";

// ─────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────
const LANGUAGE_OPTIONS = ["Chinese", "English", "Japanese", "Vietnamese", "Korean"];

const CURRENT_WORD_KEY        = "@current_word_data";
const CURRENT_REVIEW_KEY      = "@current_quiz_review";
const CURRENT_RETAKE_KEY      = "@current_quiz_retake";
const PENDING_LESSON_WORD_KEY = "@pending_lesson_word";
const LESSON_NAVIGATION_KEY   = "@lesson_navigation_context";
const KV_TTS_SPEED            = "tts_speed";

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

  const ttsSpeedRef = useRef(1.5);

  
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

  const [isFlipped, setIsFlipped] = useState(false);
  const flipAnim = useRef(new Animated.Value(0)).current;

  const handleFlip = () => {
    const toValue = isFlipped ? 0 : 1;
    Animated.timing(flipAnim, {
      toValue,
      duration: 400,
      useNativeDriver: true,
    }).start();
    setIsFlipped(v => !v);
  };

  const frontRotate = flipAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "180deg"],
  });

  const backRotate = flipAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ["180deg", "360deg"],
  });


  const hasDataRef       = useRef(false);
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
      // Mở/tab vào home → tính lại streak/todayCount (đề phòng đã sang ngày mới)
      refreshProgress().catch(() => {});

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
              if (pending.id) { await database.initDB(); if (await database.markLearned(pending.id)) bumpActivity(1); }
            } else {
              await fetchAndApplyWord(pending.word, pending.language, outputLang, async () => {
                if (pending.id) { await database.initDB(); if (await database.markLearned(pending.id)) bumpActivity(1); }
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

  /**
   * Load a VocabData object into the screen and reset all per-word view state.
   * Single source for the 4 flows (learn, cached-load, lesson-nav, restore)
   * that used to repeat this same block of setState calls.
   * Returns the flattened examples so callers can build a status message.
   */
  const applyVocabData = (data: VocabDataLocal): ExampleItem[] => {
    const examples = prepareExamples(data);
    setCurrentData(data);
    setAllExamples(examples);
    setRefreshKey(k => k + 1);
    setExampleIndex(0);
    setTokenizeStatus({});
    setRomanizationVisible(false);
    setPracticeSuccess(0);
    return examples;
  };

  const applyHistoryEntry = (entry: HistoryEntry, _prefix?: string) => {
    applyVocabData(entry.data as any);
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
        applyVocabData(data);
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

    const sentences = pendingIndices.map((i) => allExamples[i].sentence);
    const lang = currentData.language.input ?? inputLang;

    // Tách token TẤT CẢ câu trong 1 prompt (JSON) — tránh spam webview
    learner.tokenizeSentences(sentences, lang).then(async (tokenArrays) => {
      if (abortToken.cancelled) return;

      const successMap: Record<number, string[]> = {};
      pendingIndices.forEach((idx, k) => {
        const toks = tokenArrays[k];
        if (Array.isArray(toks) && toks.length > 0) successMap[idx] = toks;
      });

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

    return () => { abortToken.cancelled = true; };
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
      const examples = applyVocabData(data);
      setStatus(`✅ Ready to learn '${word}' — ${examples.length} examples!`);
      await saveWord(word.trim(), inputLang, outputLang, data);
      // Chỉ +streak/+goal khi đây là từ MỚI (lần đầu học), không tính học lại
      await database.initDB();
      if (await database.learnWordByText(word.trim(), inputLang)) bumpActivity(1);
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
      if (target.id) { await database.initDB(); if (await database.markLearned(target.id)) bumpActivity(1); }
    } else {
      setLoading(true);
      setStatus(`🔄 [${lessonNav.level}] ${nextIndex + 1}/${words.length} — '${target.word}'...`);
      try {
        const data = await learner.learnWord(target.word, language, outputLang);
        if (!data.error) {
          applyVocabData(data);
          setStatus(`✅ [${lessonNav.level}] ${nextIndex + 1}/${words.length} — '${target.word}'`);
          if (target.id) { await database.initDB(); if (await database.markLearned(target.id)) bumpActivity(1); }
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
    if (inflight.current.has(key)) { setStatus("⏳ Creating quiz…"); return; }
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
          <StreakPill />
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
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    
                    <Text style={styles.diffTag}>
                      {"📊 Level: "}
                      <Text style={{ color: DIFFICULTY_COLORS[currentExample.difficulty_tag] ?? "#fff" }}>
                        {currentExample.difficulty_tag}
                      </Text>
                    </Text>
                  </View>
                  <TTSButton onPress={() => speakText(currentExample.sentence, inputLang, ttsSpeed)} size={17} label="🔊 Play" />
                </View>

                <TouchableOpacity
                  activeOpacity={1}
                  onPress={handleFlip}
                  style={styles.flipCardWrapper}
                >
                  <Animated.View
                    style={[
                      styles.flipCardFace,
                      { transform: [{ rotateY: frontRotate }] },
                      isFlipped && { position: "absolute", top: 0, left: 0, right: 0 },
                    ]}
                    pointerEvents={isFlipped ? "none" : "auto"}
                  >
                    <View style={styles.sentenceBox}>{renderSentenceTokens()}</View>
                  </Animated.View>

                  <Animated.View
                    style={[
                      styles.flipCardFace,
                      styles.flipCardBack,
                      { transform: [{ rotateY: backRotate }] },
                      !isFlipped && { position: "absolute", top: 0, left: 0, right: 0 },
                    ]}
                    pointerEvents={!isFlipped ? "none" : "auto"}
                  >
                    <View style={[styles.sentenceBox, { backgroundColor: "#0d2a1a" }]}>
                      <Text style={[styles.sentenceText, { color: "#2ECC71" }]}>
                        {currentExample.translation}
                      </Text>
                    </View>
                    {currentExample.explanation ? (
                      <View style={{ marginTop: 8 }}>
                        <Text style={{ color: "#5DADE2", fontSize: 13 }}>
                          {`💡 ${currentExample.explanation}`}
                        </Text>
                      </View>
                    ) : null}
                  </Animated.View>
                </TouchableOpacity>

                {/* Popup dịch: đặt NGOÀI flip TouchableOpacity để nó không giành gesture cuộn của ScrollView */}
                {translationPopup && !isFlipped && (
                  <View style={[styles.translationPopup, { maxHeight: 250 }]} onTouchStart={(e) => e.stopPropagation()}>
                    <View style={styles.translationPopupHeader}>
                      <Text style={styles.translationPopupWord}>{translationPopup.text}</Text>
                      <TTSButton onPress={() => speakText(translationPopup.text, inputLang, ttsSpeed)} size={15} />
                    </View>
                    <ScrollView
                      nestedScrollEnabled
                      style={{ marginVertical: 8, maxHeight: 180 }}
                      showsVerticalScrollIndicator
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
          onCorrect={() => { setPracticeSuccess((n) => n + 1); }}
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
              const id = await saveQuiz({ ...entry, input_lang: currentData?.language?.input ?? inputLang });
              return id;
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
