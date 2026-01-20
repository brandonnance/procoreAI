// scripts/diagnose-apis.ts
// Quick diagnostic to test API connectivity and identify hangs

import "dotenv/config";
import OpenAI from "openai";
import { OPENAI_API_KEY } from "../src/config";
import { getFreshAccessToken } from "../src/procoreToken";

const TIMEOUT_MS = 15_000; // 15 second timeout for tests

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    ),
  ]);
}

async function testOpenAI(): Promise<void> {
  console.log("\n=== Testing OpenAI API ===");

  const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

  // Test 1: List models to verify API key works
  console.log("1. Testing API key with models list...");
  try {
    const models = await withTimeout(
      openai.models.list(),
      TIMEOUT_MS,
      "OpenAI models.list"
    );
    console.log("   ✓ API key valid, found", models.data.length, "models");
  } catch (err: any) {
    console.log("   ✗ Failed:", err.message);
    return;
  }

  // Test 2: Check if gpt-4.1-mini exists
  console.log("2. Checking if 'gpt-4.1-mini' model exists...");
  try {
    const models = await openai.models.list();
    const modelNames = models.data.map(m => m.id);
    const hasModel = modelNames.some(name => name.includes("gpt-4.1-mini"));

    if (hasModel) {
      console.log("   ✓ Model 'gpt-4.1-mini' found");
    } else {
      console.log("   ✗ Model 'gpt-4.1-mini' NOT found");
      console.log("   Available GPT-4 models:");
      modelNames
        .filter(n => n.includes("gpt-4"))
        .slice(0, 10)
        .forEach(n => console.log("     -", n));
    }
  } catch (err: any) {
    console.log("   ✗ Failed:", err.message);
  }

  // Test 3: Simple completion with gpt-4.1-mini
  console.log("3. Testing completion with 'gpt-4.1-mini'...");
  try {
    const start = Date.now();
    const resp = await withTimeout(
      openai.chat.completions.create({
        model: "gpt-4.1-mini",
        messages: [{ role: "user", content: "Say 'hello' and nothing else." }],
        max_tokens: 10,
      }),
      TIMEOUT_MS,
      "OpenAI completion (gpt-4.1-mini)"
    );
    const elapsed = Date.now() - start;
    console.log(`   ✓ Response in ${elapsed}ms:`, resp.choices[0]?.message?.content);
  } catch (err: any) {
    console.log("   ✗ Failed:", err.message);

    // Try with gpt-4o-mini as fallback test
    console.log("4. Testing completion with 'gpt-4o-mini' (fallback)...");
    try {
      const start = Date.now();
      const resp = await withTimeout(
        openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: "Say 'hello' and nothing else." }],
          max_tokens: 10,
        }),
        TIMEOUT_MS,
        "OpenAI completion (gpt-4o-mini)"
      );
      const elapsed = Date.now() - start;
      console.log(`   ✓ Response in ${elapsed}ms:`, resp.choices[0]?.message?.content);
      console.log("   >> Consider switching to 'gpt-4o-mini' instead");
    } catch (err2: any) {
      console.log("   ✗ Fallback also failed:", err2.message);
    }
  }
}

async function testProcore(): Promise<void> {
  console.log("\n=== Testing Procore API ===");

  // Test 1: Token refresh
  console.log("1. Testing token refresh...");
  try {
    const start = Date.now();
    const token = await withTimeout(
      getFreshAccessToken(),
      TIMEOUT_MS,
      "Procore token refresh"
    );
    const elapsed = Date.now() - start;
    console.log(`   ✓ Token obtained in ${elapsed}ms (${token.slice(0, 20)}...)`);
  } catch (err: any) {
    console.log("   ✗ Failed:", err.message);
  }
}

