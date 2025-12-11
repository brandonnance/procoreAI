// src/testSlideGeneration.ts
import * as fs from "fs-extra";
import * as path from "path";
import { MonthlyReportSpec } from "./buildReportSpec";
import { downloadImage } from "./imageDownloader";
import {
  composePhotoSlide,
  composeSummarySlide,
  composeLookaheadSlide,
  copyLastSlide,
  assembleSlidesPresentation,
  PptxSlideInput,
  LookaheadSlideData,
} from "./slideCompositor";
import { ProcoreImage } from "./procoreImages";
import { generateCaptions, CaptionInput } from "./aiClient";
import {
  getMostRecentLookahead,
  flattenLookaheadTasks,
} from "./procoreLookaheads";

async function main() {
  const specPath = process.argv[2];

  if (!specPath) {
    console.log("Usage: npm run test-slides -- <path-to-spec.json>");
    console.log("Example: npm run test-slides -- output/MyProject_2025-11_spec.json");
    process.exit(1);
  }

  // Load the report spec
  if (!(await fs.pathExists(specPath))) {
    console.error(`Spec file not found: ${specPath}`);
    process.exit(1);
  }

  const spec: MonthlyReportSpec = await fs.readJson(specPath);
  console.log(`\n=== Generating slides for ${spec.projectName} (${spec.month}) ===\n`);
  console.log(`Images to process: ${spec.images.length}`);

  if (!spec.images.length) {
    console.log("No images in spec. Nothing to do.");
    return;
  }

  // Create output directories
  const safeProjectName = spec.projectName.replace(/[^a-zA-Z0-9-_]/g, "_");
  const outputBaseDir = path.join(process.cwd(), "output", `${safeProjectName}_${spec.month}`);
  const rawImagesDir = path.join(outputBaseDir, "raw");
  const slidesDir = path.join(outputBaseDir, "slides");

  await fs.ensureDir(rawImagesDir);
  await fs.ensureDir(slidesDir);

  console.log(`Output directory: ${outputBaseDir}`);

  // Download images from Procore
  console.log("\n--- Downloading images from Procore ---");
  const downloadedImages: Map<number, string> = new Map();

  for (let i = 0; i < spec.images.length; i++) {
    const img = spec.images[i];
    const ext = img.filename?.split(".").pop() || "jpg";
    const filename = `${String(i + 1).padStart(2, "0")}_${img.id}.${ext}`;
    const localPath = path.join(rawImagesDir, filename);

    console.log(`  [${i + 1}/${spec.images.length}] Downloading image ${img.id}...`);

    // Create a minimal ProcoreImage object for the downloader
    const procoreImg: ProcoreImage = {
      id: img.id,
      project_id: spec.projectId,
      created_at: img.date,
      filename: filename,
    };

    const result = await downloadImage(spec.projectId, procoreImg, rawImagesDir);

    if (result.success) {
      downloadedImages.set(img.id, result.localPath);
      console.log(`    ✓ Saved: ${result.filename}`);
    } else {
      console.log(`    ✗ Failed: ${result.error}`);
    }

    // Small delay between downloads
    if (i < spec.images.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  console.log(`\nDownloaded ${downloadedImages.size} of ${spec.images.length} images.`);

  // Generate AI captions
  console.log("\n--- Generating AI captions ---");
  const captionInputs: CaptionInput[] = spec.images.map((img) => ({
    id: img.id,
    date: img.date,
    description: img.description,
    filename: img.filename,
  }));

  const aiCaptions = await generateCaptions(
    spec.projectName,
    spec.summaryBullets,
    spec.photoDays,
    captionInputs
  );

  // Build caption lookup map
  const captionMap = new Map<number, string>();
  for (const c of aiCaptions) {
    captionMap.set(c.id, c.caption);
  }
  console.log(`Generated ${aiCaptions.length} captions.`);

  // Track all slides for PowerPoint assembly (in order)
  const allSlides: PptxSlideInput[] = [];

  // 1. Create summary/activities slide
  console.log("\n--- Creating summary slide ---");
  const summarySlideFilename = "slide_00_summary.png";
  const summaryPath = path.join(slidesDir, summarySlideFilename);

  try {
    await composeSummarySlide(spec.summaryBullets, summaryPath);
    allSlides.push({
      imagePath: summaryPath,
      type: "summary",
      summaryBullets: spec.summaryBullets,
    });
    console.log(`  ✓ Created: ${summarySlideFilename}`);
  } catch (err: any) {
    console.log(`  ✗ Error creating summary slide: ${err.message}`);
  }

  // 2. Compose photo slides
  console.log("\n--- Composing photo slides ---");
  let slidesCreated = 0;

  for (let i = 0; i < spec.images.length; i++) {
    const img = spec.images[i];
    const photoPath = downloadedImages.get(img.id);

    if (!photoPath) {
      console.log(`  [${i + 1}] Skipping image ${img.id} (download failed)`);
      continue;
    }

    // Use AI-generated caption
    const caption = captionMap.get(img.id) || "Project Progress";

    const slideFilename = `slide_${String(i + 1).padStart(2, "0")}.png`;
    const slidePath = path.join(slidesDir, slideFilename);

    console.log(`  [${i + 1}/${spec.images.length}] Creating slide: ${slideFilename}`);
    console.log(`    Caption: "${caption}"`);

    try {
      await composePhotoSlide(photoPath, caption, slidePath);
      allSlides.push({
        imagePath: slidePath,
        type: "photo",
        caption: caption,
      });
      slidesCreated++;
      console.log(`    ✓ Done`);
    } catch (err: any) {
      console.log(`    ✗ Error: ${err.message}`);
    }
  }

  // 3. Add lookahead slide (if available)
  console.log("\n--- Fetching lookahead schedule ---");
  let lookaheadAdded = false;

  try {
    const lookahead = await getMostRecentLookahead(spec.projectId);

    if (lookahead) {
      console.log(`  Found lookahead: ${lookahead.label}`);
      const tasks = flattenLookaheadTasks(lookahead);
      console.log(`  Tasks: ${tasks.length}`);

      // Use photo overlay for lookahead slide (white bg + overlay)
      const lookaheadSlideFilename = `slide_${String(spec.images.length + 1).padStart(2, "0")}_lookahead.png`;
      const lookaheadPath = path.join(slidesDir, lookaheadSlideFilename);

      await composeLookaheadSlide(lookaheadPath);

      const lookaheadData: LookaheadSlideData = {
        label: lookahead.label,
        tasks: tasks,
      };

      allSlides.push({
        imagePath: lookaheadPath,
        type: "lookahead",
        lookaheadData: lookaheadData,
      });

      lookaheadAdded = true;
      console.log(`  ✓ Created: ${lookaheadSlideFilename}`);
    } else {
      console.log("  No lookahead found for this project.");
    }
  } catch (err: any) {
    console.log(`  ✗ Error fetching lookahead: ${err.message}`);
  }

  // 4. Add last slide
  console.log("\n--- Adding closing slide ---");
  const closingSlideNum = spec.images.length + (lookaheadAdded ? 2 : 1);
  const lastSlideFilename = `slide_${String(closingSlideNum).padStart(2, "0")}_closing.png`;
  const lastSlidePath = path.join(slidesDir, lastSlideFilename);

  try {
    await copyLastSlide(lastSlidePath);
    allSlides.push({
      imagePath: lastSlidePath,
      type: "closing",
    });
    console.log(`  ✓ Created: ${lastSlideFilename}`);
  } catch (err: any) {
    console.log(`  ✗ Error copying last slide: ${err.message}`);
  }

  // 5. Assemble PowerPoint
  console.log("\n--- Assembling PowerPoint ---");
  const pptxFilename = `${safeProjectName}_${spec.month}_report.pptx`;
  const pptxPath = path.join(outputBaseDir, pptxFilename);

  if (allSlides.length > 0) {
    try {
      await assembleSlidesPresentation(allSlides, pptxPath);
      console.log(`  ✓ PowerPoint created: ${pptxFilename}`);
    } catch (err: any) {
      console.log(`  ✗ Error creating PowerPoint: ${err.message}`);
    }
  }

  console.log(`\n=== Complete ===`);
  console.log(`Summary slide: 1`);
  console.log(`Photo slides: ${slidesCreated}`);
  console.log(`Lookahead slide: ${lookaheadAdded ? 1 : 0}`);
  console.log(`Closing slide: 1`);
  console.log(`Total slides: ${allSlides.length}`);
  console.log(`\nOutput folder: ${slidesDir}`);
  console.log(`PowerPoint: ${pptxPath}`);
}

main().catch((err) => {
  console.error("Error:", err.message || err);
  process.exit(1);
});
