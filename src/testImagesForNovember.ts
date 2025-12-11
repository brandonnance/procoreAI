import { listProjects } from "./procoreApi";
import { getImagesForMonth } from "./procoreImages";

async function main() {
  const month = process.argv[2] || "2025-11";

  console.log(`Fetching projects for company...`);

  const projects = await listProjects();

  console.log(`Total projects returned: ${projects.length}\n`);

  // 👇 Debug: show first 5 projects and their "active" flag
  const sampleCount = Math.min(5, projects.length);
  console.log(`=== First ${sampleCount} projects & their "active" flag ===`);
  projects.slice(0, sampleCount).forEach((p, i) => {
    console.log(
      `${i + 1}. [${p.id}] ${p.project_number} — ${p.name} | active: ${
        (p as any).active
      }`
    );
  });
  console.log(""); // blank line

  // 👇 Filter using the actual "active" property from JSON
  const activeProjects = projects.filter((p) => (p as any).active === true);

  console.log(`Active projects (active === true): ${activeProjects.length}\n`);

  let grandTotal = 0;

  for (const project of activeProjects) {
    const projectId = project.id;
    const projectName = project.name;
    const projectNumber = project.project_number;

    console.log(
      `---- Project [${projectId}] ${projectNumber} — ${projectName} ----`
    );
    console.log(`Fetching images for ${month}...`);

    try {
      const images = await getImagesForMonth(projectId, month);
      const count = images.length;
      grandTotal += count;

      console.log(`Found ${count} images for ${month}.`);

      if (count > 0) {
        const sample = images.slice(0, 3);
        console.log(
          "Sample images:",
          sample.map((img) => ({
            id: img.id,
            width: img.width,
            height: img.height,
            size: img.size,
            log_date: img.log_date,
            created_at: img.created_at,
          }))
        );
      }

      console.log();
    } catch (err: any) {
      console.error(
        `Error fetching images for project ${projectId}:`,
        err.response?.data || err.message
      );
      console.log();
    }
  }

  console.log(
    `==== SUMMARY: Total images across all Active projects in ${month}: ${grandTotal} ====`
  );
}

main().catch((err: any) => {
  console.error("Unexpected error:", err.response?.data || err.message);
  process.exit(1);
});
