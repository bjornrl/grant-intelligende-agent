import type { Context } from "@netlify/functions";

export default async (req: Request, context: Context) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const SUPABASE_URL  = Netlify.env.get("SUPABASE_URL") ?? process.env.SUPABASE_URL;
  const SUPABASE_KEY  = Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? process.env.SUPABASE_SERVICE_ROLE_KEY;

  const GDRIVE_CLIENT_ID     = Netlify.env.get("GDRIVE_CLIENT_ID");
  const GDRIVE_CLIENT_SECRET = Netlify.env.get("GDRIVE_CLIENT_SECRET");
  const GDRIVE_REFRESH_TOKEN = Netlify.env.get("GDRIVE_REFRESH_TOKEN");
  const SHEET_ID             = Netlify.env.get("GDRIVE_SHEET_ID");

  let body: {
    match: {
      id?: number;          // if updating an existing Supabase row
      score: number;
      fund: string;
      fund_url?: string;
      news: string;
      news_url?: string;
      insight: string;
      explanation?: string;
      org: string;
      org_url?: string;
      contact: string;
      deadline: string;
      amount: string;
      draft?: string;
      status: string;
      grant_id?: number;
      news_id?: number;
      organisation_id?: number;
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

  const { match } = body;
  const results: Record<string, unknown> = {};

  // ------------------------------------------------------------------
  // 1. Save / update in Supabase (primary store)
  // ------------------------------------------------------------------
  if (SUPABASE_URL && SUPABASE_KEY) {
    const row = {
      score:           match.score,
      fund:            match.fund,
      fund_url:        match.fund_url ?? null,
      news:            match.news,
      news_url:        match.news_url ?? null,
      insight:         match.insight,
      explanation:     match.explanation ?? null,
      org:             match.org,
      org_url:         match.org_url ?? null,
      contact:         match.contact,
      deadline:        match.deadline,
      amount:          match.amount,
      draft:           match.draft ?? null,
      status:          match.status,
      grant_id:        match.grant_id ?? null,
      news_id:         match.news_id ?? null,
      organisation_id: match.organisation_id ?? null,
    };

    if (match.id) {
      // Update existing row
      const upRes = await fetch(
        `${SUPABASE_URL}/rest/v1/matches?id=eq.${match.id}`,
        {
          method: "PATCH",
          headers: {
            "apikey": SUPABASE_KEY,
            "Authorization": `Bearer ${SUPABASE_KEY}`,
            "Content-Type": "application/json",
            "Prefer": "return=representation",
          },
          body: JSON.stringify(row),
        },
      );
      results.supabase = upRes.ok ? "updated" : `error ${upRes.status}`;
    } else {
      // Insert new row
      const insRes = await fetch(`${SUPABASE_URL}/rest/v1/matches`, {
        method: "POST",
        headers: {
          "apikey": SUPABASE_KEY,
          "Authorization": `Bearer ${SUPABASE_KEY}`,
          "Content-Type": "application/json",
          "Prefer": "return=representation",
        },
        body: JSON.stringify(row),
      });
      if (insRes.ok) {
        const inserted = await insRes.json();
        results.supabase = "inserted";
        results.supabaseId = inserted?.[0]?.id ?? null;
      } else {
        results.supabase = `error ${insRes.status}`;
      }
    }
  } else {
    results.supabase = "skipped – SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set";
  }

  // ------------------------------------------------------------------
  // 2. Also log to Google Sheet if configured (legacy / optional)
  // ------------------------------------------------------------------
  if (GDRIVE_CLIENT_ID && GDRIVE_CLIENT_SECRET && GDRIVE_REFRESH_TOKEN && SHEET_ID) {
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

    if (tokenRes.ok) {
      const { access_token } = await tokenRes.json();
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
        },
      );

      if (appendRes.ok) {
        const r = await appendRes.json();
        results.sheets = r.updates?.updatedRange ?? "ok";
      } else {
        results.sheets = `error ${appendRes.status}`;
      }
    } else {
      results.sheets = "token refresh failed";
    }
  }

  return new Response(
    JSON.stringify({ success: true, ...results }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
};

export const config = {
  path: "/api/log-match",
};
