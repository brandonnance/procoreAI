# Procore AI Monthly Report Generator

## Project Overview
Automated monthly construction report generator that integrates with Procore to:
1. Fetch daily log notes and summarize with AI
2. Select representative photos from the month
3. Generate AI captions for photos
4. Fetch 3-week lookahead schedules
5. Assemble everything into a branded PowerPoint presentation
6. Upload to Supabase storage for client download

## Current State (Dec 2024)
**Working end-to-end:**
- OAuth2 token management with auto-refresh
- Daily log notes fetching and AI summarization (GPT-4.1-mini)
- Photo selection based on AI-suggested "photo days"
- AI-generated captions for each photo
- Lookahead schedule fetching with date extraction from segments
- PowerPoint generation with editable text boxes
- **NEW:** Supabase worker for automated report generation
- **NEW:** Guard rails for minimum data validation

## Architecture

### Manual Workflow (Testing)
```
build-report-spec → test-slides → PowerPoint file
```

### Automated Workflow (Production)
```
Supabase table (owner_reports) → Worker polls → Pipeline generates → Upload to bucket
```

## Key Files

### Configuration
- `src/config.ts` - Environment variables (API keys, Procore credentials, Supabase)
- `.env` - Secrets (not in git)

### Procore API Integration
- `src/procoreToken.ts` - OAuth2 token management with refresh
- `src/procoreProjects.ts` - List projects
- `src/procoreImages.ts` - Fetch project images
- `src/procoreDailyLogs.ts` - Fetch daily log notes
- `src/procoreLookaheads.ts` - Fetch lookahead schedules

### AI & Report Building
- `src/aiClient.ts` - OpenAI integration for summaries and captions
- `src/buildReportSpec.ts` - Build report spec from notes/images
- `src/imageDownloader.ts` - Download images from Procore
- `src/imageCandidateSelection.ts` - Select candidate images based on AI photo days

### Slide Generation
- `src/slideCompositor.ts` - Sharp image compositing + PptxGenJS PowerPoint assembly
- Slide types: summary, photo, lookahead, closing
- All text is editable in the final PowerPoint
- Lookahead slides show placeholder message when no schedule exists

### Pipeline & Worker (NEW)
- `src/pipeline/generateReport.ts` - Consolidated end-to-end report generation
- `src/worker/reportWorker.ts` - Polls Supabase, processes jobs, uploads results
- `src/reportValidation.ts` - Guard rails (min 4 notes, min 5 photos)
- `src/supabaseClient.ts` - Supabase client and type definitions

### Test Scripts (npm run)
- `build-report-spec` - Generate report spec JSON
- `test-slides` - Generate PowerPoint from spec
- `test-lookahead` - Debug lookahead API response
- `worker` - Run the Supabase worker (production)

## Environment Variables

### Required
```env
PROCORE_CLIENT_ID=xxx
PROCORE_CLIENT_SECRET=xxx
PROCORE_COMPANY_ID=xxx
OPENAI_API_KEY=xxx
SUPABASE_URL=xxx
SUPABASE_SERVICE_KEY=xxx
```

### Optional
```env
PROCORE_OAUTH_BASE_URL=https://login.procore.com
PROCORE_API_BASE_URL=https://api.procore.com
PROCORE_REDIRECT_URI=urn:ietf:wg:oauth:2.0:oob
```

## Workflow

### Manual: Generate a Report (Testing)
```bash
# Step 1: Build the report spec (fetches notes, generates summary, selects images)
npm run build-report-spec -- <projectId> <YYYY-MM>

# Step 2: Generate PowerPoint from spec
npm run test-slides -- output/<ProjectName>_<YYYY-MM>_spec.json
```

### Automated: Run the Worker (Production)
```bash
npm run worker
```

The worker:
- Polls `owner_reports` table every 30 seconds
- Joins with `jobs` table to get Procore project info
- Processes one report at a time
- Uploads completed reports to `owner-reports` bucket
- Updates report status (pending → processing → completed/failed)
- Runs cleanup every hour to delete expired reports (>5 days old)

