// src/testImageSelection.ts
import { getDailyNotesForMonth } from "./procoreDailyLogs";
import { getImagesForMonth, ProcoreImage } from "./procoreImages";
import {
  summarizeDailyNotesWithPhotoDays,
  NotesSummaryResult,
  selectImagesFromMetadata,
} from "./aiClient";
import {
  selectCandidateImagesForMonth,
  PhotoDaySuggestion,
} from "./imageCandidateSelection";

async function main() {
  const projectId = Number(process.argv[2]);
  const month = process.argv[3] || "2025-11";
  const projectName = process.argv[4] || `Project ${projectId}`;
  const maxWordsArg = process.argv[5];

  if (!projectId) {
    console.log(
      'Usage: npm run test-image-selection -- <projectId> [YYYY-MM] ["Project Name"] [maxWords]'
    );
    process.exit(1);
  }

  const maxWords = maxWordsArg ? Number(maxWordsArg) : 250;

  console.log(
    `\n=== Running full image selection pipeline for ${projectName} (${projectId}) in ${month} ===\n`
  );

  // 1) Fetch notes
  console.log("Fetching daily log notes...");
  const notes = await getDailyNotesForMonth(projectId, month);
  console.log(`Found ${notes.length} notes.`);

  if (!notes.length) {
    console.log("No notes for this period. Aborting.");
    return;
  }

  // 2) Summarize notes + get photoDays
  console.log("\nAsking AI for summary + photo day suggestions...");
  const summary: NotesSummaryResult = await summarizeDailyNotesWithPhotoDays(
    projectName,
    month,
    notes,
    maxWords,
    6 // suggest up to 6 photo days
  );

  console.log("\n===== AI SUMMARY BULLETS =====");
  summary.summaryBullets.forEach((b) => console.log(b));

  console.log("\n===== AI SUGGESTED PHOTO DAYS =====");
  if (!summary.photoDays || !summary.photoDays.length) {
    console.log("(none)");
  } else {
    (summary.photoDays as PhotoDaySuggestion[])
      .sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999))
      .forEach((d) =>
        console.log(
          `- ${d.date} (priority ${d.priority ?? "?"}): ${d.reason ?? ""}`
        )
      );
  }

  // 3) Fetch images for that month
  console.log("\nFetching images for that month...");
  const images: ProcoreImage[] = await getImagesForMonth(projectId, month);
  console.log(`Total images in ${month}: ${images.length}`);

  if (!images.length) {
    console.log("No images for this period. Aborting image selection.");
    return;
  }

  // 4) Candidate selection based on photoDays + fallbacks
  console.log(
    "\nSelecting candidate images based on photo days + fallbacks..."
  );
  const photoDays: PhotoDaySuggestion[] = (summary.photoDays ||
    []) as PhotoDaySuggestion[];

  const candidates = selectCandidateImagesForMonth(images, photoDays, {
    maxCandidates: 60,
    minCandidates: 20,
  });

  console.log(`Candidate images selected: ${candidates.length}`);

  // Show candidates per date
  const countsByDate: Record<string, number> = {};
  for (const img of candidates) {
    const date = img.log_date || img.created_at.slice(0, 10);
    countsByDate[date] = (countsByDate[date] ?? 0) + 1;
  }

  console.log("\nCandidates per date:");
  Object.entries(countsByDate)
    .sort(([d1], [d2]) => d1.localeCompare(d2))
    .forEach(([date, count]) => {
      console.log(`- ${date}: ${count}`);
    });

  console.log("\nSample candidate images:");
  candidates.slice(0, 5).forEach((img: ProcoreImage) => {
    const date = img.log_date || img.created_at.slice(0, 10);
    console.log(
      `id: ${img.id}, date: ${date}, size: ${img.size}, desc: "${(
        img.description || ""
      )
        .slice(0, 60)
        .replace(/\n/g, " ")}"`
    );
  });

  // 5) Ask AI to pick the best from the candidates
  console.log(
    "\nAsking AI to select the final set of images from candidates (metadata only)..."
  );

  const selectedIds = await selectImagesFromMetadata(
    summary,
    candidates,
    20 // max images AI can choose at this stage
  );

  console.log(`\nAI selected ${selectedIds.length} images.`);

  if (!selectedIds.length) {
    console.log(
      "No images selected by AI. You may want to inspect data or adjust prompts."
    );
    return;
  }

  // Map selected IDs back to full metadata
  const candidateById = new Map<number, ProcoreImage>();
  candidates.forEach((img) => candidateById.set(img.id, img));

  console.log("\n===== FINAL SELECTED IMAGES =====");
  selectedIds.forEach((id) => {
    const img = candidateById.get(id);
    if (!img) return;
    const date = img.log_date || img.created_at.slice(0, 10);
    console.log(
      `id: ${img.id}, date: ${date}, size: ${img.size}, desc: "${(
        img.description || ""
      )
        .slice(0, 80)
        .replace(/\n/g, " ")}", file: ${img.filename || ""}`
    );
  });

  console.log("\n=== Done. ===\n");
}

main().catch((err) => {
  console.error(
    "Error in test-image-selection:",
    (err as any).response?.data || (err as Error).message
  );
  process.exit(1);
});
