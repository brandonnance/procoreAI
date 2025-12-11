import {
  getImagesForMonth,
  groupImagesByDate,
  getImageDate,
} from "./procoreImages";

async function main() {
  const projectId = Number(process.argv[2]);
  const month = process.argv[3] || "2025-11";

  if (!projectId) {
    console.log("Usage: npm run test-images-by-date -- <projectId> [YYYY-MM]");
    process.exit(1);
  }

  console.log(`Fetching images for project ${projectId} in ${month}...`);

  const images = await getImagesForMonth(projectId, month);
  console.log(`Total images: ${images.length}`);

  const byDate = groupImagesByDate(images);

  console.log("\nImages per date:");
  const sortedDates = Array.from(byDate.keys()).sort();
  for (const date of sortedDates) {
    const imgs = byDate.get(date)!;
    console.log(`- ${date}: ${imgs.length} images`);
  }

  // Show a tiny sample with date normalization
  if (images.length > 0) {
    console.log("\nSample with normalized dates:");
    images.slice(0, 5).forEach((img) => {
      console.log(
        `id: ${img.id}, created_at: ${img.created_at}, date: ${getImageDate(
          img
        )}`
      );
    });
  }
}

main().catch((err: any) => {
  console.error(
    "Error in test-images-by-date:",
    err.response?.data || err.message
  );
  process.exit(1);
});
