/**
 * Google OAuth2 loopback flow for desktop apps.
 *
 * No client secret required for installed application loopback flow.
 */

import * as http from "node:http";
import { shell } from "electron";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
// TODO: Create OAuth2 credentials in Google Cloud Console (Desktop app type)
// and replace this with your actual Client ID.
const CLIENT_ID =
  "YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com";
const SCOPES = encodeURIComponent("https://www.googleapis.com/auth/drive.file");

export interface OAuthTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

/** Start OAuth2 loopback flow and return tokens. */
export async function startOAuthFlow(): Promise<OAuthTokens> {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as import("node:net").AddressInfo).port;
      const redirectUri = `http://127.0.0.1:${port}/callback`;
      const state = randomState();

      const authUrl =
        `${GOOGLE_AUTH_URL}?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}` +
        `&response_type=code&scope=${SCOPES}&state=${state}&access_type=offline&prompt=consent`;

      shell.openExternal(authUrl);

      server.on("request", async (req, res) => {
        const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);

        if (url.pathname !== "/callback") {
          res.writeHead(404);
          res.end("Not found");
          return;
        }

        const code = url.searchParams.get("code");
        const returnedState = url.searchParams.get("state");

        if (!code || returnedState !== state) {
          res.writeHead(400, { "Content-Type": "text/html" });
          res.end(`<html><body><h2>Authorization failed</h2><p>Invalid state or missing code.</p></body></html>`);
          server.close();
          reject(new Error("OAuth callback invalid"));
          return;
        }

        try {
          const tokens = await exchangeCode(code, redirectUri);
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(`<html><body><h2>Authorization successful</h2><p>You can close this window.</p></body></html>`);
          server.close();
          resolve(tokens);
        } catch (err) {
          res.writeHead(500, { "Content-Type": "text/html" });
          res.end(`<html><body><h2>Authorization failed</h2><p>${String(err)}</p></body></html>`);
          server.close();
          reject(err);
        }
      });
    });
  });
}

/** Exchange authorization code for tokens. */
async function exchangeCode(code: string, redirectUri: string): Promise<OAuthTokens> {
  const params = new URLSearchParams();
  params.set("client_id", CLIENT_ID);
  params.set("code", code);
  params.set("redirect_uri", redirectUri);
  params.set("grant_type", "authorization_code");

  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed: ${res.status} ${text}`);
  }

  const data = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };

  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000,
  };
}

/** Refresh an access token using the refresh token. */
export async function refreshAccessToken(refreshToken: string): Promise<OAuthTokens> {
  const params = new URLSearchParams();
  params.set("client_id", CLIENT_ID);
  params.set("refresh_token", refreshToken);
  params.set("grant_type", "refresh_token");

  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token refresh failed: ${res.status} ${text}`);
  }

  const data = (await res.json()) as {
    access_token: string;
    expires_in: number;
  };

  return {
    access_token: data.access_token,
    refresh_token: refreshToken,
    expires_at: Date.now() + data.expires_in * 1000,
  };
}

function randomState(): string {
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}
