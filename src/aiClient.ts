import OpenAI from "openai";
import { OPENAI_API_KEY } from "./config";
import { DailyLogNote, getNoteText, getNoteAuthor } from "./procoreDailyLogs";

if (!OPENAI_API_KEY) {
  throw new Error(
    "OPENAI_API_KEY is not set. Add it to your .env before using AI."
  );
}

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

export interface SummarizeOptions {
  maxWords?: number;
}

export interface PhotoDaySuggestion {
  date: string; // "YYYY-MM-DD"
  reason: string;
  priority: number; // 1 = highest priority
}

export interface NotesSummaryResult {
  summaryBullets: string[];
  photoDays: PhotoDaySuggestion[];
}

function getDistinctDatesFromNotes(notes: DailyLogNote[]): string[] {
  const set = new Set<string>();
  for (const n of notes) {
    const d = n.date || n.datetime?.slice(0, 10) || n.created_at.slice(0, 10);
    if (d) set.add(d);
  }
  return Array.from(set).sort();
}

export async function summarizeDailyNotesWithPhotoDays(
  projectName: string,
  month: string,
  notes: DailyLogNote[],
  maxWords: number = 250,
  maxPhotoDays: number = 6
): Promise<NotesSummaryResult> {
  const dates = getDistinctDatesFromNotes(notes);

  const logText = notes
    .map((n) => {
      const date = n.date || n.datetime || n.created_at;
      const author = getNoteAuthor(n);
      const comment = getNoteText(n);
      return `[${date} – ${author}] ${comment}`;
    })
    .join("\n");

  const systemPrompt = `
You are a construction project reporting assistant.

Your job:
1) Read daily log notes for a single project/month.
2) Produce a clear, client-ready monthly summary as bullet points.
3) Suggest which specific dates would be best to search for photos.

Rules:
- Use ONLY the dates provided in the "available_dates" list.
- Do NOT invent dates.
- The summary should be at most ${maxWords} words.
- The summary should be clear, factual, and professional.
- In "photo_days", choose up to ${maxPhotoDays} dates that had visually meaningful or significant work.
- For each photo day, include a short reason and a priority (1 = most important).
- If nothing stands out for photos, return an empty "photo_days" array.
- Respond ONLY with valid JSON matching the provided schema.
`;

  const userPrompt = `
Project: ${projectName}
Reporting period: ${month}

Available dates (from daily logs):
${dates.map((d) => `- ${d}`).join("\n")}

Daily log notes:
${logText}

Return JSON with this structure:
{
  "summary_bullets": [
    "• bullet 1",
    "• bullet 2"
  ],
  "photo_days": [
    {
      "date": "YYYY-MM-DD",
      "reason": "Brief explanation of what happened and why it's a good photo day.",
      "priority": 1
    }
  ]
}
`;

  const resp = await openai.chat.completions.create({
    model: "gpt-4.1-mini",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    max_tokens: 1000,
    response_format: { type: "json_object" }, // ask for JSON directly
  });

  const raw = resp.choices[0]?.message?.content || "{}";
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Fallback in case model misbehaves
    parsed = { summary_bullets: [raw], photo_days: [] };
  }

  const summaryBullets: string[] = Array.isArray(parsed.summary_bullets)
    ? parsed.summary_bullets
    : [];
  const photoDays: PhotoDaySuggestion[] = Array.isArray(parsed.photo_days)
    ? parsed.photo_days
    : [];

  return { summaryBullets, photoDays };
}
