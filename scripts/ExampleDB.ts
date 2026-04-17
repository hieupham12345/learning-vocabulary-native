/**
 * exampleDB.ts
 * ──────────────────────
 * SQLite-backed storage layer for the Vocabulary Learner app.
 * Mirrors the Python AppDatabase design:
 *   - word_history  : stores metadata + API blobs in separate columns
 *   - quiz_history  : stores quiz metadata + full quiz_data blob
 *
 * Only CURRENT_WORD_KEY (transient navigation intent) still uses AsyncStorage.
 *
 * Dependencies: expo-sqlite (v14+, new API with `openDatabaseAsync`)
 */

import * as SQLite from "expo-sqlite";

// ─────────────────────────────────────────────
// TYPES  (mirrors the shapes used in the UI)
// ─────────────────────────────────────────────
export interface HistoryEntry {
  word: string;
  input_lang: string;
  output_lang: string;
  timestamp: string;
  data: VocabData;
}

export interface VocabData {
  word: string;
  language?: { input: string; output: string };
  overview: Record<string, any>;
  examples: Record<string, any[]>;
  translation_cache?: Record<string, string>;
}

export interface QuizHistoryEntry {
  words: string[];
  score: number;
  total: number;
  timestamp: string;
  quiz_data: Record<string, any>;
  user_answers: string[];
  input_lang?: string;
}

// ─────────────────────────────────────────────
// DDL
// ─────────────────────────────────────────────
const DDL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS word_history (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  word        TEXT NOT NULL,
  input_lang  TEXT NOT NULL,
  output_lang TEXT NOT NULL,
  learned_at  TEXT NOT NULL,
  overview    TEXT DEFAULT '{}',
  examples    TEXT DEFAULT '{}',
  extra       TEXT DEFAULT '{}'
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_word_lang
  ON word_history(word, input_lang, output_lang);

CREATE INDEX IF NOT EXISTS idx_wh_lang_time
  ON word_history(input_lang, learned_at DESC);

CREATE TABLE IF NOT EXISTS quiz_history (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  words        TEXT NOT NULL,
  input_lang   TEXT NOT NULL,
  score        INTEGER NOT NULL,
  total        INTEGER NOT NULL,
  taken_at     TEXT NOT NULL,
  quiz_data    TEXT DEFAULT '{}',
  user_answers TEXT DEFAULT '[]'
);

CREATE INDEX IF NOT EXISTS idx_qh_lang_time
  ON quiz_history(input_lang, taken_at DESC);

CREATE TABLE IF NOT EXISTS app_kv (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

// ─────────────────────────────────────────────
// SINGLETON
// ─────────────────────────────────────────────
let _db: SQLite.SQLiteDatabase | null = null;
let _initPromise: Promise<SQLite.SQLiteDatabase> | null = null;

async function getDB(): Promise<SQLite.SQLiteDatabase> {
  if (_db) return _db;
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    const db = await SQLite.openDatabaseAsync("app_data.db");
    await db.execAsync(DDL);
    _db = db;
    return db;
  })();

  return _initPromise;
}

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────
const j = (o: any) => JSON.stringify(o);
const pj = (s: string | null | undefined): any => {
  if (!s) return {};
  try { return JSON.parse(s); } catch { return {}; }
};
const now = () => new Date().toISOString();

function rowToHistoryEntry(row: any): HistoryEntry {
  const extra = pj(row.extra);
  const overview = pj(row.overview);
  const examples = pj(row.examples);
  return {
    word: row.word,
    input_lang: row.input_lang,
    output_lang: row.output_lang,
    timestamp: row.learned_at,
    data: {
      word: row.word,
      overview,
      examples,
      translation_cache: extra?.translation_cache ?? {},
    },
  };
}

function rowToQuizEntry(row: any): QuizHistoryEntry {
  return {
    words: pj(row.words),
    score: row.score,
    total: row.total,
    timestamp: row.taken_at,
    quiz_data: pj(row.quiz_data),
    user_answers: pj(row.user_answers),
    input_lang: row.input_lang,
  };
}

// ─────────────────────────────────────────────
// ══════════════════════════════════════════════
//  WORD HISTORY
// ══════════════════════════════════════════════
// ─────────────────────────────────────────────

/**
 * Upsert a word history entry.
 * On conflict (word + input_lang + output_lang) → update to latest.
 * Also writes to app_kv["last_learned"] so the UI can restore last session.
 */