async function testLargePayload(): Promise<void> {
  console.log("\n=== Testing Large Payload (simulating image selection) ===");

  const openai = new OpenAI({
    apiKey: OPENAI_API_KEY,
    timeout: 60_000,
  });

  // Simulate 60 candidate images (realistic workload)
  const fakeCandidates = Array.from({ length: 60 }, (_, i) => ({
    id: 1000 + i,
    date: `2024-12-${String((i % 28) + 1).padStart(2, "0")}`,
    description: i % 3 === 0 ? `Foundation work progress photo ${i}` : "",
    filename: `IMG_${1000 + i}.jpg`,
  }));

  const fakeSummary = {
    summaryBullets: [
      "• Foundation work completed on schedule",
      "• Steel framing began on December 15th",
      "• Electrical rough-in 50% complete",
      "• Plumbing inspection passed",
    ],
    photoDays: [
      { date: "2024-12-05", reason: "Foundation pour", priority: 1 },
      { date: "2024-12-15", reason: "Steel delivery", priority: 2 },
      { date: "2024-12-20", reason: "Framing complete", priority: 3 },
    ],
  };

  const systemPrompt = `You are a construction project photo curator. Choose up to 20 images. Respond ONLY with JSON: { "selected_ids": [123, 456, ...] }`;

  const userPrompt = `
Monthly summary bullets:
${fakeSummary.summaryBullets.join("\n")}

AI-suggested key dates:
${fakeSummary.photoDays.map(d => `- ${d.date} (priority ${d.priority}): ${d.reason}`).join("\n")}

Candidate photos (metadata only):
${fakeCandidates.map(p => `- id: ${p.id}, date: ${p.date}, desc: ${p.description || "(no description)"}, file: ${p.filename}`).join("\n")}

Return ONLY JSON: { "selected_ids": [ /* up to 20 ids */ ] }
`;

  console.log("Payload size:", userPrompt.length, "characters");
  console.log("Candidate count:", fakeCandidates.length);

  console.log("Sending request to gpt-4.1-mini...");
  try {
    const start = Date.now();
    const resp = await withTimeout(
      openai.chat.completions.create({
        model: "gpt-4.1-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" },
        max_completion_tokens: 500,
      }),
      60_000, // 60 second timeout
      "OpenAI large payload"
    );
    const elapsed = Date.now() - start;
    const content = resp.choices[0]?.message?.content || "{}";
    const parsed = JSON.parse(content);
    console.log(`   ✓ Response in ${elapsed}ms`);
    console.log(`   Selected ${parsed.selected_ids?.length || 0} images`);
    console.log(`   Token usage: ${resp.usage?.total_tokens || "unknown"}`);
  } catch (err: any) {
    console.log("   ✗ Failed:", err.message);
  }
}

async function testProcoreDataFetch(projectId?: number, month?: string): Promise<void> {
  if (!projectId || !month) {
    console.log("\n=== Skipping Procore Data Fetch (no project/month specified) ===");
    console.log("   Run with: npx tsx scripts/diagnose-apis.ts <projectId> <YYYY-MM>");
    return;
  }

  console.log(`\n=== Testing Procore Data Fetch (Project ${projectId}, ${month}) ===`);

  // Import dynamically to avoid loading everything upfront
  const { getDailyNotesForMonth } = await import("../src/procoreDailyLogs");
  const { getImagesForMonth } = await import("../src/procoreImages");

  // Test 1: Fetch notes
  console.log("1. Fetching daily notes...");
  try {
    const start = Date.now();
    const notes = await withTimeout(
      getDailyNotesForMonth(projectId, month),
      30_000,
      "Procore notes fetch"
    );
    const elapsed = Date.now() - start;
    console.log(`   ✓ Found ${notes.length} notes in ${elapsed}ms`);
  } catch (err: any) {
    console.log("   ✗ Failed:", err.message);
  }

  // Test 2: Fetch images
  console.log("2. Fetching images...");
  try {
    const start = Date.now();
    const images = await withTimeout(
      getImagesForMonth(projectId, month),
      30_000,
      "Procore images fetch"
    );
    const elapsed = Date.now() - start;
    console.log(`   ✓ Found ${images.length} images in ${elapsed}ms`);
  } catch (err: any) {
    console.log("   ✗ Failed:", err.message);
  }
}

async function main() {
  console.log("API Diagnostic Tool");
  console.log("===================");
  console.log("Timeout per test:", TIMEOUT_MS, "ms");

  // Parse optional project ID and month from args
  const args = process.argv.slice(2);
  const projectId = args[0] ? parseInt(args[0], 10) : undefined;
  const month = args[1]; // e.g., "2024-12"

  await testOpenAI();
  await testProcore();
  await testLargePayload();
  await testProcoreDataFetch(projectId, month);

  console.log("\n=== Done ===\n");
}

main().catch(console.error);
