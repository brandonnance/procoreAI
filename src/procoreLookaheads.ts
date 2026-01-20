// src/procoreLookaheads.ts
import axios from "axios";
import { PROCORE_API_BASE_URL, PROCORE_COMPANY_ID } from "./config";
import { getFreshAccessToken } from "./procoreToken";

// List item from GET /schedule/lookaheads
export interface LookaheadListItem {
  id: number;
  start_date: string;
  end_date: string;
}

// Segment within a subtask (one per day)
export interface LookaheadSegment {
  date: string;
  status: string; // "unstarted" means not active, anything else means active
}

// Task within a lookahead
export interface LookaheadSubtask {
  name: string;
  segments?: LookaheadSegment[];
}

export interface LookaheadTask {
  name: string;
  task?: {
    start?: string;
    finish?: string;
  };
  subtasks?: LookaheadSubtask[];
}

// Full lookahead detail from GET /schedule/lookaheads/{id}
export interface LookaheadDetail {
  id: number;
  start_date: string;
  end_date: string;
  label: string; // e.g., "08/27/21 - 09/16/21 | 3 Weeks"
  lookahead_tasks: LookaheadTask[];
}

// Flattened task for slide display
export interface FlattenedTask {
  name: string;
  start: string;
  finish: string;
  isSubtask: boolean;
}

/**
 * Fetch list of all lookaheads for a project.
 */
export async function getLookaheadList(
  projectId: number
): Promise<LookaheadListItem[]> {
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
      `/rest/v1.1/projects/${projectId}/schedule/lookaheads`,
      {
        params: {
          company_id: PROCORE_COMPANY_ID,
        },
      }
    );

    return res.data as LookaheadListItem[];
  } catch (err: any) {
    const status = err.response?.status;
    const data = err.response?.data;

    console.error(
      "Procore lookaheads list error:",
      status,
      JSON.stringify(data, null, 2)
    );

    if (status === 404) {
      return [];
    }

    throw err;
  }
}

/**
 * Fetch detailed lookahead by ID.
 */
export async function getLookaheadDetail(
  projectId: number,
  lookaheadId: number
): Promise<LookaheadDetail | null> {
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
      `/rest/v1.1/projects/${projectId}/schedule/lookaheads/${lookaheadId}`,
      {
        params: {
          company_id: PROCORE_COMPANY_ID,
        },
      }
    );

    return res.data as LookaheadDetail;
  } catch (err: any) {
    const status = err.response?.status;
    const data = err.response?.data;

    console.error(
      "Procore lookahead detail error:",
      status,
      JSON.stringify(data, null, 2)
    );

    if (status === 404) {
      return null;
    }

    throw err;
  }
}

/**
 * Get the most recent lookahead for a project.
 * Returns null if no lookaheads exist.
 */
export async function getMostRecentLookahead(
  projectId: number
): Promise<LookaheadDetail | null> {
  const list = await getLookaheadList(projectId);

  if (!list.length) {
    return null;
  }

  // Sort by end_date descending to get most recent
  const sorted = [...list].sort((a, b) => {
    return new Date(b.end_date).getTime() - new Date(a.end_date).getTime();
  });

  const mostRecent = sorted[0];
  return getLookaheadDetail(projectId, mostRecent.id);
}

/**
 * Format a date string (YYYY-MM-DD) to a short format (Mon DD).
 */
function formatShortDate(dateStr: string | undefined): string {
  if (!dateStr) return "";

  const date = new Date(dateStr);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  return `${months[date.getUTCMonth()]} ${date.getUTCDate()}`;
}

/**
 * Extract active date range from subtask segments.
 * Returns { start, finish } where dates are the first and last active days.
 * A segment is active if status !== "unstarted".
 */
function getActiveDateRange(segments: LookaheadSegment[] | undefined): { start: string; finish: string } {
  if (!segments || segments.length === 0) {
    return { start: "", finish: "" };
  }

  // Filter to only active segments (status !== "unstarted")
  const activeDates = segments
    .filter((seg) => seg.status !== "unstarted")
    .map((seg) => seg.date)
    .sort(); // Sort chronologically

  if (activeDates.length === 0) {
    return { start: "", finish: "" };
  }

  return {
    start: activeDates[0],
    finish: activeDates[activeDates.length - 1],
  };
}

/**
 * Flatten lookahead tasks into a simple list for slide display.
 * Includes parent tasks and their subtasks (marked).
 * Subtask dates are extracted from segments (active days only).
 */
export function flattenLookaheadTasks(
  lookahead: LookaheadDetail
): FlattenedTask[] {
  const tasks: FlattenedTask[] = [];

  for (const task of lookahead.lookahead_tasks) {
    // Add parent task (no dates for top-level tasks)
    tasks.push({
      name: task.name,
      start: "",
      finish: "",
      isSubtask: false,
    });

    // Add subtasks if any
    if (task.subtasks && task.subtasks.length > 0) {
      for (const subtask of task.subtasks) {
        const { start, finish } = getActiveDateRange(subtask.segments);
        tasks.push({
          name: subtask.name,
          start: formatShortDate(start),
          finish: formatShortDate(finish),
          isSubtask: true,
        });
      }
    }
  }

  return tasks;
}
