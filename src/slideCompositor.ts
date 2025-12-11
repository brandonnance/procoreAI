// src/slideCompositor.ts
import sharp from "sharp";
import * as path from "path";
import * as fs from "fs-extra";
import { PDFDocument } from "pdf-lib";
import PptxGenJS from "pptxgenjs";

// Slide dimensions
const SLIDE_WIDTH = 1320;
const SLIDE_HEIGHT = 1020;
const CAPTION_BAR_HEIGHT = 87;
const PHOTO_AREA_HEIGHT = SLIDE_HEIGHT - CAPTION_BAR_HEIGHT; // 933

// Overlay path (relative to project root)
const OVERLAY_PATH = path.join(
  process.cwd(),
  "report_images",
  "picture_overlay.png"
);

// Caption styling
const CAPTION_FONT_SIZE = 32;
const CAPTION_FONT_FAMILY = "Calibri, Arial, sans-serif";

/**
 * Create an SVG text element for the caption.
 * Centered horizontally, vertically centered in the caption bar area.
 */
function createCaptionSvg(caption: string): Buffer {
  // Escape special XML characters
  const escapedCaption = caption
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

  // Position text in the center of the caption bar
  // Caption bar starts at y = PHOTO_AREA_HEIGHT (933) and is 87px tall
  // Center of bar = 933 + (87/2) = 976.5
  const textY = PHOTO_AREA_HEIGHT + CAPTION_BAR_HEIGHT / 2;

  const svg = `
    <svg width="${SLIDE_WIDTH}" height="${SLIDE_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <text
        x="${SLIDE_WIDTH / 2}"
        y="${textY}"
        font-family="${CAPTION_FONT_FAMILY}"
        font-size="${CAPTION_FONT_SIZE}"
        fill="white"
        text-anchor="middle"
        dominant-baseline="middle"
      >${escapedCaption}</text>
    </svg>
  `;

  return Buffer.from(svg);
}

export interface SlideCompositorOptions {
  overlayPath?: string;
}

/**
 * Compose a photo slide with overlay and caption.
 *
 * @param photoPath - Path to the source photo
 * @param caption - Caption text to display on the bar
 * @param outputPath - Where to save the final slide
 * @param options - Optional configuration
 */
export async function composePhotoSlide(
  photoPath: string,
  caption: string,
  outputPath: string,
  options?: SlideCompositorOptions
): Promise<void> {
  const overlayPath = options?.overlayPath || OVERLAY_PATH;

  // Ensure overlay exists
  if (!(await fs.pathExists(overlayPath))) {
    throw new Error(`Overlay not found: ${overlayPath}`);
  }

  // 1. Load and resize the photo to fit the photo area (1320 x 933)
  //    Use "cover" to fill the area, cropping if needed
  const resizedPhoto = await sharp(photoPath)
    .resize(SLIDE_WIDTH, PHOTO_AREA_HEIGHT, {
      fit: "cover",
      position: "center",
    })
    .toBuffer();

  // 2. Create the base slide canvas (1320 x 1020) with the photo at top
  //    The bottom 87px will be filled by the overlay
  const baseSlide = await sharp({
    create: {
      width: SLIDE_WIDTH,
      height: SLIDE_HEIGHT,
      channels: 3,
      background: { r: 128, g: 128, b: 128 }, // Gray background (will be covered)
    },
  })
    .composite([
      {
        input: resizedPhoto,
        top: 0,
        left: 0,
      },
    ])
    .png()
    .toBuffer();

  // 3. Load the overlay
  const overlay = await sharp(overlayPath).toBuffer();

  // 4. Composite: base -> overlay (caption added as editable text in PowerPoint)
  await sharp(baseSlide)
    .composite([
      {
        input: overlay,
        top: 0,
        left: 0,
      },
    ])
    .png()
    .toFile(outputPath);
}

/**
 * Compose multiple photo slides.
 */