export async function saveWord(
  word: string,
  inputLang: string,
  outputLang: string,
  data: VocabData,
  learnedAt?: string
): Promise<void> {
  const db = await getDB();
  const ts = learnedAt ?? now();
  const overview = j(data.overview ?? {});
  const examples = j(data.examples ?? {});
  const extra = j({ translation_cache: data.translation_cache ?? {} });

  await db.runAsync(
    `INSERT INTO word_history (word, input_lang, output_lang, learned_at, overview, examples, extra)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(word, input_lang, output_lang) DO UPDATE SET
       learned_at = excluded.learned_at,
       overview   = excluded.overview,
       examples   = excluded.examples,
       extra      = excluded.extra`,
    [word, inputLang, outputLang, ts, overview, examples, extra]
  );

  // Persist last-learned for session restore
  const entry: HistoryEntry = {
    word, input_lang: inputLang, output_lang: outputLang, timestamp: ts, data,
  };
  await db.runAsync(
    `INSERT INTO app_kv (key, value) VALUES ('last_learned', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [j(entry)]
  );
}

/**
 * Update only the examples column (background tokenization patch).
 */
export async function updateExamples(
  word: string,
  inputLang: string,
  outputLang: string,
  examples: Record<string, any[]>
): Promise<void> {
  const db = await getDB();
  await db.runAsync(
    `UPDATE word_history SET examples = ?
     WHERE word = ? AND input_lang = ? AND output_lang = ?`,
    [j(examples), word, inputLang, outputLang]
  );
}

/**
 * Update translation_cache inside the extra JSON column.
 */
export async function updateTranslationCache(
  word: string,
  inputLang: string,
  outputLang: string,
  cache: Record<string, string>
): Promise<void> {
  const db = await getDB();
  const row = await db.getFirstAsync<{ extra: string }>(
    `SELECT extra FROM word_history WHERE word=? AND input_lang=? AND output_lang=?`,
    [word, inputLang, outputLang]
  );
  if (!row) return;
  const extra = pj(row.extra);
  extra.translation_cache = cache;
  await db.runAsync(
    `UPDATE word_history SET extra = ? WHERE word=? AND input_lang=? AND output_lang=?`,
    [j(extra), word, inputLang, outputLang]
  );
}

/**
 * Load a single full entry.
 */
export async function loadWord(
  word: string,
  inputLang: string,
  outputLang: string
): Promise<HistoryEntry | null> {
  const db = await getDB();
  const row = await db.getFirstAsync<any>(
    `SELECT * FROM word_history WHERE word=? AND input_lang=? AND output_lang=?`,
    [word, inputLang, outputLang]
  );
  return row ? rowToHistoryEntry(row) : null;
}

/**
 * Lightweight list (no blobs) — for sidebar / quiz word picker.
 */
export async function listWords(opts: {
  inputLang?: string;
  limit?: number;
  offset?: number;
}): Promise<Pick<HistoryEntry, "word" | "input_lang" | "output_lang" | "timestamp">[]> {
  const db = await getDB();
  const limit = opts.limit ?? 50;
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
  return rows.map((r) => ({
    word: r.word,
    input_lang: r.input_lang,
    output_lang: r.output_lang,
    timestamp: r.learned_at,
  }));
}

/**
 * Full entries including blobs — used to rebuild in-memory list on startup.
 */
export async function listWordsFull(opts: {
  inputLang?: string;
  limit?: number;
}): Promise<HistoryEntry[]> {
  const db = await getDB();
  const limit = opts.limit ?? 50;
  let rows: any[];
  if (opts.inputLang) {
    rows = await db.getAllAsync(
      `SELECT * FROM word_history WHERE input_lang=? ORDER BY learned_at DESC LIMIT ?`,
      [opts.inputLang, limit]
    );
  } else {
    rows = await db.getAllAsync(
      `SELECT * FROM word_history ORDER BY learned_at DESC LIMIT ?`,
      [limit]
    );
  }
  return rows.map(rowToHistoryEntry);
}

/**
 * Find cached entry for a word by text only (any language).
 */
export async function findWordInHistory(word: string): Promise<HistoryEntry | null> {
  const db = await getDB();
  const row = await db.getFirstAsync<any>(
    `SELECT * FROM word_history WHERE word=? ORDER BY learned_at DESC LIMIT 1`,
    [word]
  );
  return row ? rowToHistoryEntry(row) : null;
}

export async function clearWordHistory(): Promise<void> {
  const db = await getDB();
  await db.runAsync(`DELETE FROM word_history`);
  await db.runAsync(`DELETE FROM app_kv WHERE key='last_learned'`);
}

// ─────────────────────────────────────────────
// ══════════════════════════════════════════════
//  QUIZ HISTORY
// ══════════════════════════════════════════════
// ─────────────────────────────────────────────

export async function saveQuiz(entry: QuizHistoryEntry): Promise<void> {
  const db = await getDB();
  // Infer input_lang from quiz question difficulty context if not provided
  const inputLang = entry.input_lang ?? "";
  await db.runAsync(
    `INSERT INTO quiz_history (words, input_lang, score, total, taken_at, quiz_data, user_answers)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      j(entry.words),
      inputLang,
      entry.score,
      entry.total,
      entry.timestamp ?? now(),
      j(entry.quiz_data),
      j(entry.user_answers),
    ]
  );
}

