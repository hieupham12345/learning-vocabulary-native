// VocabularyLearner.ts
import { callChatbot } from "./chatbotService";
import { getSettings } from "./settings-store";

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
const QUIZ_BATCH_SIZE    = 10;
const QUIZ_MAX_QUESTIONS = 30;

const PROFICIENCY_SCALE: Record<string, string> = {
  Chinese:  "HSK 1–6+ scale",
  Japanese: "JLPT N5–N1 scale",
  Korean:   "TOPIK I (1–2) / TOPIK II (3–6) scale",
  English:  "CEFR A1–C2 scale",
};

export class VocabularyLearner {
  private get apiKey()    { return getSettings().api_key; }
  private get modelType() { return getSettings().agent;   }
  private get modelName() { return getSettings().model;   }

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
    if (!data.audioContent) throw new Error("Google TTS returned no audioContent.");
    return data.audioContent as string;
  }

  // ─────────────────────────────────────────────
  // LEARN WORD — settings-driven example counts
  // ─────────────────────────────────────────────
  private createLearningPrompt(
    word: string,
    inputLanguage: string,
    outputLanguage: string
  ): string {
    const s = getSettings();
    const easyCount      = s.easy_examples;
    const mediumCount    = s.medium_examples;
    const hardCount      = s.hard_examples;
    const superHardCount = s.super_hard_examples;
    const total          = easyCount + mediumCount + hardCount + superHardCount;

    return `You are a professional ${inputLanguage} tutor preparing a learner for official proficiency exams. Output MUST be valid JSON only — no markdown, no code blocks, no extra text.

TASK: Generate a comprehensive learning output for: "${word}"

LANGUAGE SETTINGS:
- Input_language: "${inputLanguage}" (language of the word and ALL example sentences)
- Output_language: "${outputLanguage}" (language for ALL explanations, meanings, translations)

STRICT RULES:
- ALL explanatory text (meaning, usage, notes, translation, explanation, difficulty_justification) MUST be in Output_language only. No mixing.
- Every example "sentence" MUST contain "${word}" (or a natural inflected/conjugated form of it).
- Romanization: Chinese → Hanyu Pinyin with tone marks; Japanese → romaji; Korean → Revised Romanization; Latin-script languages → null (JSON null, not the string "null").
- No repeated grammatical structures across examples — vary tense, clause type, and register.
- ACCURACY: never invent meanings. If "${word}" is misspelled or not a standard word, describe the closest standard form and say so in "notes".
- Valid JSON: escape line breaks inside strings as \\n and inner double quotes as \\". No trailing commas.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EXAMPLE DISTRIBUTION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
First determine the word's own proficiency level on the scale below, then generate EXACTLY ${total} examples distributed as follows:
- "easy"       : exactly ${easyCount}
- "medium"     : exactly ${mediumCount}
- "hard"       : exactly ${hardCount}
- "super_hard" : exactly ${superHardCount}

LEVEL GUIDANCE per bucket:
- easy       → at or below the word's own proficiency level; short everyday sentence
- medium     → 1–2 levels above the word's own level; realistic daily / workplace context
- hard       → 3 levels above or near-native register — the kind of sentence found in exam reading sections (HSK 5–6 / JLPT N2–N1 / TOPIK II / IELTS–TOEIC reading)
- super_hard → NO cap — native / literary / academic / news register

Use the appropriate scale for ${inputLanguage}:
- Chinese → HSK 1–6+  |  Japanese → JLPT N5–N1
- Korean → TOPIK 1–6  |  English/Other → CEFR A1–C2

EXAMPLE QUALITY:
- Adult, real-world contexts (work, news, travel, opinions, study) — never childish or textbook-artificial sentences.
- Build sentences around natural, high-frequency collocations of the word.
- The "level" field of each example MUST be a concrete scale value (e.g. "HSK 4", "JLPT N2", "CEFR B2").

OUTPUT JSON:
{
    "word": "${word}",
    "language": { "input": "${inputLanguage}", "output": "${outputLanguage}" },
    "overview": {
        "meaning": "...",
        "romanization": "<string|null>",
        "part_of_speech": "...",
        "register": "<formal/neutral/informal + typical contexts>",
        "usage": "...",
        "notes": "...",
        "collocations": ["<5 high-frequency collocations in ${inputLanguage}, each containing the word>"]
    },
    "examples": {
        "easy":       [ <${easyCount} items> ],
        "medium":     [ <${mediumCount} items> ],
        "hard":       [ <${hardCount} items> ],
        "super_hard": [ <${superHardCount} items> ]
    }
}

Each example item:
{ "sentence": "...", "level": "...", "romanization": "<string|null>", "translation": "...", "explanation": "...", "grammar_points": ["..."], "difficulty_justification": "..." }`;
  }

  public async learnWord(
    word: string,
    inputLanguage: string,
    outputLanguage: string
  ): Promise<any> {
    const prompt = this.createLearningPrompt(word, inputLanguage, outputLanguage);
    let responseText = "";
    try {
      // 1 từ vựng mới = 1 phiên chat riêng
      responseText = await callChatbot(prompt, this.modelName, this.modelType, this.apiKey, 1.0, { newChat: true });
      return JSON.parse(this.cleanJsonResponse(responseText));
    } catch (error: any) {
      return { error: error.message, raw_response: responseText };
    }
  }

  // ─────────────────────────────────────────────
  // QUIZ — BATCH GENERATION  (25/25/25/25)
  // ─────────────────────────────────────────────
  private createQuizBatchPrompt(
    words: string[],
    inputLanguage: string,
    outputLanguage: string,
    batchSize: number,
    totalTarget: number,
    previousQuestions: any[]
  ): string {
    const wordsStr   = words.join(", ");
    const batchLabel = previousQuestions.length === 0
      ? `first batch`
      : `batch ${Math.floor(previousQuestions.length / QUIZ_BATCH_SIZE) + 1} (questions ${previousQuestions.length + 1}–${previousQuestions.length + batchSize} of ${totalTarget})`;

    const proficiencyScale = PROFICIENCY_SCALE[inputLanguage] ?? "CEFR A1–C2 scale";

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

    return `You are an expert ${inputLanguage} language examiner designing a proficiency assessment.

TASK: Generate EXACTLY ${batchSize} multiple-choice questions — ${batchLabel}.
Words to test: [${wordsStr}]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
LANGUAGE RULE — NON-NEGOTIABLE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Every "question" field and ALL items in "options" MUST be written ENTIRELY in ${inputLanguage}.
Do NOT use any other language in these fields. The purpose is to assess ${inputLanguage} proficiency directly.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PROFICIENCY ALIGNMENT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Align difficulty labels and sentence complexity to the ${proficiencyScale}.

DIFFICULTY DISTRIBUTION for this batch of ${batchSize}:
- easy       : ~25% (≈${Math.round(batchSize * 0.25)})
- medium     : ~25% (≈${Math.round(batchSize * 0.25)})
- hard       : ~25% (≈${Math.round(batchSize * 0.25)})
- super_hard : ~25% (≈${Math.round(batchSize * 0.25)})
Distribute as evenly as possible; exact counts may vary by ±1 to hit the total.

QUESTION DIMENSIONS (vary — never repeat same dimension consecutively):
- DIRECT_USAGE: pick the sentence/blank where the word is used correctly
- SYNONYM_ANTONYM: closest synonym or antonym in context
- COLLOCATION: which word naturally combines with the tested word
- CONTEXTUAL_MEANING: meaning of the word in a given sentence
- GRAMMAR_ROLE: correct grammatical form/position of the word
- ERROR_DETECTION: identify the sentence that uses the word incorrectly
- REGISTER_MATCH: appropriate formality/context for the word
- NUANCE: distinguish the word from a near-synonym

QUALITY RULES:
- Each question MUST genuinely test its "word_tested": the word appears in the question stem or is the answer.
- EXACTLY ONE option is correct. A competent native speaker must be able to reject the other three — never two defensible answers.
- Distractors: same part of speech and similar length/register as the correct option; plausible but clearly wrong. No "all/none of the above".
- Mimic official exam item style for ${inputLanguage} (HSK / JLPT / TOPIK / CEFR-based exams such as IELTS·TOEIC) — natural phrasing, not textbook-artificial.
- Spread questions evenly across all words.
- Distribute correct answer positions (A/B/C/D) evenly across the batch.
- "level" MUST be a concrete value on the ${proficiencyScale}.
- Valid JSON: escape line breaks inside strings as \\n and inner double quotes as \\".
${avoidBlock}
OUTPUT: valid JSON only — no markdown, no extra text, start with { end with }.

{
  "quiz": [
    {
      "word_tested": "...",
      "difficulty": "easy|medium|hard|super_hard",
      "level": "<e.g. HSK 3 | JLPT N2 | CEFR B1>",
      "dimension": "<from dimension list>",
      "question": "<entirely in ${inputLanguage}>",
      "options": ["A. <${inputLanguage}>", "B. <${inputLanguage}>", "C. <${inputLanguage}>", "D. <${inputLanguage}>"],
      "answer": "<A|B|C|D>"
    }
  ]
}`;
  }

  private createExplanationPrompt(
    questions: any[],
    inputLanguage: string,
    outputLanguage: string
  ): string {
    return `You are an expert ${inputLanguage} language tutor. Your student has just completed a quiz and needs clear explanations.

Quiz question language: ${inputLanguage}
Explanation language: ${outputLanguage} — ALL text in your response MUST be in ${outputLanguage} only.

Questions (JSON array):
${JSON.stringify(questions.map((q, i) => ({
  n: i + 1,
  question: q.question,
  options: q.options,
  answer: q.answer,
  word_tested: q.word_tested,
})), null, 2)}

For EACH question, write an explanation that includes:
1. 📋 Question translation — translate the question and all options into ${outputLanguage}.
2. ✅ Correct answer — explain WHY the correct option is right (meaning, grammar, usage context), 1–3 sentences.
3. ❌ Wrong answers — one short sentence per incorrect option explaining why it does NOT fit.
4. 💡 Key insight — one concise, memorable takeaway about the word tested (collocation, nuance, or common mistake).
5. 📊 Level note — the proficiency level this question targets (e.g. HSK 4, JLPT N2, CEFR B2) and the skill it tests.

OUTPUT: valid JSON only — no markdown, no code blocks. An array of exactly ${questions.length} objects, same order, "n" matching the input numbering.
Inside "explanation" strings: line breaks MUST be written as \\n and inner double quotes as \\".
[
  {
    "n": 1,
    "explanation": "📋 <translated question & options>\\n\\n✅ <correct answer explanation>\\n\\n❌ <wrong answers explanation>\\n\\n💡 <key insight>\\n\\n📊 <level note>"
  }
]`;
  }

  public async generateQuiz(
    words: string[],
    inputLanguage: string,
    outputLanguage: string,
    numQuestions: number
  ): Promise<any> {
    const target = Math.min(numQuestions, QUIZ_MAX_QUESTIONS);
    const allQuestions: any[] = [];
    let remaining = target;

    while (remaining > 0) {
      const batchSize = Math.min(remaining, QUIZ_BATCH_SIZE);
      const prompt = this.createQuizBatchPrompt(
        words, inputLanguage, outputLanguage,
        batchSize, target, allQuestions
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

        if (batch.length < batchSize && remaining > 0) {
          console.warn(`[generateQuiz] Batch returned ${batch.length}/${batchSize}. Stopping early.`);
          break;
        }
      } catch (error: any) {
        return { error: error.message, raw_response: responseText };
      }
    }

    return { words, quiz: allQuestions };
  }

  public async generateQuizExplanations(
    questions: any[],
    inputLanguage: string,
    outputLanguage: string
  ): Promise<any[]> {
    if (questions.length === 0) return questions;

    const EXPLAIN_BATCH = 10;
    const result = [...questions];

    for (let start = 0; start < questions.length; start += EXPLAIN_BATCH) {
      const chunk = questions.slice(start, start + EXPLAIN_BATCH);
      const prompt = this.createExplanationPrompt(chunk, inputLanguage, outputLanguage);

      try {
        const responseText = await callChatbot(prompt, this.modelName, this.modelType, this.apiKey);
        const parsed: any[] = JSON.parse(this.cleanJsonResponse(responseText));
        for (const item of parsed) {
          const idx = item.n - 1;
          if (result[idx]) result[idx] = { ...result[idx], explanation: item.explanation };
        }
      } catch (e) {
        console.warn("[generateQuizExplanations] batch failed:", e);
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
1. Return ONLY a valid JSON array of strings. No markdown, no code blocks, no explanation.
2. Concatenating all tokens in order MUST reproduce the sentence EXACTLY — do not add, remove, translate, or normalize any character.
3. Chinese/Japanese: split by word/morpheme, NOT single character. Japanese particles (は/が/を/に…) are separate tokens. CJK punctuation (。、！？「」…) is a standalone token.
4. Space-separated languages: split on whitespace, keeping whitespace as its own token; punctuation attached to preceding word OR standalone.
Example Chinese: ["我", "喜欢", "学习", "中文", "。"]
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

  // Tách token cho NHIỀU câu trong MỘT prompt (JSON) — tránh spam webview.
  // Không bao giờ reject: lỗi/parse hỏng → fallback split từng câu.
  public async tokenizeSentences(sentences: string[], language: string): Promise<string[][]> {
    if (sentences.length === 0) return [];

    const fallback = (s: string): string[] =>
      ["Chinese", "Japanese"].includes(language) ? s.split("") : s.split(/(\s+)/);

    const prompt = `
You are an expert linguist. Split EACH ${language} sentence below into an array of meaningful tokens.
INPUT: a JSON array of ${sentences.length} sentences.
OUTPUT: ONLY a valid JSON array of EXACTLY ${sentences.length} arrays — element i is the token array for sentence i, SAME order. Never merge, split, skip, or reorder sentences. No markdown, no code blocks, no extra text.
RULES:
1. Concatenating the tokens of element i in order MUST reproduce sentence i EXACTLY — do not add, remove, translate, or normalize any character.
2. Chinese/Japanese: split by word/morpheme, NOT single character. Japanese particles (は/が/を/に…) are separate tokens. CJK punctuation (。、！？「」…) is a standalone token.
3. Space-separated languages: split on whitespace, keeping whitespace as its own token; punctuation attached to preceding word OR standalone.
Example (2 sentences): [["我","喜欢","学习","中文","。"],["I"," ","love"," ","learning."]]
SENTENCES: ${JSON.stringify(sentences)}
    `;

    try {
      const responseText = await callChatbot(prompt, this.modelName, this.modelType, this.apiKey);
      const parsed = JSON.parse(this.cleanJsonResponse(responseText));
      if (!Array.isArray(parsed)) return sentences.map(fallback);
      // Khớp theo index; phần tử thiếu/hỏng → fallback câu tương ứng
      return sentences.map((s, i) => {
        const toks = parsed[i];
        return Array.isArray(toks) && toks.length > 0 ? toks : fallback(s);
      });
    } catch {
      return sentences.map(fallback);
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
  public async translateText(
    text: string,
    inputLanguage: string,
    outputLanguage: string
  ): Promise<string> {
    const prompt = `
You are an expert lexicographer translating ${inputLanguage} to ${outputLanguage}.
TASK: Translate "${text}".
RULES:
- Concise and precise, like a dictionary entry. Group by part of speech if multiple; at most 3 meanings per part of speech, most common first.
- Every meaning MUST be in ${outputLanguage}.
- If "${text}" is a multi-word phrase, translate the whole phrase as used naturally, not word by word.
- If ${inputLanguage} is Chinese: MUST include Pinyin with tone marks.
- If ${inputLanguage} is Japanese: MUST include Romaji.
- If ${inputLanguage} is Korean: MUST include Revised Romanization.
- No preamble, no commentary, no markdown — start directly with the entry.
OUTPUT FORMAT (plain text only):
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
      return `[Error: Translation failed: ${error.message}]`;
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
    const wrongOptions  = options.filter(o => !o.startsWith(correctAnswer));

    const prompt = `You are a ${inputLanguage} language tutor. Explain the quiz question below to your student.
Write EVERYTHING in ${outputLanguage} (you may quote ${inputLanguage} words when needed). Be concise — enough to understand, no more. No markdown, no bullet symbols, plain text only.

Question: ${question}
Options: ${options.join(" / ")}
Correct answer: ${correctOption}

Structure your response in EXACTLY this format — each label starts a new line, keep the labels verbatim, replace the bracketed text with your content, and do NOT output the square brackets:

Translation: [Translate the question and all options into ${outputLanguage}.]

Correct answer: [In 1–2 sentences, explain why ${correctOption} is right — meaning, grammar, or usage.]

Wrong answers: [For each wrong option, one short sentence explaining why it does not fit: ${wrongOptions.join(", ")}.]

Key point: [One sentence on the most important thing to remember about "${wordTested}" — collocation, nuance, or common mistake.]

Level: [State the proficiency level (e.g. HSK 4, JLPT N2, CEFR B2) and what skill this question tests.]`;

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
    else if (clean.startsWith("```"))  clean = clean.slice(3).trim();
    if (clean.endsWith("```"))         clean = clean.slice(0, -3).trim();
    return clean;
  }
}