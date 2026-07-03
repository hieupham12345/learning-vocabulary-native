/**
 * progress-store.ts
 * Streak + daily goal + hoạt động học. Reactive như settings-store.
 * Nguồn dữ liệu: bảng daily_activity trong ExampleDB (SQLite).
 *
 * Dùng:
 *   const { progress, loaded } = useProgress();   // hook
 *   await bumpActivity(1);                         // ghi 1 hoạt động học
 */

import {
  recordActivity,
  listDailyActivity,
  localDay,
  kvGet,
  kvSet,
  type DailyCount,
} from "./ExampleDB";

const GOAL_KEY = "daily_goal";
export const DEFAULT_GOAL = 10;

export interface Progress {
  todayCount: number;   // số hoạt động hôm nay
  goal: number;         // mục tiêu/ngày
  streak: number;       // chuỗi ngày liên tiếp có học
  bestStreak: number;   // chuỗi dài nhất
  goalMetToday: boolean;
  last14: DailyCount[]; // 14 ngày gần nhất (cũ → mới) để vẽ biểu đồ
}

const EMPTY: Progress = {
  todayCount: 0,
  goal: DEFAULT_GOAL,
  streak: 0,
  bestStreak: 0,
  goalMetToday: false,
  last14: [],
};

let _cache: Progress | null = null;
const _listeners = new Set<(p: Progress) => void>();

// ── Tính streak từ danh sách ngày có count > 0 ──────────────
function computeStreaks(activeDays: Set<string>): { streak: number; best: number } {
  if (activeDays.size === 0) return { streak: 0, best: 0 };

  const dayMs = 86_400_000;
  const today = new Date(localDay() + "T00:00:00");

  // Streak hiện tại: đếm ngược từ hôm nay (hoặc hôm qua nếu hôm nay chưa học)
  let cursor = new Date(today);
  if (!activeDays.has(localDay(cursor))) cursor = new Date(today.getTime() - dayMs);
  let streak = 0;
  while (activeDays.has(localDay(cursor))) {
    streak++;
    cursor = new Date(cursor.getTime() - dayMs);
  }

  // Best streak: quét toàn bộ ngày đã sort
  const sorted = Array.from(activeDays).sort();
  let best = 0;
  let run = 0;
  let prev: Date | null = null;
  for (const d of sorted) {
    const cur = new Date(d + "T00:00:00");
    if (prev && cur.getTime() - prev.getTime() === dayMs) run++;
    else run = 1;
    if (run > best) best = run;
    prev = cur;
  }

  return { streak, best: Math.max(best, streak) };
}

function recompute(rows: DailyCount[], goal: number): Progress {
  const today = localDay();
  const todayCount = rows.find((r) => r.day === today)?.count ?? 0;
  const activeDays = new Set(rows.filter((r) => r.count > 0).map((r) => r.day));
  const { streak, best } = computeStreaks(activeDays);

  // 14 ngày gần nhất, cũ → mới, điền 0 cho ngày trống
  const byDay = new Map(rows.map((r) => [r.day, r.count]));
  const last14: DailyCount[] = [];
  const dayMs = 86_400_000;
  const base = new Date(today + "T00:00:00");
  for (let i = 13; i >= 0; i--) {
    const d = localDay(new Date(base.getTime() - i * dayMs));
    last14.push({ day: d, count: byDay.get(d) ?? 0 });
  }

  return {
    todayCount,
    goal,
    streak,
    bestStreak: best,
    goalMetToday: todayCount >= goal,
    last14,
  };
}

async function refresh(): Promise<Progress> {
  const [rows, goalRaw] = await Promise.all([
    listDailyActivity(400),
    kvGet<number>(GOAL_KEY),
  ]);
  const goal = typeof goalRaw === "number" && goalRaw > 0 ? goalRaw : DEFAULT_GOAL;
  _cache = recompute(rows, goal);
  _listeners.forEach((fn) => fn(_cache!));
  return _cache;
}

export async function loadProgress(): Promise<Progress> {
  return _cache ? _cache : refresh();
}

export function getProgress(): Progress {
  return _cache ?? { ...EMPTY };
}

export function subscribeProgress(fn: (p: Progress) => void): () => void {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

/** Ghi hoạt động học rồi phát lại state mới. */
export async function bumpActivity(n: number = 1): Promise<void> {
  await recordActivity(n);
  await refresh();
}

export async function setGoal(goal: number): Promise<void> {
  await kvSet(GOAL_KEY, goal);
  await refresh();
}
