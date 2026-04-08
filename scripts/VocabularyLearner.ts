// VocabularyLearner.ts
import Constants from "expo-constants";
import { callChatbot } from "./chatbotService";
import { OPENAI_API_KEY } from "./config";

///////////////////////////////////////////////////////////////////////////////////
const GPT_API_KEY = OPENAI_API_KEY || process.env.OPENAI_API_KEY ||
  Constants.expoConfig?.extra?.OPENAI_API_KEY ||
  (Constants.manifest as any)?.extra?.OPENAI_API_KEY ||
  "";

const AGENT = "chatgpt"; 
const MODEL = "gpt-5.4-mini"; 
///////////////////////////////////////////////////////////////////////////////////


// ── Google Cloud TTS language code mapping ──
// Ánh xạ từ tên ngôn ngữ app → BCP-47 language code cho Google TTS
const LANGUAGE_TO_TTS_CODE: Record<string, string> = {
  Chinese:    "zh-CN",
  English:    "en-US",
  Japanese:   "ja-JP",
  Vietnamese: "vi-VN",
  Korean:     "ko-KR",
};

// Giọng đọc mặc định cho từng ngôn ngữ (WaveNet nếu có)
const LANGUAGE_TO_VOICE_NAME: Record<string, string> = {
  Chinese:    "zh-CN-Wavenet-A",
  English:    "en-US-Wavenet-D",
  Japanese:   "ja-JP-Wavenet-A",
  Vietnamese: "vi-VN-Wavenet-A",
  Korean:     "ko-KR-Wavenet-A",
};

export class VocabularyLearner {
  private apiKey: string;
  private modelType: string;
  private modelName: string;

  constructor(apiKey: string = GPT_API_KEY, modelType: string = AGENT, modelName: string = MODEL) {
    this.apiKey = apiKey;
    this.modelType = modelType;
    this.modelName = modelName;
  }

  // ─────────────────────────────────────────────
  // GOOGLE TTS
  // ─────────────────────────────────────────────

