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

const LANGUAGE_TO_TTS_CODE: Record<string, string> = {
  Chinese:    "zh-CN",
  English:    "en-US",
  Japanese:   "ja-JP",
  Vietnamese: "vi-VN",
  Korean:     "ko-KR",
};

const LANGUAGE_TO_VOICE_NAME: Record<string, string> = {
  Chinese:    "zh-CN-Wavenet-A",
  English:    "en-US-Wavenet-D",
  Japanese:   "ja-JP-Wavenet-A",
  Vietnamese: "vi-VN-Wavenet-A",
  Korean:     "ko-KR-Wavenet-A",
};

// ─────────────────────────────────────────────
// QUIZ BATCH CONSTANTS
// ─────────────────────────────────────────────
const QUIZ_BATCH_SIZE = 10;
const QUIZ_MAX_QUESTIONS = 30; // hardcode ceiling; change to Infinity to remove cap

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
      voice: { languageCode, name: voiceName, ssmlGender: "NEUTRAL" },
      audioConfig: { audioEncoding: "MP3", speakingRate: 0.9, pitch: 0 },
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
    if (!data.audioContent) throw new Error("Google TTS trả về không có audioContent.");
    return data.audioContent as string;
  }

  // ─────────────────────────────────────────────
  // LEARN WORD
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

    STEP 3 — DISTRIBUTE EXAMPLES:
    Generate EXACTLY 12 examples:
    - "easy"   : exactly 4
    - "medium" : exactly 4
    - "hard"   : exactly 4
    NOTE: Do NOT use "super_hard" in easy mode.
    ` : `
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    MODE: HARD (Advanced Learner)
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    STEP 1 — ASSESS THE WORD:
    Evaluate the word's proficiency level:
    - Chinese → HSK 1–6+  |  Japanese → JLPT N5–N1
    - Korean → TOPIK 1–6  |  English/Other → CEFR A1–C2

    STEP 2 — DERIVE LEVEL ANCHORS:
    - "easy"       → at or below word's level
    - "medium"     → 1–2 levels above
    - "hard"       → 3 levels above or near-native register
    - "super_hard" → NO cap — native/literary/academic level

    STEP 3 — DISTRIBUTE EXAMPLES (EXACTLY 12):
    - "easy"       : exactly 1
    - "medium"     : exactly 2
    - "hard"       : exactly 6
    - "super_hard" : exactly 3
    `;

    const examplesJsonStructure = mode === "easy" ? `
        "examples": {
            "easy":   [ <4 items>, ... ],
            "medium": [ <4 items>, ... ],
            "hard":   [ <4 items>, ... ]
        }
    ` : `
        "examples": {
            "easy":       [ <1 item> ],
            "medium":     [ <2 items>, ... ],
            "hard":       [ <6 items>, ... ],
            "super_hard": [ <3 items>, ... ]
        }
    `;

    const exampleItem = `{ "sentence": "...", "level": "...", "romanization": "...", "translation": "...", "explanation": "...", "grammar_points": ["..."], "difficulty_justification": "..." }`;

    return `
      You are a professional language tutor. Output MUST be valid JSON only — no markdown, no code blocks, no extra text.

      TASK: Generate a comprehensive learning output for: "${word}"

      LANGUAGE SETTINGS:
      - Input_language: "${inputLanguage}" (language of the word)
      - Output_language: "${outputLanguage}" (language for ALL explanations, meanings, translations)

      STRICT RULES:
      - ALL explanatory text MUST be in Output_language only. No mixing.
      - Romanization: provide string if Input_language is non-Latin; null otherwise.
      - No repeated grammatical structures across examples.

      ${modeConfig}

      OUTPUT JSON:
      {
          "word": "${word}",
          "language": { "input": "${inputLanguage}", "output": "${outputLanguage}" },
          "overview": {
              "meaning": "...",
              "romanization": "<string|null>",
              "part_of_speech": "...",
              "register": "...",
              "usage": "...",
              "notes": "...",
              "collocations": ["<5 items in ${inputLanguage}>"]
          },
          ${examplesJsonStructure.replace(/<[^>]+>/g, exampleItem)}
      }
    `;
  }

  public async learnWord(word: string, inputLanguage: string, outputLanguage: string, mode: string = "hard"): Promise<any> {
    const prompt = this.createLearningPrompt(word, inputLanguage, outputLanguage, mode);
    let responseText = "";
    try {
      responseText = await callChatbot(prompt, this.modelName, this.modelType, this.apiKey);
      return JSON.parse(this.cleanJsonResponse(responseText));
    } catch (error: any) {
      return { error: error.message, raw_response: responseText };
    }
  }

  // ─────────────────────────────────────────────
  // QUIZ — BATCH GENERATION
  // ─────────────────────────────────────────────

  /**
   * Build a single-batch quiz prompt.
   *
   * @param words            - Word list to draw questions from
   * @param inputLanguage    - Language of the words / question sentences
   * @param outputLanguage   - Language for answer options & answer key labels
   * @param batchSize        - How many questions to generate in THIS call
   * @param totalTarget      - Total questions the user wants (context only, for distribution guidance)
   * @param mode             - "easy" | "hard"
   * @param previousQuestions - Already-generated questions to avoid duplication
   */
  private createQuizBatchPrompt(
    words: string[],
    inputLanguage: string,
    outputLanguage: string,
    batchSize: number,
    totalTarget: number,
    mode: string,
    previousQuestions: any[]
  ): string {
    const wordsStr = words.join(", ");
    const batchLabel = previousQuestions.length === 0
      ? `first batch`
      : `batch ${Math.floor(previousQuestions.length / QUIZ_BATCH_SIZE) + 1} (questions ${previousQuestions.length + 1}–${previousQuestions.length + batchSize} of ${totalTarget})`;

    const difficultyGuide = mode === "easy"
      ? `Distribute the ${batchSize} questions as: ~40% EASY, ~40% MEDIUM, ~20% HARD. NO super_hard/very_hard.`
      : `Distribute the ${batchSize} questions as: ~20% MEDIUM, ~50% HARD, ~30% VERY_HARD.`;

    const avoidBlock = previousQuestions.length > 0
      ? `\nALREADY GENERATED QUESTIONS (DO NOT REPEAT or reuse similar phrasing/structure):\n${JSON.stringify(
          previousQuestions.map((q, i) => ({
            n: i + 1,
            word: q.word_tested,
            dimension: q.dimension,
            q: q.question,
          })),
          null, 2
        )}\n`
      : "";

    return `You are an expert language examiner.

