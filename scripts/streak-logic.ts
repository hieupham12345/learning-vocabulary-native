/**
 * streak-logic.ts
 * Logic tính streak THUẦN — không import gì từ ExampleDB/RN để test được bằng node.
 * Nguồn dữ liệu: tập các ngày (YYYY-MM-DD local) có hoạt động.
 */

/** Date → local YYYY-MM-DD (khớp localDay trong ExampleDB, KHÔNG dùng UTC) */
function toLocalDay(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

/**
 * Tính streak hiện tại + streak dài nhất từ tập ngày có hoạt động.
 * @param activeDays  tập ngày (YYYY-MM-DD) đã học ≥1 từ mới.
 * @param todayStr    ngày "hôm nay" (YYYY-MM-DD) — truyền vào để deterministic/test.
 *                    Streak neo ở hôm nay, hoặc hôm qua nếu hôm nay chưa học.
 */
export function computeStreaks(
  activeDays: Set<string>,
  todayStr: string
): { streak: number; best: number } {
  if (activeDays.size === 0) return { streak: 0, best: 0 };

  const dayMs = 86_400_000;
  const today = new Date(todayStr + "T00:00:00");

  // Streak hiện tại: đếm ngược từ hôm nay (hoặc hôm qua nếu hôm nay chưa học)
  let cursor = new Date(today);
  if (!activeDays.has(toLocalDay(cursor))) cursor = new Date(today.getTime() - dayMs);
  let streak = 0;
  while (activeDays.has(toLocalDay(cursor))) {
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
