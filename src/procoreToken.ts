import axios from "axios";
import {
  PROCORE_CLIENT_ID,
  PROCORE_CLIENT_SECRET,
  PROCORE_OAUTH_BASE_URL,
  PROCORE_REDIRECT_URI,
} from "./config";
import { supabase } from "./supabaseClient";

// Token row ID - we use a single row for the app's Procore tokens
const TOKEN_ROW_ID = "procore-oauth-tokens";

interface TokenData {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  obtained_at: number;
}

/**
 * Load tokens from Supabase.
 * Tokens are stored in a simple key-value table: procore_tokens
 */
export async function loadTokens(): Promise<TokenData> {
  const { data, error } = await supabase
    .from("procore_tokens")
    .select("token_data")
    .eq("id", TOKEN_ROW_ID)
    .single();

  if (error || !data) {
    throw new Error(
      "Procore tokens not found in database. Run the OAuth init flow first, then seed the tokens."
    );
  }

  return data.token_data as TokenData;
}

/**
 * Save tokens to Supabase (upsert).
 */
async function saveTokens(tokens: TokenData): Promise<void> {
  const { error } = await supabase.from("procore_tokens").upsert(
    {
      id: TOKEN_ROW_ID,
      token_data: tokens,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" }
  );

  if (error) {
    console.error("Failed to save tokens to Supabase:", error.message);
    throw new Error(`Failed to save tokens: ${error.message}`);
  }
}

/**
 * Get a fresh access token, refreshing if needed.
 * Automatically saves the new tokens to Supabase.
 */
export async function getFreshAccessToken(): Promise<string> {
  const stored = await loadTokens();

  const res = await axios.post(
    `${PROCORE_OAUTH_BASE_URL}/oauth/token`,
    {
      grant_type: "refresh_token",
      refresh_token: stored.refresh_token,
      client_id: PROCORE_CLIENT_ID,
      client_secret: PROCORE_CLIENT_SECRET,
      redirect_uri: PROCORE_REDIRECT_URI,
    },
    {
      headers: { "Content-Type": "application/json" },
      timeout: 30_000, // 30 second timeout
    }
  );

  const newTokens: TokenData = {
    ...stored,
    access_token: res.data.access_token,
    refresh_token: res.data.refresh_token ?? stored.refresh_token,
    expires_in: res.data.expires_in,
    token_type: res.data.token_type,
    obtained_at: Date.now(),
  };

  await saveTokens(newTokens);

  return newTokens.access_token;
}
