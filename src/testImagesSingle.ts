// src/testImagesSingle.ts
import axios from "axios";
import { PROCORE_API_BASE_URL, PROCORE_COMPANY_ID } from "./config";
import { getFreshAccessToken } from "./procoreToken";

async function main() {
  const projectId = Number(process.argv[2]);
  const logDate = process.argv[3]; // "YYYY-MM-DD" or "all"

  if (!projectId || !logDate) {
    console.log(
      "Usage: npm run test-images-single -- <projectId> <YYYY-MM-DD|all>"
    );
    process.exit(1);
  }

  console.log(
    `Testing /rest/v1.0/images for project ${projectId} with logDate="${logDate}"...`
  );

  const token = await getFreshAccessToken();

  const client = axios.create({
    baseURL: PROCORE_API_BASE_URL,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  // Build params based on whether we want all images or a specific Daily Log date
  const params: Record<string, any> = {
    company_id: PROCORE_COMPANY_ID,
    project_id: projectId,
    per_page: 50,
  };

  if (logDate !== "all") {
    // Daily Log photos for a specific date
    params["filters[log_date]"] = logDate; // e.g. "2025-11-10"
  }

  try {
    const res = await client.get("/rest/v1.0/images", { params });

    const images = res.data as any[];

    console.log(`\nFound ${images.length} images.\n`);

    if (images.length > 0) {
      console.log(
        "Sample:",
        images.slice(0, 3).map((img) => ({
          id: img.id,
          width: img.width,
          height: img.height,
          size: img.size,
          log_date: img.log_date,
          created_at: img.created_at,
          description: img.description,
          filename: img.filename,
        }))
      );
    }
  } catch (err: any) {
    console.error(
      "Error calling /images:",
      err.response?.status,
      err.response?.data || err.message
    );
  }
}

main().catch((err) => {
  console.error("Unexpected error:", err.response?.data || err.message);
  process.exit(1);
});
