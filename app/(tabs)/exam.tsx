/**
 * exam.tsx
 * Exam tab — Reading Practice (Luyện đọc)
 * UI follows History.tsx patterns, dark navy theme
 *
 * Upgrades:
 *  - LocalDictionary (L1 memory → L2 SQLite → L3 API) để tiết kiệm API calls
 *  - Tooltip tự ẩn khi user kéo ScrollView (onScroll)
 */

import React, { useState, useCallback, useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
  Modal,
  ActivityIndicator,
  Dimensions,
  NativeSyntheticEvent,
  NativeScrollEvent,
  TouchableWithoutFeedback,
  TextInput,   

} from "react-native";
import { useFocusEffect } from "expo-router";
import * as SQLite from "expo-sqlite";
import { VocabularyLearner } from "../../scripts/VocabularyLearner";
import { callChatbot } from "../../scripts/chatbotService";
import Constants from "expo-constants";
import { localDict } from "../../scripts/LocalDictionary"; // ← NEW
import { getSettings } from "@/scripts/settings-store";

// ─────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────

const { api_key, model, agent } = getSettings();
  
const GPT_API_KEY = api_key;
const AGENT = agent;
const MODEL = model;

const learner = new VocabularyLearner();

function buildKeywordPrompt(inputLang: string, topic: string): string {
  return `Generate a single short, specific keyword or phrase (2-5 words) in English that could serve as a unique angle or focus for a ${inputLang} reading passage on the topic "${topic}". Be creative and specific — avoid generic words. Return only the keyword, nothing else.`;
}

// ─────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────
export interface ReadingPassage {
  title: string;
  body: string;
  level: string;
  topic: string;
  word_count: number;
  vocabulary_notes: Array<{ word: string; reading?: string; meaning: string }>;
  comprehension_questions: Array<{
    question: string;
    options: string[];
    answer: string; // "A"|"B"|"C"|"D"
    explanation: string;
  }>;
}

export interface ReadingHistoryEntry {
  id?: number;
  title: string;
  input_lang: string;
  output_lang: string;
  level: string;
  length: string;
  topic: string;
  timestamp: string;
  passage: ReadingPassage;
  tokens: string[] | null;
  user_answers: string[];
  score: number;
  total: number;
  completed: boolean;
}

// ─────────────────────────────────────────────
// DATABASE
// ─────────────────────────────────────────────
let _db: SQLite.SQLiteDatabase | null = null;

async function getDB(): Promise<SQLite.SQLiteDatabase> {
  if (_db) return _db;
  _db = await SQLite.openDatabaseAsync("exam_reading.db");
  await _db.execAsync(`
    CREATE TABLE IF NOT EXISTS reading_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      input_lang TEXT NOT NULL,
      output_lang TEXT NOT NULL,
      level TEXT NOT NULL,
      length TEXT NOT NULL,
      topic TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      passage_json TEXT NOT NULL,
      tokens_json TEXT,
      user_answers_json TEXT NOT NULL,
      score INTEGER NOT NULL DEFAULT 0,
      total INTEGER NOT NULL DEFAULT 0,
      completed INTEGER NOT NULL DEFAULT 0
    );
  `);
  try {
    await _db.execAsync(`ALTER TABLE reading_history ADD COLUMN tokens_json TEXT`);
  } catch {
    // Column already exists — ignore
  }
  return _db;
}

