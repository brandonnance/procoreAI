// src/worker/reportWorker.ts
import * as fs from "fs-extra";
import {
  supabase,
  OwnerReport,
  OwnerReportWithJob,
  REPORTS_BUCKET,
} from "../supabaseClient";
import {
  generateReport,
  ReportGenerationResult,
} from "../pipeline/generateReport";
import { ValidationError } from "../reportValidation";

const POLL_INTERVAL_MS = 30_000; // 30 seconds
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const REPORT_EXPIRY_DAYS = 5;

/**
 * Fetch the next pending job from the queue.
 * Joins with jobs table to get Procore project info.
 * Returns null if no jobs are available.
 */
async function pollForPendingJob(): Promise<OwnerReportWithJob | null> {
  const { data, error } = await supabase
    .from("owner_reports")
    .select(
      `
      *,
      jobs (
        id,
        procore_project_id,
        name,
        organization_id
      )
    `
    )
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(1)
    .single();

  if (error) {
    // PGRST116 = no rows returned (not an error)
    if (error.code === "PGRST116") {
      return null;
    }
    console.error("Error polling for jobs:", error.message);
    return null;
  }

  return data as OwnerReportWithJob;
}

/**
 * Mark a job as processing.
 */
async function markJobProcessing(jobId: string): Promise<void> {
  const { error } = await supabase
    .from("owner_reports")
    .update({
      status: "processing",
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId);

  if (error) {
    throw new Error(`Failed to mark job as processing: ${error.message}`);
  }
}

/**
 * Mark a job as completed with the storage path.
 */
async function markJobCompleted(jobId: string, pptxPath: string): Promise<void> {
  const { error } = await supabase
    .from("owner_reports")
    .update({
      status: "completed",
      pptx_path: pptxPath,
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId);

  if (error) {
    throw new Error(`Failed to mark job as completed: ${error.message}`);
  }
}

/**
 * Mark a job as failed with an error message.
 */
async function markJobFailed(jobId: string, errorMessage: string): Promise<void> {
  const { error } = await supabase
    .from("owner_reports")
    .update({
      status: "failed",
      error_message: errorMessage,
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId);

  if (error) {
    console.error(`Failed to mark job as failed: ${error.message}`);
  }
}

/**
 * Upload the generated PowerPoint to Supabase storage.
 * Returns the storage path (not a URL - frontend generates signed URLs).
 */
async function uploadToStorage(
  localPath: string,
  reportId: string,
  filename: string
): Promise<string> {
  const fileBuffer = await fs.readFile(localPath);
  const storagePath = `reports/${reportId}/${filename}`;

  const { error: uploadError } = await supabase.storage
    .from(REPORTS_BUCKET)
    .upload(storagePath, fileBuffer, {
      contentType:
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      upsert: true,
    });

  if (uploadError) {
    throw new Error(`Failed to upload to storage: ${uploadError.message}`);
  }

  return storagePath;
}

/**
 * Convert period dates to a month string for the pipeline.
 * Uses the period_start month (YYYY-MM).
 */
function periodToMonth(periodStart: string): string {
  return periodStart.slice(0, 7); // "2025-11-01" -> "2025-11"
}

/**
 * Process a single job.
 */
async function processJob(report: OwnerReportWithJob): Promise<void> {
  const reportId = report.id;
  const job = report.jobs;
  const projectName = job.name;
  const month = periodToMonth(report.period_start);

  console.log(`\n[${new Date().toISOString()}] Processing report ${reportId}`);
  console.log(`  Job: ${job.id}`);
  console.log(`  Project: ${projectName}`);
  console.log(`  Period: ${report.period_start} to ${report.period_end}`);

  // Check if job has Procore project linked
  if (!job.procore_project_id) {
    console.log(`  ✗ Job has no Procore project linked`);
    await markJobFailed(
      reportId,
      "Job is not linked to a Procore project. Link a Procore project to generate reports."
    );
    return;
  }

  const projectId = Number(job.procore_project_id);
  console.log(`  Procore ID: ${projectId}`);

  try {
    // Mark as processing
    await markJobProcessing(reportId);

    // Generate the report
    const result: ReportGenerationResult = await generateReport(
      projectId,
      projectName,
      month,
      {
        onProgress: (stage, message) => {
          console.log(`  [${stage}] ${message}`);
        },
      }
    );

    if (!result.success || !result.pptxPath || !result.pptxFilename) {
      throw new Error(result.error || "Report generation failed");
    }

    // Upload to Supabase storage
    console.log(`  Uploading to storage...`);
    const storagePath = await uploadToStorage(
      result.pptxPath,
      reportId,
      result.pptxFilename
    );

    // Mark as completed
    await markJobCompleted(reportId, storagePath);

    console.log(`  ✓ Report completed successfully`);
    console.log(`  Storage path: ${storagePath}`);
  } catch (error: any) {
    console.error(`  ✗ Error processing report: ${error.message}`);

    // Determine appropriate error message
    let errorMessage: string;
    if (error instanceof ValidationError) {
      errorMessage = error.message;
    } else {
      errorMessage =
        "Report generation unable to complete. Suggest manually creating report.";
    }

    await markJobFailed(reportId, errorMessage);
    console.log(`  Report marked as failed: ${errorMessage}`);
  }
}

/**
 * Clean up expired reports (older than REPORT_EXPIRY_DAYS).
 * Deletes files from storage and clears pptx_path in database.
 */
async function cleanupExpiredReports(): Promise<void> {
  const expiryDate = new Date();
  expiryDate.setDate(expiryDate.getDate() - REPORT_EXPIRY_DAYS);
  const expiryDateStr = expiryDate.toISOString();

  console.log(`\n[${new Date().toISOString()}] Running cleanup for reports older than ${REPORT_EXPIRY_DAYS} days...`);

  // Find completed reports with pptx_path that are older than expiry
  const { data: expiredReports, error: fetchError } = await supabase
    .from("owner_reports")
    .select("id, pptx_path")
    .eq("status", "completed")
    .not("pptx_path", "is", null)
    .lt("completed_at", expiryDateStr);

  if (fetchError) {
    console.error(`  Cleanup fetch error: ${fetchError.message}`);
    return;
  }

  if (!expiredReports || expiredReports.length === 0) {
    console.log("  No expired reports to clean up.");
    return;
  }

  console.log(`  Found ${expiredReports.length} expired report(s) to clean up.`);

  for (const report of expiredReports) {
    try {
      // Delete from storage
      if (report.pptx_path) {
        const { error: deleteError } = await supabase.storage
          .from(REPORTS_BUCKET)
          .remove([report.pptx_path]);

        if (deleteError) {
          console.error(`  Failed to delete storage for ${report.id}: ${deleteError.message}`);
          continue;
        }
      }

      // Clear pptx_path in database (keep the record for history)
      const { error: updateError } = await supabase
        .from("owner_reports")
        .update({
          pptx_path: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", report.id);

      if (updateError) {
        console.error(`  Failed to update record ${report.id}: ${updateError.message}`);
        continue;
      }

      console.log(`  ✓ Cleaned up report ${report.id}`);
    } catch (err: any) {
      console.error(`  Error cleaning up ${report.id}: ${err.message}`);
    }
  }

  console.log("  Cleanup complete.");
}

/**
 * Main worker loop.
 */
async function runWorker(): Promise<void> {
  console.log("===========================================");
  console.log("  Owner Report Worker Started");
  console.log(`  Poll interval: ${POLL_INTERVAL_MS / 1000}s`);
  console.log(`  Cleanup interval: ${CLEANUP_INTERVAL_MS / 1000 / 60} min`);
  console.log(`  Report expiry: ${REPORT_EXPIRY_DAYS} days`);
  console.log("===========================================\n");

  let lastCleanup = 0;

  while (true) {
    try {
      // Process pending reports
      const report = await pollForPendingJob();

      if (report) {
        await processJob(report);
      }

      // Run cleanup periodically
      const now = Date.now();
      if (now - lastCleanup >= CLEANUP_INTERVAL_MS) {
        await cleanupExpiredReports();
        lastCleanup = now;
      }
    } catch (error: any) {
      console.error(`Worker error: ${error.message}`);
    }

    // Wait before next poll
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

// Start the worker
runWorker().catch((err) => {
  console.error("Fatal worker error:", err);
  process.exit(1);
});
