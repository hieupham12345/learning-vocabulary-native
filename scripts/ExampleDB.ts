import * as SQLite from "expo-sqlite";

// ─────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────
export interface VocabData {
  word: string;
  language?: { input: string; output: string };
  overview: Record<string, any>;
  examples: Record<string, any[]>;
  translation_cache?: Record<string, string>;
}

export interface HistoryEntry {
  word: string;
  input_lang: string;
  output_lang: string;
  timestamp: string;
  data: VocabData;
}

/** Metadata không có blob — dùng cho list UI và quiz picker */
export interface HistoryMeta {
  word: string;
  input_lang: string;
  output_lang: string;
  timestamp: string;
}

export interface QuizHistoryEntry {
  id?: number;
  words: string[];
  score: number;
  total: number;
  timestamp: string;
  quiz_data: Record<string, any>;
  user_answers: string[];
  input_lang?: string;
}

// ─────────────────────────────────────────────
// INTERNAL HELPERS
// ─────────────────────────────────────────────
const j = (o: any): string => JSON.stringify(o ?? {});

const pj = <T = any>(s: string | null | undefined, fallback: T): T => {
  if (!s) return fallback;
  try { return JSON.parse(s) as T; }
  catch { return fallback; }
};

const nowIso = (): string => new Date().toISOString();

const TAG = "[exampleDB]";
const logError = (ctx: string, err: unknown) =>
  console.error(`${TAG} ${ctx}:`, err instanceof Error ? err.message : err);

const SCHEMA_VERSION = 1;

// ─────────────────────────────────────────────
// ROW MAPPERS
// ─────────────────────────────────────────────
function rowToHistoryEntry(row: any): HistoryEntry {
  const overview = pj<Record<string, any>>(row.overview, {});
  const examples = pj<Record<string, any[]>>(row.examples, {});
  const extra    = pj<Record<string, any>>(row.extra, {});
  return {
    word:        row.word,
    input_lang:  row.input_lang,
    output_lang: row.output_lang,
    timestamp:   row.learned_at,
    data: {
      word:     row.word,
      language: { input: row.input_lang, output: row.output_lang },
      overview,
      examples,
      translation_cache: extra?.translation_cache ?? {},
    },
  };
}

function rowToMeta(row: any): HistoryMeta {
  return {
    word:        row.word,
    input_lang:  row.input_lang,
    output_lang: row.output_lang,
    timestamp:   row.learned_at,
  };
}

function rowToQuizEntry(row: any): QuizHistoryEntry {
  return {
    id:           row.id,
    words:        pj<string[]>(row.words, []),
    score:        row.score,
    total:        row.total,
    timestamp:    row.taken_at,
    quiz_data:    pj<Record<string, any>>(row.quiz_data, {}),
    user_answers: pj<string[]>(row.user_answers, []),
    input_lang:   row.input_lang ?? "",
  };
}

// ─────────────────────────────────────────────
// DATABASE SINGLETON
// ─────────────────────────────────────────────
let _db: SQLite.SQLiteDatabase | null = null;
let _initPromise: Promise<SQLite.SQLiteDatabase> | null = null;

