
# Procore AI Monthly Report Agent — Handoff Summary

This document summarizes the current state of the **Procore AI Monthly Report Agent** and outlines the next development steps. Claude can use this as the authoritative context when continuing the project.

---

## 1. What the Project Already Does (Working End‑to‑End)

### ✔ Procore OAuth2 Integration
- Handles login flow and stores `token.json`.
- Uses Procore REST API.

### ✔ Daily Log Notes → AI Summary + Photo Day Suggestions
- `summarizeDailyNotesWithPhotoDays(projectName, month, notes, maxWords, maxPhotoDays)`
- Model: **GPT‑4.1‑mini**
- Output includes:
  - `summary_bullets: string[]`
  - `photo_days: { date, reason?, priority? }[]`

### ✔ Fetch Images for a Month
- `getImagesForMonth(projectId, month)`
- Returns array of:
  ```ts
  interface ProcoreImage {
    id: number;
    project_id: number;
    width?: number;
    height?: number;
    size?: number;
    created_at: string;
    log_date?: string;
    description?: string;
    filename?: string;
  }
  ```

### ✔ Candidate Image Selection (Metadata‑Only)
- `selectCandidateImagesForMonth(images, photoDays, { maxCandidates, minCandidates })`
- Rules:
  - Includes AI-selected dates ±1 day.
  - Fallback fill favors images with descriptions + larger sizes.
  - Caps candidates at ~60; min ~20.

### ✔ AI Final Image Selection (No Vision Yet)
- `selectImagesFromMetadata(summary, candidates, maxImages)`
- AI picks best ~20 images based on:
  - Summary bullets
  - Photo days
  - Image metadata

### ✔ Full End‑to‑End Script Working
- `npm run test-image-selection`
- Produces:
  - Summary
  - Photo day suggestions
  - Candidate images
  - Final selected images (IDs, metadata)

---

## 2. Next Development Steps (What Claude Should Implement)

### **Step 1 — Add `filterImagesByIds` Helper**
```ts
export function filterImagesByIds(images: ProcoreImage[], ids: number[]): ProcoreImage[]
```
Purpose: return only the selected images in order.

---

### **Step 2 — Create a “Report Spec” Builder**
New file: `src/buildReportSpec.ts`

Goal: Produce a JSON structure representing the monthly report before PDF generation.

```ts
interface ReportImageSpec {
  id: number;
  date: string;
  description?: string;
  filename?: string;
}

interface MonthlyReportSpec {
  projectId: number;
  projectName: string;
  month: string;
  summaryBullets: string[];
  photoDays: PhotoDaySuggestion[];
  images: ReportImageSpec[];
}
```

Add CLI script `testBuildReportSpec.ts` to output this JSON.

---

### **Step 3 — Download + Resize Selected Images**
New file: `src/imageDownloadAndResize.ts`

Use `sharp`:

```ts
sharp(buffer).resize({ width: 1024, height: 1024, fit: "inside" })
```

Goal:
- Create folder: `output/<project>_<month>/`
- Download selected images
- Downscale them
- Save filenames consistently

---

### **Step 4 — (Later) Optional Vision Refinement**
After resizing:
- Use GPT‑4.1‑vision or Nano‑vision
- Provide:
  - Summary
  - The resized images
- Ask model to refine the selection to 8–10 best report photos.

---

### **Step 5 — (Later) PDF Generation**
Once the “Report Spec” + final image files exist:
- Use HTML → PDF (Puppeteer) OR pdf-lib/PDFKit
- Layout:
  - Cover page (static template + project info)
  - Summary page
  - 1 photo/page with caption
  - Final static page

---

## 3. Running the Existing Working Flow

```sh
npm run test-image-selection -- <projectId> 2025-11 "Project Name" 350
```

---

## 4. Claude’s Mission

Claude should begin by implementing:

1. `filterImagesByIds`
2. `buildReportSpec.ts`
3. `testBuildReportSpec.ts`
4. Then the download + resize pipeline.

Everything else already works and should NOT be modified unless necessary.

---
