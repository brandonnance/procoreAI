// src/reportValidation.ts
import { DailyLogNote } from "./procoreDailyLogs";
import { ProcoreImage } from "./procoreImages";

// Minimum thresholds for report generation
export const MIN_NOTES_COUNT = 4;
export const MIN_PHOTOS_COUNT = 5;

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export interface ValidationResult {
  valid: boolean;
  error?: string;
  notesCount: number;
  photosCount: number;
}

/**
 * Validate that there is sufficient data to generate a meaningful report.
 * Returns a ValidationResult with counts and any error message.
 */
export function validateReportData(
  notes: DailyLogNote[],
  images: ProcoreImage[]
): ValidationResult {
  const notesCount = notes.length;
  const photosCount = images.length;

  if (notesCount < MIN_NOTES_COUNT) {
    return {
      valid: false,
      error: `Insufficient daily log data (found ${notesCount} notes, minimum ${MIN_NOTES_COUNT} required). Suggest manually creating report.`,
      notesCount,
      photosCount,
    };
  }

  if (photosCount < MIN_PHOTOS_COUNT) {
    return {
      valid: false,
      error: `Insufficient photos (found ${photosCount} photos, minimum ${MIN_PHOTOS_COUNT} required). Suggest manually creating report.`,
      notesCount,
      photosCount,
    };
  }

  return {
    valid: true,
    notesCount,
    photosCount,
  };
}

/**
 * Validate report data and throw ValidationError if insufficient.
 * Use this in the pipeline to halt processing with a clear error.
 */
export function assertValidReportData(
  notes: DailyLogNote[],
  images: ProcoreImage[]
): void {
  const result = validateReportData(notes, images);
  if (!result.valid && result.error) {
    throw new ValidationError(result.error);
  }
}
