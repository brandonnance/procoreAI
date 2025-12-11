// src/testBuildReportSpec.ts
import * as fs from "fs-extra";
import * as path from "path";
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
import { buildReportSpec, MonthlyReportSpec } from "./buildReportSpec";

async function main() {
  const projectId = Number(process.argv[2]);
  const month = process.argv[3] || "2025-11";
  const projectName = process.argv[4] || `Project ${projectId}`;
  const maxWordsArg = process.argv[5];

  if (!projectId) {
    console.log(
      'Usage: npm run build-report-spec -- <projectId> [YYYY-MM] ["Project Name"] [maxWords]'
    );
    process.exit(1);
  }

  const maxWords = maxWordsArg ? Number(maxWordsArg) : 250;

  console.log(
    `\n=== Building report spec for ${projectName} (${projectId}) in ${month} ===\n`
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
  console.log("Asking AI for summary + photo day suggestions...");
  const summary: NotesSummaryResult = await summarizeDailyNotesWithPhotoDays(
    projectName,
    month,
    notes,
    maxWords,
    6
  );

  console.log(`Summary bullets: ${summary.summaryBullets.length}`);
  console.log(`Photo days suggested: ${summary.photoDays?.length || 0}`);

  // 3) Fetch images for that month
  console.log("Fetching images for that month...");
  const images: ProcoreImage[] = await getImagesForMonth(projectId, month);
  console.log(`Total images in ${month}: ${images.length}`);

  if (!images.length) {
    console.log("No images for this period. Building spec without images.");
  }

  let selectedIds: number[] = [];

  if (images.length > 0) {
    // 4) Candidate selection based on photoDays + fallbacks
    console.log("Selecting candidate images...");
    const photoDays: PhotoDaySuggestion[] = (summary.photoDays ||
      []) as PhotoDaySuggestion[];

    const candidates = selectCandidateImagesForMonth(images, photoDays, {
      maxCandidates: 60,
      minCandidates: 20,
    });

    console.log(`Candidate images: ${candidates.length}`);

    // 5) Ask AI to pick the best from the candidates
    console.log("Asking AI to select final images...");
    selectedIds = await selectImagesFromMetadata(summary, candidates, 20);
    console.log(`AI selected ${selectedIds.length} images.`);
  }

  // 6) Build the report spec
  console.log("Building report spec...");
  const reportSpec: MonthlyReportSpec = buildReportSpec(
    projectId,
    projectName,
    month,
    summary.summaryBullets,
    (summary.photoDays || []) as PhotoDaySuggestion[],
    images,
    selectedIds
  );

  // 7) Output to file
  const outputDir = path.join(process.cwd(), "output");
  await fs.ensureDir(outputDir);

  const safeProjectName = projectName.replace(/[^a-zA-Z0-9-_]/g, "_");
  const outputFilename = `${safeProjectName}_${month}_spec.json`;
  const outputPath = path.join(outputDir, outputFilename);

  await fs.writeJson(outputPath, reportSpec, { spaces: 2 });

  console.log(`\n=== Report spec saved to: ${outputPath} ===`);

  // Print summary
  console.log("\n--- Report Spec Summary ---");
  console.log(`Project: ${reportSpec.projectName} (${reportSpec.projectId})`);
  console.log(`Month: ${reportSpec.month}`);
  console.log(`Summary bullets: ${reportSpec.summaryBullets.length}`);
  console.log(`Photo days: ${reportSpec.photoDays.length}`);
  console.log(`Selected images: ${reportSpec.images.length}`);

  if (reportSpec.images.length > 0) {
    console.log("\nSelected images:");
    reportSpec.images.forEach((img, i) => {
      console.log(
        `  ${i + 1}. id: ${img.id}, date: ${img.date}, desc: "${(
          img.description || ""
        )
          .slice(0, 50)
          .replace(/\n/g, " ")}"`
      );
    });
  }

  console.log("\n=== Done. ===\n");
}

main().catch((err) => {
  console.error(
    "Error in build-report-spec:",
    (err as any).response?.data || (err as Error).message
  );
  process.exit(1);
});
