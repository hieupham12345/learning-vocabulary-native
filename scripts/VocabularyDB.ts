import * as SQLite from 'expo-sqlite';
import * as FileSystem from 'expo-file-system/legacy';
import { Asset } from 'expo-asset';

export interface Vocabulary {
  id?: number;
  word: string;
  language: string;
  /** Stored as SQLite INTEGER 0/1 — this is the raw row value. */
  is_learned: number;
  level?: string;
}

export class VocabularyDB {
  private static instance: VocabularyDB;
  private db: SQLite.SQLiteDatabase | null = null;
  private dbName = 'vocab_words.db';
  private initPromise: Promise<void> | null = null; 

  private constructor() {}

  public static getInstance(): VocabularyDB {
    if (!VocabularyDB.instance) {
      VocabularyDB.instance = new VocabularyDB();
    }
    return VocabularyDB.instance;
  }

  async initDB(): Promise<void> {
    if (this.db) return; 
    
    if (!this.initPromise) {
      this.initPromise = this._initDBInternal();
    }
    return this.initPromise; 
  }

  private async _initDBInternal(): Promise<void> {
    const dbDirectory = FileSystem.documentDirectory + 'SQLite/';
    const dbPath = dbDirectory + this.dbName;

    
    // Đổi thành FALSE khi build app lên Store
    const FORCE_UPDATE = true; 

    if (__DEV__ && FORCE_UPDATE) {
      console.log("🛠 [DEV] Đang xóa DB cũ để nạp lại bản mới từ assets...");
      await FileSystem.deleteAsync(dbPath, { idempotent: true }); 
    }

    const dbInfo = await FileSystem.getInfoAsync(dbPath);

    if (!dbInfo.exists) {
      console.log("Đang copy database từ bundle vào máy...");
      await FileSystem.makeDirectoryAsync(dbDirectory, { intermediates: true });
      
      const asset = Asset.fromModule(require('../assets/vocab_words.db')); 
      await asset.downloadAsync();
      
      await FileSystem.copyAsync({
        from: asset.localUri || asset.uri,
        to: dbPath,
      });
      console.log("✅ Copy database thành công!");
    } else {
      console.log("⚡ Database đã tồn tại trên thiết bị.");
    }

    this.db = SQLite.openDatabaseSync(this.dbName);

    // 🚀 TỐI ƯU HÓA: Tự động đánh Index (Chỉ mục) cho database
    // Giúp tốc độ tìm kiếm trong 100.000 dòng chỉ tốn vài mili-giây
    await this.db.execAsync(`
      CREATE INDEX IF NOT EXISTS idx_lang_level ON vocabulary(language, level);
    `);
    console.log("⚡ Đã kiểm tra và thiết lập Index cho Database.");
  }

  private async getDB(): Promise<SQLite.SQLiteDatabase> {
    if (!this.db) {
      await this.initDB();
    }
    return this.db!;
  }

  // --- CÁC HÀM TƯƠNG TÁC DỮ LIỆU ---

  async addWord(word: string, language: string, is_learned: boolean = false, level: string = "") {
    const db = await this.getDB();

    // 1. Kiểm tra xem từ vựng đã tồn tại trong ngôn ngữ này chưa
    const existingWord = await db.getFirstAsync<{ id: number }>(
      'SELECT id FROM vocabulary WHERE word = ? AND language = ?',
      [word, language]
    );

    // 2. Nếu đã tồn tại thì bỏ qua (hoặc bạn có thể update tuỳ ý)
    if (existingWord) {
      console.log(`⚠️ Từ "${word}" đã tồn tại trong từ điển ${language}! Bỏ qua thêm mới.`);
      return; 
    }

    // 3. Nếu chưa có thì thực hiện thêm mới
    await db.runAsync(
      'INSERT INTO vocabulary (word, language, is_learned, level) VALUES (?, ?, ?, ?)',
      [word, language, is_learned ? 1 : 0, level]
    );
  }

