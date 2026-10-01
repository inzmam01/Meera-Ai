import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeIcon } from "./icons.js";
import { streamAnswer, hasKey, MODEL, AIError } from "./ai.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.set("trust proxy", 1); // needed on Render/Railway so each student gets their own IP
app.use(express.json({ limit: "50kb" }));

// App icons for "Install app" (generated in code, so there is no image file to upload)
const icons = { 192: makeIcon(192), 512: makeIcon(512) };
app.get("/icon-:size.png", (req, res) => {
  const icon = icons[req.params.size];
  if (!icon) return res.sendStatus(404);
  res.type("png").set("Cache-Control", "public, max-age=86400").send(icon);
});

// Open /health in your browser to check that the AI key is set
app.get("/health", (_req, res) => res.json({ ok: true, aiKeySet: hasKey(), model: MODEL }));

// Simple per-student limit so strangers can't drain your API credit
const LIMIT = Number(process.env.RATE_LIMIT || 30); // questions per hour per IP
const hits = new Map();
function rateLimit(req, res, next) {
  const now = Date.now();
  const recent = (hits.get(req.ip) || []).filter((t) => now - t < 3600_000);
  if (recent.length >= LIMIT) {
    return res.status(429).json({ error: "You have asked a lot of questions this hour. Take a short break and come back soon!" });
  }
  recent.push(now);
  hits.set(req.ip, recent);
  next();
}
setInterval(() => {
  const now = Date.now();
  for (const [ip, times] of hits) if (!times.some((t) => now - t < 3600_000)) hits.delete(ip);
}, 600_000).unref();
app.use(express.static(path.join(__dirname, "public")));

// ---------- Teaching content ----------
const SUBJECTS = {
  "Financial Accounting": "journal, ledger, trial balance, final accounts, depreciation",
  "Business Law": "contract act, sale of goods act, company law basics",
  "Micro & Macro Economics": "demand and supply, GDP, inflation, monetary policy",
  "Cost Accounting": "material, labour, overheads, marginal costing, budgeting",
  "Income Tax": "heads of income, deductions, computation of taxable income",
  "Business Statistics": "mean, median, correlation, regression, probability",
  "Auditing": "audit process, vouching, verification, internal control",
  "Business Management": "planning, organising, leadership, motivation theories",
};

const MODES = {
  explain:
    "Explain the concept step by step. Start with a real-life example, then the formal definition, then a small worked example.",
  simplify:
    "The student is confused. Re-explain in the simplest way possible, like talking to a friend. Use a daily-life analogy and very short sentences.",
  quiz:
    "Run a quiz. Ask ONE question at a time (mix of MCQ and short numerical/theory). Wait for the answer, then say if it is right, explain why, and ask the next question.",
  exam:
    "Prepare the student for exams. Give a crisp answer in the style expected in university papers: definition, key points, format or formula if any, and one common mistake to avoid.",
};

function buildSystemPrompt(subject, mode) {
  return `You are Professor Meera, a warm and experienced B.Com teacher with 20 years of classroom experience.

How you teach:
- Use simple, interesting, human language. Talk like a friendly teacher, not a textbook.
- Begin with a real-life example (shop, chai stall, salary, bank, online order) before any definition.
- Explain jargon the first time you use it.
- For numerical topics, show the working step by step, with clear headings such as "Given", "Step 1", "Answer".
- Keep answers short and focused. End with one small question or a "try this" to check understanding.
- Be encouraging. If the student makes a mistake, correct it kindly and show the right way.
- Stay within commerce, accounting, finance, law, economics, statistics, taxation and management. If asked something unrelated, politely bring the student back to studies.
- If unsure about a rule, section number or rate (especially tax and law, which change over time), say so and advise checking the latest official source or their syllabus.

Current subject: ${subject}. Topics in this subject include: ${SUBJECTS[subject]}.
Current mode: ${MODES[mode]}

Formatting: plain text with **bold** for key terms and simple "-" bullets. No tables wider than 3 columns.`;
}

// ---------- API ----------
function friendlyError(err) {
  if (!(err instanceof AIError)) return "The teacher is busy right now. Please try again in a moment.";
  if (err.status === 401) return "The teacher's access key is not valid. (Site owner: check DEEPSEEK_API_KEY.)";
  if (err.status === 402) return "The teacher's AI balance has run out. (Site owner: add balance on the DeepSeek platform.)";
  if (err.status === 429) return "Many students are asking at once. Please try again in a minute.";
  return "The teacher is busy right now. Please try again in a moment.";
}

app.get("/api/subjects", (_req, res) => res.json(Object.keys(SUBJECTS)));

app.post("/api/chat", rateLimit, async (req, res) => {
  const { subject, mode, messages } = req.body ?? {};

  if (!SUBJECTS[subject] || !MODES[mode] || !Array.isArray(messages) || !messages.length) {
    return res.status(400).json({ error: "Invalid request." });
  }

  // Keep only the last 20 turns and cap message size
  const history = messages
    .slice(-20)
    .filter((m) => ["user", "assistant"].includes(m.role) && typeof m.content === "string")
    .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }));

  if (!history.length || history[0].role !== "user") {
    return res.status(400).json({ error: "Conversation must start with a student message." });
  }

  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.flushHeaders();

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  const controller = new AbortController();
  res.on("close", () => controller.abort()); // stop if the student leaves

  try {
    await streamAnswer({
      system: buildSystemPrompt(subject, mode),
      messages: history,
      signal: controller.signal,
      onText: (text) => send({ text }),
    });
    send({ done: true });
  } catch (err) {
    if (controller.signal.aborted) return;
    console.error("AI error:", err.status || "", err.detail || err.message);
    send({ error: friendlyError(err) });
  } finally {
    res.end();
  }
});

if (!hasKey()) console.warn("WARNING: DEEPSEEK_API_KEY is not set. The teacher cannot answer yet.");
app.listen(PORT, () => console.log(`Professor Meera is teaching at http://localhost:${PORT}`));
                                            
