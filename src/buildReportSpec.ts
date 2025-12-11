// src/buildReportSpec.ts
import { ProcoreImage, getImageDate, filterImagesByIds } from "./procoreImages";
import { PhotoDaySuggestion } from "./imageCandidateSelection";

export interface ReportImageSpec {
  id: number;
  date: string;
  description?: string;
  filename?: string;
}

export interface MonthlyReportSpec {
  projectId: number;
  projectName: string;
  month: string;
  summaryBullets: string[];
  photoDays: PhotoDaySuggestion[];
  images: ReportImageSpec[];
}

/**
 * Build a MonthlyReportSpec from the pipeline outputs.
 *
 * @param projectId - Procore project ID
 * @param projectName - Human-readable project name
 * @param month - Report month in "YYYY-MM" format
 * @param summaryBullets - AI-generated summary bullets
 * @param photoDays - AI-suggested photo days
 * @param allImages - All images fetched for the month (used to resolve IDs)
 * @param selectedIds - Final selected image IDs from AI
 */
export function buildReportSpec(
  projectId: number,
  projectName: string,
  month: string,
  summaryBullets: string[],
  photoDays: PhotoDaySuggestion[],
  allImages: ProcoreImage[],
  selectedIds: number[]
): MonthlyReportSpec {
  const selectedImages = filterImagesByIds(allImages, selectedIds);

  const images: ReportImageSpec[] = selectedImages.map((img) => ({
    id: img.id,
    date: getImageDate(img) || img.created_at.slice(0, 10),
    description: img.description,
    filename: img.filename,
  }));

  return {
    projectId,
    projectName,
    month,
    summaryBullets,
    photoDays,
    images,
  };
}
