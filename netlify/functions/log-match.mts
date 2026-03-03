import type { Context } from "@netlify/functions";

export default async (req: Request, context: Context) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const GDRIVE_CLIENT_ID     = Netlify.env.get("GDRIVE_CLIENT_ID");
  const GDRIVE_CLIENT_SECRET = Netlify.env.get("GDRIVE_CLIENT_SECRET");
  const GDRIVE_REFRESH_TOKEN = Netlify.env.get("GDRIVE_REFRESH_TOKEN");
  const SHEET_ID             = Netlify.env.get("GDRIVE_SHEET_ID");

  if (!GDRIVE_CLIENT_ID || !GDRIVE_CLIENT_SECRET || !GDRIVE_REFRESH_TOKEN || !SHEET_ID) {
    return new Response(
      JSON.stringify({
        error: "Google Drive not configured.",
        required_env_vars: [
          "GDRIVE_CLIENT_ID",
          "GDRIVE_CLIENT_SECRET",
          "GDRIVE_REFRESH_TOKEN",
          "GDRIVE_SHEET_ID — the ID from your Google Sheet URL",
        ],
        setup_url: "https://developers.google.com/sheets/api/quickstart/nodejs",
      }),
      { status: 503, headers: { "Content-Type": "application/json" } }
    );
  }

  let body: {
    match: {
      score: number;
      fund: string;
      news: string;
      insight: string;
      org: string;
      contact: string;
      deadline: string;
      amount: string;
      status: string;
    };
  };

  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Step 1: Refresh token
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id:     GDRIVE_CLIENT_ID,
      client_secret: GDRIVE_CLIENT_SECRET,
      refresh_token: GDRIVE_REFRESH_TOKEN,
      grant_type:    "refresh_token",
    }),
  });

  if (!tokenRes.ok) {
    const err = await tokenRes.text();
    return new Response(JSON.stringify({ error: `OAuth token refresh failed: ${err}` }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { access_token } = await tokenRes.json();

  // Step 2: Append row to Google Sheet
  const { match } = body;
  const now = new Date().toISOString().split("T")[0];

  const values = [[
    now,
    match.score,
    match.fund,
    match.news,
    match.insight,
    match.org,
    match.contact,
    match.deadline,
    match.amount,
    match.status,
  ]];

  const appendRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/Sheet1!A1:J1:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ values }),
    }
  );

  if (!appendRes.ok) {
    const err = await appendRes.text();
    return new Response(JSON.stringify({ error: `Sheets append failed: ${err}` }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }

  const result = await appendRes.json();
  return new Response(
    JSON.stringify({ success: true, updatedRange: result.updates?.updatedRange }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
};

export const config = {
  path: "/api/log-match",
};