export async function composePhotoSlides(
  slides: Array<{ photoPath: string; caption: string; outputPath: string }>,
  options?: SlideCompositorOptions,
  onProgress?: (completed: number, total: number) => void
): Promise<void> {
  for (let i = 0; i < slides.length; i++) {
    const slide = slides[i];
    await composePhotoSlide(
      slide.photoPath,
      slide.caption,
      slide.outputPath,
      options
    );

    if (onProgress) {
      onProgress(i + 1, slides.length);
    }
  }
}

// Activities/Summary slide paths and styling
const ACTIVITIES_BG_PATH = path.join(
  process.cwd(),
  "report_images",
  "activities.png"
);
const LAST_SLIDE_PATH = path.join(
  process.cwd(),
  "report_images",
  "last_slide.png"
);
const SUMMARY_FONT_SIZE = 18;
const SUMMARY_FONT_FAMILY = "'Segoe UI', Arial, sans-serif";
const SUMMARY_TEXT_COLOR = "#333333";

// Text area positioning (avoid logo in top right)
const SUMMARY_TEXT_LEFT = 60;
const SUMMARY_TEXT_TOP = 150;
const SUMMARY_TEXT_WIDTH = 1100;
const SUMMARY_LINE_HEIGHT = 1.6;

/**
 * Wrap text to fit within a max width (approximate character count).
 * Returns array of lines.
 */
function wrapText(text: string, maxCharsPerLine: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let currentLine = "";

  for (const word of words) {
    if (currentLine.length + word.length + 1 <= maxCharsPerLine) {
      currentLine += (currentLine ? " " : "") + word;
    } else {
      if (currentLine) lines.push(currentLine);
      currentLine = word;
    }
  }
  if (currentLine) lines.push(currentLine);

  return lines;
}

/**
 * Create SVG with summary bullets text using native SVG text elements.
 */
function createSummarySvg(bullets: string[]): Buffer {
  // Approximate characters per line based on font size and width
  const charsPerLine = Math.floor(
    SUMMARY_TEXT_WIDTH / (SUMMARY_FONT_SIZE * 0.5)
  );
  const lineHeightPx = SUMMARY_FONT_SIZE * SUMMARY_LINE_HEIGHT;

  // Build text elements for each bullet
  const textElements: string[] = [];
  let currentY = SUMMARY_TEXT_TOP;

  for (const bullet of bullets) {
    // Escape special XML characters
    const escaped = bullet
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

    // Wrap the bullet text
    const lines = wrapText(escaped, charsPerLine);

    for (const line of lines) {
      textElements.push(
        `<text x="${SUMMARY_TEXT_LEFT}" y="${currentY}" font-family="${SUMMARY_FONT_FAMILY}" font-size="${SUMMARY_FONT_SIZE}" fill="${SUMMARY_TEXT_COLOR}">${line}</text>`
      );
      currentY += lineHeightPx;
    }

    // Add extra spacing between bullets
    currentY += lineHeightPx * 0.3;
  }

  const svg = `
    <svg width="${SLIDE_WIDTH}" height="${SLIDE_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      ${textElements.join("\n      ")}
    </svg>
  `;

  return Buffer.from(svg);
}

/**
 * Compose the activities/summary slide.
 *
 * @param summaryBullets - Array of summary bullet strings
 * @param outputPath - Where to save the slide
 */
export async function composeSummarySlide(
  summaryBullets: string[],
  outputPath: string
): Promise<void> {
  // Ensure background exists
  if (!(await fs.pathExists(ACTIVITIES_BG_PATH))) {
    throw new Error(`Activities background not found: ${ACTIVITIES_BG_PATH}`);
  }

  // Just copy the background (summary text added as editable text in PowerPoint)
  await fs.copy(ACTIVITIES_BG_PATH, outputPath);
}

/**
 * Compose a lookahead slide background (white background + overlay).
 *
 * @param outputPath - Where to save the slide
 */
