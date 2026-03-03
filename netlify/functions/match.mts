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
For each match return one JSON object with the following rules:

- fundUrl:  a Google search URL that will find the specific grant program / application page.
  Format: https://www.google.com/search?q=FUND+NAME+tilskudd+søknad
  Example: https://www.google.com/search?q=DAM+forebyggende+helse+tilskudd+søknad

- newsUrl:  a Google search URL that will find real news articles about this specific topic on that news site.
  Format: https://www.google.com/search?q=TOPIC+KEYWORDS+site:NEWSDOMAIN
  Example: https://www.google.com/search?q=psykisk+helse+unge+site:nrk.no

- orgUrl:   the organisation's own website (best known URL).

- explanation: 3–4 sentences in English explaining the full match reasoning:
  (1) what the news topic is about and why it is currently relevant,
  (2) what the suggested organisation does and why it is a strong fit for this topic,
  (3) what the funder's mission / grant program is and how it connects to both,
  (4) what makes this a high-scoring match overall.

Reply ONLY with a valid JSON array (no markdown, no code fences):
[{
  "score": 85,
  "fund": "DAM – Forebyggende helse",
  "fundUrl": "https://www.google.com/search?q=DAM+forebyggende+helse+tilskudd+søknad",
  "news": "Psykisk helse blant unge (NRK)",
  "newsUrl": "https://www.google.com/search?q=psykisk+helse+unge+site:nrk.no",
  "insight": "one sentence in English explaining the alignment",
  "explanation": "NRK has been reporting extensively on the mental health crisis among Norwegian youth, with studies showing a significant rise in anxiety and depression post-pandemic. Mental Helse Norge is a user-led organisation focused specifically on mental health advocacy and support, making them an ideal applicant for a mental-health-focused grant. DAM's Forebyggende helse programme funds preventive health initiatives, and the alignment between current public debate, the organisation's purpose, and the funder's criteria is very strong. The combination of high media attention and direct thematic overlap gives this match a high probability of success.",
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
    max_tokens: 3000,
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
