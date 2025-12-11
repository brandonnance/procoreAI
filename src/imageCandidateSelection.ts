// src/imageCandidateSelection.ts
import { ProcoreImage, getImageDate, groupImagesByDate } from "./procoreImages";

export interface PhotoDaySuggestion {
  date: string; // "YYYY-MM-DD"
  reason?: string;
  priority?: number; // 1 = highest priority
}

const DEFAULT_MAX_CANDIDATES = 60;
const DEFAULT_MIN_CANDIDATES = 20;

function shiftDate(dateStr: string, offsetDays: number): string {
  const [yearStr, monthStr, dayStr] = dateStr.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);

  const dt = new Date(Date.UTC(year, month - 1, day + offsetDays));
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dt.getUTCDate()).padStart(2, "0");

  return `${y}-${m}-${d}`;
}

function finalizeSelection(
  selectedById: Map<number, ProcoreImage>
): ProcoreImage[] {
  const arr = Array.from(selectedById.values());

  // Sort by normalized date, then id for stability
  arr.sort((a, b) => {
    const da = getImageDate(a) ?? "";
    const db = getImageDate(b) ?? "";
    if (da !== db) return da.localeCompare(db);
    return a.id - b.id;
  });

  return arr;
}

/**
 * Select a capped set of candidate images for a given month, based on:
 * - AI-suggested photo days (and +/- 1 day around them)
 * - Fallback fill using described & larger images if we don't hit minCandidates
 */
export function selectCandidateImagesForMonth(
  images: ProcoreImage[],
  photoDays: PhotoDaySuggestion[],
  options?: {
    maxCandidates?: number;
    minCandidates?: number;
  }
): ProcoreImage[] {
  const maxCandidates = options?.maxCandidates ?? DEFAULT_MAX_CANDIDATES;
  const minCandidates = options?.minCandidates ?? DEFAULT_MIN_CANDIDATES;

  if (images.length === 0) return [];

  const byDate = groupImagesByDate(images);
  const selectedById = new Map<number, ProcoreImage>();

  // Sort photo days by priority (if present), then by date
  const sortedPhotoDays = [...photoDays].sort((a, b) => {
    const pa = a.priority ?? 999;
    const pb = b.priority ?? 999;
    if (pa !== pb) return pa - pb;
    return a.date.localeCompare(b.date);
  });

  // Pass 1: grab images on suggested dates and +/- 1 day around them
  for (const day of sortedPhotoDays) {
    const baseDate = day.date;
    const variants = [
      baseDate,
      shiftDate(baseDate, -1),
      shiftDate(baseDate, +1),
    ];

    for (const d of variants) {
      const imgs = byDate.get(d);
      if (!imgs) continue;

      for (const img of imgs) {
        if (!selectedById.has(img.id)) {
          selectedById.set(img.id, img);
          if (selectedById.size >= maxCandidates) {
            return finalizeSelection(selectedById);
          }
        }
      }
    }
  }

  // Pass 2: if we haven't hit minCandidates, fill from remaining images
  if (selectedById.size < minCandidates) {
    const remaining = images.filter((img) => !selectedById.has(img.id));

    // Prefer images with descriptions, then larger files (likely higher quality)
    remaining.sort((a, b) => {
      const hasDescA = !!(a.description && a.description.trim().length > 0);
      const hasDescB = !!(b.description && b.description.trim().length > 0);
      if (hasDescA && !hasDescB) return -1;
      if (!hasDescA && hasDescB) return 1;

      const sizeA = a.size ?? 0;
      const sizeB = b.size ?? 0;
      return sizeB - sizeA; // larger first
    });

    for (const img of remaining) {
      selectedById.set(img.id, img);
      if (selectedById.size >= maxCandidates) break;
    }
  }

  return finalizeSelection(selectedById);
}
