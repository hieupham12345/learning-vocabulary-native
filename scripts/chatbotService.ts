// chatbotService.ts
//
// Điểm nghẽn duy nhất app nói chuyện với LLM. 2 chế độ (settings.chat_mode):
//   - 'web' : điều khiển Gemini web qua WebViewChatBridge (đăng nhập Google, không tốn API).
//   - 'api' : gọi thẳng REST API — dispatch theo `agent` (chatgpt → OpenAI, gemini → Gemini API).
// Chữ ký giữ nguyên nên toàn bộ callsite không đổi.

import { WebViewChatBridge } from "./webview-chat-bridge";
import { getSettings } from "./settings-store";

// Bỏ các dòng trắng (không có text) — innerText Gemini web hay chèn dòng rỗng thừa.
const stripBlankLines = (s: string): string =>
  s
    .split("\n")
    .filter((line) => line.trim() !== "")
    .join("\n")
    .trim();

export const callChatbot = async (
  prompt: string,
  modelName?: string,
  modelType?: string,
  apiKey?: string,
  temperature: number = 1.0,
  opts?: { newChat?: boolean }
): Promise<string> => {
  const s = getSettings();

  // Chế độ web: Gemini WebView
  if (s.chat_mode === "web") {
    const webText = await WebViewChatBridge.send(prompt, opts);
    return stripBlankLines(webText);
  }

  // Chế độ API: dispatch theo agent (logic gốc)
  const type  = (modelType ?? s.agent ?? "").toLowerCase();
  const key   = apiKey ?? s.api_key;
  const model = modelName ?? s.model;

  let text: string;
  if (type === "chatgpt" || type === "openai") {
    text = await callOpenAI(prompt, model, key, temperature);
  } else if (type === "gemini") {
    text = await callGeminiApi(prompt, model, key, temperature);
  } else {
    throw new Error(`Unsupported agent: ${type || "(empty)"}`);
  }
  return stripBlankLines(text);
};

// ── OpenAI Chat Completions ────────────────────────────────
const callOpenAI = async (
  prompt: string,
  model: string,
  apiKey: string,
  temperature: number
): Promise<string> => {
  if (!apiKey) throw new Error("Missing API key (OpenAI). Enter it in Settings.");
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model || "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature,
    }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err?.error?.message || `OpenAI API Error ${response.status}`);
  }
  const data = await response.json();
  return data.choices?.[0]?.message?.content ?? "";
};

// ── Gemini API (Google AI Studio) ──────────────────────────
const callGeminiApi = async (
  prompt: string,
  model: string,
  apiKey: string,
  temperature: number
): Promise<string> => {
  if (!apiKey) throw new Error("Missing API key (Gemini). Enter it in Settings.");
  const mdl = model || "gemini-2.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${mdl}:generateContent?key=${apiKey}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature },
    }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Gemini API Error ${response.status}`);
  }
  const data = await response.json();
  const parts = data.candidates?.[0]?.content?.parts ?? [];
  return parts.map((p: any) => p.text ?? "").join("");
};
