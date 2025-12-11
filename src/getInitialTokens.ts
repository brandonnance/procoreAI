// src/getInitialTokens.ts
import axios from "axios";
import * as fs from "fs/promises";
import readline from "readline";
import {
  PROCORE_CLIENT_ID,
  PROCORE_CLIENT_SECRET,
  PROCORE_OAUTH_BASE_URL,
  PROCORE_REDIRECT_URI,
} from "./config";

const TOKEN_PATH = "./tokens.json";

interface ProcoreTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
}

function createAuthUrl() {
  const params = new URLSearchParams({
    client_id: PROCORE_CLIENT_ID,
    response_type: "code",
    redirect_uri: PROCORE_REDIRECT_URI,
    // Add scope here if Procore requires it, e.g. "scope": "all"
  });

  return `${PROCORE_OAUTH_BASE_URL}/oauth/authorize?${params.toString()}`;
}

async function exchangeCodeForTokens(
  code: string
): Promise<ProcoreTokenResponse> {
  const url = `${PROCORE_OAUTH_BASE_URL}/oauth/token`;

  const res = await axios.post<ProcoreTokenResponse>(
    url,
    {
      grant_type: "authorization_code",
      code,
      client_id: PROCORE_CLIENT_ID,
      client_secret: PROCORE_CLIENT_SECRET,
      redirect_uri: PROCORE_REDIRECT_URI,
    },
    {
      headers: {
        "Content-Type": "application/json",
      },
    }
  );

  return res.data;
}

async function saveTokens(tokens: ProcoreTokenResponse) {
  const data = {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token ?? null,
    expires_in: tokens.expires_in,
    token_type: tokens.token_type,
    obtained_at: Date.now(),
  };

  await fs.writeFile(TOKEN_PATH, JSON.stringify(data, null, 2), "utf-8");
  console.log(`\nSaved tokens to ${TOKEN_PATH}`);
}

async function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function main() {
  console.log("=== Procore OAuth (redirectless) ===\n");

  const authUrl = createAuthUrl();
  console.log("1) Open this URL in your browser:\n");
  console.log(authUrl + "\n");

  console.log(
    "2) Log into Procore and authorize the app.\n" +
      "3) Procore will show you an authorization code.\n" +
      "4) Copy that code and paste it here.\n"
  );

  const code = await prompt("Paste the authorization code here: ");

  if (!code) {
    console.error("No code entered. Exiting.");
    process.exit(1);
  }

  console.log("\nExchanging code for tokens...\n");

  try {
    const tokens = await exchangeCodeForTokens(code);
    await saveTokens(tokens);

    console.log(
      "\nAccess token (truncated):",
      tokens.access_token.slice(0, 10) + "..."
    );
    if (tokens.refresh_token) {
      console.log(
        "Refresh token (truncated):",
        tokens.refresh_token.slice(0, 10) + "..."
      );
    } else {
      console.log(
        "No refresh_token returned (check Procore app config/scopes)."
      );
    }

    console.log("\nDone. You can now use tokens.json in other scripts.");
  } catch (err: any) {
    console.error("\nError exchanging code for tokens:");
    console.error(err.response?.data || err.message);
    process.exit(1);
  }
}

main();