export async function composeLookaheadSlide(outputPath: string): Promise<void> {
  const overlayPath = OVERLAY_PATH;

  // Ensure overlay exists
  if (!(await fs.pathExists(overlayPath))) {
    throw new Error(`Overlay not found: ${overlayPath}`);
  }

  // Create white background
  const baseSlide = await sharp({
    create: {
      width: SLIDE_WIDTH,
      height: SLIDE_HEIGHT,
      channels: 3,
      background: { r: 255, g: 255, b: 255 }, // White background
    },
  })
    .png()
    .toBuffer();

  // Load the overlay
  const overlay = await sharp(overlayPath).toBuffer();

  // Composite: white background + overlay
  await sharp(baseSlide)
    .composite([
      {
        input: overlay,
        top: 0,
        left: 0,
      },
    ])
    .png()
    .toFile(outputPath);
}

/**
 * Copy the last slide to output.
 *
 * @param outputPath - Where to save the slide
 */
export async function copyLastSlide(outputPath: string): Promise<void> {
  if (!(await fs.pathExists(LAST_SLIDE_PATH))) {
    throw new Error(`Last slide not found: ${LAST_SLIDE_PATH}`);
  }

  await fs.copy(LAST_SLIDE_PATH, outputPath);
}

/**
 * Assemble multiple PNG slides into a single PDF.
 *
 * @param imagePaths - Array of paths to PNG images (in order)
 * @param outputPath - Where to save the PDF
 */
export async function assembleSlidesPdf(
  imagePaths: string[],
  outputPath: string
): Promise<void> {
  const pdfDoc = await PDFDocument.create();

  for (const imagePath of imagePaths) {
    // Read the PNG file
    const imageBytes = await fs.readFile(imagePath);

    // Embed the PNG in the PDF
    const pngImage = await pdfDoc.embedPng(imageBytes);

    // Get image dimensions
    const { width, height } = pngImage.scale(1);

    // Add a page with the same dimensions as the image
    const page = pdfDoc.addPage([width, height]);

    // Draw the image to fill the page
    page.drawImage(pngImage, {
      x: 0,
      y: 0,
      width: width,
      height: height,
    });
  }

  // Save the PDF
  const pdfBytes = await pdfDoc.save();
  await fs.writeFile(outputPath, pdfBytes);
}

// PowerPoint constants (convert pixels to inches at 72 PPI)
const PPI = 72;
const SLIDE_WIDTH_INCHES = SLIDE_WIDTH / PPI; // 18.33"
const SLIDE_HEIGHT_INCHES = SLIDE_HEIGHT / PPI; // 14.17"
const CAPTION_BAR_HEIGHT_INCHES = CAPTION_BAR_HEIGHT / PPI; // 1.21"
const CAPTION_BAR_TOP_INCHES = (SLIDE_HEIGHT - CAPTION_BAR_HEIGHT) / PPI; // 12.96"

// Lookahead task for slide display
export interface LookaheadSlideTask {
  name: string;
  start: string;
  finish: string;
  isSubtask: boolean;
}

export interface LookaheadSlideData {
  label: string; // Header like "08/27/21 - 09/16/21 | 3 Weeks"
  tasks: LookaheadSlideTask[];
}

export interface PptxSlideInput {
  imagePath: string;
  caption?: string; // If provided, adds editable text box
  type: "photo" | "summary" | "closing" | "lookahead";
  summaryBullets?: string[]; // For summary slides
  lookaheadData?: LookaheadSlideData; // For lookahead slides
}

/**
 * Assemble multiple slides into a PowerPoint presentation.
 * Photo slides have editable caption text boxes.
 * Summary slides have editable bullet text boxes.
 *
 * @param slides - Array of slide inputs
 * @param outputPath - Where to save the .pptx file
 */