TASK: Generate EXACTLY ${batchSize} multiple-choice questions — ${batchLabel}.
Words to test: [${wordsStr}]
Question language: ${inputLanguage} | Answer/option language: ${outputLanguage}
Mode: ${mode.toUpperCase()}

${difficultyGuide}

QUESTION DIMENSIONS (vary — never repeat same dimension consecutively):
DIRECT_USAGE | SYNONYM_ANTONYM | COLLOCATION | CONTEXTUAL_MEANING | GRAMMAR_ROLE | ERROR_DETECTION | REGISTER_MATCH | NUANCE

QUALITY RULES:
- Spread questions across all words as evenly as possible.
- All 4 options must be plausible distractors.
- Correct answer position (A/B/C/D) must be evenly distributed across the batch.
- Natural, exam-quality phrasing — not textbook-artificial.
${avoidBlock}
OUTPUT: valid JSON only — no markdown, no extra text, start with { end with }.

{
  "quiz": [
    {
      "word_tested": "...",
      "difficulty": "${mode === "easy" ? "easy|medium|hard" : "medium|hard|very_hard"}",
      "level": "<e.g. HSK 3 | JLPT N2 | CEFR B1>",
      "dimension": "<from dimension list>",
      "question": "...",
      "options": ["A. ...", "B. ...", "C. ...", "D. ..."],
      "answer": "<A|B|C|D>"
    }
  ]
}`;
  }

  /**
   * Generate explanation for a completed quiz in one batch call.
   * Called AFTER all questions have been generated and user has submitted.
   */
  private createExplanationPrompt(
    questions: any[],
    inputLanguage: string,
    outputLanguage: string
  ): string {
    return `You are a language tutor. For each quiz question below, write a short explanation.

