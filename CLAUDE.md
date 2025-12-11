# Procore AI Monthly Report Generator

## Project Overview
Automated monthly construction report generator that integrates with Procore to:
1. Fetch daily log notes and summarize with AI
2. Select representative photos from the month
3. Generate AI captions for photos
4. Fetch 3-week lookahead schedules
5. Assemble everything into a branded PowerPoint presentation

## Current State (Dec 2024)
**Working end-to-end:**
- OAuth2 token management with auto-refresh
- Daily log notes fetching and AI summarization (GPT-4.1-mini)
- Photo selection based on AI-suggested "photo days"
- AI-generated captions for each photo
- Lookahead schedule fetching with date extraction from segments
- PowerPoint generation with editable text boxes

## Key Files

### Configuration
- `src/config.ts` - Environment variables (API keys, Procore credentials)
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

### Slide Generation
- `src/slideCompositor.ts` - Sharp image compositing + PptxGenJS PowerPoint assembly
- Slide types: summary, photo, lookahead, closing
- All text is editable in the final PowerPoint

### Test Scripts (npm run)
- `build-report-spec` - Generate report spec JSON
- `test-slides` - Generate PowerPoint from spec
- `test-lookahead` - Debug lookahead API response

## Workflow

### Generate a Report
```bash
# Step 1: Build the report spec (fetches notes, generates summary, selects images)
npm run build-report-spec -- <projectId> <YYYY-MM>

# Step 2: Generate PowerPoint from spec
npm run test-slides -- output/<ProjectName>_<YYYY-MM>_spec.json
```

### Example
```bash
npm run build-report-spec -- 562949955107625 2025-11
npm run test-slides -- output/Procore_Emerald_2025-11_spec.json
```

## Slide Structure
1. **Summary slide** - AI-generated bullet points from daily notes
2. **Photo slides** - Project photos with AI captions (editable)
3. **Lookahead slide** - 3-week schedule with tasks and dates
4. **Closing slide** - Static branded slide

## Lookahead Date Logic
- Parent tasks: No dates displayed
- Subtasks: Dates extracted from `segments[]` array
- Each segment has `date` and `status`
- `status === "unstarted"` means NOT active that day
- Any other status means active - we show first to last active date range

## Report Images (Branding)
Located in `report_images/`:
- `picture_overlay.png` - Photo slide overlay (1320x1020)
- `activities.png` - Summary slide background
- `last_slide.png` - Closing slide

## Slide Dimensions
- 1320 x 1020 pixels (landscape)
- Caption bar: 87px at bottom
- Photo area: 933px height

## Recent Changes
- Switched from PDF to PowerPoint output (pptxgenjs)
- Fixed duplicate text bug (text was burned into PNG AND added as text box)
- Added lookahead slide with segments-based date extraction
- Summary text color changed to black

## Known Issues / Next Steps
- Lookahead date extraction now working (uses segments array)
- May want to handle "chunked" tasks (gaps in active dates) differently
- Could add more slide customization options

## Dependencies
- axios - HTTP client for Procore API
- sharp - Image compositing
- pptxgenjs - PowerPoint generation
- openai - AI summaries and captions
- fs-extra - File operations
- dotenv - Environment variables
