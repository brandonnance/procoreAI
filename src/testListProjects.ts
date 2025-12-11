import { listProjects } from "./procoreApi";

async function main() {
  console.log("Fetching projects...");

  const projects = await listProjects();

  console.log(`\nTotal projects returned: ${projects.length}\n`);

  // Dump the first few full objects so we can inspect structure
  const sampleCount = Math.min(3, projects.length);

  console.log(
    `=== Showing first ${sampleCount} raw project JSON objects ===\n`
  );

  for (let i = 0; i < sampleCount; i++) {
    console.log(`---- Project ${i + 1} ----`);
    console.log(JSON.stringify(projects[i], null, 2));
    console.log("\n");
  }

  // Show available keys for the first project (easier to spot field names)
  if (projects.length > 0) {
    console.log("=== Keys on first project object ===");
    console.log(Object.keys(projects[0]));
    console.log("\n");
  }

  console.log(
    "If you want me to identify which key represents 'Active' status, paste this output into ChatGPT."
  );
}

main().catch((err) => {
  console.error("Error:", err.response?.data || err.message);
});
