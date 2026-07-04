import { test } from "node:test";
import assert from "node:assert/strict";
import { computeStreaks } from "./streak-logic";

const days = (...d: string[]) => new Set(d);

test("(a) rỗng → streak 0, best 0", () => {
  assert.deepEqual(computeStreaks(days(), "2026-07-04"), { streak: 0, best: 0 });
});

test("(b) chỉ hôm nay → streak 1", () => {
  const r = computeStreaks(days("2026-07-04"), "2026-07-04");
  assert.equal(r.streak, 1);
  assert.equal(r.best, 1);
});

test("(c) chuỗi liên tiếp kết ở hôm nay → đúng độ dài", () => {
  const r = computeStreaks(
    days("2026-07-01", "2026-07-02", "2026-07-03", "2026-07-04"),
    "2026-07-04"
  );
  assert.equal(r.streak, 4);
  assert.equal(r.best, 4);
});

test("(d) chuỗi kết ở hôm qua, hôm nay chưa học → vẫn giữ (không đứt)", () => {
  const r = computeStreaks(
    days("2026-07-01", "2026-07-02", "2026-07-03"),
    "2026-07-04"
  );
  assert.equal(r.streak, 3);
});

test("(e) hôm qua trống (cách đúng 1 ngày) → streak đứt", () => {
  // Học đến 02, nghỉ 03, hôm nay 04 chưa học → không có 03/04 → streak 0
  const r = computeStreaks(
    days("2026-07-01", "2026-07-02"),
    "2026-07-04"
  );
  assert.equal(r.streak, 0);
  assert.equal(r.best, 2); // chuỗi lịch sử dài nhất vẫn là 2
});

test("(f) học lại hôm nay sau khi đứt → streak = 1", () => {
  // Nghỉ 02+03, học lại 04
  const r = computeStreaks(
    days("2026-07-01", "2026-07-04"),
    "2026-07-04"
  );
  assert.equal(r.streak, 1);
});

test("(g) bestStreak = chuỗi dài nhất lịch sử (không phải streak hiện tại)", () => {
  // Chuỗi 4 ngày cũ (01-04), nghỉ, rồi 2 ngày mới (07-08) kết hôm nay 08
  const r = computeStreaks(
    days("2026-07-01", "2026-07-02", "2026-07-03", "2026-07-04", "2026-07-07", "2026-07-08"),
    "2026-07-08"
  );
  assert.equal(r.streak, 2);
  assert.equal(r.best, 4);
});

test("(h) đổi todayStr mô phỏng sang ngày mới → streak đứt nếu ngày mới + hôm trước đều trống", () => {
  const set = days("2026-07-01", "2026-07-02", "2026-07-03");
  // Cùng dữ liệu, hôm nay = 03 → streak 3
  assert.equal(computeStreaks(set, "2026-07-03").streak, 3);
  // Sang 04 (hôm qua 03 có học) → vẫn 3 (chưa học 04 nhưng hôm qua có)
  assert.equal(computeStreaks(set, "2026-07-04").streak, 3);
  // Sang 05 (04 trống) → đứt
  assert.equal(computeStreaks(set, "2026-07-05").streak, 0);
});

test("một ngày không học → mất streak (rõ ràng)", () => {
  // Học liên tục 5 ngày rồi nghỉ 1 ngày (06), hôm nay 07 học lại
  const r = computeStreaks(
    days("2026-07-01", "2026-07-02", "2026-07-03", "2026-07-04", "2026-07-05", "2026-07-07"),
    "2026-07-07"
  );
  assert.equal(r.streak, 1); // chỉ tính hôm nay, chuỗi cũ đã đứt do nghỉ 06
  assert.equal(r.best, 5);
});
