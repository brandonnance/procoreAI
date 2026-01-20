import axios from "axios";
import { PROCORE_API_BASE_URL, PROCORE_COMPANY_ID } from "./config";
import { getFreshAccessToken } from "./procoreToken";

export interface DailyLogNote {
  id: number;
  comment: string;
  created_at: string;
  date: string;
  datetime: string;
  status: string;
  created_by?: {
    id: number;
    login: string;
    name: string;
  };
  location?: {
    id: number;
    name: string;
  };
  // keep it open to allow extra fields
  [key: string]: any;
}

function formatDate(date: Date) {
  return date.toISOString().split("T")[0]; // YYYY-MM-DD
}

// 👉 This is the “text we feed to AI”
export function getNoteText(note: DailyLogNote): string {
  return note.comment || "";
}

// 👉 Nice helper for name (falls back gracefully)
export function getNoteAuthor(note: DailyLogNote): string {
  return note.created_by?.name || "unknown";
}

export async function getDailyNotesForMonth(
  projectId: number,
  month: string // e.g. "2025-12"
): Promise<DailyLogNote[]> {
  const [yearStr, monthStr] = month.split("-");
  const year = Number(yearStr);
  const monthNum = Number(monthStr) - 1; // JS months 0–11

  const monthStart = new Date(Date.UTC(year, monthNum, 1));
  const monthEnd = new Date(Date.UTC(year, monthNum + 1, 0)); // last day of month

  // Use a conservative "today" that accounts for timezone differences.
  // Procore's API validates dates against US Pacific time (UTC-8).
  // By subtracting 8 hours, we ensure the date we use is never "tomorrow"
  // from Procore's perspective, regardless of when the worker runs.
  const now = new Date();
  const conservativeNow = new Date(now.getTime() - 8 * 60 * 60 * 1000); // subtract 8 hours
  const todayUTC = new Date(
    Date.UTC(conservativeNow.getFullYear(), conservativeNow.getMonth(), conservativeNow.getDate())
  );

  // clamp end date so it never goes beyond today (in Procore's timezone)
  const effectiveEnd = monthEnd > todayUTC ? todayUTC : monthEnd;

  const startDate = formatDate(monthStart);
  const endDate = formatDate(effectiveEnd);

  const accessToken = await getFreshAccessToken();

  const client = axios.create({
    baseURL: PROCORE_API_BASE_URL,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    timeout: 30_000, // 30 second timeout
  });

  try {
    const res = await client.get(
      `/rest/v1.0/projects/${projectId}/notes_logs`,
      {
        params: {
          company_id: PROCORE_COMPANY_ID,
          start_date: startDate,
          end_date: endDate,
        },
      }
    );

    return res.data as DailyLogNote[];
  } catch (err: any) {
    const status = err.response?.status;
    const data = err.response?.data;

    console.error(
      "Procore notes_logs error:",
      status,
      JSON.stringify(data, null, 2)
    );

    if (status === 404 || data?.message === "Item not found") {
      return [];
    }

    throw err;
  }
}
