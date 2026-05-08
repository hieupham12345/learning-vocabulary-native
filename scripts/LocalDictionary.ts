// LocalDictionary.ts
import * as SQLite from 'expo-sqlite';

// Kích thước tối đa cho Memory Cache để tránh tràn RAM
const L1_CACHE_LIMIT = 1000; 

export class LocalDictionary {
  private db: SQLite.SQLiteDatabase;
  
  // L1 Cache: Hash Map in-memory O(1)
  private memoryCache: Map<string, string> = new Map();

  constructor() {
    // Mở hoặc tạo database local
    this.db = SQLite.openDatabaseSync('vocab_dictionary.db');
    this.initDB();
  }

  private initDB() {
    // Tạo bảng với B-Tree Index giúp O(log n) lookup khi DB phình to tới hàng triệu dòng
    this.db.execSync(`
      CREATE TABLE IF NOT EXISTS dictionary (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        word_key TEXT UNIQUE NOT NULL,
        translation TEXT NOT NULL,
        last_accessed INTEGER NOT NULL
      );
      -- Thuật toán Indexing B-Tree khuyên dùng cho các truy vấn tra cứu
      CREATE INDEX IF NOT EXISTS idx_word_key ON dictionary(word_key);
    `);
  }

  // Thêm vào bên trong class LocalDictionary
    public clearAllData() {
    try {
        // 1. Xóa L1 Cache (Memory)
        this.memoryCache.clear();
        
        // 2. Xóa L2 Cache (SQLite)
        this.db.runSync('DELETE FROM dictionary');
        
        console.log("✅ Local dictionary cache cleared (Memory & SQLite).");
    } catch (e) {
        console.error("❌ Failed to clear local dictionary", e);
    }
    }

  /**
   * Tạo khóa duy nhất cho mỗi token dựa trên ngôn ngữ
   * Ví dụ: "zh-en-苹果"
   */
  private generateKey(word: string, inputLang: string, outputLang: string): string {
    return `${inputLang}-${outputLang}-${word.trim()}`;
  }

  /**
   * Thuật toán tra cứu 3 lớp (L1 -> L2 -> L3)
   */
  public async translateToken(
    word: string, 
    inputLang: string, 
    outputLang: string, 
    apiFallback: () => Promise<string> // Hàm gọi API truyền từ bên ngoài vào
  ): Promise<string> {
    const key = this.generateKey(word, inputLang, outputLang);

    // 1. Check L1: Memory Cache O(1)
    if (this.memoryCache.has(key)) {
      this.updateLRU(key, this.memoryCache.get(key)!); // Đẩy lên đầu LRU
      return this.memoryCache.get(key)!;
    }

    // 2. Check L2: SQLite (B-Tree Index O(log n))
    const row = this.db.getFirstSync<{ translation: string }>(
      'SELECT translation FROM dictionary WHERE word_key = ?',
      [key]
    );

    if (row) {
      // Đưa ngược từ DB lên Memory Cache
      this.addToMemoryCache(key, row.translation);
      // Cập nhật thời gian truy cập ngầm
      this.db.runAsync('UPDATE dictionary SET last_accessed = ? WHERE word_key = ?', [Date.now(), key]);
      return row.translation;
    }

    // 3. Check L3: Gọi API (LLM / External Service)
    const apiTranslation = await apiFallback(); // throws nếu lỗi -> không cache

    // Chỉ lưu khi thành công
    this.addToMemoryCache(key, apiTranslation);
    this.saveToDB(key, apiTranslation);

    return apiTranslation;
  }

  /**
   * Batch Lookup: Thuật toán tra cứu nhiều token cùng lúc (Tránh N+1 Query)
   * Rất hữu ích khi bạn load 1 câu có 10 tokens.
   */
  public getTranslationsBatch(tokens: string[], inputLang: string, outputLang: string): Record<string, string> {
    const result: Record<string, string> = {};
    const missingKeys: string[] = [];

    // Lọc qua L1 trước
    tokens.forEach(token => {
      const key = this.generateKey(token, inputLang, outputLang);
      if (this.memoryCache.has(key)) {
        result[token] = this.memoryCache.get(key)!;
      } else {
        missingKeys.push(key);
      }
    });

    if (missingKeys.length === 0) return result;

    // Truy vấn SQLite 1 lần duy nhất bằng mệnh đề IN (Tối ưu I/O)
    const placeholders = missingKeys.map(() => '?').join(',');
    const rows = this.db.getAllSync<{word_key: string, translation: string}>(
      `SELECT word_key, translation FROM dictionary WHERE word_key IN (${placeholders})`,
      missingKeys
    );

    rows.forEach(row => {
      const originalToken = row.word_key.split('-').pop()!;
      result[originalToken] = row.translation;
      this.addToMemoryCache(row.word_key, row.translation);
    });

    return result;
  }

  public evictFromCache(word: string, inputLang: string, outputLang: string) {
    const key = this.generateKey(word, inputLang, outputLang);
    this.memoryCache.delete(key);
    this.db.runSync('DELETE FROM dictionary WHERE word_key = ?', [key]);
  }

  // --- Quản lý Local DB ---
  private saveToDB(key: string, translation: string) {
    try {
      this.db.runSync(
        `INSERT OR REPLACE INTO dictionary (word_key, translation, last_accessed) VALUES (?, ?, ?)`,
        [key, translation, Date.now()]
      );
    } catch (e) {
      console.warn("Failed to save to local dictionary", e);
    }
  }

  // --- Thuật toán LRU (Least Recently Used) cho Memory Cache ---
  private addToMemoryCache(key: string, translation: string) {
    if (this.memoryCache.size >= L1_CACHE_LIMIT) {
      // Xóa item cũ nhất (item đầu tiên trong Map iteration)
      const oldestKey = this.memoryCache.keys().next().value;
      if (oldestKey) this.memoryCache.delete(oldestKey);
    }
    this.memoryCache.set(key, translation);
  }

  private updateLRU(key: string, translation: string) {
    // Xóa và set lại để nó nổi lên cuối Map (Mới nhất)
    this.memoryCache.delete(key);
    this.memoryCache.set(key, translation);
  }
}


export const localDict = new LocalDictionary();
