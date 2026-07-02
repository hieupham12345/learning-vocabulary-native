// types/vocab.ts
// Shared domain types for the vocabulary-learning flow.
// Extracted from app/(tabs)/index.tsx so screens and components share one source.

export interface ExampleItem {
  sentence: string;
  romanization?: string | null;
  translation: string;
  explanation: string;
  grammar_points: string[];
  difficulty_justification: string;
  difficulty_tag: string;
  tokens?: string[];
}

export interface VocabOverview {
  meaning: string;
  romanization?: string | null;
  part_of_speech: string;
  register: string;
  usage: string;
  notes: string;
  collocations: string[];
}

export interface VocabDataLocal {
  word: string;
  language: { input: string; output: string };
  overview: VocabOverview;
  examples: {
    easy?: ExampleItem[];
    medium?: ExampleItem[];
    hard?: ExampleItem[];
    super_hard?: ExampleItem[];
  };
  translation_cache?: Record<string, string>;
}

export interface QuizQuestion {
  difficulty: string;
  dimension: string;
  question: string;
  options: string[];
  answer: string;
  explanation: string;
}

export interface QuizData {
  words: string[];
  quiz: QuizQuestion[];
}

export interface QuizHistoryEntryLocal {
  id?: number;
  words: string[];
  score: number;
  total: number;
  timestamp: string;
  quiz_data: QuizData;
  user_answers: string[];
  input_lang?: string;
}

/** Difficulty buckets in canonical order — single source for iteration. */
export const DIFFICULTY_ORDER = ["easy", "medium", "hard", "super_hard"] as const;
export type Difficulty = (typeof DIFFICULTY_ORDER)[number];
