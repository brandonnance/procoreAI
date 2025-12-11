import axios from "axios";
import fs from "fs-extra";
import {
  PROCORE_CLIENT_ID,
  PROCORE_CLIENT_SECRET,
  PROCORE_OAUTH_BASE_URL,
  PROCORE_REDIRECT_URI,
} from "./config";

const TOKEN_PATH = "./tokens.json";

interface TokenFile {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  obtained_at: number;
}

export async function loadTokens(): Promise<TokenFile> {
  if (!(await fs.pathExists(TOKEN_PATH))) {
    throw new Error("tokens.json not found — run the OAuth init flow first.");
  }
  return fs.readJSON(TOKEN_PATH);
}

async function saveTokens(tokens: TokenFile) {
  await fs.writeJSON(TOKEN_PATH, tokens, { spaces: 2 });
}

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
    }
  );

  const newTokens = {
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