async function getDB(): Promise<SQLite.SQLiteDatabase> {
  if (_db) return _db;
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    const db = await SQLite.openDatabaseAsync("app_data.db");

    // PRAGMAs phải chạy TRƯỚC DDL trên Android
    await db.execAsync("PRAGMA journal_mode = WAL;");
    await db.execAsync("PRAGMA foreign_keys = ON;");
    // 4MB page cache — tăng tốc read trên thiết bị low-RAM
    await db.execAsync("PRAGMA cache_size = -4096;");
    // NORMAL: an toàn với WAL, nhanh hơn FULL
    await db.execAsync("PRAGMA synchronous = NORMAL;");

    // word_history
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS word_history (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        word        TEXT    NOT NULL,
        input_lang  TEXT    NOT NULL,
        output_lang TEXT    NOT NULL,
        learned_at  TEXT    NOT NULL,
        overview    TEXT    NOT NULL DEFAULT '{}',
        examples    TEXT    NOT NULL DEFAULT '{}',
        extra       TEXT    NOT NULL DEFAULT '{}'
      );
    `);
    await db.execAsync(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_word_lang
        ON word_history(word, input_lang, output_lang);
    `);
    // Composite index cho query chính: list theo ngôn ngữ + thời gian
    await db.execAsync(`
      CREATE INDEX IF NOT EXISTS idx_wh_lang_time
        ON word_history(input_lang, learned_at DESC);
    `);
    // Index riêng cho lookup theo word text (dedup, load by key)
    await db.execAsync(`
      CREATE INDEX IF NOT EXISTS idx_wh_word
        ON word_history(word);
    `);

    // quiz_history
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS quiz_history (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        words        TEXT    NOT NULL,
        input_lang   TEXT    NOT NULL DEFAULT '',
        score        INTEGER NOT NULL,
        total        INTEGER NOT NULL,
        taken_at     TEXT    NOT NULL,
        quiz_data    TEXT    NOT NULL DEFAULT '{}',
        user_answers TEXT    NOT NULL DEFAULT '[]'
      );
    `);
    await db.execAsync(`
      CREATE INDEX IF NOT EXISTS idx_qh_lang_time
        ON quiz_history(input_lang, taken_at DESC);
    `);

    // daily_activity: streak + daily goal. day = local YYYY-MM-DD.
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS daily_activity (
        day   TEXT    PRIMARY KEY,
        count INTEGER NOT NULL DEFAULT 0
      );
    `);

    // app_kv: CHỈ lưu giá trị nhỏ:
    //   tts_speed (number), migration flags (bool),
    //   last_learned_ptr (pointer = word+langs, KHÔNG phải blob VocabData)
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS app_kv (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);

    await db.execAsync(`PRAGMA user_version = ${SCHEMA_VERSION};`);

    _db = db;
    return db;
  })().catch((err) => {
    _initPromise = null;
    logError("getDB init failed", err);
    throw err;
  });

  return _initPromise;
}

// ─────────────────────────────────────────────
// PUBLIC INIT
// ─────────────────────────────────────────────
export async function initDatabase(): Promise<boolean> {
  try {
    await getDB();
    return true;
  } catch (err) {
    logError("initDatabase", err);
    return false;
  }
}

// ─────────────────────────────────────────────
// ══════════════════════════════════════════════
//  WORD HISTORY
// ══════════════════════════════════════════════
// ─────────────────────────────────────────────

/**
 * Upsert một word entry.
 *
 * v3 THAY ĐỔI: Không còn serialize full HistoryEntry vào app_kv.
 * Chỉ lưu POINTER nhỏ (word + langs + ts) vào 'last_learned_ptr'.
 * Khi cần restore session → gọi loadLastLearned() để query SQLite bằng pointer.
 *
 * Lý do: VocabData có thể 10–50KB JSON. Lưu vào KV mỗi lần saveWord()
 * là redundant write, đặc biệt tệ khi học nhiều từ liên tiếp.
 */
