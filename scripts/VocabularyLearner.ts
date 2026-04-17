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
    
      const modeConfig = mode === "easy" ? `
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    MODE: EASY (Beginner–Intermediate Learner)
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    STEP 1 — ASSESS THE WORD:
    Before generating examples, internally evaluate the word's proficiency level using the appropriate scale for ${inputLanguage}:
    - Chinese → HSK 1–6+ scale
    - Japanese → JLPT N5–N1 scale  
    - Korean → TOPIK I (1–2) / TOPIK II (3–6) scale
    - English → CEFR A1–C2 scale
    - Other → CEFR A1–C2 scale

    STEP 2 — DERIVE THE EXAMPLE CEILING:
    Based on the word's assessed level, the HARDEST example may NOT exceed 2 levels above the word's own level.
    Examples:
    - Word is HSK 1 → Hard cap = HSK 3
    - Word is HSK 2 → Hard cap = HSK 4
    - Word is HSK 3 → Hard cap = HSK 5
    - Word is JLPT N5 → Hard cap = N3
    - Word is JLPT N4 → Hard cap = N2
    - Word is CEFR A1 → Hard cap = B1
    - Word is CEFR A2 → Hard cap = B2

    STEP 3 — DISTRIBUTE EXAMPLES:
    Generate EXACTLY 12 examples with this distribution:
    - "easy"   : exactly 4 — at or BELOW the word's own level (reinforce recognition)
    - "medium" : exactly 4 — 1 level above the word's level (build confidence)
    - "hard"   : exactly 4 — at the derived ceiling (challenge without overwhelming)
    NOTE: Do NOT use "super_hard" level in easy mode.

    ` : `
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    MODE: HARD (Advanced Learner)
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    STEP 1 — ASSESS THE WORD:
    Before generating examples, internally evaluate the word's proficiency level using the appropriate scale for ${inputLanguage}:
    - Chinese → HSK 1–6+ scale
    - Japanese → JLPT N5–N1 scale  
    - Korean → TOPIK I (1–2) / TOPIK II (3–6) scale
    - English → CEFR A1–C2 scale
    - Other → CEFR A1–C2 scale

    STEP 2 — DERIVE LEVEL ANCHORS:
    Based on the word's assessed level, assign anchors:
    - "easy"       → at or below the word's level (contextual recall)
    - "medium"     → 1–2 levels above (confident production)
    - "hard"       → 3 levels above OR near-native register (collocations, idioms, formal writing)
    - "super_hard" → NO upper cap — native/literary/academic/high-stakes exam level; maximum complexity

    STEP 3 — DISTRIBUTE EXAMPLES:
    Generate EXACTLY 12 examples with this distribution:
    - "easy"       : exactly 1
    - "medium"     : exactly 2
    - "hard"       : exactly 6
    - "super_hard" : exactly 3

    `;

      const examplesJsonStructure = mode === "easy" ? `
        "word_level_assessment": {
            "scale": "<HSK / JLPT / TOPIK / CEFR>",
            "word_level": "<e.g. HSK 2>",
            "hard_ceiling": "<e.g. HSK 4>"
        },
        "examples": {
            "easy": [
                { "sentence": "...", "level": "...", "romanization": "...", "translation": "...", "explanation": "...", "grammar_points": ["...", "..."], "difficulty_justification": "..." },
                { "sentence": "...", "level": "...", "romanization": "...", "translation": "...", "explanation": "...", "grammar_points": ["...", "..."], "difficulty_justification": "..." },
                { "sentence": "...", "level": "...", "romanization": "...", "translation": "...", "explanation": "...", "grammar_points": ["...", "..."], "difficulty_justification": "..." },
                { "sentence": "...", "level": "...", "romanization": "...", "translation": "...", "explanation": "...", "grammar_points": ["...", "..."], "difficulty_justification": "..." }
            ],
            "medium": [
                { "sentence": "...", "level": "...", "romanization": "...", "translation": "...", "explanation": "...", "grammar_points": ["...", "..."], "difficulty_justification": "..." },
                { "sentence": "...", "level": "...", "romanization": "...", "translation": "...", "explanation": "...", "grammar_points": ["...", "..."], "difficulty_justification": "..." },
                { "sentence": "...", "level": "...", "romanization": "...", "translation": "...", "explanation": "...", "grammar_points": ["...", "..."], "difficulty_justification": "..." },
                { "sentence": "...", "level": "...", "romanization": "...", "translation": "...", "explanation": "...", "grammar_points": ["...", "..."], "difficulty_justification": "..." }
            ],
            "hard": [
                { "sentence": "...", "level": "...", "romanization": "...", "translation": "...", "explanation": "...", "grammar_points": ["...", "..."], "difficulty_justification": "..." },
                { "sentence": "...", "level": "...", "romanization": "...", "translation": "...", "explanation": "...", "grammar_points": ["...", "..."], "difficulty_justification": "..." },
                { "sentence": "...", "level": "...", "romanization": "...", "translation": "...", "explanation": "...", "grammar_points": ["...", "..."], "difficulty_justification": "..." },
                { "sentence": "...", "level": "...", "romanization": "...", "translation": "...", "explanation": "...", "grammar_points": ["...", "..."], "difficulty_justification": "..." }
            ]
        }
      ` : `
        "word_level_assessment": {
            "scale": "<HSK / JLPT / TOPIK / CEFR>",
            "word_level": "<e.g. HSK 3>",
            "hard_anchor": "<e.g. HSK 6>",
            "super_hard_note": "No ceiling — native/literary/academic level"
        },
        "examples": {
            "easy": [
                { "sentence": "...", "level": "...", "romanization": "...", "translation": "...", "explanation": "...", "grammar_points": ["...", "..."], "difficulty_justification": "..." }
            ],
            "medium": [
                { "sentence": "...", "level": "...", "romanization": "...", "translation": "...", "explanation": "...", "grammar_points": ["...", "..."], "difficulty_justification": "..." },
                { "sentence": "...", "level": "...", "romanization": "...", "translation": "...", "explanation": "...", "grammar_points": ["...", "..."], "difficulty_justification": "..." }
            ],
            "hard": [
                { "sentence": "...", "level": "...", "romanization": "...", "translation": "...", "explanation": "...", "grammar_points": ["...", "..."], "difficulty_justification": "..." },
                { "sentence": "...", "level": "...", "romanization": "...", "translation": "...", "explanation": "...", "grammar_points": ["...", "..."], "difficulty_justification": "..." },
                { "sentence": "...", "level": "...", "romanization": "...", "translation": "...", "explanation": "...", "grammar_points": ["...", "..."], "difficulty_justification": "..." },
                { "sentence": "...", "level": "...", "romanization": "...", "translation": "...", "explanation": "...", "grammar_points": ["...", "..."], "difficulty_justification": "..." },
                { "sentence": "...", "level": "...", "romanization": "...", "translation": "...", "explanation": "...", "grammar_points": ["...", "..."], "difficulty_justification": "..." },
                { "sentence": "...", "level": "...", "romanization": "...", "translation": "...", "explanation": "...", "grammar_points": ["...", "..."], "difficulty_justification": "..." }
            ],
            "super_hard": [
                { "sentence": "...", "level": "...", "romanization": "...", "translation": "...", "explanation": "...", "grammar_points": ["...", "..."], "difficulty_justification": "..." },
                { "sentence": "...", "level": "...", "romanization": "...", "translation": "...", "explanation": "...", "grammar_points": ["...", "..."], "difficulty_justification": "..." },
                { "sentence": "...", "level": "...", "romanization": "...", "translation": "...", "explanation": "...", "grammar_points": ["...", "..."], "difficulty_justification": "..." }
            ]
        }
      `;

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

        ${modeConfig}

        ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        PROFICIENCY SCALE REFERENCE
        ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        [EASY]       : A1–A2 / HSK 1–2 / JLPT N5–N4 / TOPIK 1–2. Survival language, highest-frequency words.
        [MEDIUM]     : B1    / HSK 3–4 / JLPT N3    / TOPIK 3–4. Everyday fluent conversation.
        [HARD]       : B2–C1 / HSK 5   / JLPT N2    / TOPIK 5.   Exam readiness, collocations, formal register.
        [SUPER_HARD] : C2    / HSK 6+  / JLPT N1    / TOPIK 6.   Native/literary/academic mastery. No ceiling.

        ANTI-PATTERNS (STRICTLY FORBIDDEN):
        - Do NOT repeat the same grammatical structure across any two examples.
        - Do NOT produce sentences that sound artificial or textbook-like.
        - Each example's "level" field must explicitly state the proficiency level (e.g. "HSK 3", "JLPT N2", "CEFR B1").

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

  private createQuizPrompt(
    words: string[],
    inputLanguage: string,
    outputLanguage: string,
    numQuestions: number,
    mode: string = "hard"
  ): string {
    const wordsStr = words.join(", ");

    const modeConfig = mode === "easy" ? `
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  MODE: EASY (Beginner–Intermediate Learner)
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  STEP 1 — ASSESS EACH WORD:
  Internally evaluate every word's proficiency level using the appropriate scale:
  - Chinese  → HSK 1–6+
  - Japanese → JLPT N5–N1
  - Korean   → TOPIK 1–6
  - English / Other → CEFR A1–C2

  STEP 2 — DERIVE QUESTION CEILING PER WORD:
  The hardest question about a word may NOT test knowledge more than 2 levels above that word's assessed level.
  Examples:
  - Word is HSK 1  → Question ceiling = HSK 3
  - Word is HSK 2  → Question ceiling = HSK 4
  - Word is JLPT N5 → Question ceiling = N3
  - Word is CEFR A1 → Question ceiling = B1
  - Word is CEFR A2 → Question ceiling = B2

  STEP 3 — DISTRIBUTE QUESTIONS:
  Distribute ALL ${numQuestions} questions across difficulty tiers:
  - EASY   : ~40% (${Math.round(numQuestions * 0.4)} questions) — Direct recognition, meaning matching, basic fill-in-the-blank
  - MEDIUM : ~40% (${Math.round(numQuestions * 0.4)} questions) — Simple contextual usage, synonym selection
  - HARD   : ~20% (${Math.round(numQuestions * 0.2)} questions) — Nuanced usage up to the ceiling; NO super-hard questions

  Round to nearest integer to reach exactly ${numQuestions} total.
  DO NOT include VERY_HARD or SUPER_HARD questions in easy mode.

  ` : `
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  MODE: HARD (Advanced Learner)
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  STEP 1 — ASSESS EACH WORD:
  Internally evaluate every word's proficiency level using the appropriate scale:
  - Chinese  → HSK 1–6+
  - Japanese → JLPT N5–N1
  - Korean   → TOPIK 1–6
  - English / Other → CEFR A1–C2

  STEP 2 — DERIVE ANCHORS PER WORD:
  - MEDIUM questions    → test 1–2 levels above the word's level
  - HARD questions      → test 3 levels above OR formal/idiomatic register
  - VERY_HARD questions → NO upper cap; test native collocations, literary register, high-stakes exam patterns

  STEP 3 — DISTRIBUTE QUESTIONS:
  Distribute ALL ${numQuestions} questions across difficulty tiers:
  - MEDIUM    : ~20% (${Math.round(numQuestions * 0.2)} questions)
  - HARD      : ~50% (${Math.round(numQuestions * 0.5)} questions)
  - VERY_HARD : ~30% (${Math.round(numQuestions * 0.3)} questions) — No ceiling; native/academic/literary level

  Round to nearest integer to reach exactly ${numQuestions} total.
  `;

    const dimensionExamples = `
  QUESTION DIMENSION GUIDE (vary across all questions):
  - DIRECT_USAGE       : Choose the correct word to complete a sentence
  - SYNONYM_ANTONYM    : Identify closest meaning or opposite
  - COLLOCATION        : Which word naturally pairs with the target
  - CONTEXTUAL_MEANING : What does the word mean in THIS specific context
  - GRAMMAR_ROLE       : Identify the grammatical function/pattern used
  - ERROR_DETECTION    : Spot the incorrect usage among options
  - REGISTER_MATCH     : Select the most appropriate register (formal/informal)
  - NUANCE             : Distinguish subtle meaning differences between near-synonyms
  `;

    return `
  You are an expert language examiner and curriculum designer.

  TASK: Generate a multiple-choice quiz of EXACTLY ${numQuestions} questions for these words: [${wordsStr}]

  LANGUAGE SETTINGS:
  - Target Exam Language (sentences/questions): "${inputLanguage}"
  - Explanation Language (explanations/analysis): "${outputLanguage}"

  ${modeConfig}

  ${dimensionExamples}

  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  QUESTION QUALITY RULES
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  - Distribute questions across ALL provided words as evenly as possible.
  - Every question must test a DIFFERENT dimension — never repeat the same dimension consecutively.
  - All 4 answer options must be plausible; avoid obviously wrong distractors.
  - Correct answer position (A/B/C/D) must be distributed — do NOT cluster correct answers.
  - Questions must feel natural and exam-quality, not textbook-artificial.
  - Each question's "level" field must state the explicit proficiency level (e.g. "HSK 3", "JLPT N2", "CEFR B2").

  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  OUTPUT FORMAT
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Valid JSON ONLY. No markdown. No extra text. Start with { end with }.

  {
      "words": ${JSON.stringify(words)},
      "mode": "${mode}",
      "word_assessments": [
          { "word": "...", "scale": "HSK / JLPT / CEFR", "level": "...", "ceiling": "..." }
      ],
      "difficulty_distribution": {
          ${mode === "easy"
            ? `"easy": <count>, "medium": <count>, "hard": <count>`
            : `"medium": <count>, "hard": <count>, "very_hard": <count>`
          },
          "total": ${numQuestions}
      },
      "quiz": [
          {
              "word_tested": "...",
              "difficulty": "${mode === "easy" ? "easy | medium | hard" : "medium | hard | very_hard"}",
              "level": "<explicit proficiency level, e.g. HSK 3>",
              "dimension": "<from QUESTION DIMENSION GUIDE>",
              "question": "...",
              "options": ["A. ...", "B. ...", "C. ...", "D. ..."],
              "answer": "<A | B | C | D>",
              "explanation": "🗣️ Pronunciation: [Romanization if applicable, else omit line]\\n📝 Translation: [Translation of key word/phrase]\\n💡 Analysis: [Why correct answer fits, why others are wrong]\\n📊 Level: [Proficiency level of this question]"
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