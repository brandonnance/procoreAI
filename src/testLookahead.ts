// src/testLookahead.ts
import { getLookaheadList, getLookaheadDetail } from "./procoreLookaheads";

async function main() {
  const projectId = Number(process.argv[2]);

  if (!projectId) {
    console.log("Usage: npm run test-lookahead -- <projectId>");
    process.exit(1);
  }

  console.log(`\n=== Fetching lookaheads for project ${projectId} ===\n`);

  // 1. Get list of all lookaheads
  const list = await getLookaheadList(projectId);
  console.log(`Found ${list.length} lookaheads:\n`);

  if (!list.length) {
    console.log("No lookaheads found.");
    return;
  }

  // Print the list
  console.log("--- Lookahead List ---");
  console.log(JSON.stringify(list, null, 2));

  // 2. Sort by end_date to find most recent
  const sorted = [...list].sort((a, b) => {
    return new Date(b.end_date).getTime() - new Date(a.end_date).getTime();
  });

  const mostRecent = sorted[0];
  console.log(`\n--- Most Recent Lookahead ---`);
  console.log(`ID: ${mostRecent.id}`);
  console.log(`Start: ${mostRecent.start_date}`);
  console.log(`End: ${mostRecent.end_date}`);

  // 3. Get full details
  console.log(`\n--- Full Lookahead Detail (ID: ${mostRecent.id}) ---\n`);
  const detail = await getLookaheadDetail(projectId, mostRecent.id);

  if (detail) {
    console.log(JSON.stringify(detail, null, 2));
  } else {
    console.log("Failed to fetch detail.");
  }
}

main().catch((err) => {
  console.error("Error:", err.message || err);
  process.exit(1);
});
