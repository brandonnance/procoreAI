import { getDailyNotesForMonth } from "./procoreDailyLogs";
import { summarizeDailyNotesWithPhotoDays } from "./aiClient";

async function main() {
  const projectId = Number(process.argv[2]);
  const month = process.argv[3] || "2025-12";
  const projectName = process.argv[4] || `Project ${projectId}`;
  const maxWordsArg = process.argv[5] ? Number(process.argv[5]) : undefined;

  if (!projectId) {
    console.log(
      "Usage: npm run summarize-notes -- <projectId> [YYYY-MM] [projectName] [maxWords]"
    );
    process.exit(1);
  }

  const maxWords = maxWordsArg ?? 250;

  console.log(
    `Fetching notes for project ${projectId} (${projectName}) in ${month}...`
  );

  const notes = await getDailyNotesForMonth(projectId, month);

  if (!notes.length) {
    console.log("\nNo notes found for that period. Nothing to summarize.");
    return;
  }

  console.log(
    `Found ${notes.length} notes. Sending to AI (max ${maxWords} words)...\n`
  );

  const result = await summarizeDailyNotesWithPhotoDays(
    projectName,
    month,
    notes,
    maxWords,
    6 // e.g. suggest up to 6 photo days
  );

  console.log("===== AI MONTHLY SUMMARY =====\n");
  console.log(result.summaryBullets.join("\n"));
  console.log("\n===== SUGGESTED PHOTO DAYS =====\n");

  if (!result.photoDays.length) {
    console.log("No specific photo days suggested.");
  } else {
    result.photoDays
      .sort((a, b) => a.priority - b.priority)
      .forEach((d) => {
        console.log(`- ${d.date} (priority ${d.priority}): ${d.reason}`);
      });
  }

  console.log("\n==============================\n");
}

main().catch((err: any) => {
  console.error("Error summarizing notes:", err.response?.data || err.message);
  process.exit(1);
});
