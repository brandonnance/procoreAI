// src/testImageCandidates.ts
import { getImagesForMonth, ProcoreImage } from "./procoreImages";
import {
  selectCandidateImagesForMonth,
  PhotoDaySuggestion,
} from "./imageCandidateSelection";

async function main() {
  const projectId = Number(process.argv[2]);
  const month = process.argv[3] || "2025-11";
  const photoDatesArg = process.argv[4]; // comma-separated dates: YYYY-MM-DD,YYYY-MM-DD,...

  if (!projectId) {
    console.log(
      "Usage: npm run test-image-candidates -- <projectId> [YYYY-MM] [date1,date2,...]"
    );
    process.exit(1);
  }

  console.log(`Fetching images for project ${projectId} in ${month}...`);
  const images = await getImagesForMonth(projectId, month);
  console.log(`Total images found: ${images.length}`);

  if (!images.length) {
    console.log("No images for this project/month.");
    return;
  }

  let photoDays: PhotoDaySuggestion[] = [];

  if (photoDatesArg) {
    const dates = photoDatesArg
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    photoDays = dates.map((d, index) => ({
      date: d,
      priority: index + 1,
    }));
  }

  console.log(
    `Using photo days: ${
      photoDays.length
        ? photoDays.map((d) => d.date).join(", ")
        : "(none provided)"
    }`
  );

  const candidates = selectCandidateImagesForMonth(images, photoDays, {
    maxCandidates: 60,
    minCandidates: 20,
  });

  console.log(`\nSelected ${candidates.length} candidate images.\n`);

  // Show how many candidates per date
  const countsByDate: Record<string, number> = {};
  for (const img of candidates) {
    const date = img.log_date || img.created_at.slice(0, 10);
    countsByDate[date] = (countsByDate[date] ?? 0) + 1;
  }

  console.log("Candidates per date:");
  Object.entries(countsByDate)
    .sort(([d1], [d2]) => d1.localeCompare(d2))
    .forEach(([date, count]) => {
      console.log(`- ${date}: ${count}`);
    });

  console.log("\nSample candidates:");
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

  console.log("\nDone.\n");
}

main().catch((err: any) => {
  console.error(
    "Error in test-image-candidates:",
    err.response?.data || err.message
  );
  process.exit(1);
});
