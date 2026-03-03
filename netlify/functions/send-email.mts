import type { Context } from "@netlify/functions";

export default async (req: Request, context: Context) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const GMAIL_CLIENT_ID     = Netlify.env.get("GMAIL_CLIENT_ID");
  const GMAIL_CLIENT_SECRET = Netlify.env.get("GMAIL_CLIENT_SECRET");
  const GMAIL_REFRESH_TOKEN = Netlify.env.get("GMAIL_REFRESH_TOKEN");
  const GMAIL_FROM          = Netlify.env.get("GMAIL_FROM_EMAIL");

  if (!GMAIL_CLIENT_ID || !GMAIL_CLIENT_SECRET || !GMAIL_REFRESH_TOKEN || !GMAIL_FROM) {
    return new Response(
      JSON.stringify({
        error: "Gmail not configured. Set GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN, GMAIL_FROM_EMAIL in Netlify env vars.",
        setup_url: "https://developers.google.com/gmail/api/quickstart/nodejs",
      }),
      { status: 503, headers: { "Content-Type": "application/json" } }
    );
  }

  let body: { to: string; subject: string; html: string; text: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Step 1: Refresh OAuth2 access token
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id:     GMAIL_CLIENT_ID,
      client_secret: GMAIL_CLIENT_SECRET,
      refresh_token: GMAIL_REFRESH_TOKEN,
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

  // Step 2: Build RFC 2822 email
  const emailLines = [
    `From: Grant Intelligence <${GMAIL_FROM}>`,
    `To: ${body.to}`,
    `Subject: ${body.subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/html; charset=utf-8`,
    ``,
    body.html,
  ];
  const raw = btoa(unescape(encodeURIComponent(emailLines.join("\r\n"))))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  // Step 3: Send via Gmail API
  const sendRes = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ raw }),
    }
  );

  if (!sendRes.ok) {
    const err = await sendRes.text();
    return new Response(JSON.stringify({ error: `Gmail send failed: ${err}` }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }

  const result = await sendRes.json();
  return new Response(JSON.stringify({ success: true, messageId: result.id }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};

export const config = {
  path: "/api/send-email",
};
