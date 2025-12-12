# ForeSyt Owner Reports Integration

## Overview
A Render background worker generates monthly owner reports (PowerPoint presentations) from Procore project data. ForeSyt needs frontend UI to request and download these reports.

## Backend (Already Deployed)
- **Worker:** Polls Supabase `owner_reports` table every 30 seconds
- **Storage:** Uploads to `owner-reports` bucket in Supabase
- **Auto-cleanup:** Deletes files older than 5 days

## Database Schema

### Table: `owner_reports`
```sql
create type owner_report_status_type as enum (
  'pending', 'processing', 'ready', 'error'
);

create table owner_reports (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id),
  organization_id uuid not null references organizations(id),
  period_start date not null,
  period_end date not null,
  status owner_report_status_type not null default 'pending',
  error_message text,
  pptx_path text,  -- Storage path (not URL)
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  started_at timestamptz,
  completed_at timestamptz
);
```

**RLS is enabled** - users can only see reports for their organization.

### Required: `jobs` table must have
- `procore_project_id` (text, nullable) - Links to Procore project
- If null, report generation fails with helpful error message

## Status Flow
```
pending → processing → ready (success)
                    → error (failure with error_message)
```

## Frontend Implementation Tasks

### 1. Request a Report
Insert row into `owner_reports`:
```typescript
const { data, error } = await supabase
  .from('owner_reports')
  .insert({
    job_id: selectedJobId,
    organization_id: userOrgId,
    period_start: '2025-11-01',
    period_end: '2025-11-30',
    // status defaults to 'pending'
  })
  .select()
  .single();
```

### 2. Show Report Status
Query and display status with real-time updates:
```typescript
const { data } = await supabase
  .from('owner_reports')
  .select('*')
  .eq('job_id', jobId)
  .order('created_at', { ascending: false });

// Subscribe to changes
supabase
  .channel('owner_reports')
  .on('postgres_changes', {
    event: '*',
    schema: 'public',
    table: 'owner_reports',
    filter: `job_id=eq.${jobId}`
  }, (payload) => {
    // Update UI
  })
  .subscribe();
```

### 3. Download Ready Reports
Generate signed URL from `pptx_path`:
```typescript
if (report.status === 'ready' && report.pptx_path) {
  const { data } = await supabase.storage
    .from('owner-reports')
    .createSignedUrl(report.pptx_path, 3600); // 1 hour expiry

  // data.signedUrl is the download link
}
```

### 4. Display Errors
When `status === 'error'`, show `error_message` to user. Common messages:
- "Job is not linked to a Procore project..."
- "Insufficient daily log data (found X notes, minimum 4 required)"
- "Insufficient photos (found X photos, minimum 5 required)"
- "Report generation unable to complete. Suggest manually creating report."

## UI Suggestions

### Job Detail Page
Add "Owner Reports" section:
- Button: "Generate Report" (opens month picker)
- List of past reports with status badges
- Download button for ready reports
- Error message display for failed reports

### Status Badges
- `pending` - Gray, "Queued"
- `processing` - Blue spinner, "Generating..."
- `ready` - Green, "Ready" + download button
- `error` - Red, "Failed" + show error_message

### Month Picker
- Default to previous month
- period_start = first day of month
- period_end = last day of month

## Notes
- Reports auto-delete after 5 days (pptx_path becomes null, record remains)
- Worker processes one report at a time
- Poll interval is 30 seconds, so there may be slight delay before processing starts
- Jobs without `procore_project_id` will fail immediately with helpful message