  /**
   * Gọi Google Cloud Text-to-Speech API và trả về base64 audio MP3.
   * Yêu cầu: GOOGLE_TTS_API_KEY hợp lệ.
   *
   * @param text         - Văn bản cần đọc
   * @param language     - Tên ngôn ngữ (khớp LANGUAGE_OPTIONS trong UI)
   * @param googleApiKey - Google Cloud API key có quyền TTS
   * @returns base64-encoded MP3 string
   */
  public async synthesizeSpeech(
    text: string,
    language: string,
    googleApiKey: string
  ): Promise<string> {
    const languageCode = LANGUAGE_TO_TTS_CODE[language] ?? "en-US";
    const voiceName    = LANGUAGE_TO_VOICE_NAME[language] ?? "en-US-Wavenet-D";

    const url = `https://texttospeech.googleapis.com/v1/text:synthesize?key=${googleApiKey}`;

    const body = {
      input: { text },
      voice: {
        languageCode,
        name: voiceName,
        ssmlGender: "NEUTRAL",
      },
      audioConfig: {
        audioEncoding: "MP3",
        speakingRate: 0.9,   // Hơi chậm để học tốt hơn
        pitch: 0,
      },
    };

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Google TTS API error ${response.status}: ${errText}`);
    }

    const data = await response.json();
    if (!data.audioContent) {
      throw new Error("Google TTS trả về không có audioContent.");
    }

    return data.audioContent as string; // base64 MP3
  }

  // ─────────────────────────────────────────────
  // PROMPTS & LEARNING
  // ─────────────────────────────────────────────

  private createLearningPrompt(word: string, inputLanguage: string, outputLanguage: string, mode: string = "hard"): string {
    let examplesGenerationRules = "";
    let examplesJsonStructure = "";

    if (mode === "easy") {
      examplesGenerationRules = `
        Generate EXACTLY 12 examples total:
        - "easy"      : exactly 4
        - "medium"    : exactly 4
        - "hard"      : exactly 4
      `;
      examplesJsonStructure = `
        "examples": {
            "easy": [
                { "sentence": "...", "romanization": "...", "translation": "...", "explanation": "...", "grammar_points": ["...", "..."], "difficulty_justification": "..." },
                { "sentence": "...", "romanization": "...", "translation": "...", "explanation": "...", "grammar_points": ["...", "..."], "difficulty_justification": "..." },
                { "sentence": "...", "romanization": "...", "translation": "...", "explanation": "...", "grammar_points": ["...", "..."], "difficulty_justification": "..." },
                { "sentence": "...", "romanization": "...", "translation": "...", "explanation": "...", "grammar_points": ["...", "..."], "difficulty_justification": "..." }
            ],
            "medium": [
                { "sentence": "...", "romanization": "...", "translation": "...", "explanation": "...", "grammar_points": ["...", "..."], "difficulty_justification": "..." },
                { "sentence": "...", "romanization": "...", "translation": "...", "explanation": "...", "grammar_points": ["...", "..."], "difficulty_justification": "..." },
                { "sentence": "...", "romanization": "...", "translation": "...", "explanation": "...", "grammar_points": ["...", "..."], "difficulty_justification": "..." },
                { "sentence": "...", "romanization": "...", "translation": "...", "explanation": "...", "grammar_points": ["...", "..."], "difficulty_justification": "..." }
            ],
            "hard": [
                { "sentence": "...", "romanization": "...", "translation": "...", "explanation": "...", "grammar_points": ["...", "..."], "difficulty_justification": "..." },
                { "sentence": "...", "romanization": "...", "translation": "...", "explanation": "...", "grammar_points": ["...", "..."], "difficulty_justification": "..." },
                { "sentence": "...", "romanization": "...", "translation": "...", "explanation": "...", "grammar_points": ["...", "..."], "difficulty_justification": "..." },
                { "sentence": "...", "romanization": "...", "translation": "...", "explanation": "...", "grammar_points": ["...", "..."], "difficulty_justification": "..." }
            ]
        }
      `;
    } else {
      examplesGenerationRules = `
        Generate EXACTLY 12 examples total:
        - "easy"      : exactly 1
        - "medium"    : exactly 2
        - "hard"      : exactly 6
        - "super_hard": exactly 3
      `;
      examplesJsonStructure = `
        "examples": {
            "easy": [
                { "sentence": "...", "romanization": "...", "translation": "...", "explanation": "...", "grammar_points": ["...", "..."], "difficulty_justification": "..." }
            ],
            "medium": [
                { "sentence": "...", "romanization": "...", "translation": "...", "explanation": "...", "grammar_points": ["...", "..."], "difficulty_justification": "..." },
                { "sentence": "...", "romanization": "...", "translation": "...", "explanation": "...", "grammar_points": ["...", "..."], "difficulty_justification": "..." }
            ],
            "hard": [
                { "sentence": "...", "romanization": "...", "translation": "...", "explanation": "...", "grammar_points": ["...", "..."], "difficulty_justification": "..." },
                { "sentence": "...", "romanization": "...", "translation": "...", "explanation": "...", "grammar_points": ["...", "..."], "difficulty_justification": "..." },
                { "sentence": "...", "romanization": "...", "translation": "...", "explanation": "...", "grammar_points": ["...", "..."], "difficulty_justification": "..." },
                { "sentence": "...", "romanization": "...", "translation": "...", "explanation": "...", "grammar_points": ["...", "..."], "difficulty_justification": "..." },
                { "sentence": "...", "romanization": "...", "translation": "...", "explanation": "...", "grammar_points": ["...", "..."], "difficulty_justification": "..." },
                { "sentence": "...", "romanization": "...", "translation": "...", "explanation": "...", "grammar_points": ["...", "..."], "difficulty_justification": "..." }
            ],
            "super_hard": [
                { "sentence": "...", "romanization": "...", "translation": "...", "explanation": "...", "grammar_points": ["...", "..."], "difficulty_justification": "..." },
                { "sentence": "...", "romanization": "...", "translation": "...", "explanation": "...", "grammar_points": ["...", "..."], "difficulty_justification": "..." },
                { "sentence": "...", "romanization": "...", "translation": "...", "explanation": "...", "grammar_points": ["...", "..."], "difficulty_justification": "..." }
            ]
        }
      `;
    }

    return `
      You are a professional language tutor. Output MUST be valid JSON only — no markdown, no code blocks, no extra text. Start directly with { and end with }.

      TASK: Generate a comprehensive learning output for the vocabulary word: "${word}"

      LANGUAGE SETTINGS:
      - Input_language: "${inputLanguage}" (the language of the vocabulary word)
      - Output_language: "${outputLanguage}" (the language for ALL explanations, meanings, translations, notes, grammar_points, usage, collocations)

      LANGUAGE RULE (STRICT):
      - Every explanation, meaning, translation, note, and grammar point MUST be written entirely in Output_language.
      - Do NOT use Input_language for any explanatory text.
      - Mixing languages = invalid response.

      ROMANIZATION RULE:
      - If Input_language uses a non-Latin script: provide romanization as a string.
      - If Input_language uses Latin script: set romanization to null.
      - This applies to BOTH the overview block AND each example.

      ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      DIFFICULTY LEVEL DEFINITIONS
      ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      [EASY]: Beginner spoken communication. Survival language. (e.g. A1–A2, JLPT N5–N4, HSK 1–2). Highest-frequency everyday words.
      [MEDIUM]: Independent spoken fluency. Everyday conversation. (e.g. B1, JLPT N3, HSK 3–4). Common descriptive words.
      [HARD]: Upper-intermediate to advanced proficiency. Exam readiness. (e.g. B2–C1, JLPT N2, HSK 5). Collocations, phrasal patterns.
      [SUPER_HARD]: Near-native or native mastery. High-stakes exams or literary reading. (e.g. C2, JLPT N1, HSK 6+).

      ANTI-PATTERNS (STRICTLY FORBIDDEN):
      - Do NOT repeat the same grammatical structure across any two examples.
      - Do NOT produce sentences that sound artificial or textbook-like.

      ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      EXAMPLES GENERATION RULES
      ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      ${examplesGenerationRules}

      ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      OUTPUT JSON STRUCTURE
      ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      {
          "word": "${word}",
          "language": {
              "input": "${inputLanguage}",
              "output": "${outputLanguage}"
          },
          "overview": {
              "meaning": "<in Output_language>",
              "romanization": "<string or null>",
              "part_of_speech": "<in Output_language>",
              "register": "<formal | informal | neutral | literary | colloquial>",
              "usage": "<in Output_language>",
              "notes": "<in Output_language>",
              "collocations": ["<5 items in Input_language>"]
          },
          ${examplesJsonStructure}
      }
    `;
  }

  public async learnWord(word: string, inputLanguage: string, outputLanguage: string, mode: string = "hard"): Promise<any> {
    const prompt = this.createLearningPrompt(word, inputLanguage, outputLanguage, mode);
    let responseText = "";
    try {
      responseText = await callChatbot(prompt, this.modelName, this.modelType, this.apiKey);
      const cleanResponse = this.cleanJsonResponse(responseText);
      const data = JSON.parse(cleanResponse);
      
      // Đã loại bỏ logic fs.writeFileSync để UI tự handle việc lưu trữ
      return data;
    } catch (error: any) {
      return { 
        error: error.message, 
        raw_response: responseText 
      };
    }
  }

  private createQuizPrompt(words: string[], inputLanguage: string, outputLanguage: string, numQuestions: number, mode: string = "hard"): string {
    const wordsStr = words.join(", ");
    const difficultyRules = mode === "easy" 
      ? `DIFFICULTY DISTRIBUTION: EASY SET (Beginner Level)
         - 33% EASY: Basic recognition, direct translation.
         - 33% MEDIUM: Simple contextual understanding.
         - 33% HARD: Nuanced usage.`
      : `DIFFICULTY DISTRIBUTION: HARD SET (Advanced Level)
         - 33% MEDIUM: Contextual inference.
         - 33% HARD: Advanced collocations.
         - 33% VERY HARD: Subtle nuance, rare collocations.`;

    return `
      You are an expert language examiner and curriculum designer.
      TASK: Generate a multiple-choice quiz (EXACTLY ${numQuestions} questions) for these words: [${wordsStr}].
      
      LANGUAGE SETTINGS:
      - Target Exam Language: "${inputLanguage}"
      - Explanation Language: "${outputLanguage}"

      CRITICAL RULES:
      ${difficultyRules}
      - Distribute the correct answers reasonably.

      OUTPUT FORMAT:
      Valid JSON ONLY. No markdown.
      {
          "words": ${JSON.stringify(words)},
          "quiz": [
              {
                  "difficulty": "${mode}",
                  "dimension": "DIRECT USAGE / SYNONYM / etc",
                  "question": "...",
                  "options": ["A. ...", "B. ...", "C. ...", "D. ..."],
                  "answer": "B",
                  "explanation": "🗣️ Pronunciation: [Romanization]\\n📝 Translation: [Translation]\\n💡 Analysis: [Why correct answer fits]"
              }
          ]
      }
    `;
  }

  public async generateQuiz(words: string[], inputLanguage: string, outputLanguage: string, numQuestions: number, mode: string = "hard"): Promise<any> {
    const prompt = this.createQuizPrompt(words, inputLanguage, outputLanguage, numQuestions, mode);
    let responseText = "";
    try {
      responseText = await callChatbot(prompt, this.modelName, this.modelType, this.apiKey);
      const cleanResponse = this.cleanJsonResponse(responseText);
      return JSON.parse(cleanResponse);
    } catch (error: any) {
      return { error: error.message, raw_response: responseText };
    }
  }

  /**
   * Tokenize một câu thành mảng token có nghĩa.
   * Kết quả được cache trong ExampleItem.tokens để tránh gọi API lại.
   */
  public async tokenizeSentence(sentence: string, language: string): Promise<string[]> {
    const prompt = `
      You are an expert linguist. Split the following ${language} sentence into an array of meaningful tokens (words, compound words, or punctuation).
      Sentence: "${sentence}"
      CRITICAL RULES:
      1. Return ONLY a valid JSON array of strings. Do NOT wrap in markdown or code blocks.
      2. Every character in the original sentence must appear in exactly one token (perfect reconstruction required).
      3. For Chinese/Japanese: split by word/morpheme boundary, NOT by single character.
      4. For space-separated languages: split on whitespace, keeping punctuation attached to the preceding word OR as its own token if standalone.
      Example for Chinese "我喜欢学习中文": ["我", "喜欢", "学习", "中文"]
      Example for English "I love learning.": ["I", " ", "love", " ", "learning."]
    `;
    try {
      const responseText = await callChatbot(prompt, this.modelName, this.modelType, this.apiKey);
      const cleanResponse = this.cleanJsonResponse(responseText);
      const tokens = JSON.parse(cleanResponse);
      return Array.isArray(tokens) ? tokens : [sentence];
    } catch (error) {
      console.warn("Tokenization API Error:", error);
      // Fallback: tách từng ký tự cho CJK, tách whitespace cho ngôn ngữ Latin
      const cjkLanguages = ["Chinese", "Japanese"];
      if (cjkLanguages.includes(language)) {
        // Tách từng ký tự cho CJK — tốt hơn split whitespace
        return sentence.split("");
      }
      return sentence.split(/(\s+)/);
    }
  }

  /**
   * Batch tokenize tất cả sentences trong learning data một lần.
   * Gọi sau khi learnWord() trả về data để preprocess tất cả examples cùng lúc.
   * 
   * @param learningData - Data trả về từ learnWord()
   * @param language - Ngôn ngữ input
   * @returns Learning data với tokens được thêm vào mỗi example
   */
  public async preprocessExampleTokens(learningData: any, language: string): Promise<any> {
    if (!learningData || !learningData.examples) return learningData;

    const difficultiesMap: Record<string, any> = (["easy", "medium", "hard", "super_hard"] as const).reduce((acc, diff) => {
      if (learningData.examples[diff]) {
        acc[diff] = learningData.examples[diff];
      }
      return acc;
    }, {} as Record<string, any>);

    // Lặp qua tất cả độ khó và tokenize toàn bộ examples
    for (const [difficulty, examples] of Object.entries(difficultiesMap)) {
      if (Array.isArray(examples)) {
        for (const example of examples) {
          if (example.sentence) {
            // Tokenize từng câu nhưng batch gọi (không await liên tục)
            example.tokens = await this.tokenizeSentence(example.sentence, language);
          }
        }
      }
    }

    return learningData;
  }

  public async translateText(text: string, inputLanguage: string, outputLanguage: string): Promise<string> {
    const prompt = `
      You are an expert lexicographer translating ${inputLanguage} to ${outputLanguage}.
      TASK: Translate "${text}".
      RULES:
      - Concise and precise. Group by part of speech if multiple.
      - If ${inputLanguage} is Chinese: MUST include Pinyin.
      - If ${inputLanguage} is Japanese: MUST include Romaji.
      OUTPUT FORMAT (plain text only, no markdown):
      <source word> (<romanization if applicable>):
      [Noun / Verb...]
      - <meaning 1>
      - <meaning 2>
    `;
    try {
      const responseText = await callChatbot(prompt, this.modelName, this.modelType, this.apiKey);
      // Xử lý dọn dẹp markdown nếu AI sinh ra
      let cleanResponse = responseText.trim();
      if (cleanResponse.startsWith("```")) {
        const lines = cleanResponse.split('\n');
        if (lines.length > 2) {
          cleanResponse = lines.slice(1, -1).join('\n').trim();
        }
      }
      return cleanResponse;
    } catch (error: any) {
      return `[Lỗi dịch thuật: ${error.message}]`;
    }
  }

  // Hàm tiện ích nội bộ để dọn dẹp chuỗi JSON thô từ AI
  private cleanJsonResponse(response: string): string {
    let clean = response.trim();
    if (clean.startsWith("```json")) {
      clean = clean.slice(7, -3).trim();
    } else if (clean.startsWith("```")) {
      clean = clean.slice(3, -3).trim();
    }
    return clean;
  }
}