Language of questions: ${inputLanguage}
Explanation language: ${outputLanguage}

Questions (JSON array):
${JSON.stringify(questions.map((q, i) => ({
  n: i + 1,
  question: q.question,
  options: q.options,
  answer: q.answer,
  word_tested: q.word_tested,
})), null, 2)}

OUTPUT: valid JSON only — array of exactly ${questions.length} objects, same order.
[
  {
    "n": 1,
    "explanation": "🗣️ Pronunciation: ...\\n📝 Translation: ...\\n💡 Analysis: ...\\n📊 Level: ..."
  },
  ...
]`;
  }

  /**
   * Main quiz generation entry point.
   * Generates questions in sequential batches of QUIZ_BATCH_SIZE.
   * Explanations are fetched separately (lazy, after submit) via generateQuizExplanations().
   */
  public async generateQuiz(
    words: string[],
    inputLanguage: string,
    outputLanguage: string,
    numQuestions: number,
    mode: string = "hard"
  ): Promise<any> {
    // Enforce ceiling
    const target = Math.min(numQuestions, QUIZ_MAX_QUESTIONS);

    const allQuestions: any[] = [];
    let remaining = target;

    while (remaining > 0) {
      const batchSize = Math.min(remaining, QUIZ_BATCH_SIZE);
      const prompt = this.createQuizBatchPrompt(
        words,
        inputLanguage,
        outputLanguage,
        batchSize,
        target,
        mode,
        allQuestions
      );

      let responseText = "";
      try {
        responseText = await callChatbot(prompt, this.modelName, this.modelType, this.apiKey);
        const parsed = JSON.parse(this.cleanJsonResponse(responseText));
        const batch: any[] = parsed?.quiz ?? [];

        if (!Array.isArray(batch) || batch.length === 0) {
          return { error: "Empty batch returned by API.", raw_response: responseText };
        }

        allQuestions.push(...batch);
        remaining -= batch.length;

        // Safety: if API returned fewer than expected and we can't progress, stop
        if (batch.length < batchSize && remaining > 0) {
          console.warn(`[generateQuiz] Batch returned ${batch.length}/${batchSize}. Stopping early.`);
          break;
        }
      } catch (error: any) {
        return { error: error.message, raw_response: responseText };
      }
    }

    return {
      words,
      mode,
      quiz: allQuestions,
    };
  }

  /**
   * Fetch explanations for a list of questions after the quiz is submitted.
   * Returns the same questions array with `explanation` fields populated.
   */
  public async generateQuizExplanations(
    questions: any[],
    inputLanguage: string,
    outputLanguage: string
  ): Promise<any[]> {
    if (questions.length === 0) return questions;

    // Fetch explanations in batches too, to stay within token limits
    const EXPLAIN_BATCH = 10;
    const result = [...questions];

    for (let start = 0; start < questions.length; start += EXPLAIN_BATCH) {
      const chunk = questions.slice(start, start + EXPLAIN_BATCH);
      const prompt = this.createExplanationPrompt(chunk, inputLanguage, outputLanguage);

      try {
        const responseText = await callChatbot(prompt, this.modelName, this.modelType, this.apiKey);
        const parsed: any[] = JSON.parse(this.cleanJsonResponse(responseText));
        for (const item of parsed) {
          const idx = (item.n - 1); // 1-based → 0-based absolute index
          if (result[idx]) result[idx] = { ...result[idx], explanation: item.explanation };
        }
      } catch (e) {
        console.warn("[generateQuizExplanations] batch failed:", e);
        // Non-fatal: continue without explanations for this chunk
      }
    }

    return result;
  }

  // ─────────────────────────────────────────────
  // TOKENIZE
  // ─────────────────────────────────────────────
  public async tokenizeSentence(sentence: string, language: string): Promise<string[]> {
    const prompt = `
      You are an expert linguist. Split the following ${language} sentence into an array of meaningful tokens.
      Sentence: "${sentence}"
      CRITICAL RULES:
      1. Return ONLY a valid JSON array of strings. No markdown, no code blocks.
      2. Every character must appear in exactly one token (perfect reconstruction).
      3. Chinese/Japanese: split by word/morpheme, NOT single character.
      4. Space-separated languages: split on whitespace; punctuation attached to preceding word OR standalone.
      Example Chinese: ["我", "喜欢", "学习", "中文"]
      Example English: ["I", " ", "love", " ", "learning."]
    `;
    try {
      const responseText = await callChatbot(prompt, this.modelName, this.modelType, this.apiKey);
      const tokens = JSON.parse(this.cleanJsonResponse(responseText));
      return Array.isArray(tokens) ? tokens : [sentence];
    } catch {
      const cjkLanguages = ["Chinese", "Japanese"];
      return cjkLanguages.includes(language) ? sentence.split("") : sentence.split(/(\s+)/);
    }
  }

  public async preprocessExampleTokens(learningData: any, language: string): Promise<any> {
    if (!learningData?.examples) return learningData;
    for (const diff of ["easy", "medium", "hard", "super_hard"] as const) {
      const bucket = learningData.examples[diff];
      if (Array.isArray(bucket)) {
        for (const example of bucket) {
          if (example.sentence) {
            example.tokens = await this.tokenizeSentence(example.sentence, language);
          }
        }
      }
    }
    return learningData;
  }

  // ─────────────────────────────────────────────
  // TRANSLATE
  // ─────────────────────────────────────────────
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
      let clean = (await callChatbot(prompt, this.modelName, this.modelType, this.apiKey)).trim();
      if (clean.startsWith("```")) {
        const lines = clean.split("\n");
        if (lines.length > 2) clean = lines.slice(1, -1).join("\n").trim();
      }
      return clean;
    } catch (error: any) {
      return `[Lỗi dịch thuật: ${error.message}]`;
    }
  }

  // ─────────────────────────────────────────────
    // EXPLAIN SINGLE QUIZ QUESTION
    // ─────────────────────────────────────────────
  public async explainQuizQuestion(
      question: string,
      options: string[],
      correctAnswer: string,
      wordTested: string,
      inputLanguage: string,
      outputLanguage: string
    ): Promise<string> {
      const correctOption = options.find(o => o.startsWith(correctAnswer)) ?? correctAnswer;
      const prompt = `You are an expert language tutor explaining a vocabulary quiz question.

  Question language: ${inputLanguage}
  Explanation language: ${outputLanguage}
  Word being tested: "${wordTested}"

  QUESTION:
  ${question}

  OPTIONS:
  ${options.join("\n")}

  CORRECT ANSWER: ${correctOption}

  Write a clear, concise explanation covering:
  🗣️ Pronunciation/Romanization (if ${inputLanguage} is non-Latin)
  📝 Why "${correctOption}" is correct
  ❌ Why the other options are wrong (briefly)
  💡 Key grammar or usage insight about "${wordTested}"
  📊 Difficulty note if relevant

  Use ${outputLanguage} for ALL explanations. Be direct and educational. Plain text only, no markdown.`;

      try {
        const responseText = await callChatbot(prompt, this.modelName, this.modelType, this.apiKey);
        return responseText.trim();
      } catch (error: any) {
        throw new Error(`Explanation failed: ${error.message}`);
      }
    }

    // ─────────────────────────────────────────────
    // INTERNAL UTILS
    // ─────────────────────────────────────────────
  private cleanJsonResponse(response: string): string {
    let clean = response.trim();
    if (clean.startsWith("```json")) clean = clean.slice(7).trim();
    else if (clean.startsWith("```")) clean = clean.slice(3).trim();
    if (clean.endsWith("```")) clean = clean.slice(0, -3).trim();
    return clean;
  }
}