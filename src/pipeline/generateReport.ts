// src/pipeline/generateReport.ts
import * as fs from "fs-extra";
import * as path from "path";
import { getDailyNotesForMonth } from "../procoreDailyLogs";
import { getImagesForMonth, ProcoreImage } from "../procoreImages";
import {
  summarizeDailyNotesWithPhotoDays,
  NotesSummaryResult,
  selectImagesFromMetadata,
  generateCaptions,
  CaptionInput,
} from "../aiClient";
import {
  selectCandidateImagesForMonth,
  PhotoDaySuggestion,
} from "../imageCandidateSelection";
import { buildReportSpec, MonthlyReportSpec } from "../buildReportSpec";
import { downloadImage } from "../imageDownloader";
import {
  composePhotoSlide,
  composeSummarySlide,
  composeLookaheadSlide,
  copyLastSlide,
  assembleSlidesPresentation,
  PptxSlideInput,
  LookaheadSlideData,
} from "../slideCompositor";
import {
  getMostRecentLookahead,
  flattenLookaheadTasks,
} from "../procoreLookaheads";
import {
  validateReportData,
  ValidationError,
  ValidationResult,
} from "../reportValidation";

export interface ReportGenerationResult {
  success: boolean;
  pptxPath?: string;
  pptxFilename?: string;
  notesCount: number;
  photosCount: number;
  error?: string;
}

export interface ReportGenerationOptions {
  outputDir?: string;
  maxWords?: number;
  maxPhotoDays?: number;
  maxCandidates?: number;
  maxSelectedImages?: number;
  onProgress?: (stage: string, message: string) => void;
}

const DEFAULT_OPTIONS: Required<Omit<ReportGenerationOptions, "onProgress" | "outputDir">> = {
  maxWords: 250,
  maxPhotoDays: 6,
  maxCandidates: 60,
  maxSelectedImages: 20,
};

/**
 * Generate a complete monthly report PowerPoint from scratch.
 * This is the main pipeline function that orchestrates the entire report generation.
 *
 * @param projectId - Procore project ID
 * @param projectName - Human-readable project name
 * @param month - Report month in "YYYY-MM" format
 * @param options - Optional configuration
 * @returns Result with path to generated PowerPoint and statistics
 */