export async function assembleSlidesPresentation(
  slides: PptxSlideInput[],
  outputPath: string
): Promise<void> {
  const pptx = new PptxGenJS();

  // Set slide size to match our dimensions
  pptx.defineLayout({
    name: "CUSTOM",
    width: SLIDE_WIDTH_INCHES,
    height: SLIDE_HEIGHT_INCHES,
  });
  pptx.layout = "CUSTOM";

  for (const slideInput of slides) {
    const slide = pptx.addSlide();

    // Read image and convert to base64 for embedding
    const imageData = await fs.readFile(slideInput.imagePath);
    const base64Image = imageData.toString("base64");
    const ext = path.extname(slideInput.imagePath).toLowerCase().slice(1);
    const mimeType = ext === "png" ? "png" : "jpeg";

    // Add image as background (covers full slide)
    slide.addImage({
      data: `image/${mimeType};base64,${base64Image}`,
      x: 0,
      y: 0,
      w: SLIDE_WIDTH_INCHES,
      h: SLIDE_HEIGHT_INCHES,
    });

    // Add editable text based on slide type
    if (slideInput.type === "photo" && slideInput.caption) {
      // Add editable caption text box over the caption bar
      slide.addText(slideInput.caption, {
        x: 0,
        y: CAPTION_BAR_TOP_INCHES,
        w: SLIDE_WIDTH_INCHES,
        h: CAPTION_BAR_HEIGHT_INCHES,
        align: "center",
        valign: "middle",
        fontSize: CAPTION_FONT_SIZE * 1.25, // Convert px to pt (approximate)
        fontFace: "Calibri",
        color: "FFFFFF",
        bold: false,
      });
    } else if (slideInput.type === "summary" && slideInput.summaryBullets) {
      // Add editable summary text box
      const summaryText = slideInput.summaryBullets.join("\n\n");
      slide.addText(summaryText, {
        x: SUMMARY_TEXT_LEFT / PPI,
        y: SUMMARY_TEXT_TOP / PPI,
        w: SUMMARY_TEXT_WIDTH / PPI,
        h: (SLIDE_HEIGHT - SUMMARY_TEXT_TOP - 50) / PPI, // Leave some margin at bottom
        fontSize: SUMMARY_FONT_SIZE * 1.25,
        fontFace: "Segoe UI",
        color: "000000", // Black
        valign: "top",
        align: "left",
      });
    } else if (slideInput.type === "lookahead" && slideInput.lookaheadData) {
      const { label, tasks } = slideInput.lookaheadData;

      // Caption bar with the label (same style as photo captions)
      slide.addText(label, {
        x: 0,
        y: CAPTION_BAR_TOP_INCHES,
        w: SLIDE_WIDTH_INCHES,
        h: CAPTION_BAR_HEIGHT_INCHES,
        align: "center",
        valign: "middle",
        fontSize: CAPTION_FONT_SIZE * 1.25,
        fontFace: "Calibri",
        color: "FFFFFF",
        bold: false,
      });

      // Build task rows in the main area
      const taskFontSize = 16;
      const subtaskFontSize = 14;
      const lineHeight = 32;
      let yPos = 80;

      for (const task of tasks) {
        const fontSize = task.isSubtask ? subtaskFontSize : taskFontSize;
        const indent = task.isSubtask ? 40 : 0;
        const prefix = task.isSubtask ? "  - " : "• ";
        const dateRange = task.start && task.finish
          ? `${task.start} - ${task.finish}`
          : task.start || task.finish || "";

        // Task name (left aligned)
        slide.addText(`${prefix}${task.name}`, {
          x: (SUMMARY_TEXT_LEFT + indent) / PPI,
          y: yPos / PPI,
          w: 800 / PPI,
          h: lineHeight / PPI,
          fontSize: fontSize,
          fontFace: "Segoe UI",
          color: task.isSubtask ? "444444" : "000000",
          bold: !task.isSubtask,
          valign: "middle",
        });

        // Date range (right aligned)
        if (dateRange) {
          slide.addText(dateRange, {
            x: 900 / PPI,
            y: yPos / PPI,
            w: 300 / PPI,
            h: lineHeight / PPI,
            fontSize: fontSize,
            fontFace: "Segoe UI",
            color: "666666",
            align: "right",
            valign: "middle",
          });
        }

        yPos += lineHeight;

        // Stop before caption bar area
        if (yPos > PHOTO_AREA_HEIGHT - 50) break;
      }
    }
    // Closing slides just use the image, no editable text needed
  }

  // Save the presentation
  await pptx.writeFile({ fileName: outputPath });
}
