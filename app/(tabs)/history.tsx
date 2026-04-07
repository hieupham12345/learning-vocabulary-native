/**
 * History.tsx
 * History tab for vocabulary learning and quiz history
 */

import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
  Dimensions,
  Modal,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { VocabularyLearner } from "../../scripts/VocabularyLearner";
import { useRouter } from "expo-router";
import { useFocusEffect } from 'expo-router';

interface HistoryEntry {
  word: string;
  input_lang: string;
  output_lang: string;
  timestamp: string;
  data: any;
}

interface QuizHistoryEntry {
  words: string[];
  score: number;
  total: number;
  timestamp: string;
  quiz_data: any;
  user_answers: string[];
}

const HISTORY_KEY = "@vocab_history";
const QUIZ_HISTORY_KEY = "@quiz_history";
const CURRENT_REVIEW_KEY = "@current_quiz_review";
const CURRENT_RETAKE_KEY = "@current_quiz_retake";

const learner = new VocabularyLearner();

export default function HistoryScreen() {
  const router = useRouter();
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [quizHistory, setQuizHistory] = useState<QuizHistoryEntry[]>([]);
  const [activeTab, setActiveTab] = useState<"Words" | "Quizzes">("Words");
  const [quizModalVisible, setQuizModalVisible] = useState(false);
  const [activeQuiz, setActiveQuiz] = useState<QuizHistoryEntry | null>(null);
  const [quizMode, setQuizMode] = useState<"review" | "retake" | null>(null);
  const [quizAnswers, setQuizAnswers] = useState<string[]>([]);
  const [quizSubmitted, setQuizSubmitted] = useState(false);
  const [quizScore, setQuizScore] = useState(0);

  // ─────────────────────────────────────────────
  // LOAD HISTORY
  // ─────────────────────────────────────────────
  const loadHistory = useCallback(async () => {
    try {
      const raw = await AsyncStorage.getItem(HISTORY_KEY);
      if (raw) setHistory(JSON.parse(raw));
      const rawQ = await AsyncStorage.getItem(QUIZ_HISTORY_KEY);
      if (rawQ) {
        const parsed = JSON.parse(rawQ);
        setQuizHistory(parsed);
      }
    } catch (e) { console.error("loadHistory:", e); }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadHistory();
    }, [loadHistory])
  );

  // ─────────────────────────────────────────────
  // CLEAR HISTORY
  // ─────────────────────────────────────────────
  const handleClearHistory = () => {
    Alert.alert("Confirm", "Clear all history?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Clear", style: "destructive", onPress: async () => {
          setHistory([]); setQuizHistory([]);
          await AsyncStorage.removeItem(HISTORY_KEY);
          await AsyncStorage.removeItem(QUIZ_HISTORY_KEY);
          Alert.alert("Success", "All history cleared!");
        },
      },
    ]);
  };

  // ─────────────────────────────────────────────
  // LOAD WORD FROM HISTORY
  // ─────────────────────────────────────────────
  const loadWordFromHistory = (entry: HistoryEntry) => {
    AsyncStorage.setItem("@current_word_data", JSON.stringify(entry)).then(() => {
      router.replace("/");
    });
  };

  const openQuizModal = (entry: QuizHistoryEntry, mode: "review" | "retake") => {
    setActiveQuiz(entry);
    setQuizMode(mode);
    setQuizAnswers(mode === "review" ? entry.user_answers : entry.quiz_data.quiz.map(() => ""));
    setQuizScore(mode === "review" ? entry.score : 0);
    setQuizSubmitted(mode === "review");
    setQuizModalVisible(true);
  };

  const handleReviewQuiz = (entry: QuizHistoryEntry) => {
    openQuizModal(entry, "review");
  };

  const handleRetakeQuiz = (entry: QuizHistoryEntry) => {
    openQuizModal(entry, "retake");
  };

  const handleQuizOptionPress = (questionIndex: number, optionLetter: string) => {
    if (quizMode !== "retake") return;
    setQuizAnswers((prev) => {
      const next = [...prev];
      next[questionIndex] = optionLetter;
      return next;
    });
  };

  const handleSubmitRetake = async () => {
    if (!activeQuiz) return;
    const score = activeQuiz.quiz_data.quiz.reduce((acc: number, q: any, i: number) => acc + (quizAnswers[i] === q.answer ? 1 : 0), 0);
    const newEntry: QuizHistoryEntry = {
      words: activeQuiz.words,
      score,
      total: activeQuiz.total,
      timestamp: new Date().toISOString(),
      quiz_data: activeQuiz.quiz_data,
      user_answers: quizAnswers,
    };

    const currentQuizHistory = await AsyncStorage.getItem(QUIZ_HISTORY_KEY);
    const quizHistoryArray = currentQuizHistory ? JSON.parse(currentQuizHistory) : [];
    const updated = [newEntry, ...quizHistoryArray];
    await AsyncStorage.setItem(QUIZ_HISTORY_KEY, JSON.stringify(updated));
    setQuizHistory(updated);
    setQuizScore(score);
    setQuizSubmitted(true);
    Alert.alert("Retake Saved", `Saved new quiz result: ${score}/${newEntry.total}`);
  };

  const closeQuizModal = () => {
    setQuizModalVisible(false);
    setActiveQuiz(null);
    setQuizMode(null);
    setQuizAnswers([]);
    setQuizSubmitted(false);
    setQuizScore(0);
  };

  // ─────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.containerContent} nestedScrollEnabled>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>📚 History</Text>
      </View>

      {/* TABS */}
      <View style={styles.card}>
        <View style={styles.tabRow}>
          {(["Words", "Quizzes"] as const).map((tab) => (
            <TouchableOpacity key={tab} style={[styles.tab, activeTab === tab && styles.tabActive]} onPress={() => setActiveTab(tab)}>
              <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>
                {tab === "Words" ? "📚 Words" : "📝 Quizzes"}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {activeTab === "Words" && (
          <ScrollView style={styles.historyList} contentContainerStyle={styles.historyListContent} nestedScrollEnabled>
            {history.length === 0
              ? <Text style={styles.emptyText}>No words learned yet.</Text>
              : history.map((entry, i) => (
                <TouchableOpacity key={i} style={styles.historyItem} onPress={() => loadWordFromHistory(entry)}>
                  <Text style={styles.historyWord}>{entry.word}</Text>
                  <Text style={styles.historyLang}>{entry.input_lang} → {entry.output_lang}</Text>
                </TouchableOpacity>
              ))
            }
          </ScrollView>
        )}

        {activeTab === "Quizzes" && (
          <ScrollView style={styles.historyList} contentContainerStyle={styles.historyListContent} nestedScrollEnabled>
            {quizHistory.length === 0
              ? <Text style={styles.emptyText}>No quizzes taken yet.</Text>
              : quizHistory.map((entry, i) => (
                <View key={i} style={styles.historyItem}>
                  <View style={styles.historyEntryText}>
                    <Text style={styles.historyWord}>[{entry.score}/{entry.total}] {entry.words.slice(0, 3).join(", ")}{entry.words.length > 3 ? "…" : ""}</Text>
                    <Text style={styles.historyLang}>{new Date(entry.timestamp).toLocaleDateString()}</Text>
                  </View>
                  <View style={styles.quizActionRow}>
                    <TouchableOpacity style={[styles.quizActionBtn, styles.reviewBtn]} onPress={() => handleReviewQuiz(entry)}>
                      <Text style={styles.quizActionBtnText}>Review</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.quizActionBtn, styles.retakeBtn]} onPress={() => handleRetakeQuiz(entry)}>
                      <Text style={styles.quizActionBtnText}>Retake</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))
            }
          </ScrollView>
        )}

        <TouchableOpacity style={styles.clearBtn} onPress={handleClearHistory}>
          <Text style={styles.clearBtnText}>🗑️ Clear All History</Text>
        </TouchableOpacity>
      </View>

      {quizModalVisible && activeQuiz && (
        <Modal visible transparent animationType="fade">
          <View style={styles.modalOverlay}>
            <View style={styles.quizModalBox}>
              <View style={styles.quizHeader}>
                <Text style={styles.quizModalTitle} numberOfLines={1}>
                  {quizMode === "review" ? "🔍 Review Quiz" : "📝 Quiz"}: {activeQuiz.words.slice(0, 3).join(", ")}
                </Text>
                <TouchableOpacity onPress={closeQuizModal}>
                  <Text style={styles.memCheckClose}>✕</Text>
                </TouchableOpacity>
              </View>
              <ScrollView
                style={styles.quizModalBody}
                contentContainerStyle={styles.quizModalBodyContent}
                nestedScrollEnabled
                showsVerticalScrollIndicator
              >
                {activeQuiz.quiz_data.quiz.map((question: any, index: number) => {
                  const userAns = quizAnswers[index] ?? "";
                  const isCorrect = quizSubmitted && userAns === question.answer;
                  const isWrong = quizSubmitted && userAns !== question.answer;
                  return (
                    <View key={index} style={[
                      styles.quizQuestionCard,
                      quizSubmitted && isCorrect && { borderColor: "#2ECC71", borderWidth: 2 },
                      quizSubmitted && isWrong && { borderColor: "#E74C3C", borderWidth: 2 },
                    ]}>
                      <Text style={[styles.quizQuestionText, { color: "#F1C40F" }]}>Q{index + 1}: {question.question}</Text>
                      {question.options.map((opt: string) => {
                        const letter = opt[0];
                        const isSelected = userAns === letter;
                        const isCorrectOpt = quizSubmitted && letter === question.answer;
                        const isWrongOpt = quizSubmitted && isSelected && letter !== question.answer;
                        return (
                          <View key={letter} style={styles.quizOptionWrapper}>
                            <TouchableOpacity
                              style={[
                                styles.quizOption,
                                isSelected && !quizSubmitted && styles.quizOptionSelected,
                                isCorrectOpt && styles.quizOptionCorrect,
                                isWrongOpt && styles.quizOptionWrong,
                              ]}
                              onPress={() => { if (quizSubmitted) return; handleQuizOptionPress(index, letter); }}
                              disabled={quizSubmitted}
                            >
                              <Text style={[
                                styles.quizOptionText,
                                isCorrectOpt && { color: "#2ECC71", fontWeight: "bold" },
                                isWrongOpt && { color: "#E74C3C" },
                              ]}>{opt}</Text>
                            </TouchableOpacity>
                            {quizSubmitted && isCorrectOpt && <Text style={styles.quizOptionMeta}>Correct answer</Text>}
                            {quizSubmitted && isWrongOpt && <Text style={styles.quizOptionMeta}>Your answer</Text>}
                          </View>
                        );
                      })}
                      {quizSubmitted && question.explanation && (
                        <Text style={styles.quizExplanation}>💡 {question.explanation}</Text>
                      )}
                    </View>
                  );
                })}
              </ScrollView>
              {!quizSubmitted && quizMode === "retake" && (
                <TouchableOpacity style={styles.quizSubmitBtn} onPress={handleSubmitRetake}>
                  <Text style={styles.quizSubmitBtnText}>Submit Retake</Text>
                </TouchableOpacity>
              )}
              {quizSubmitted && (
                <View style={styles.quizScoreBar}>
                  <Text style={styles.quizScoreText}>🎯 Score: {quizScore}/{activeQuiz.total}</Text>
                </View>
              )}
              <TouchableOpacity style={styles.btnPrimary} onPress={closeQuizModal}>
                <Text style={styles.btnPrimaryText}>Close</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      )}
    </ScrollView>
  );
}

