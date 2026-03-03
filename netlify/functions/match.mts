import type { Context, Config } from "@netlify/functions";

// Retry the Anthropic API call up to `maxAttempts` times on 529 Overloaded errors.
async function callAnthropic(
  apiKey: string,
  payload: unknown,
  maxAttempts = 3,
): Promise<Response> {
  const delays = [1000, 2000, 4000]; // ms between retries
  let lastResponse: Response | null = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type":      "application/json",
        "x-api-key":         apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(payload),
    });

    // Success or a non-retryable error — return immediately
    if (res.ok || res.status !== 529) return res;

    lastResponse = res;
    if (attempt < maxAttempts - 1) {
      await new Promise(r => setTimeout(r, delays[attempt]));
    }
  }

  return lastResponse!;
}

export default async (req: Request, context: Context) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const ANTHROPIC_API_KEY = Netlify.env.get("ANTHROPIC_API_KEY") ?? process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_API_KEY) {
    return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY not set" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  let body: {
    profile: string;
    keywords: string[];
    threshold: number;
    fundingSources: { name: string; url: string; tag: string }[];
    newsSources:    { name: string; url: string }[];
    extraSources?:  { category: string; name: string; url: string }[];
  };

  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { profile, keywords, threshold, fundingSources, newsSources, extraSources = [] } = body;

  // Build readable source lists for the prompt
  const fundingList = fundingSources
    .map(f => `  - ${f.name} (${f.tag ?? ""}) → ${f.url}`)
    .join("\n");

  const newsList = newsSources
    .map(n => `  - ${n.name} → ${n.url}`)
    .join("\n");

  const extraList = extraSources.length
    ? "\nExtra sources to consider:\n" +
      extraSources.map(e => `  - [${e.category}] ${e.name} → ${e.url}`).join("\n")
    : "";

  const prompt = `You are a Norwegian grant intelligence agent.

Organisation profile: "${profile.slice(0, 300)}"
Keywords: ${keywords.slice(0, 8).join(", ")}
Min match score: ${threshold}

Funding sources (name → URL):
${fundingList}

News / political sources (name → URL):
${newsList}${extraList}

Find the 3–5 best matches between a funding source and a relevant news/political topic.
For each match return one JSON object. Use the exact URLs provided above for fundUrl and newsUrl.
For orgUrl, provide the best known website for the suggested recipient organisation.

Reply ONLY with a valid JSON array (no markdown, no code fences):
[{
  "score": 85,
  "fund": "DAM – Forebyggende helse",
  "fundUrl": "https://www.dam.no/organisasjoner/",
  "news": "Psykisk helse blant unge (NRK)",
  "newsUrl": "https://www.nrk.no",
  "insight": "one sentence in English explaining the alignment",
  "org": "Mental Helse Norge",
  "orgUrl": "https://www.mentalhelse.no",
  "contact": "post@mentalhelse.no",
  "deadline": "2025-09-01",
  "amount": "NOK 800 000",
  "draft": "2–3 sentence Norwegian proposal summary",
  "status": "new"
}]`;

  const response = await callAnthropic(ANTHROPIC_API_KEY, {
    model:      "claude-haiku-4-5-20251001",
    max_tokens: 2000,
    messages:   [{ role: "user", content: prompt }],
  });

  if (!response.ok) {
    let errBody: { type?: string; error?: { type?: string; message?: string } } = {};
    try { errBody = await response.json(); } catch { /* ignore */ }

    const isOverloaded =
      response.status === 529 ||
      errBody?.error?.type === "overloaded_error";

    const message = isOverloaded
      ? "Claude API is temporarily overloaded — please wait a moment and try again."
      : (errBody?.error?.message ?? `Anthropic API error (${response.status})`);

    return new Response(JSON.stringify({ error: message }), {
      status: isOverloaded ? 503 : 502,
      headers: { "Content-Type": "application/json" },
    });
  }

  const data = await response.json();
  const text = data.content?.[0]?.text ?? "[]";

  let matches;
  try {
    const clean = text.replace(/```json|```/g, "").trim();
    matches = JSON.parse(clean);
  } catch {
    return new Response(JSON.stringify({ error: "Failed to parse Claude response", raw: text }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ matches }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};

export const config: Config = {
  path:    "/api/match",
  timeout: 60, // allow up to 3 retries with backoff on overloaded errors
};
