/**
 * stats.tsx — Dashboard tiến độ
 * Streak, mục tiêu ngày, biểu đồ 14 ngày, và số liệu tổng (từ/quiz/độ chính xác).
 * Chỉ ĐỌC dữ liệu sẵn có (không đổi logic học). Chart tự vẽ bằng View.
 */

import React, { useState, useCallback } from "react";
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from "react-native";
import { useFocusEffect } from "expo-router";
import { useProgress } from "../../scripts/useProgress";
import { setGoal } from "../../scripts/progress-store";
import { countWords, countActiveDays, listQuizzes } from "../../scripts/ExampleDB";
import { Palette } from "@/constants/palette";

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function StatsScreen() {
  const { progress, loaded } = useProgress();
  const [totals, setTotals] = useState({ words: 0, activeDays: 0, quizzes: 0, accuracy: 0 });

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      (async () => {
        const [words, activeDays, quizzes] = await Promise.all([
          countWords(),
          countActiveDays(),
          listQuizzes({ limit: 1000 }),
        ]);
        if (!alive) return;
        const totScore = quizzes.reduce((s, q) => s + q.score, 0);
        const totTotal = quizzes.reduce((s, q) => s + q.total, 0);
        const accuracy = totTotal > 0 ? Math.round((totScore / totTotal) * 100) : 0;
        setTotals({ words, activeDays, quizzes: quizzes.length, accuracy });
      })();
      return () => { alive = false; };
    }, [])
  );

  const goalPct = Math.min(100, progress.goal > 0 ? (progress.todayCount / progress.goal) * 100 : 0);
  const chartMax = Math.max(progress.goal, ...progress.last14.map((d) => d.count), 1);

  return (
    <ScrollView style={s.container} contentContainerStyle={s.content}>
      <View style={s.header}>
        <Text style={s.headerTitle}>📊 Progress</Text>
        <Text style={s.headerSub}>Study every day — don’t make the owl sad 🦉</Text>
      </View>

      {/* ── Streak ── */}
      <View style={[s.section, s.streakRow]}>
        <View style={s.streakMain}>
          <Text style={s.streakFlame}>🔥</Text>
          <View>
            <Text style={s.streakNum}>{progress.streak}</Text>
            <Text style={s.streakLabel}>day streak</Text>
          </View>
        </View>
        <View style={s.streakBest}>
          <Text style={s.bestNum}>{progress.bestStreak}</Text>
          <Text style={s.bestLabel}>best</Text>
        </View>
      </View>

      {/* ── Mục tiêu hôm nay ── */}
      <View style={s.section}>
        <View style={s.goalHeader}>
          <Text style={s.sectionTitle}>🎯 Today’s goal</Text>
          <Text style={[s.goalCount, progress.goalMetToday && { color: Palette.success }]}>
            {progress.todayCount}/{progress.goal}
            {progress.goalMetToday ? "  ✅" : ""}
          </Text>
        </View>
        <View style={s.barTrack}>
          <View
            style={[
              s.barFill,
              { width: `${goalPct}%`, backgroundColor: progress.goalMetToday ? Palette.success : Palette.brand },
            ]}
          />
        </View>
        <View style={s.goalEdit}>
          <Text style={s.goalEditLabel}>Adjust goal</Text>
          <View style={s.stepper}>
            <TouchableOpacity
              style={s.stepBtn}
              onPress={() => setGoal(Math.max(1, progress.goal - 5))}
            >
              <Text style={s.stepBtnText}>−5</Text>
            </TouchableOpacity>
            <Text style={s.stepVal}>{progress.goal}</Text>
            <TouchableOpacity style={s.stepBtn} onPress={() => setGoal(progress.goal + 5)}>
              <Text style={s.stepBtnText}>+5</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {/* ── Biểu đồ 14 ngày ── */}
      <View style={s.section}>
        <Text style={s.sectionTitle}>📈 Last 14 days</Text>
        <View style={s.chart}>
          {progress.last14.map((d) => {
            const h = Math.max(3, (d.count / chartMax) * 90);
            const met = d.count >= progress.goal && d.count > 0;
            const dow = WEEKDAY[new Date(d.day + "T00:00:00").getDay()];
            return (
              <View key={d.day} style={s.chartCol}>
                <Text style={s.chartVal}>{d.count > 0 ? d.count : ""}</Text>
                <View
                  style={[
                    s.chartBar,
                    { height: h, backgroundColor: met ? Palette.success : d.count > 0 ? Palette.brand : Palette.inset },
                  ]}
                />
                <Text style={s.chartLabel}>{dow}</Text>
              </View>
            );
          })}
        </View>
      </View>

      {/* ── Số liệu tổng ── */}
      <View style={s.grid}>
        <StatCard icon="📚" value={totals.words} label="Words learned" />
        <StatCard icon="🗓️" value={totals.activeDays} label="Days active" />
        <StatCard icon="📝" value={totals.quizzes} label="Quizzes" />
        <StatCard icon="🎯" value={`${totals.accuracy}%`} label="Accuracy" />
      </View>

      {!loaded && <Text style={s.loadingHint}>Loading…</Text>}
      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

function StatCard({ icon, value, label }: { icon: string; value: number | string; label: string }) {
  return (
    <View style={s.card}>
      <Text style={s.cardIcon}>{icon}</Text>
      <Text style={s.cardValue}>{value}</Text>
      <Text style={s.cardLabel}>{label}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Palette.bg },
  content: { paddingBottom: 30 },

  header: { alignItems: "center", paddingTop: 28, paddingBottom: 12, paddingHorizontal: 16 },
  headerTitle: { fontSize: 26, fontWeight: "bold", color: Palette.accent },
  headerSub: { color: Palette.textDim, fontSize: 13, marginTop: 4, textAlign: "center" },

  section: {
    backgroundColor: Palette.card,
    borderRadius: 16,
    padding: 16,
    marginHorizontal: 16,
    marginBottom: 14,
  },
  sectionTitle: { color: Palette.info, fontWeight: "bold", fontSize: 14 },

  // streak
  streakRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  streakMain: { flexDirection: "row", alignItems: "center", gap: 12 },
  streakFlame: { fontSize: 44 },
  streakNum: { color: Palette.hard, fontSize: 34, fontWeight: "bold", lineHeight: 38 },
  streakLabel: { color: Palette.textMuted, fontSize: 13 },
  streakBest: { alignItems: "center" },
  bestNum: { color: Palette.accent, fontSize: 22, fontWeight: "bold" },
  bestLabel: { color: Palette.textDim, fontSize: 11 },

  // goal
  goalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  goalCount: { color: Palette.brand, fontSize: 15, fontWeight: "bold" },
  barTrack: { height: 14, borderRadius: 7, backgroundColor: Palette.inset, overflow: "hidden" },
  barFill: { height: "100%", borderRadius: 7 },
  goalEdit: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 14 },
  goalEditLabel: { color: Palette.textFaint, fontSize: 12 },
  stepper: { flexDirection: "row", alignItems: "center", gap: 12 },
  stepBtn: {
    backgroundColor: Palette.inset,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: Palette.primary,
  },
  stepBtnText: { color: Palette.brand, fontWeight: "700", fontSize: 14 },
  stepVal: { color: Palette.textPrimary, fontWeight: "bold", fontSize: 16, minWidth: 28, textAlign: "center" },

  // chart
  chart: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", height: 130, marginTop: 14 },
  chartCol: { flex: 1, alignItems: "center", justifyContent: "flex-end" },
  chartBar: { width: 12, borderRadius: 4 },
  chartVal: { color: Palette.textMuted, fontSize: 9, marginBottom: 2, height: 12 },
  chartLabel: { color: Palette.textDim, fontSize: 9, marginTop: 4 },

  // grid
  grid: { flexDirection: "row", flexWrap: "wrap", paddingHorizontal: 10, gap: 12, justifyContent: "center" },
  card: {
    backgroundColor: Palette.card,
    borderRadius: 16,
    paddingVertical: 18,
    alignItems: "center",
    width: "45%",
  },
  cardIcon: { fontSize: 24, marginBottom: 6 },
  cardValue: { color: Palette.accent, fontSize: 24, fontWeight: "bold" },
  cardLabel: { color: Palette.textMuted, fontSize: 12, marginTop: 2 },

  loadingHint: { color: Palette.textDim, textAlign: "center", marginTop: 10 },
});
