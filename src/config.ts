// src/config.ts
import * as dotenv from "dotenv";

dotenv.config();

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

export const PROCORE_CLIENT_ID = requireEnv("PROCORE_CLIENT_ID");
export const PROCORE_CLIENT_SECRET = requireEnv("PROCORE_CLIENT_SECRET");
export const PROCORE_COMPANY_ID = requireEnv("PROCORE_COMPANY_ID");
export const OPENAI_API_KEY = requireEnv("OPENAI_API_KEY");

// We'll add these later when we actually wire OAuth:
export const PROCORE_OAUTH_BASE_URL =
  process.env.PROCORE_OAUTH_BASE_URL || "https://login.procore.com";
export const PROCORE_API_BASE_URL =
  process.env.PROCORE_API_BASE_URL || "https://api.procore.com";
export const PROCORE_REDIRECT_URI =
  process.env.PROCORE_REDIRECT_URI || "urn:ietf:wg:oauth:2.0:oob";