export async function generateReport(
  projectId: number,
  projectName: string,
  month: string,
  options?: ReportGenerationOptions
): Promise<ReportGenerationResult> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const log = opts.onProgress || (() => {});

  // Setup output directories
  const safeProjectName = projectName.replace(/[^a-zA-Z0-9-_]/g, "_");
  const baseOutputDir = opts.outputDir || path.join(process.cwd(), "output");
  const outputDir = path.join(baseOutputDir, `${safeProjectName}_${month}`);
  const rawImagesDir = path.join(outputDir, "raw");
  const slidesDir = path.join(outputDir, "slides");

  await fs.ensureDir(rawImagesDir);
  await fs.ensureDir(slidesDir);

  try {
    // Step 1: Fetch daily log notes
    log("notes", "Fetching daily log notes...");
    const notes = await getDailyNotesForMonth(projectId, month);
    log("notes", `Found ${notes.length} notes`);

    // Step 2: Fetch images for the month
    log("images", "Fetching images...");
    const images = await getImagesForMonth(projectId, month);
    log("images", `Found ${images.length} images`);

    // Step 3: Validate data meets minimum thresholds
    log("validation", "Validating report data...");
    const validation: ValidationResult = validateReportData(notes, images);
    if (!validation.valid && validation.error) {
      throw new ValidationError(validation.error);
    }

    // Step 4: AI summarization + photo day suggestions
    log("summary", "Generating AI summary...");
    const summary: NotesSummaryResult = await summarizeDailyNotesWithPhotoDays(
      projectName,
      month,
      notes,
      opts.maxWords,
      opts.maxPhotoDays
    );
    log("summary", `Generated ${summary.summaryBullets.length} bullets, ${summary.photoDays?.length || 0} photo days`);

    // Step 5: Image candidate selection
    log("candidates", "Selecting candidate images...");
    const photoDays: PhotoDaySuggestion[] = (summary.photoDays || []) as PhotoDaySuggestion[];
    const candidates = selectCandidateImagesForMonth(images, photoDays, {
      maxCandidates: opts.maxCandidates,
      minCandidates: 20,
    });
    log("candidates", `Selected ${candidates.length} candidates`);

    // Step 6: AI final image selection
    log("selection", "AI selecting final images...");
    const selectedIds = await selectImagesFromMetadata(summary, candidates, opts.maxSelectedImages);
    log("selection", `AI selected ${selectedIds.length} images`);

    // Step 7: Build report spec
    log("spec", "Building report spec...");
    const reportSpec: MonthlyReportSpec = buildReportSpec(
      projectId,
      projectName,
      month,
      summary.summaryBullets,
      photoDays,
      images,
      selectedIds
    );

    // Step 8: Download images from Procore
    log("download", "Downloading images from Procore...");
    const downloadedImages: Map<number, string> = new Map();

    for (let i = 0; i < reportSpec.images.length; i++) {
      const img = reportSpec.images[i];
      const ext = img.filename?.split(".").pop() || "jpg";
      const filename = `${String(i + 1).padStart(2, "0")}_${img.id}.${ext}`;

      const procoreImg: ProcoreImage = {
        id: img.id,
        project_id: projectId,
        created_at: img.date,
        filename: filename,
      };

      const result = await downloadImage(projectId, procoreImg, rawImagesDir);
      if (result.success) {
        downloadedImages.set(img.id, result.localPath);
      }

      // Small delay between downloads
      if (i < reportSpec.images.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    log("download", `Downloaded ${downloadedImages.size} of ${reportSpec.images.length} images`);

    // Step 9: Generate AI captions
    log("captions", "Generating AI captions...");
    const captionInputs: CaptionInput[] = reportSpec.images.map((img) => ({
      id: img.id,
      date: img.date,
      description: img.description,
      filename: img.filename,
    }));

    const aiCaptions = await generateCaptions(
      projectName,
      reportSpec.summaryBullets,
      reportSpec.photoDays,
      captionInputs
    );

    const captionMap = new Map<number, string>();
    for (const c of aiCaptions) {
      captionMap.set(c.id, c.caption);
    }
    log("captions", `Generated ${aiCaptions.length} captions`);

    // Step 10: Create slides
    log("slides", "Creating slides...");
    const allSlides: PptxSlideInput[] = [];

    // Summary slide
    const summaryPath = path.join(slidesDir, "slide_00_summary.png");
    await composeSummarySlide(reportSpec.summaryBullets, summaryPath);
    allSlides.push({
      imagePath: summaryPath,
      type: "summary",
      summaryBullets: reportSpec.summaryBullets,
    });

    // Photo slides
    for (let i = 0; i < reportSpec.images.length; i++) {
      const img = reportSpec.images[i];
      const photoPath = downloadedImages.get(img.id);

      if (!photoPath) continue;

      const caption = captionMap.get(img.id) || "Project Progress";
      const slideFilename = `slide_${String(i + 1).padStart(2, "0")}.png`;
      const slidePath = path.join(slidesDir, slideFilename);

      await composePhotoSlide(photoPath, caption, slidePath);
      allSlides.push({
        imagePath: slidePath,
        type: "photo",
        caption: caption,
      });
    }

    // Lookahead slide (always created, with placeholder if no data)
    log("lookahead", "Creating lookahead slide...");
    const lookaheadPath = path.join(
      slidesDir,
      `slide_${String(reportSpec.images.length + 1).padStart(2, "0")}_lookahead.png`
    );

    await composeLookaheadSlide(lookaheadPath);

    let lookaheadData: LookaheadSlideData;
    try {
      const lookahead = await getMostRecentLookahead(projectId);
      if (lookahead) {
        const tasks = flattenLookaheadTasks(lookahead);
        lookaheadData = {
          label: lookahead.label,
          tasks: tasks,
        };
        log("lookahead", `Found lookahead with ${tasks.length} tasks`);
      } else {
        lookaheadData = {
          label: "3-Week Lookahead",
          tasks: [],
          placeholderMessage:
            "No valid lookahead exists. Create one and place it here, or delete this slide.",
        };
        log("lookahead", "No lookahead found - using placeholder");
      }
    } catch {
      lookaheadData = {
        label: "3-Week Lookahead",
        tasks: [],
        placeholderMessage:
          "No valid lookahead exists. Create one and place it here, or delete this slide.",
      };
      log("lookahead", "Error fetching lookahead - using placeholder");
    }

    allSlides.push({
      imagePath: lookaheadPath,
      type: "lookahead",
      lookaheadData: lookaheadData,
    });

    // Closing slide
    const closingPath = path.join(
      slidesDir,
      `slide_${String(reportSpec.images.length + 2).padStart(2, "0")}_closing.png`
    );
    await copyLastSlide(closingPath);
    allSlides.push({
      imagePath: closingPath,
      type: "closing",
    });

    // Step 11: Assemble PowerPoint
    log("pptx", "Assembling PowerPoint...");
    const pptxFilename = `${safeProjectName}_${month}_report.pptx`;
    const pptxPath = path.join(outputDir, pptxFilename);

    await assembleSlidesPresentation(allSlides, pptxPath);
    log("pptx", `Created: ${pptxFilename}`);

    return {
      success: true,
      pptxPath,
      pptxFilename,
      notesCount: validation.notesCount,
      photosCount: validation.photosCount,
    };
  } catch (error: any) {
    const isValidationError = error instanceof ValidationError;
    return {
      success: false,
      notesCount: 0,
      photosCount: 0,
      error: isValidationError
        ? error.message
        : `Report generation failed: ${error.message || String(error)}`,
    };
  }
}