export async function saveWord(
  word: string,
  inputLang: string,
  outputLang: string,
  data: VocabData,
  learnedAt?: string
): Promise<void> {
  try {
    const db          = await getDB();
    const ts          = learnedAt ?? nowIso();
    const overviewStr = j(data.overview ?? {});
    const examplesStr = j(data.examples ?? {});
    const extraStr    = j({ translation_cache: data.translation_cache ?? {} });
    // Pointer: chỉ ~80 bytes
    const ptrStr      = j({ word, input_lang: inputLang, output_lang: outputLang, learned_at: ts });

    await db.withTransactionAsync(async () => {
      await db.runAsync(
        `INSERT INTO word_history
           (word, input_lang, output_lang, learned_at, overview, examples, extra)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(word, input_lang, output_lang) DO UPDATE SET
           learned_at = excluded.learned_at,
           overview   = excluded.overview,
           examples   = excluded.examples,
           extra      = excluded.extra`,
        [word, inputLang, outputLang, ts, overviewStr, examplesStr, extraStr]
      );
      await db.runAsync(
        `INSERT INTO app_kv (key, value) VALUES ('last_learned_ptr', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        [ptrStr]
      );
    });
  } catch (err) {
    logError(`saveWord(${word}, ${inputLang})`, err);
    throw err;
  }
}

/**
 * Restore last session: đọc pointer → query word_history.
 * Tránh deserialize blob từ KV.
 */
export async function loadLastLearned(): Promise<HistoryEntry | null> {
  try {
    const db  = await getDB();
    const kv  = await db.getFirstAsync<{ value: string }>(
      `SELECT value FROM app_kv WHERE key='last_learned_ptr'`
    );
    if (!kv) return null;
    const ptr = pj<{ word: string; input_lang: string; output_lang: string }>(kv.value, null as any);
    if (!ptr?.word) return null;
    return loadWord(ptr.word, ptr.input_lang, ptr.output_lang);
  } catch (err) {
    logError("loadLastLearned", err);
    return null;
  }
}

/**
 * Cập nhật chỉ cột examples (background tokenization patch).
 * Không throw nếu row chưa tồn tại.
 */
export async function updateExamples(
  word: string,
  inputLang: string,
  outputLang: string,
  examples: Record<string, any[]>
): Promise<void> {
  try {
    const db     = await getDB();
    const result = await db.runAsync(
      `UPDATE word_history SET examples = ?
       WHERE word = ? AND input_lang = ? AND output_lang = ?`,
      [j(examples), word, inputLang, outputLang]
    );
    if (result.changes === 0) {
      console.warn(`${TAG} updateExamples: no row for "${word}" [${inputLang}→${outputLang}]`);
    }
  } catch (err) {
    logError(`updateExamples(${word})`, err);
    // Không re-throw
  }
}

/**
 * Merge token translations vào cache hiện có.
 * GỌI SAU MỖI LẦN DỊCH TOKEN THÀNH CÔNG.
 * Chỉ đọc cột `extra` (không load overview/examples).
 *
 * @param newEntries - map { token → translation } mới cần thêm vào cache
 */
export async function updateTranslationCache(
  word: string,
  inputLang: string,
  outputLang: string,
  newEntries: Record<string, string>
): Promise<void> {
  try {
    const db  = await getDB();
    // Chỉ SELECT cột extra — không kéo cả row
    const row = await db.getFirstAsync<{ extra: string }>(
      `SELECT extra FROM word_history
       WHERE word=? AND input_lang=? AND output_lang=?`,
      [word, inputLang, outputLang]
    );
    if (!row) {
      console.warn(`${TAG} updateTranslationCache: no row for "${word}". Skipping.`);
      return;
    }
    const extra = pj<Record<string, any>>(row.extra, {});
    // Merge: không xoá key cũ
    extra.translation_cache = { ...(extra.translation_cache ?? {}), ...newEntries };
    await db.runAsync(
      `UPDATE word_history SET extra = ?
       WHERE word=? AND input_lang=? AND output_lang=?`,
      [j(extra), word, inputLang, outputLang]
    );
  } catch (err) {
    logError(`updateTranslationCache(${word})`, err);
    // Cache miss không ảnh hưởng UX
  }
}

/** Load đầy đủ một entry */
export async function loadWord(
  word: string,
  inputLang: string,
  outputLang: string
): Promise<HistoryEntry | null> {
  try {
    const db  = await getDB();
    const row = await db.getFirstAsync<any>(
      `SELECT * FROM word_history
       WHERE word=? AND input_lang=? AND output_lang=?`,
      [word, inputLang, outputLang]
    );
    return row ? rowToHistoryEntry(row) : null;
  } catch (err) {
    logError(`loadWord(${word})`, err);
    return null;
  }
}

/**
 * Tìm cached entry theo word + input_lang (bỏ qua output_lang).
 * Mirrors old AsyncStorage cache-hit logic.
 */
export async function loadWordByInputLang(
  word: string,
  inputLang: string
): Promise<HistoryEntry | null> {
  try {
    const db  = await getDB();
    const row = await db.getFirstAsync<any>(
      `SELECT * FROM word_history
       WHERE word=? AND input_lang=? ORDER BY learned_at DESC LIMIT 1`,
      [word, inputLang]
    );
    return row ? rowToHistoryEntry(row) : null;
  } catch (err) {
    logError(`loadWordByInputLang(${word}, ${inputLang})`, err);
    return null;
  }
}

/**
 * Danh sách metadata nhẹ (KHÔNG có blob overview/examples/extra).
 * Dùng cho: history list UI, sidebar.
 * Scale tốt đến hàng nghìn từ.
 */
export async function listWords(opts: {
  inputLang?: string;
  limit?: number;
  offset?: number;
} = {}): Promise<HistoryMeta[]> {
  try {
    const db     = await getDB();
    const limit  = opts.limit ?? 50;
    const offset = opts.offset ?? 0;
    let rows: any[];

    if (opts.inputLang) {
      rows = await db.getAllAsync(
        `SELECT word, input_lang, output_lang, learned_at FROM word_history
         WHERE input_lang=? ORDER BY learned_at DESC LIMIT ? OFFSET ?`,
        [opts.inputLang, limit, offset]
      );
    } else {
      rows = await db.getAllAsync(
        `SELECT word, input_lang, output_lang, learned_at FROM word_history
         ORDER BY learned_at DESC LIMIT ? OFFSET ?`,
        [limit, offset]
      );
    }
    return rows.map(rowToMeta);
  } catch (err) {
    logError("listWords", err);
    return [];
  }
}

/**
 * Chỉ lấy danh sách tên từ (strings) — nhẹ nhất có thể.
 * Dùng TRỰC TIẾP cho quiz generation thay vì listWordsFull().
 */
export async function listWordNames(
  inputLang: string,
  limit = 50
): Promise<string[]> {
  try {
    const db   = await getDB();
    const rows = await db.getAllAsync<{ word: string }>(
      `SELECT word FROM word_history
       WHERE input_lang=? ORDER BY learned_at DESC LIMIT ?`,
      [inputLang, limit]
    );
    return rows.map((r) => r.word);
  } catch (err) {
    logError("listWordNames", err);
    return [];
  }
}

/**
 * Danh sách đầy đủ kèm blob.
 * Chỉ dùng khi thực sự cần toàn bộ data (export, offline search, migration).
 * TRÁNH dùng cho UI list — dùng listWords() thay thế.
 */
export async function listWordsFull(opts: {
  inputLang?: string;
  limit?: number;
} = {}): Promise<HistoryEntry[]> {
  try {
    const db    = await getDB();
    const limit = opts.limit ?? 50;
    let rows: any[];

    if (opts.inputLang) {
      rows = await db.getAllAsync(
        `SELECT * FROM word_history
         WHERE input_lang=? ORDER BY learned_at DESC LIMIT ?`,
        [opts.inputLang, limit]
      );
    } else {
      rows = await db.getAllAsync(
        `SELECT * FROM word_history ORDER BY learned_at DESC LIMIT ?`,
        [limit]
      );
    }
    return rows.map(rowToHistoryEntry);
  } catch (err) {
    logError("listWordsFull", err);
    return [];
  }
}

/** Đếm số từ — O(1) với index, không load blob */
export async function countWords(inputLang?: string): Promise<number> {
  try {
    const db  = await getDB();
    const row = inputLang
      ? await db.getFirstAsync<{ cnt: number }>(
          `SELECT COUNT(*) as cnt FROM word_history WHERE input_lang=?`,
          [inputLang]
        )
      : await db.getFirstAsync<{ cnt: number }>(
          `SELECT COUNT(*) as cnt FROM word_history`
        );
    return row?.cnt ?? 0;
  } catch (err) {
    logError("countWords", err);
    return 0;
  }
}

export async function clearWordHistory(): Promise<void> {
  try {
    const db = await getDB();
    await db.withTransactionAsync(async () => {
      await db.runAsync(`DELETE FROM word_history`);
      await db.runAsync(`DELETE FROM app_kv WHERE key='last_learned_ptr'`);
    });
  } catch (err) {
    logError("clearWordHistory", err);
    throw err;
  }
}

// ─────────────────────────────────────────────
// ══════════════════════════════════════════════
//  QUIZ HISTORY
// ══════════════════════════════════════════════
// ─────────────────────────────────────────────

export async function saveQuiz(entry: QuizHistoryEntry): Promise<number | undefined> {
  try {
    const db = await getDB();
    const result = await db.runAsync(
      `INSERT INTO quiz_history
         (words, input_lang, score, total, taken_at, quiz_data, user_answers)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        j(entry.words),
        entry.input_lang ?? "",
        entry.score,
        entry.total,
        entry.timestamp ?? nowIso(),
        j(entry.quiz_data),
        j(entry.user_answers),
      ]
    );
    return result.lastInsertRowId;
  } catch (err) {
    logError("saveQuiz", err);
    throw err;
  }
}
export async function listQuizzes(opts: {
  inputLang?: string;
  limit?: number;
  offset?: number;
} = {}): Promise<QuizHistoryEntry[]> {
  try {
    const db     = await getDB();
    const limit  = opts.limit ?? 100;
    const offset = opts.offset ?? 0;
    let rows: any[];

    if (opts.inputLang) {
      rows = await db.getAllAsync(
        `SELECT * FROM quiz_history
         WHERE input_lang=? ORDER BY taken_at DESC LIMIT ? OFFSET ?`,
        [opts.inputLang, limit, offset]
      );
    } else {
      rows = await db.getAllAsync(
        `SELECT * FROM quiz_history ORDER BY taken_at DESC LIMIT ? OFFSET ?`,
        [limit, offset]
      );
    }
    return rows.map(rowToQuizEntry);
  } catch (err) {
    logError("listQuizzes", err);
    return [];
  }
}

export async function clearQuizHistory(): Promise<void> {
  try {
    const db = await getDB();
    await db.runAsync(`DELETE FROM quiz_history`);
  } catch (err) {
    logError("clearQuizHistory", err);
    throw err;
  }
}


export async function saveQuizExplanation(
  quizId: number,
  questionIndex: number,
  explanation: string
): Promise<void> {
  try {
    const db = await getDB();
    await db.runAsync(
      `INSERT INTO app_kv (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [`qexp:${quizId}:${questionIndex}`, JSON.stringify(explanation)]
    );
  } catch (err) {
    logError(`saveQuizExplanation(${quizId}, ${questionIndex})`, err);
  }
}

export async function loadQuizExplanations(
  quizId: number
): Promise<Record<number, string>> {
  try {
    const db = await getDB();
    const rows = await db.getAllAsync<{ key: string; value: string }>(
      `SELECT key, value FROM app_kv WHERE key LIKE ?`,
      [`qexp:${quizId}:%`]
    );
    const result: Record<number, string> = {};
    for (const row of rows) {
      const idx = parseInt(row.key.split(":")[2], 10);
      result[idx] = JSON.parse(row.value);
    }
    return result;
  } catch (err) {
    logError(`loadQuizExplanations(${quizId})`, err);
    return {};
  }
}

// ─────────────────────────────────────────────
// ══════════════════════════════════════════════
//  DAILY ACTIVITY  — streak + daily goal
// ══════════════════════════════════════════════
// ─────────────────────────────────────────────

export interface DailyCount {
  day: string;   // local YYYY-MM-DD
  count: number;
}

/** Ngày local dạng YYYY-MM-DD (KHÔNG dùng UTC để streak khớp múi giờ user) */
export function localDay(d: Date = new Date()): string {
  const y  = d.getFullYear();
  const m  = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

/** Cộng dồn số hoạt động học của HÔM NAY. Trả về count mới của ngày. */
export async function recordActivity(n: number = 1): Promise<number> {
  try {
    const db  = await getDB();
    const day = localDay();
    await db.runAsync(
      `INSERT INTO daily_activity (day, count) VALUES (?, ?)
       ON CONFLICT(day) DO UPDATE SET count = count + excluded.count`,
      [day, n]
    );
    const row = await db.getFirstAsync<{ count: number }>(
      `SELECT count FROM daily_activity WHERE day=?`,
      [day]
    );
    return row?.count ?? n;
  } catch (err) {
    logError("recordActivity", err);
    return 0;
  }
}

/** Danh sách count theo ngày (mới → cũ), tối đa `limitDays` ngày gần nhất. */
export async function listDailyActivity(limitDays: number = 30): Promise<DailyCount[]> {
  try {
    const db = await getDB();
    const rows = await db.getAllAsync<DailyCount>(
      `SELECT day, count FROM daily_activity ORDER BY day DESC LIMIT ?`,
      [limitDays]
    );
    return rows;
  } catch (err) {
    logError("listDailyActivity", err);
    return [];
  }
}

/** Tổng số ngày từng học (dùng cho stats) */
export async function countActiveDays(): Promise<number> {
  try {
    const db  = await getDB();
    const row = await db.getFirstAsync<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM daily_activity WHERE count > 0`
    );
    return row?.cnt ?? 0;
  } catch (err) {
    logError("countActiveDays", err);
    return 0;
  }
}

// ─────────────────────────────────────────────
// ══════════════════════════════════════════════
//  KV STORE  — chỉ dùng cho giá trị NHỎ
// ══════════════════════════════════════════════
// Quy tắc: KHÔNG lưu VocabData blob vào đây.
// Hợp lệ: tts_speed (float), flags (bool), last_learned_ptr (pointer ~80B)
// ─────────────────────────────────────────────

export async function kvSet(key: string, value: any): Promise<void> {
  try {
    const db  = await getDB();
    const str = typeof value === "string" ? value : j(value);
    await db.runAsync(
      `INSERT INTO app_kv (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [key, str]
    );
  } catch (err) {
    logError(`kvSet(${key})`, err);
    throw err;
  }
}

export async function kvGet<T = any>(key: string): Promise<T | null> {
  try {
    const db  = await getDB();
    const row = await db.getFirstAsync<{ value: string }>(
      `SELECT value FROM app_kv WHERE key=?`,
      [key]
    );
    if (!row) return null;
    try { return JSON.parse(row.value) as T; }
    catch { return row.value as unknown as T; }
  } catch (err) {
    logError(`kvGet(${key})`, err);
    return null;
  }
}

export async function kvDelete(key: string): Promise<void> {
  try {
    const db = await getDB();
    await db.runAsync(`DELETE FROM app_kv WHERE key=?`, [key]);
  } catch (err) {
    logError(`kvDelete(${key})`, err);
  }
}

// ─────────────────────────────────────────────
// ══════════════════════════════════════════════
//  MIGRATION FROM ASYNCSTORAGE  (one-shot)
// ══════════════════════════════════════════════
// ─────────────────────────────────────────────

export async function migrateFromAsyncStorage(
  AsyncStorage: any
): Promise<{ words: number; quizzes: number; skipped: boolean }> {
  const result = { words: 0, quizzes: 0, skipped: false };

  try {
    const done = await kvGet<boolean>("migration_v1_done");
    if (done === true) { result.skipped = true; return result; }

    console.log(`${TAG} Starting migration from AsyncStorage...`);
    const db = await getDB();

    // ── Word history — 1 transaction cho toàn bộ batch ────────────────────
    try {
      const historyRaw = await AsyncStorage.getItem("@vocab_history");
      if (historyRaw) {
        const entries: HistoryEntry[] = JSON.parse(historyRaw);
        await db.withTransactionAsync(async () => {
          for (const e of entries) {
            try {
              await db.runAsync(
                `INSERT INTO word_history
                   (word, input_lang, output_lang, learned_at, overview, examples, extra)
                 VALUES (?, ?, ?, ?, ?, ?, ?)
                 ON CONFLICT(word, input_lang, output_lang) DO NOTHING`,
                [
                  e.word, e.input_lang, e.output_lang, e.timestamp,
                  j(e.data.overview ?? {}),
                  j(e.data.examples ?? {}),
                  j({ translation_cache: e.data.translation_cache ?? {} }),
                ]
              );
              result.words++;
            } catch (innerErr) {
              console.warn(`${TAG} migrate word "${e.word}":`, innerErr);
            }
          }
        });
      }
    } catch (err) {
      console.warn(`${TAG} migrate vocab_history:`, err);
    }

    // ── Quiz history — 1 transaction ──────────────────────────────────────
    try {
      const quizRaw = await AsyncStorage.getItem("@quiz_history");
      if (quizRaw) {
        const entries: QuizHistoryEntry[] = JSON.parse(quizRaw);
        await db.withTransactionAsync(async () => {
          for (const e of entries) {
            try {
              await db.runAsync(
                `INSERT INTO quiz_history
                   (words, input_lang, score, total, taken_at, quiz_data, user_answers)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [
                  j(e.words), e.input_lang ?? "",
                  e.score, e.total, e.timestamp ?? nowIso(),
                  j(e.quiz_data), j(e.user_answers),
                ]
              );
              result.quizzes++;
            } catch (innerErr) {
              console.warn(`${TAG} migrate quiz:`, innerErr);
            }
          }
        });
      }
    } catch (err) {
      console.warn(`${TAG} migrate quiz_history:`, err);
    }

    // ── KV items ──────────────────────────────────────────────────────────
    try {
      const speedRaw = await AsyncStorage.getItem("@tts_speed");
      if (speedRaw) {
        const speed = parseFloat(speedRaw);
        if (!isNaN(speed)) await kvSet("tts_speed", speed);
      }
    } catch { /* non-critical */ }

    try {
      const lastRaw = await AsyncStorage.getItem("@last_learned_word");
      if (lastRaw) {
        const entry: HistoryEntry = JSON.parse(lastRaw);
        // Chỉ lưu pointer, không lưu blob
        await kvSet("last_learned_ptr", {
          word:        entry.word,
          input_lang:  entry.input_lang,
          output_lang: entry.output_lang,
          learned_at:  entry.timestamp,
        });
      }
    } catch { /* non-critical */ }

    await kvSet("migration_v1_done", true);
    console.log(`${TAG} Migration done: ${result.words} words, ${result.quizzes} quizzes.`);
  } catch (err) {
    logError("migrateFromAsyncStorage (outer)", err);
  }

  return result;
}