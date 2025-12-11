import {
  getDailyNotesForMonth,
  getNoteText,
  getNoteAuthor,
} from "./procoreDailyLogs";

async function main() {
  const projectId = Number(process.argv[2]);
  const month = process.argv[3] || "2025-12";

  if (!projectId) {
    console.log("Usage: npm run test-notes -- <projectId> [YYYY-MM]");
    process.exit(1);
  }

  console.log(`Fetching notes for project ${projectId} in ${month}...`);

  const notes = await getDailyNotesForMonth(projectId, month);

  if (!notes.length) {
    console.log("\nNo notes found (empty array).");
    return;
  }

  console.log(`\nFound ${notes.length} notes:\n`);

  // Debug: show first full note once
  console.log("First note object:\n", JSON.stringify(notes[0], null, 2), "\n");

  notes.forEach((n) => {
    const date = n.date || n.datetime || n.created_at;
    const author = getNoteAuthor(n);
    const text = getNoteText(n);
    console.log(`• ${date} (${author}): ${text.slice(0, 80)}...`);
  });
}

main().catch((err: any) => {
  console.error("Error fetching notes:", err.response?.data || err.message);
});