// ─────────────────────────────────────────────
// STYLES
// ─────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#1a1a2e" },
  containerContent: { flexGrow: 1, paddingBottom: 24 },
  header: { alignItems: "center", paddingVertical: 20 },
  headerTitle: { fontSize: 26, fontWeight: "bold", color: "#F1C40F" },
  card: {
    backgroundColor: "#16213e", borderRadius: 16, padding: 16, margin: 16,
    shadowColor: "#000", shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4, shadowRadius: 8, elevation: 6,
  },
  tabRow: { flexDirection: "row", marginBottom: 12, gap: 8 },
  tab: { flex: 1, paddingVertical: 10, borderRadius: 8, backgroundColor: "#0a1628", alignItems: "center" },
  tabActive: { backgroundColor: "#1a4a7a" },
  tabText: { color: "#777", fontWeight: "600" },
  tabTextActive: { color: "#2CC985" },
  historyList: { maxHeight: Dimensions.get("window").height * 0.55, marginBottom: 8 },
  historyListContent: { paddingBottom: 8 },
  historyItem: {
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: "#0a1628",
    marginBottom: 8,
  },
  historyEntryText: { marginBottom: 10 },
  historyWord: { color: "#fff", fontSize: 15, fontWeight: "600" },
  historyLang: { color: "#777", fontSize: 12, marginTop: 4 },
  quizActionRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  quizActionBtn: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: "center" },
  reviewBtn: { backgroundColor: "#1a4a7a" },
  retakeBtn: { backgroundColor: "#7d3c1b" },
  quizActionBtnText: { color: "#fff", fontWeight: "700" },
  emptyText: { color: "#555", textAlign: "center", paddingVertical: 20, fontStyle: "italic" },
  clearBtn: { backgroundColor: "#922b21", borderRadius: 8, paddingVertical: 12, marginTop: 12, alignItems: "center" },
  clearBtnText: { color: "#fff", fontWeight: "bold" },
  modalOverlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.7)", justifyContent: "center", alignItems: "center", padding: 16 },
  quizModalBox: { width: "100%", height: "90%", backgroundColor: "#16213e", borderRadius: 20, padding: 18, overflow: "hidden" },
  quizModalTitle: { color: "#F1C40F", fontSize: 20, fontWeight: "bold", marginBottom: 12, textAlign: "center" },
  quizModalBodyWrapper: { flex: 1, width: "100%", marginBottom: 12 },
  quizModalBody: { flex: 1, width: "100%" },
  quizModalBodyContent: { paddingBottom: 16 },
  quizQuestionCard: { backgroundColor: "#0a1628", borderRadius: 12, padding: 14, marginBottom: 12 },
  quizHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  memCheckClose: { color: "#fff", fontSize: 20, fontWeight: "bold" },
  quizScoreBar: { alignItems: "center", marginVertical: 12 },
  quizScoreText: { color: "#F1C40F", fontWeight: "700" },
  quizExplanation: { color: "#aaa", fontSize: 13, marginTop: 8 },
  quizQuestionText: { color: "#fff", fontSize: 15, fontWeight: "700", marginBottom: 10 },
  quizOptionWrapper: { marginBottom: 10 },
  quizOption: { backgroundColor: "#111a2c", borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12, borderWidth: 1, borderColor: "#222" },
  quizOptionSelected: { borderColor: "#5DADE2", backgroundColor: "#112244" },
  quizOptionCorrect: { borderColor: "#2ECC71", backgroundColor: "#0d3320" },
  quizOptionWrong: { borderColor: "#E74C3C", backgroundColor: "#2d0a0a" },
  quizOptionText: { color: "#fff", fontSize: 14 },
  quizOptionMeta: { color: "#aaa", fontSize: 12, marginTop: 4, marginLeft: 8 },
  quizSubmitBtn: { backgroundColor: "#2ECC71", borderRadius: 10, paddingVertical: 12, marginBottom: 10, alignItems: "center" },
  quizSubmitBtnText: { color: "#16213e", fontWeight: "bold", fontSize: 15 },
  quizResultText: { color: "#F1C40F", fontWeight: "700", textAlign: "center", marginBottom: 10 },
  btnPrimary: { backgroundColor: "#1a4a7a", borderRadius: 10, paddingVertical: 12, alignItems: "center" },
  btnPrimaryText: { color: "#fff", fontWeight: "700" },
});