export async function saveReading(entry: ReadingHistoryEntry): Promise<number> {
  const db = await getDB();
  const result = await db.runAsync(
    `INSERT INTO reading_history
      (title, input_lang, output_lang, level, length, topic, timestamp, passage_json, tokens_json, user_answers_json, score, total, completed)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      entry.title,
      entry.input_lang,
      entry.output_lang,
      entry.level,
      entry.length,
      entry.topic,
      entry.timestamp,
      JSON.stringify(entry.passage),
      entry.tokens ? JSON.stringify(entry.tokens) : null,
      JSON.stringify(entry.user_answers),
      entry.score,
      entry.total,
      entry.completed ? 1 : 0,
    ]
  );
  return result.lastInsertRowId;
}

export async function updateReading(entry: ReadingHistoryEntry): Promise<void> {
  if (!entry.id) return;
  const db = await getDB();
  await db.runAsync(
    `UPDATE reading_history SET
      tokens_json = ?,
      user_answers_json = ?,
      score = ?,
      total = ?,
      completed = ?
     WHERE id = ?`,
    [
      entry.tokens ? JSON.stringify(entry.tokens) : null,
      JSON.stringify(entry.user_answers),
      entry.score,
      entry.total,
      entry.completed ? 1 : 0,
      entry.id,
    ]
  );
}

export async function listReadings(opts?: { limit?: number }): Promise<ReadingHistoryEntry[]> {
  const db = await getDB();
  const limit = opts?.limit ?? 100;
  const rows = await db.getAllAsync<any>(
    `SELECT * FROM reading_history ORDER BY timestamp DESC LIMIT ?`,
    [limit]
  );
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    input_lang: r.input_lang,
    output_lang: r.output_lang,
    level: r.level,
    length: r.length,
    topic: r.topic,
    timestamp: r.timestamp,
    passage: JSON.parse(r.passage_json),
    tokens: r.tokens_json ? JSON.parse(r.tokens_json) : null,
    user_answers: JSON.parse(r.user_answers_json),
    score: r.score,
    total: r.total,
    completed: r.completed === 1,
  }));
}

export async function clearReadingHistory(): Promise<void> {
  const db = await getDB();
  await db.runAsync(`DELETE FROM reading_history`);
}

// ─────────────────────────────────────────────
// PROMPT
// ─────────────────────────────────────────────
const LEVEL_MAP: Record<string, string[]> = {
  Chinese: ["HSK 1", "HSK 2", "HSK 3", "HSK 4", "HSK 5", "HSK 6"],
  Japanese: ["JLPT N5", "JLPT N4", "JLPT N3", "JLPT N2", "JLPT N1"],
  English: ["CEFR A1", "CEFR A2", "CEFR B1", "CEFR B2", "CEFR C1", "CEFR C2"],
  Korean: ["TOPIK 1", "TOPIK 2", "TOPIK 3", "TOPIK 4", "TOPIK 5", "TOPIK 6"],
  Vietnamese: ["Beginner", "Elementary", "Intermediate", "Upper-Intermediate", "Advanced"],
};

const LENGTH_WORDS: Record<string, string> = {
  short: "80–150 words",
  medium: "200–350 words",
  long: "450–650 words",
};

const TOPICS = [
  "Daily Life", "Travel", "Food & Culture", "Technology", "Nature",
  "Health", "Business", "History", "Science", "Society",
];

function buildReadingPrompt(
  inputLang: string,
  outputLang: string,
  level: string,
  length: string,
  topic: string,
  keyword: string          // ← thêm param
): string {
  const wordRange = LENGTH_WORDS[length] ?? "150–250 words";
  const keywordLine = keyword.trim()
    ? `- Specific angle / keyword: "${keyword.trim()}" — weave this naturally into the passage`
    : "";
  return `You are an expert ${inputLang} language examiner creating a reading comprehension passage for a standardized exam.

TASK: Generate a complete reading comprehension exercise.

SETTINGS:
- Passage language: ${inputLang}
- Explanation / question language: ${outputLang}
- Proficiency level: ${level}
- Passage length: ${wordRange}
- Topic: ${topic}
${keywordLine}

STRICT RULES:
1. The passage body MUST be written entirely in ${inputLang}.
2. The title MUST be in ${inputLang}.
3. All comprehension questions and options MUST be written in ${inputLang}.
4. "explanation" for each question MUST be in ${outputLang}.
5. vocabulary_notes: "word" and "reading" (romanization if applicable) in ${inputLang}; "meaning" in ${outputLang}.
6. Output valid JSON only — no markdown, no code blocks.

OUTPUT JSON:
{
  "title": "<passage title in ${inputLang}>",
  "body": "<full passage text in ${inputLang}>",
  "level": "${level}",
  "topic": "${topic}",
  "word_count": <integer>,
  "vocabulary_notes": [
    { "word": "<key word in ${inputLang}>", "reading": "<romanization or null>", "meaning": "<meaning in ${outputLang}>" }
  ],
  "comprehension_questions": [
    {
      "question": "<question in ${inputLang}>",
      "options": ["A. <${inputLang}>", "B. <${inputLang}>", "C. <${inputLang}>", "D. <${inputLang}>"],
      "answer": "<A|B|C|D>",
      "explanation": "<why correct, in ${outputLang}>"
    }
  ]
}

Generate exactly 4 comprehension questions covering: main idea, detail, vocabulary-in-context, and inference.
Vocabulary notes: include 5–8 key words from the passage.`;
}

// ─────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────
const LANG_OPTIONS = ["Chinese", "Japanese", "English", "Korean", "Vietnamese"];
const OUTPUT_LANG_OPTIONS = ["Vietnamese", "English", "Chinese", "Japanese", "Korean"];

export default function ExamScreen() {
  const [historyTab, setHistoryTab] = useState(false);

  const [inputLang, setInputLang] = useState("Chinese");
  const [outputLang, setOutputLang] = useState("Vietnamese");
  const [level, setLevel] = useState("HSK 3");
  const [length, setLength] = useState<"short" | "medium" | "long">("medium");
  const [topic, setTopic] = useState("Daily Life");

  const [generating, setGenerating] = useState(false);

  const [readingModal, setReadingModal] = useState(false);
  const [activeEntry, setActiveEntry] = useState<ReadingHistoryEntry | null>(null);

  const [history, setHistory] = useState<ReadingHistoryEntry[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const [inputLangPicker, setInputLangPicker] = useState(false);
  const [outputLangPicker, setOutputLangPicker] = useState(false);
  const [levelPicker, setLevelPicker] = useState(false);
  const [topicPicker, setTopicPicker] = useState(false);


  const [keyword, setKeyword] = useState("");
  const [generatingKeyword, setGeneratingKeyword] = useState(false);

  const loadHistory = useCallback(async () => {
    setLoadingHistory(true);
    try {
      const rows = await listReadings({ limit: 100 });
      setHistory(rows);
    } catch (e) {
      console.error("loadHistory reading:", e);
    } finally {
      setLoadingHistory(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadHistory();
    }, [loadHistory])
  );

  const handleInputLangChange = (lang: string) => {
    setInputLang(lang);
    const levels = LEVEL_MAP[lang] ?? ["Beginner", "Intermediate", "Advanced"];
    setLevel(levels[2] ?? levels[0]);
    setInputLangPicker(false);
  };

  const handleRandomKeyword = async () => {
    setGeneratingKeyword(true);
    try {
      const prompt = buildKeywordPrompt(inputLang, topic);
      const result = await callChatbot(prompt, MODEL, AGENT, GPT_API_KEY);
      setKeyword(result.trim().replace(/^["']|["']$/g, ""));
    } catch {
      // silent fail — user can retry
    } finally {
      setGeneratingKeyword(false);
    }
  };

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const prompt = buildReadingPrompt(inputLang, outputLang, level, length, topic, keyword);
      const raw = await callChatbot(prompt, MODEL, AGENT, GPT_API_KEY);
      let clean = raw.trim();
      if (clean.startsWith("```json")) clean = clean.slice(7).trim();
      else if (clean.startsWith("```")) clean = clean.slice(3).trim();
      if (clean.endsWith("```")) clean = clean.slice(0, -3).trim();

      const passage: ReadingPassage = JSON.parse(clean);

      const entry: ReadingHistoryEntry = {
        title: passage.title,
        input_lang: inputLang,
        output_lang: outputLang,
        level,
        length,
        topic,
        timestamp: new Date().toISOString(),
        passage,
        tokens: null,
        user_answers: passage.comprehension_questions.map(() => ""),
        score: 0,
        total: passage.comprehension_questions.length,
        completed: false,
      };

      const id = await saveReading(entry);
      const saved = { ...entry, id };

      setHistory((prev) => [saved, ...prev]);
      setActiveEntry(saved);
      setReadingModal(true);
    } catch (e: any) {
      Alert.alert("Error", e.message ?? "Failed to generate passage.");
    } finally {
      setGenerating(false);
    }
  };

  const openEntry = (entry: ReadingHistoryEntry) => {
    setActiveEntry({ ...entry });
    setReadingModal(true);
  };

  const handleClear = () => {
    Alert.alert("Confirm", "Clear all reading history?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Clear", style: "destructive",
        onPress: async () => {
          await clearReadingHistory();
          setHistory([]);
          Alert.alert("Done", "Reading history cleared.");
        },
      },
    ]);
  };

  const levels = LEVEL_MAP[inputLang] ?? ["Beginner", "Intermediate", "Advanced"];

  return (
    <ScrollView style={s.container} contentContainerStyle={s.containerContent} nestedScrollEnabled>
      <View style={s.header}>
        <Text style={s.headerTitle}>🎓 Exam Practice</Text>
      </View>

      <View style={s.card}>
        <View style={s.tabRow}>
          <TouchableOpacity
            style={[s.tab, !historyTab && s.tabActive]}
            onPress={() => setHistoryTab(false)}
          >
            <Text style={[s.tabText, !historyTab && s.tabTextActive]}>📖 Reading</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.tab, historyTab && s.tabActive]}
            onPress={() => setHistoryTab(true)}
          >
            <Text style={[s.tabText, historyTab && s.tabTextActive]}>🕘 History</Text>
          </TouchableOpacity>
        </View>

        {!historyTab && (
          <View>
            <Text style={s.sectionLabel}>🌐 Languages</Text>
            <View style={s.langRow}>
              <View style={{ flex: 1 }}>
                <Text style={s.miniLabel}>Passage language</Text>
                <TouchableOpacity style={s.picker} onPress={() => setInputLangPicker(true)}>
                  <Text style={s.pickerText}>{inputLang} ▼</Text>
                </TouchableOpacity>
              </View>
              <Text style={s.arrow}>→</Text>
              <View style={{ flex: 1 }}>
                <Text style={s.miniLabel}>Explanation in</Text>
                <TouchableOpacity style={s.picker} onPress={() => setOutputLangPicker(true)}>
                  <Text style={s.pickerText}>{outputLang} ▼</Text>
                </TouchableOpacity>
              </View>
            </View>

            <Text style={s.sectionLabel}>📊 Level</Text>
            <TouchableOpacity style={s.pickerFull} onPress={() => setLevelPicker(true)}>
              <Text style={s.pickerText}>{level} ▼</Text>
            </TouchableOpacity>

            <Text style={s.sectionLabel}>📏 Length</Text>
            <View style={s.chipRow}>
              {(["short", "medium", "long"] as const).map((l) => (
                <TouchableOpacity
                  key={l}
                  style={[s.chip, length === l && s.chipActive]}
                  onPress={() => setLength(l)}
                >
                  <Text style={[s.chipText, length === l && s.chipTextActive]}>
                    {l === "short" ? "⚡ Short" : l === "medium" ? "📄 Medium" : "📚 Long"}
                  </Text>
                  <Text style={[s.chipSub, length === l && { color: "#aaa" }]}>
                    {LENGTH_WORDS[l]}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={s.sectionLabel}>🏷️ Topic</Text>
      
            <TouchableOpacity style={s.pickerFull} onPress={() => setTopicPicker(true)}>
              <Text style={s.pickerText}>{topic} ▼</Text>
            </TouchableOpacity>

            <Text style={s.sectionLabel}>🔑 Keyword</Text>
            <View style={s.keywordRow}>
              <TextInput
                style={s.keywordInput}
                value={keyword}
                onChangeText={setKeyword}
                placeholder="e.g. morning routine, street food…"
                placeholderTextColor="#444"
              />
              <TouchableOpacity
                style={[s.keywordGenBtn, generatingKeyword && { opacity: 0.5 }]}
                onPress={handleRandomKeyword}
                disabled={generatingKeyword}
              >
                {generatingKeyword
                  ? <ActivityIndicator size="small" color="#2CC985" />
                  : <Text style={s.keywordGenBtnText}>✨ Random</Text>
                }
              </TouchableOpacity>
            </View>


            <TouchableOpacity
              style={[s.generateBtn, generating && { opacity: 0.6 }]}
              onPress={handleGenerate}
              disabled={generating}
            >
              {generating ? (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <ActivityIndicator color="#16213e" size="small" />
                  <Text style={s.generateBtnText}>Generating passage…</Text>
                </View>
              ) : (
                <Text style={s.generateBtnText}>✨ Generate Reading</Text>
              )}
            </TouchableOpacity>
          </View>
        )}

        {historyTab && (
          <ScrollView
            style={s.historyList}
            contentContainerStyle={s.historyListContent}
            nestedScrollEnabled
          >
            {loadingHistory ? (
              <ActivityIndicator color="#F1C40F" style={{ marginTop: 20 }} />
            ) : history.length === 0 ? (
              <Text style={s.emptyText}>No reading sessions yet.</Text>
            ) : (
              history.map((entry, i) => (
                <View key={i} style={s.historyItem}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.historyTitle} numberOfLines={2}>{entry.title}</Text>
                    <Text style={s.historyMeta}>
                      {entry.level} · {entry.input_lang} · {entry.length}
                    </Text>
                    <Text style={s.historyMeta}>
                      {entry.completed
                        ? `✅ ${entry.score}/${entry.total} · `
                        : "🔲 Not attempted · "}
                      {new Date(entry.timestamp).toLocaleDateString()}
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={s.reviewBtn}
                    onPress={() => openEntry(entry)}
                  >
                    <Text style={s.reviewBtnText}>Review</Text>
                  </TouchableOpacity>
                </View>
              ))
            )}
            {history.length > 0 && (
              <TouchableOpacity style={s.clearBtn} onPress={handleClear}>
                <Text style={s.clearBtnText}>🗑️ Clear History</Text>
              </TouchableOpacity>
            )}
          </ScrollView>
        )}
      </View>

      {/* ── PICKERS ── */}
      <Modal visible={inputLangPicker} transparent animationType="slide">
        <TouchableOpacity
          style={s.modalOverlay}
          activeOpacity={1}
          onPress={() => setInputLangPicker(false)}
        >
          <View style={s.pickerSheet}>
            <Text style={s.pickerSheetTitle}>Passage Language</Text>
            {LANG_OPTIONS.map((l) => (
              <TouchableOpacity
                key={l}
                style={s.pickerSheetItem}
                onPress={() => handleInputLangChange(l)}
              >
                <Text style={s.pickerSheetItemText}>{l}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>

      <Modal visible={outputLangPicker} transparent animationType="slide">
        <TouchableOpacity
          style={s.modalOverlay}
          activeOpacity={1}
          onPress={() => setOutputLangPicker(false)}
        >
          <View style={s.pickerSheet}>
            <Text style={s.pickerSheetTitle}>Explanation Language</Text>
            {OUTPUT_LANG_OPTIONS.map((l) => (
              <TouchableOpacity
                key={l}
                style={s.pickerSheetItem}
                onPress={() => { setOutputLang(l); setOutputLangPicker(false); }}
              >
                <Text style={s.pickerSheetItemText}>{l}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>

      <Modal visible={levelPicker} transparent animationType="slide">
        <TouchableOpacity
          style={s.modalOverlay}
          activeOpacity={1}
          onPress={() => setLevelPicker(false)}
        >
          <View style={s.pickerSheet}>
            <Text style={s.pickerSheetTitle}>Proficiency Level</Text>
            {levels.map((l) => (
              <TouchableOpacity
                key={l}
                style={s.pickerSheetItem}
                onPress={() => { setLevel(l); setLevelPicker(false); }}
              >
                <Text style={s.pickerSheetItemText}>{l}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>

      <Modal visible={topicPicker} transparent animationType="slide">
        <TouchableOpacity
          style={s.modalOverlay}
          activeOpacity={1}
          onPress={() => setTopicPicker(false)}
        >
          <View style={s.pickerSheet}>
            <Text style={s.pickerSheetTitle}>Topic</Text>
            <ScrollView style={{ maxHeight: 320 }} nestedScrollEnabled>
              {TOPICS.map((t) => (
                <TouchableOpacity
                  key={t}
                  style={s.pickerSheetItem}
                  onPress={() => { setTopic(t); setTopicPicker(false); }}
                >
                  <Text style={s.pickerSheetItemText}>{t}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* ── READING MODAL ── */}
      {readingModal && activeEntry && (
        <ReadingModal
          entry={activeEntry}
          onClose={() => { setReadingModal(false); setActiveEntry(null); }}
          onUpdate={async (updated) => {
            await updateReading(updated);
            setHistory((prev) => {
              const idx = prev.findIndex((e) => e.id === updated.id);
              if (idx >= 0) {
                const copy = [...prev];
                copy[idx] = updated;
                return copy;
              }
              return prev;
            });
          }}
        />
      )}
    </ScrollView>
  );
}

// ─────────────────────────────────────────────
// READING MODAL
// ─────────────────────────────────────────────
function ReadingModal({
  entry,
  onClose,
  onUpdate,
}: {
  entry: ReadingHistoryEntry;
  onClose: () => void;
  onUpdate: (updated: ReadingHistoryEntry) => Promise<void>;
}) {
  const passage = entry.passage;
  const inputLang = entry.input_lang;
  const outputLang = entry.output_lang;
  const isReview = entry.completed;

  const [phase, setPhase] = useState<"read" | "quiz">(isReview ? "quiz" : "read");
  const [answers, setAnswers] = useState<string[]>(
    isReview ? entry.user_answers : passage.comprehension_questions.map(() => "")
  );
  const [submitted, setSubmitted] = useState(isReview);
  const [score, setScore] = useState(entry.score);

  const [tokens, setTokens] = useState<string[] | null>(entry.tokens ?? null);
  const [tokenizing, setTokenizing] = useState(false);
  const tokensSaved = useRef(entry.tokens !== null);

  // tooltip: map từ token index → { text, align }
  const [translationMap, setTranslationMap] = useState<
    Record<number, { text: string; align: "left" | "right" }>
  >({});

  // inflight set để tránh gọi API trùng
  const inflight = useRef<Set<string>>(new Set());

  // Tokenize on mount only if not cached
  React.useEffect(() => {
    if (tokens !== null || tokenizing) return;
    setTokenizing(true);
    learner
      .tokenizeSentence(passage.body, inputLang)
      .then((t) => {
        setTokens(t);
        if (!tokensSaved.current) {
          const updated = { ...entry, tokens: t };
          onUpdate(updated).catch(() => {});
          tokensSaved.current = true;
        }
      })
      .catch(() => setTokens(passage.body.split(/(\s+)/)))
      .finally(() => setTokenizing(false));
  }, []);


  // ── Thêm vào sau khai báo inflight.current ──
  const hasTooltip = Object.keys(translationMap).length > 0;

  const dismissTooltip = useCallback(() => {
    setTranslationMap({});
  }, []);


  // ── NEW: ẩn tooltip khi user scroll ──────────
  const handlePassageScroll = useCallback(
    (_e: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (Object.keys(translationMap).length > 0) {
        setTranslationMap({});
      }
    },
    [translationMap]
  );

  // ── NEW: handleTokenPress dùng LocalDictionary ──
  const handleTokenPress = async (event: any, token: string, idx: number) => {
    const core = token.trim();
    if (!core) return;

    const screenWidth = Dimensions.get("window").width;
    const pageX = event.nativeEvent.pageX;
    const align: "left" | "right" = pageX > screenWidth / 2 ? "right" : "left";

    // Toggle off nếu đang hiện
    if (translationMap[idx] !== undefined) {
      setTranslationMap((prev) => {
        const copy = { ...prev };
        delete copy[idx];
        return copy;
      });
      return;
    }

    // Hiện trạng thái loading ngay lập tức
    setTranslationMap({ [idx]: { text: "⏳ Translating…", align } });

    // Tránh gọi trùng cho cùng 1 token
    const inflightKey = `${core}:${inputLang}:${outputLang}`;
    if (inflight.current.has(inflightKey)) return;
    inflight.current.add(inflightKey);

    try {
      // ── Dùng LocalDictionary: L1 → L2 → L3 (API) ──
      const result = await localDict.translateToken(
        core,
        inputLang,
        outputLang,
        // L3 fallback: chỉ gọi API khi không có cache
        () => learner.translateText(core, inputLang, outputLang)
      );

      setTranslationMap((prev) => ({ ...prev, [idx]: { text: result, align } }));
    } catch {
      setTranslationMap((prev) => ({ ...prev, [idx]: { text: "❌ Lỗi dịch", align } }));
    } finally {
      inflight.current.delete(inflightKey);
    }
  };

  const handleSubmit = async () => {
    const s = passage.comprehension_questions.reduce(
      (acc, q, i) => acc + (answers[i] === q.answer ? 1 : 0),
      0
    );
    setScore(s);
    setSubmitted(true);

    const updated: ReadingHistoryEntry = {
      ...entry,
      tokens,
      user_answers: answers,
      score: s,
      total: passage.comprehension_questions.length,
      completed: true,
    };
    await onUpdate(updated);
  };

  const pct = submitted
    ? Math.round((score / passage.comprehension_questions.length) * 100)
    : 0;

  const displayTokens = tokens ?? passage.body.split(/(\s+)/);

  return (
    <Modal visible animationType="slide">
      <View style={rm.root}>
        {/* Header */}
        <View style={rm.header}>
          <View style={{ flex: 1 }}>
            <Text style={rm.headerTitle} numberOfLines={2}>{passage.title}</Text>
            <Text style={rm.headerMeta}>{entry.level} · {entry.input_lang} · {entry.length}</Text>
          </View>
          <TouchableOpacity onPress={onClose}>
            <Text style={rm.closeBtn}>✕</Text>
          </TouchableOpacity>
        </View>
        {hasTooltip && (
          <TouchableWithoutFeedback onPress={dismissTooltip}>
            <View style={rm.tooltipOverlay} />
          </TouchableWithoutFeedback>
        )}
        {/* Phase tabs */}
        <View style={rm.phaseRow}>
          <TouchableOpacity
            style={[rm.phaseTab, phase === "read" && rm.phaseTabActive]}
            onPress={() => setPhase("read")}
          >
            <Text style={[rm.phaseTabText, phase === "read" && rm.phaseTabTextActive]}>
              📖 Read
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[rm.phaseTab, phase === "quiz" && rm.phaseTabActive]}
            onPress={() => setPhase("quiz")}
          >
            <Text style={[rm.phaseTabText, phase === "quiz" && rm.phaseTabTextActive]}>
              📝 Quiz
            </Text>
          </TouchableOpacity>
        </View>

        {/* ── ScrollView với onScroll để ẩn tooltip ── */}
        <ScrollView
          contentContainerStyle={rm.body}
          nestedScrollEnabled
          onScroll={handlePassageScroll}       // ← ẩn tooltip khi kéo
          scrollEventThrottle={16}             // ← fire mỗi ~16ms (60fps)
        >
          {/* ── READ PHASE ── */}
          {phase === "read" && (
            <View>
              <View style={[rm.passageBox, { zIndex: 10, overflow: "visible" }]}>
                {tokenizing ? (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 12 }}>
                    <ActivityIndicator size="small" color="#F1C40F" />
                    <Text style={{ color: "#888", fontStyle: "italic" }}>Tokenizing passage…</Text>
                  </View>
                ) : (
                  <View style={rm.passageContainer}>
                    {displayTokens.map((tok, i) => {
                      if (tok.includes("\n")) {
                        const parts = tok.split("\n");
                        return (
                          <React.Fragment key={i}>
                            {parts.map((part, partIdx) => (
                              <React.Fragment key={`${i}-${partIdx}`}>
                                {partIdx > 0 && <View style={{ width: "100%", height: 12 }} />}
                                {part !== "" && <Text style={rm.passageText}>{part}</Text>}
                              </React.Fragment>
                            ))}
                          </React.Fragment>
                        );
                      }

                      const core = tok.trim();
                      if (!core) return <Text key={i} style={rm.passageText}>{tok}</Text>;

                      const translation = translationMap[i];
                      const isActive = translation !== undefined;

                      return (
                        <View key={i} style={[rm.tokenWrapper, isActive && { zIndex: 10 }]}>
                          <Text
                            style={[rm.passageText, rm.tokenText, isActive && rm.tokenActive]}
                            onPress={(e) => handleTokenPress(e, core, i)}
                          >
                            {tok}
                          </Text>
                          {isActive && (
                            <View
                              style={[
                                rm.tooltipContainer,
                                translation.align === "left" ? { left: 0 } : { right: 0 },
                              ]}
                            >
                              <Text style={rm.tooltipText}>{translation.text}</Text>
                            </View>
                          )}
                        </View>
                      );
                    })}
                  </View>
                )}
              </View>

              <TouchableOpacity
                style={rm.proceedBtn}
                onPress={() => setPhase("quiz")}
              >
                <Text style={rm.proceedBtnText}>📝 Start Quiz →</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* ── QUIZ PHASE ── */}
          {phase === "quiz" && (
            <View>
              {submitted && (
                <View style={rm.scoreCard}>
                  <Text style={rm.scoreLabel}>🎯 Score</Text>
                  <Text style={rm.scoreValue}>{score}/{passage.comprehension_questions.length}</Text>
                  <Text style={rm.scorePct}>{pct}%</Text>
                  <View style={rm.scoreBar}>
                    <View style={[rm.scoreBarFill, { width: `${pct}%` as any }]} />
                  </View>
                </View>
              )}

              {passage.comprehension_questions.map((q, i) => {
                const userAns = answers[i];
                const isCorrect = submitted && userAns === q.answer;
                const isWrong = submitted && userAns !== q.answer;
                return (
                  <View
                    key={i}
                    style={[
                      rm.qCard,
                      submitted && isCorrect && { borderColor: "#2ECC71", borderWidth: 2 },
                      submitted && isWrong && { borderColor: "#E74C3C", borderWidth: 2 },
                    ]}
                  >
                    <Text style={rm.qText}>Q{i + 1}: {q.question}</Text>
                    {q.options.map((opt) => {
                      const letter = opt[0];
                      const sel = userAns === letter;
                      const correctOpt = submitted && letter === q.answer;
                      const wrongOpt = submitted && sel && letter !== q.answer;
                      return (
                        <View key={letter} style={{ marginBottom: 6 }}>
                          <TouchableOpacity
                            style={[
                              rm.optBtn,
                              sel && !submitted && rm.optSelected,
                              correctOpt && rm.optCorrect,
                              wrongOpt && rm.optWrong,
                            ]}
                            onPress={() => {
                              if (submitted) return;
                              const u = [...answers];
                              u[i] = letter;
                              setAnswers(u);
                            }}
                            disabled={submitted}
                          >
                            <Text
                              style={[
                                rm.optText,
                                correctOpt && { color: "#2ECC71", fontWeight: "bold" },
                                wrongOpt && { color: "#E74C3C" },
                              ]}
                            >
                              {opt}
                            </Text>
                          </TouchableOpacity>
                          {submitted && correctOpt && (
                            <Text style={rm.optMeta}>✅ Correct answer</Text>
                          )}
                          {submitted && wrongOpt && (
                            <Text style={[rm.optMeta, { color: "#E74C3C" }]}>❌ Your answer</Text>
                          )}
                        </View>
                      );
                    })}
                    {submitted && (
                      <View style={rm.explanationBox}>
                        <Text style={rm.explanationText}>💡 {q.explanation}</Text>
                      </View>
                    )}
                  </View>
                );
              })}

              {!submitted && (
                <TouchableOpacity style={rm.submitBtn} onPress={handleSubmit}>
                  <Text style={rm.submitBtnText}>✅ Submit Answers</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

// ─────────────────────────────────────────────
// STYLES — Setup screen
// ─────────────────────────────────────────────
const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#1a1a2e" },
  containerContent: { flexGrow: 1, paddingBottom: 30 },
  header: { alignItems: "center", paddingVertical: 20 },
  headerTitle: { fontSize: 26, fontWeight: "bold", color: "#F1C40F" },
  card: { backgroundColor: "#16213e", borderRadius: 16, padding: 16, margin: 16, shadowColor: "#000", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 8, elevation: 6 },
  tabRow: { flexDirection: "row", marginBottom: 16, gap: 8 },
  tab: { flex: 1, paddingVertical: 10, borderRadius: 8, backgroundColor: "#0a1628", alignItems: "center" },
  tabActive: { backgroundColor: "#1a4a7a" },
  tabText: { color: "#777", fontWeight: "600" },
  tabTextActive: { color: "#2CC985" },
  sectionLabel: { color: "#5DADE2", fontWeight: "bold", fontSize: 13, marginTop: 12, marginBottom: 6 },
  miniLabel: { color: "#777", fontSize: 11, marginBottom: 4 },
  langRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  arrow: { color: "#555", fontSize: 18, marginBottom: 0, marginTop: 16 },
  picker: { backgroundColor: "#0a1628", borderRadius: 8, paddingVertical: 10, paddingHorizontal: 12, borderWidth: 1, borderColor: "#1a4a7a" },
  pickerFull: { backgroundColor: "#0a1628", borderRadius: 8, paddingVertical: 10, paddingHorizontal: 12, borderWidth: 1, borderColor: "#1a4a7a" },
  pickerText: { color: "#2CC985", fontWeight: "600" },
  chipRow: { flexDirection: "row", gap: 8 },
  chip: { flex: 1, backgroundColor: "#0a1628", borderRadius: 10, paddingVertical: 10, paddingHorizontal: 8, alignItems: "center", borderWidth: 1, borderColor: "#1a4a7a" },
  chipActive: { backgroundColor: "#1a4a7a", borderColor: "#2CC985" },
  chipText: { color: "#777", fontWeight: "700", fontSize: 13 },
  chipTextActive: { color: "#2CC985" },
  chipSub: { color: "#555", fontSize: 10, marginTop: 2 },
  generateBtn: { backgroundColor: "#e67e22", borderRadius: 12, paddingVertical: 14, alignItems: "center", marginTop: 20 },
  generateBtnText: { color: "#fff", fontWeight: "bold", fontSize: 16 },
  historyList: { maxHeight: Dimensions.get("window").height * 0.55 },
  historyListContent: { paddingBottom: 8 },
  historyItem: { flexDirection: "row", alignItems: "center", backgroundColor: "#0a1628", borderRadius: 10, padding: 12, marginBottom: 8, gap: 10 },
  historyTitle: { color: "#fff", fontSize: 14, fontWeight: "600", marginBottom: 4 },
  historyMeta: { color: "#777", fontSize: 11 },
  reviewBtn: { backgroundColor: "#1a4a7a", borderRadius: 8, paddingVertical: 8, paddingHorizontal: 14 },
  reviewBtnText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  clearBtn: { backgroundColor: "#922b21", borderRadius: 8, paddingVertical: 12, marginTop: 8, alignItems: "center" },
  clearBtnText: { color: "#fff", fontWeight: "bold" },
  emptyText: { color: "#555", textAlign: "center", paddingVertical: 20, fontStyle: "italic" },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.7)", justifyContent: "flex-end" },
  pickerSheet: { backgroundColor: "#16213e", borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20 },
  pickerSheetTitle: { color: "#F1C40F", fontSize: 17, fontWeight: "bold", marginBottom: 14, textAlign: "center" },
  pickerSheetItem: { paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: "#222" },
  pickerSheetItemText: { color: "#fff", fontSize: 16, textAlign: "center" },
  keywordRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  keywordInput: {
    flex: 1,
    backgroundColor: "#0a1628",
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: "#1a4a7a",
    color: "#2CC985",
    fontSize: 14,
  },
  keywordGenBtn: {
    backgroundColor: "#1a4a7a",
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: "#2CC985",
    minWidth: 80,
    alignItems: "center",
  },
  keywordGenBtnText: { color: "#2CC985", fontWeight: "700", fontSize: 13 },
  keywordHint: { color: "#555", fontSize: 11, marginTop: 4, marginBottom: 4 },

});

// ─────────────────────────────────────────────
// STYLES — Reading modal
// ─────────────────────────────────────────────
const rm = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#1a1a2e" },
  header: { flexDirection: "row", alignItems: "flex-start", padding: 16, backgroundColor: "#16213e", borderBottomWidth: 1, borderBottomColor: "#222" },
  headerTitle: { color: "#F1C40F", fontSize: 17, fontWeight: "bold", lineHeight: 24 },
  headerMeta: { color: "#777", fontSize: 12, marginTop: 2 },
  closeBtn: { color: "#E74C3C", fontSize: 22, fontWeight: "bold", paddingLeft: 10 },
  phaseRow: { flexDirection: "row", backgroundColor: "#16213e", paddingHorizontal: 16, paddingBottom: 10, paddingTop: 8, gap: 8, borderBottomWidth: 1, borderBottomColor: "#111" },
  phaseTab: { flex: 1, paddingVertical: 8, borderRadius: 8, backgroundColor: "#0a1628", alignItems: "center" },
  phaseTabActive: { backgroundColor: "#1a4a7a" },
  phaseTabText: { color: "#777", fontWeight: "600", fontSize: 13 },
  phaseTabTextActive: { color: "#2CC985" },
  body: { padding: 16, paddingBottom: 40 },
  passageBox: { backgroundColor: "#0a1628", borderRadius: 12, padding: 14, marginBottom: 16 },
  passageContainer: { flexDirection: "row", flexWrap: "wrap", alignItems: "flex-start" },
  tokenWrapper: { position: "relative" },
  passageText: { fontSize: 18, color: "#E0E0E0", lineHeight: 32 },
  tokenText: { textDecorationLine: "underline", textDecorationColor: "#444" },
  tokenActive: { color: "#F1C40F", textDecorationColor: "#F1C40F" },
  tooltipContainer: {
    position: "absolute",
    top: 32,
    backgroundColor: "#1a4a7a",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    maxWidth: 300,
    minWidth: 150,
    zIndex: 999,
    elevation: 6,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 5,
  },
  tooltipText: { color: "#2ECC71", fontSize: 14, fontWeight: "bold", textAlign: "left" },
  proceedBtn: { backgroundColor: "#1a4a7a", borderRadius: 10, paddingVertical: 14, alignItems: "center", marginBottom: 10 },
  proceedBtnText: { color: "#fff", fontWeight: "bold", fontSize: 15 },
  scoreCard: { backgroundColor: "#0a1628", borderRadius: 12, padding: 16, marginBottom: 16, alignItems: "center" },
  scoreLabel: { color: "#aaa", fontSize: 13, marginBottom: 4 },
  scoreValue: { color: "#F1C40F", fontSize: 36, fontWeight: "bold" },
  scorePct: { color: "#2CC985", fontSize: 20, fontWeight: "bold", marginBottom: 10 },
  scoreBar: { width: "100%", height: 8, backgroundColor: "#1a4a7a", borderRadius: 4, overflow: "hidden" },
  scoreBarFill: { height: 8, backgroundColor: "#2ECC71", borderRadius: 4 },
  qCard: { backgroundColor: "#16213e", borderRadius: 12, padding: 16, marginBottom: 14 },
  qText: { color: "#F1C40F", fontSize: 15, fontWeight: "700", marginBottom: 12, lineHeight: 22 },
  optBtn: { backgroundColor: "#0a1628", borderRadius: 8, paddingVertical: 11, paddingHorizontal: 14, borderWidth: 1, borderColor: "#222" },
  optSelected: { borderColor: "#5DADE2", backgroundColor: "#112244" },
  optCorrect: { borderColor: "#2ECC71", backgroundColor: "#0d3320" },
  optWrong: { borderColor: "#E74C3C", backgroundColor: "#2d0a0a" },
  optText: { color: "#ccc", fontSize: 14 },
  optMeta: { color: "#aaa", fontSize: 11, marginTop: 3, marginLeft: 10 },
  explanationBox: { backgroundColor: "#1a1a1a", borderRadius: 8, padding: 10, marginTop: 8, borderLeftWidth: 3, borderLeftColor: "#F39C12" },
  explanationText: { color: "#F39C12", fontSize: 13, lineHeight: 20 },
  submitBtn: { backgroundColor: "#27ae60", borderRadius: 10, paddingVertical: 16, alignItems: "center", marginTop: 8 },
  submitBtnText: { color: "#fff", fontWeight: "bold", fontSize: 15 },
  tooltipOverlay: {
  position: "absolute",
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  zIndex: 100,          // dưới tooltip (zIndex 999) nhưng trên content
  backgroundColor: "transparent",
  
},

});
