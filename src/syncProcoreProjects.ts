// src/syncProcoreProjects.ts
// One-time script to sync Procore project IDs to Supabase jobs table

import { listProjects } from "./procoreApi";
import { supabase } from "./supabaseClient";

async function main() {
  console.log("Fetching Procore projects...");
  const projects = await listProjects();
  console.log(`Found ${projects.length} Procore projects\n`);

  console.log("Fetching Supabase jobs...");
  const { data: jobs, error } = await supabase
    .from("jobs")
    .select("id, job_number, name, procore_project_id");

  if (error) {
    console.error("Error fetching jobs:", error.message);
    process.exit(1);
  }

  console.log(`Found ${jobs.length} jobs in Supabase\n`);

  // Build a map of project_number -> procore id
  const projectMap = new Map<string, number>();
  for (const project of projects) {
    if (project.project_number) {
      projectMap.set(project.project_number, project.id);
    }
  }

  let matched = 0;
  let skipped = 0;
  let updated = 0;

  for (const job of jobs) {
    if (!job.job_number) {
      skipped++;
      continue;
    }

    const procoreId = projectMap.get(job.job_number);

    if (!procoreId) {
      console.log(`No match: job_number="${job.job_number}" (${job.name})`);
      skipped++;
      continue;
    }

    matched++;

    // Skip if already set to same value
    if (job.procore_project_id === String(procoreId)) {
      console.log(`Already set: ${job.job_number} -> ${procoreId}`);
      continue;
    }

    // Update the job
    const { error: updateError } = await supabase
      .from("jobs")
      .update({ procore_project_id: String(procoreId) })
      .eq("id", job.id);

    if (updateError) {
      console.error(`Error updating job ${job.id}:`, updateError.message);
    } else {
      console.log(`Updated: ${job.job_number} (${job.name}) -> procore_project_id=${procoreId}`);
      updated++;
    }
  }

  console.log("\n=== Summary ===");
  console.log(`Total jobs: ${jobs.length}`);
  console.log(`Matched: ${matched}`);
  console.log(`Updated: ${updated}`);
  console.log(`Skipped (no match or no job_number): ${skipped}`);
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
