import OpenAI from "openai";
import { OPENAI_API_KEY } from "./config";
import { ProcoreImage } from "./procoreImages";
import { DailyLogNote, getNoteText, getNoteAuthor } from "./procoreDailyLogs";

if (!OPENAI_API_KEY) {
  throw new Error(
    "OPENAI_API_KEY is not set. Add it to your .env before using AI."
  );
}

const openai = new OpenAI({
  apiKey: OPENAI_API_KEY,
  timeout: 60_000, // 60 second timeout per request
});

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

export interface ImageSelectionInput {
  id: number;
  date: string;
  description?: string;
  filename?: string;
}

/**
 * Given:
 * - the monthly summary (bullets + photoDays)
 * - a capped list of candidate images (metadata only)
 *
 * Ask AI (GPT-4.1-mini) to choose up to maxImages that best illustrate the story.
 * Returns an array of selected image IDs.
 */
export async function selectImagesFromMetadata(
  summary: NotesSummaryResult,
  candidates: ProcoreImage[],
  maxImages: number = 20
): Promise<number[]> {
  if (!candidates.length) return [];

  const list: ImageSelectionInput[] = candidates.map((img) => ({
    id: img.id,
    date: img.log_date || img.created_at.slice(0, 10),
    description: img.description,
    filename: img.filename,
  }));

  const systemPrompt = `
You are a construction project photo curator.

Your job:
- Read the monthly summary and list of candidate photos.
- Choose up to ${maxImages} images that best illustrate the key activities, milestones, and visible progress.
- Prefer photos whose descriptions clearly match important events from the summary.
- If descriptions are sparse, prefer:
  - Dates that align with important days from the summary and photo_days list.
  - A good spread across the month (not all on one day).
- If multiple photos seem redundant (same date/description), you may skip some to improve variety.
- Respond ONLY with valid JSON of the form:
  { "selected_ids": [123, 456, ...] }.
`;

  const userPrompt = `
Monthly summary bullets:
${summary.summaryBullets.join("\n")}

AI-suggested key dates (photo_days):
${
  summary.photoDays && summary.photoDays.length
    ? summary.photoDays
        .map(
          (d: any) =>
            `- ${d.date} (priority ${d.priority ?? "?"}): ${d.reason ?? ""}`
        )
        .join("\n")
    : "(none)"
}

Candidate photos (metadata only):
${list
  .map(
    (p) =>
      `- id: ${p.id}, date: ${p.date}, desc: ${
        p.description || "(no description)"
      }, file: ${p.filename || ""}`
  )
  .join("\n")}

Return ONLY JSON:
{
  "selected_ids": [ /* up to ${maxImages} ids from the list above */ ]
}
`;

  const resp = await openai.chat.completions.create({
    model: "gpt-4.1-mini",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    response_format: { type: "json_object" },
    max_completion_tokens: 500,
  });

  const raw = resp.choices[0]?.message?.content || "{}";

  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = {};
  }

  const ids: number[] = Array.isArray(parsed.selected_ids)
    ? parsed.selected_ids.filter((id: any) => typeof id === "number")
    : [];

  // Extra safety: only keep IDs that exist in candidates
  const candidateIdSet = new Set(candidates.map((c) => c.id));
  const filteredIds = ids.filter((id) => candidateIdSet.has(id));

  return filteredIds;
}

function getDistinctDatesFromNotes(notes: DailyLogNote[]): string[] {
  const set = new Set<string>();
  for (const n of notes) {
    const d = n.date || n.datetime?.slice(0, 10) || n.created_at.slice(0, 10);
    if (d) set.add(d);
  }
  return Array.from(set).sort();
}

export interface CaptionInput {
  id: number;
  date: string;
  description?: string;
  filename?: string;
}

export interface CaptionResult {
  id: number;
  caption: string;
}

/**
 * Generate short, professional captions for photo slides.
 *
 * - If a good description exists, AI will clean/shorten it
 * - If no description, AI generates based on filename, date, and project context
 */
export async function generateCaptions(
  projectName: string,
  summaryBullets: string[],
  photoDays: Array<{ date: string; reason?: string; priority?: number }>,
  images: CaptionInput[]
): Promise<CaptionResult[]> {
  if (!images.length) return [];

  const systemPrompt = `
You are a construction project photo caption writer.

Your job: Generate short, professional captions for monthly report slides.

Rules:
- Each caption should be 3-8 words maximum (must fit on one line)
- Use professional construction terminology
- Be specific but concise (e.g., "Foundation pour in progress" not "Construction work")
- If the image has a good description, clean it up and shorten it
- If no description, infer from filename and date using the project context
- Captions should sound professional for a client-facing report
- Do NOT include dates in captions
- Do NOT use generic phrases like "Construction photo" or "Site image"

Respond ONLY with valid JSON matching the schema.
`;

  const photoDaysText = photoDays.length
    ? photoDays.map((d) => "- " + d.date + ": " + (d.reason || "")).join("\n")
    : "(none specified)";

  const imagesText = images
    .map((img) => {
      const desc = img.description || "(none)";
      const file = img.filename || "(unknown)";
      return "- id: " + img.id + ", date: " + img.date + ", desc: \"" + desc + "\", file: \"" + file + "\"";
    })
    .join("\n");

  const userPrompt = `
Project: ${projectName}

Project summary (for context):
${summaryBullets.join("\n")}

Key dates this month:
${photoDaysText}

Images needing captions:
${imagesText}

Return JSON:
{
  "captions": [
    { "id": 123, "caption": "Short caption here" }
  ]
}
`;

  const resp = await openai.chat.completions.create({
    model: "gpt-4.1-mini",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    response_format: { type: "json_object" },
    max_completion_tokens: 1000,
  });

  const raw = resp.choices[0]?.message?.content || "{}";

  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = { captions: [] };
  }

  const captions: CaptionResult[] = Array.isArray(parsed.captions)
    ? parsed.captions.filter(
        (c: any) => typeof c.id === "number" && typeof c.caption === "string"
      )
    : [];

  // Ensure we have a caption for every image (fallback if AI missed any)
  const captionMap = new Map<number, string>();
  for (const c of captions) {
    captionMap.set(c.id, c.caption);
  }

  const results: CaptionResult[] = images.map((img) => ({
    id: img.id,
    caption: captionMap.get(img.id) || img.description?.slice(0, 50) || "Project Progress",
  }));

  return results;
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
