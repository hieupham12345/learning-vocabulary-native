// components/vocab/QuizModal.tsx
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Modal, ScrollView, Text, TouchableOpacity, View } from "react-native";
import { VocabularyLearner } from "@/scripts/VocabularyLearner";
import { loadQuizExplanations, saveQuizExplanation } from "@/scripts/ExampleDB";
import type { QuizData, QuizHistoryEntryLocal } from "@/types/vocab";
import { styles } from "./styles";
import { Palette } from "@/constants/palette";

const learner = new VocabularyLearner();

export function QuizModal({ quizData, words, mode, pastAnswers, quizId, onClose, onSaveResult, inputLang, outputLang }: {
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
    ({ easy: Palette.success, medium: Palette.accent, hard: Palette.hard, super_hard: Palette.danger, very_hard: Palette.danger }[d] ?? Palette.textPrimary);

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
                submitted && isCorrect && { borderColor: Palette.success, borderWidth: 2 },
                submitted && isWrong   && { borderColor: Palette.danger, borderWidth: 2 },
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
                        <Text style={[styles.quizOptionText, isCorrectOpt && { color: Palette.success, fontWeight: "bold" }, isWrongOpt && { color: Palette.danger }]}>{opt}</Text>
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
                        <ActivityIndicator size="small" color={Palette.warn} />
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
