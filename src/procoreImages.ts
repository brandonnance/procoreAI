import axios from "axios";
import { PROCORE_API_BASE_URL, PROCORE_COMPANY_ID } from "./config";
import { getFreshAccessToken } from "./procoreToken";

export interface ProcoreImage {
  id: number;
  project_id: number;
  width?: number;
  height?: number;
  size?: number; // bytes
  created_at: string;
  updated_at?: string;
  log_date?: string;
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

  const today = new Date();
  const todayUTC = new Date(
    Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())
  );

  const effectiveEnd = monthEnd > todayUTC ? todayUTC : monthEnd;

  const startDate = formatDate(monthStart);
  const endDate = formatDate(effectiveEnd);

  return getImagesForCreatedAtRange(projectId, startDate, endDate);
}
