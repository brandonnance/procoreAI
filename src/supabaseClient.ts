// src/supabaseClient.ts
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_SERVICE_KEY } from "./config";

// Status enum matching Postgres owner_report_status_type
export type OwnerReportStatus =
  | "pending"
  | "processing"
  | "ready"
  | "error";

// Database types for owner_reports table
export interface OwnerReport {
  id: string;
  job_id: string; // References jobs.id
  organization_id: string; // References organizations.id (for RLS)
  period_start: string; // Date (YYYY-MM-DD)
  period_end: string; // Date (YYYY-MM-DD)
  status: OwnerReportStatus;
  error_message: string | null;
  pptx_path: string | null; // Storage path, not URL
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
}

// Job info from the jobs table (joined when fetching reports)
export interface Job {
  id: string;
  name: string; // Project name
  organization_id: string;
  procore_project_id: string | null; // Nullable - may not be linked to Procore
}

// Combined type when we join owner_reports with jobs
export interface OwnerReportWithJob extends OwnerReport {
  jobs: Job;
}

// Create Supabase client with service role key (for backend use)
// Service role key bypasses RLS for backend operations
export const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Storage bucket name
export const REPORTS_BUCKET = "owner-reports";