  async getAllWords(): Promise<Vocabulary[]> {
    const db = await this.getDB();
    return await db.getAllAsync<Vocabulary>('SELECT * FROM vocabulary', []);
  }

  async setLearned(id: number, is_learned: boolean) {
    const db = await this.getDB();
    await db.runAsync(
      'UPDATE vocabulary SET is_learned = ? WHERE id = ?',
      [is_learned ? 1 : 0, id]
    );
  }

  /**
   * Đánh dấu từ đã học LẦN ĐẦU (0→1). Atomic + idempotent.
   * Trả true nếu đây là lần đầu (changes>0) → dùng để +streak/+goal 1 lần duy nhất.
   * Học lại từ đã học (is_learned=1) → changes=0 → false → KHÔNG tính.
   */
  async markLearned(id: number): Promise<boolean> {
    const db = await this.getDB();
    const res = await db.runAsync(
      'UPDATE vocabulary SET is_learned = 1 WHERE id = ? AND is_learned = 0',
      [id]
    );
    return (res.changes ?? 0) > 0;
  }

  /**
   * Luồng gõ tay (từ không đến từ danh sách có id). Trả true nếu là từ MỚI học lần đầu.
   * - Chưa có row → INSERT (is_learned=1) → true.
   * - Có & đã học (is_learned=1) → false.
   * - Có & chưa học (is_learned=0) → UPDATE lên 1 → true.
   */
  async learnWordByText(word: string, language: string): Promise<boolean> {
    const db = await this.getDB();
    const row = await db.getFirstAsync<{ id: number; is_learned: number }>(
      'SELECT id, is_learned FROM vocabulary WHERE word = ? AND language = ?',
      [word, language]
    );
    if (!row) {
      await db.runAsync(
        'INSERT INTO vocabulary (word, language, is_learned, level) VALUES (?, ?, 1, ?)',
        [word, language, '']
      );
      return true;
    }
    if (row.is_learned === 1) return false;
    await db.runAsync('UPDATE vocabulary SET is_learned = 1 WHERE id = ?', [row.id]);
    return true;
  }

  async setLevel(id: number, level: string) {
    const db = await this.getDB();
    await db.runAsync(
      'UPDATE vocabulary SET level = ? WHERE id = ?',
      [level, id]
    );
  }

  async deleteWord(id: number) {
    const db = await this.getDB();
    await db.runAsync(
      'DELETE FROM vocabulary WHERE id = ?',
      [id]
    );
  }

  async getLanguages(): Promise<string[]> {
    const db = await this.getDB();
    const results = await db.getAllAsync<{ language: string }>(
      `SELECT DISTINCT language 
       FROM vocabulary 
       WHERE language IS NOT NULL AND language != ''
       ORDER BY language ASC`,
      []
    );
    return results.map(row => row.language);
  }

  async getLevelsByLanguage(language: string): Promise<string[]> {
    const db = await this.getDB();
    const results = await db.getAllAsync<{ level: string }>(
      `SELECT DISTINCT level 
       FROM vocabulary 
       WHERE language = ? AND level IS NOT NULL AND level != ''
       ORDER BY level ASC`,
      [language]
    );
    return results.map(row => row.level);
  }

  // 🚀 TỐI ƯU HÓA: Phân trang dữ liệu + Sắp xếp theo trạng thái học
  async getWordsByLanguageAndLevel(
    language: string, 
    level: string, 
    limit: number = 50, 
    offset: number = 0
  ): Promise<Vocabulary[]> {
    const db = await this.getDB();
    
    // Thêm ORDER BY is_learned ASC
    // Nếu muốn các từ mới thêm vào hiện lên đầu trong nhóm chưa học, 
    // bạn có thể dùng: ORDER BY is_learned ASC, id DESC
    return await db.getAllAsync<Vocabulary>(
      `SELECT * FROM vocabulary 
       WHERE language = ? AND level = ?
       LIMIT ? OFFSET ?`,
      [language, level, limit, offset]
    );
  }
}
      //  ORDER BY is_learned ASC, id ASC

export const database = VocabularyDB.getInstance();