// src/imageDownloader.ts
import axios from "axios";
import * as fs from "fs-extra";
import * as path from "path";
import { PROCORE_API_BASE_URL, PROCORE_COMPANY_ID } from "./config";
import { getFreshAccessToken } from "./procoreToken";
import { ProcoreImage } from "./procoreImages";

export interface ImageDownloadResult {
  id: number;
  filename: string;
  localPath: string;
  success: boolean;
  error?: string;
}

/**
 * Fetch the full image details including download URL from Procore.
 */
async function getImageDetails(
  projectId: number,
  imageId: number
): Promise<any> {
  const accessToken = await getFreshAccessToken();

  const client = axios.create({
    baseURL: PROCORE_API_BASE_URL,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    timeout: 30_000, // 30 second timeout for API calls
  });

  const res = await client.get(`/rest/v1.0/images/${imageId}`, {
    params: {
      company_id: PROCORE_COMPANY_ID,
      project_id: projectId,
    },
  });

  return res.data;
}

// Overall timeout for a single image download (safety net)
const DOWNLOAD_TIMEOUT_MS = 120_000; // 2 minutes max per image

/**
 * Wrap a promise with a hard timeout.
 */
function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  errorMessage: string
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(errorMessage)), ms)
    ),
  ]);
}

/**
 * Download a single image from Procore and save to disk.
 */
export async function downloadImage(
  projectId: number,
  image: ProcoreImage,
  outputDir: string
): Promise<ImageDownloadResult> {
  const imageId = image.id;
  const filename = image.filename || `image_${imageId}.jpg`;
  const localPath = path.join(outputDir, filename);

  try {
    // Wrap entire download in a hard timeout
    const result = await withTimeout(
      downloadImageInternal(projectId, imageId, filename, localPath, outputDir),
      DOWNLOAD_TIMEOUT_MS,
      `Download timed out after ${DOWNLOAD_TIMEOUT_MS / 1000}s`
    );
    return result;
  } catch (err: any) {
    return {
      id: imageId,
      filename,
      localPath,
      success: false,
      error: err.message || String(err),
    };
  }
}

/**
 * Internal image download logic.
 */
async function downloadImageInternal(
  projectId: number,
  imageId: number,
  filename: string,
  localPath: string,
  outputDir: string
): Promise<ImageDownloadResult> {
  // Get full image details with URL
  const details = await getImageDetails(projectId, imageId);

  // Procore typically returns image URLs in various sizes
  // Look for the original/full size URL
  const imageUrl =
    details.image_url ||
    details.url ||
    details.original_url ||
    details.full_url;

  if (!imageUrl) {
    return {
      id: imageId,
      filename,
      localPath,
      success: false,
      error: "No image URL found in response",
    };
  }

  // Download the image binary
  const response = await axios.get(imageUrl, {
    responseType: "arraybuffer",
    timeout: 60_000, // 60 second timeout for image download
  });

  // Ensure output directory exists
  await fs.ensureDir(outputDir);

  // Write to disk
  await fs.writeFile(localPath, response.data);

  return {
    id: imageId,
    filename,
    localPath,
    success: true,
  };
}

/**
 * Download multiple images from Procore.
 * Downloads sequentially to avoid rate limiting.
 */
export async function downloadImages(
  projectId: number,
  images: ProcoreImage[],
  outputDir: string,
  onProgress?: (completed: number, total: number) => void
): Promise<ImageDownloadResult[]> {
  const results: ImageDownloadResult[] = [];

  for (let i = 0; i < images.length; i++) {
    const image = images[i];
    const result = await downloadImage(projectId, image, outputDir);
    results.push(result);

    if (onProgress) {
      onProgress(i + 1, images.length);
    }

    // Small delay to be nice to the API
    if (i < images.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  return results;
}
