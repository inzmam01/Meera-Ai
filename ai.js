// Talks to the AI provider (DeepSeek, which uses the OpenAI-style chat API).
// To switch provider later, change the three settings below (or the env variables).

export const MODEL = process.env.MODEL || "deepseek-chat";
const baseUrl = () => (process.env.AI_BASE_URL || "https://api.deepseek.com").replace(/\/$/, "");
export const hasKey = () => Boolean(process.env.DEEPSEEK_API_KEY);

export class AIError extends Error {
  constructor(status, detail) {
    super(`AI request failed (${status})`);
    this.status = status;
    this.detail = detail;
  }
}

// Streams the answer piece by piece through onText(text)
export async function streamAnswer({ system, messages, signal, onText }) {
  const res = await fetch(`${baseUrl()}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      stream: true,
      max_tokens: 1200,
      messages: [{ role: "system", content: system }, ...messages],
    }),
    signal,
  });

  if (!res.ok) throw new AIError(res.status, (await res.text()).slice(0, 500));

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop(); // keep the unfinished line for next time
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (payload === "[DONE]") return;
      try {
        const text = JSON.parse(payload).choices?.[0]?.delta?.content;
        if (text) onText(text);
      } catch {
        /* ignore keep-alive or partial lines */
      }
    }
  }
}
