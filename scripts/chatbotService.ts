// chatbotService.ts

export const callChatbot = async (
  prompt: string,
  modelName: string,
  modelType: string,
  apiKey: string,
  temperature: number = 1.0
): Promise<string> => {
  try {
    if (modelType === "chatgpt") {
      return await callChatgpt(prompt, modelName, apiKey, temperature);
    }
    // Tương lai có thể mở rộng Claude, Gemini tại đây
    throw new Error(`Unsupported model type: ${modelType}`);
  } catch (error: any) {
    throw new Error(`Chatbot API Error: ${error.message}`);
  }
};

const callChatgpt = async (
  prompt: string,
  model: string,
  apiKey: string,
  temperature: number
): Promise<string> => {
  // Sử dụng fetch API chuẩn để tương thích 100% với React Native
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model,
      messages: [{ role: "user", content: prompt }],
      temperature: temperature,
    }),
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error?.message || "OpenAI API Error");
  }

  const data = await response.json();
  return data.choices[0].message.content;
};