## Supabase Schema

### Table: `owner_reports`
References ForeSyt's `jobs` table for project info. Uses Postgres enum for status. Has RLS enabled.

```sql
-- Status enum
create type owner_report_status_type as enum (
  'pending', 'processing', 'ready', 'error'
);

create table owner_reports (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id),
  organization_id uuid not null references organizations(id),  -- For RLS
  period_start date not null,
  period_end date not null,
  status owner_report_status_type not null default 'pending',
  error_message text,
  pptx_path text,  -- Storage path, frontend generates signed URLs
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  started_at timestamptz,
  completed_at timestamptz
);
-- RLS enabled on this table
```

### Related: `jobs` table (ForeSyt)
```sql
-- Worker joins to get Procore info
jobs (
  id uuid,
  name text,  -- Project name
  organization_id uuid,
  procore_project_id text  -- Nullable, may not be linked to Procore
)
```

**Note:** If `procore_project_id` is null, the worker will fail the report with a message asking to link a Procore project.

### Table: `procore_tokens`
Stores Procore OAuth tokens. Single row, updated on each token refresh.

```sql
create table procore_tokens (
  id text primary key,  -- 'procore-oauth-tokens'
  token_data jsonb not null,  -- { access_token, refresh_token, expires_in, token_type, obtained_at }
  updated_at timestamptz default now()
);

-- Seed initial tokens (run once after OAuth flow):
insert into procore_tokens (id, token_data) values (
  'procore-oauth-tokens',
  '{"access_token": "...", "refresh_token": "...", "expires_in": 7200, "token_type": "Bearer", "obtained_at": 1234567890}'
);
```

**Note:** No RLS on this table - only accessed by backend with service role key.

### Storage Bucket: `owner-reports`
- Path format: `reports/{report_id}/{filename}.pptx`
- Frontend generates signed URLs at download time
- Cleanup: Worker deletes files >5 days old (hourly check), clears `pptx_path` but keeps record

## Guard Rails

| Check | Threshold | Error Message |
|-------|-----------|---------------|
| Notes count | < 4 | "Insufficient daily log data (found X notes, minimum 4 required)" |
| Photos count | < 5 | "Insufficient photos (found X photos, minimum 5 required)" |

When thresholds aren't met, the job fails with a user-friendly message suggesting manual report creation.

## Slide Structure
1. **Summary slide** - AI-generated bullet points from daily notes
2. **Photo slides** - Project photos with AI captions (editable)
3. **Lookahead slide** - 3-week schedule with tasks and dates (or placeholder if none)
4. **Closing slide** - Static branded slide

## Lookahead Behavior
- Always creates a lookahead slide
- If no lookahead exists: Shows placeholder message "No valid lookahead exists. Create one and place it here, or delete this slide."
- If lookahead exists: Shows tasks with date ranges
- Parent tasks: No dates displayed
- Subtasks: Dates extracted from `segments[]` array

## Report Images (Branding)
Located in `report_images/`:
- `picture_overlay.png` - Photo slide overlay (1320x1020)
- `activities.png` - Summary slide background
- `last_slide.png` - Closing slide

## Slide Dimensions
- 1320 x 1020 pixels (landscape)
- Caption bar: 87px at bottom
- Photo area: 933px height

## Dependencies
- axios - HTTP client for Procore API
- sharp - Image compositing (could be removed, see notes)
- pptxgenjs - PowerPoint generation
- openai - AI summaries and captions
- fs-extra - File operations
- dotenv - Environment variables
- @supabase/supabase-js - Supabase client

## Notes
- Sharp is still used for image compositing but could potentially be removed since PptxGenJS can handle image sizing with `sizing: "cover"`
- The worker runs indefinitely - use process manager (PM2, systemd) in production
- pdf-lib dependency is unused (legacy from PDF output)