export async function listQuizzes(opts: {
  inputLang?: string;
  limit?: number;
  offset?: number;
} = {}): Promise<QuizHistoryEntry[]> {
  const db = await getDB();
  const limit = opts.limit ?? 100;
  const offset = opts.offset ?? 0;
  let rows: any[];
  if (opts.inputLang) {
    rows = await db.getAllAsync(
      `SELECT * FROM quiz_history WHERE input_lang=? ORDER BY taken_at DESC LIMIT ? OFFSET ?`,
      [opts.inputLang, limit, offset]
    );
  } else {
    rows = await db.getAllAsync(
      `SELECT * FROM quiz_history ORDER BY taken_at DESC LIMIT ? OFFSET ?`,
      [limit, offset]
    );
  }
  return rows.map(rowToQuizEntry);
}

export async function clearQuizHistory(): Promise<void> {
  const db = await getDB();
  await db.runAsync(`DELETE FROM quiz_history`);
}

// ─────────────────────────────────────────────
// ══════════════════════════════════════════════
//  KV STORE  (last_learned, tts_speed, lesson nav, etc.)
// ══════════════════════════════════════════════
// ─────────────────────────────────────────────

export async function kvSet(key: string, value: any): Promise<void> {
  const db = await getDB();
  await db.runAsync(
    `INSERT INTO app_kv (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, typeof value === "string" ? value : j(value)]
  );
}

export async function kvGet<T = any>(key: string): Promise<T | null> {
  const db = await getDB();
  const row = await db.getFirstAsync<{ value: string }>(
    `SELECT value FROM app_kv WHERE key=?`,
    [key]
  );
  if (!row) return null;
  try { return JSON.parse(row.value) as T; } catch { return row.value as unknown as T; }
}

export async function kvDelete(key: string): Promise<void> {
  const db = await getDB();
  await db.runAsync(`DELETE FROM app_kv WHERE key=?`, [key]);
}

// ─────────────────────────────────────────────
// ══════════════════════════════════════════════
//  MIGRATION FROM AsyncStorage
// ══════════════════════════════════════════════
// ─────────────────────────────────────────────
/**
 * One-shot migration from AsyncStorage to SQLite.
 * Call once on first launch; safe to call multiple times (UPSERT).
 */
export async function migrateFromAsyncStorage(
  AsyncStorage: any
): Promise<{ words: number; quizzes: number }> {
  const counts = { words: 0, quizzes: 0 };

  try {
    const historyRaw = await AsyncStorage.getItem("@vocab_history");
    if (historyRaw) {
      const entries: HistoryEntry[] = JSON.parse(historyRaw);
      for (const e of entries) {
        try {
          await saveWord(e.word, e.input_lang, e.output_lang, e.data, e.timestamp);
          counts.words++;
        } catch { /* skip duplicates */ }
      }
    }
  } catch (err) {
    console.warn("[migrate] vocab_history error:", err);
  }

  try {
    const quizRaw = await AsyncStorage.getItem("@quiz_history");
    if (quizRaw) {
      const entries: QuizHistoryEntry[] = JSON.parse(quizRaw);
      for (const e of entries) {
        try {
          await saveQuiz(e);
          counts.quizzes++;
        } catch { /* skip */ }
      }
    }
  } catch (err) {
    console.warn("[migrate] quiz_history error:", err);
  }

  try {
    const speedRaw = await AsyncStorage.getItem("@tts_speed");
    if (speedRaw) await kvSet("tts_speed", parseFloat(speedRaw));

    const lastLearned = await AsyncStorage.getItem("@last_learned_word");
    if (lastLearned) await kvSet("last_learned", JSON.parse(lastLearned));
  } catch { /* non-critical */ }

  return counts;
}

// ─────────────────────────────────────────────
// INIT — call this once at app startup
// ─────────────────────────────────────────────
export async function initDatabase(): Promise<void> {
  await getDB();
}
