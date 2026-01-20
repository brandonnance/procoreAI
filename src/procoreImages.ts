import axios from "axios";
import { PROCORE_API_BASE_URL, PROCORE_COMPANY_ID } from "./config";
import { getFreshAccessToken } from "./procoreToken";

export interface ProcoreImage {
  id: number;
  project_id: number;
  width?: number;
  height?: number;
  size?: number; // bytes
  created_at: string; // ISO
  updated_at?: string;
  log_date?: string; // often undefined in your case
  description?: string; // user-entered description (may be empty string)
  filename?: string; // original filename
  [key: string]: any;
}

function formatDate(date: Date) {
  return date.toISOString().split("T")[0]; // YYYY-MM-DD
}

/**
 * Fetch all images for a project between startDate and endDate (inclusive),
 * using filters[created_at]="YYYY-MM-DD...YYYY-MM-DD", handling pagination.
 */
export async function getImagesForCreatedAtRange(
  projectId: number,
  startDate: string,
  endDate: string
): Promise<ProcoreImage[]> {
  const accessToken = await getFreshAccessToken();

  const client = axios.create({
    baseURL: PROCORE_API_BASE_URL,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    timeout: 30_000, // 30 second timeout
  });

  const perPage = 200;
  let page = 1;
  const all: ProcoreImage[] = [];

  while (true) {
    try {
      const res = await client.get("/rest/v1.0/images", {
        params: {
          company_id: PROCORE_COMPANY_ID,
          project_id: projectId,
          // 👇 use created_at range, not log_date
          "filters[created_at]": `${startDate}...${endDate}`,
          page,
          per_page: perPage,
        },
      });

      const images = res.data as ProcoreImage[];

      if (!images.length) break;

      all.push(...images);

      if (images.length < perPage) break;
      page += 1;
    } catch (err: any) {
      const status = err.response?.status;
      const data = err.response?.data;
      console.error(
        `Procore images error for project ${projectId}, page ${page}:`,
        status,
        JSON.stringify(data, null, 2)
      );

      // Treat 404/Item not found as "no images for this range"
      if (status === 404 || data?.message === "Item not found") {
        return all;
      }

      throw err;
    }
  }

  return all;
}

/**
 * Convenience: given a YYYY-MM, compute the month range and clamp endDate to today if needed.
 */
export async function getImagesForMonth(
  projectId: number,
  month: string // e.g. "2025-11"
): Promise<ProcoreImage[]> {
  const [yearStr, monthStr] = month.split("-");
  const year = Number(yearStr);
  const monthNum = Number(monthStr) - 1; // JS 0–11

  const monthStart = new Date(Date.UTC(year, monthNum, 1));
  const monthEnd = new Date(Date.UTC(year, monthNum + 1, 0)); // last day

  // Use a conservative "today" that accounts for timezone differences.
  // Procore's API validates dates against US Pacific time (UTC-8).
  // By subtracting 8 hours, we ensure the date we use is never "tomorrow"
  // from Procore's perspective, regardless of when the worker runs.
  const now = new Date();
  const conservativeNow = new Date(now.getTime() - 8 * 60 * 60 * 1000); // subtract 8 hours
  const todayUTC = new Date(
    Date.UTC(conservativeNow.getFullYear(), conservativeNow.getMonth(), conservativeNow.getDate())
  );

  const effectiveEnd = monthEnd > todayUTC ? todayUTC : monthEnd;

  const startDate = formatDate(monthStart);
  const endDate = formatDate(effectiveEnd);

  return getImagesForCreatedAtRange(projectId, startDate, endDate);
}

// Normalize an image's "day" as YYYY-MM-DD
export function getImageDate(img: ProcoreImage): string | null {
  // Prefer log_date if Procore ever populates it
  if (img.log_date && img.log_date.length >= 10) {
    return img.log_date.slice(0, 10);
  }

  if (img.created_at && img.created_at.length >= 10) {
    return img.created_at.slice(0, 10);
  }

  return null;
}

// Group images by normalized date (YYYY-MM-DD)
export function groupImagesByDate(
  images: ProcoreImage[]
): Map<string, ProcoreImage[]> {
  const map = new Map<string, ProcoreImage[]>();

  for (const img of images) {
    const date = getImageDate(img);
    if (!date) continue;

    const existing = map.get(date);
    if (existing) {
      existing.push(img);
    } else {
      map.set(date, [img]);
    }
  }

  return map;
}

/**
 * Filter images to only those matching the given IDs, preserving the order of IDs.
 */
export function filterImagesByIds(
  images: ProcoreImage[],
  ids: number[]
): ProcoreImage[] {
  const imageById = new Map<number, ProcoreImage>();
  for (const img of images) {
    imageById.set(img.id, img);
  }

  const result: ProcoreImage[] = [];
  for (const id of ids) {
    const img = imageById.get(id);
    if (img) {
      result.push(img);
    }
  }

  return result;
}
