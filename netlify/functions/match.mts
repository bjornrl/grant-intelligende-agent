import type { Context } from "@netlify/functions";

export default async (req: Request, context: Context) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const ANTHROPIC_API_KEY = Netlify.env.get("ANTHROPIC_API_KEY");
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
    newsSources: { name: string; url: string }[];
  };

  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { profile, keywords, threshold, fundingSources, newsSources } = body;

  const prompt = `You are a Norwegian grant intelligence agent. Your job is to find strong matches between funding programs and recent news/political topics, then draft project proposals.

Organisation profile: "${profile}"
Keywords of interest: ${keywords.join(", ")}

Active funding sources:
${fundingSources.map((f) => `- ${f.name} (${f.tag}): ${f.url}`).join("\n")}

Active news/political sources:
${newsSources.map((n) => `- ${n.name}: ${n.url}`).join("\n")}

Based on this, generate 3-5 realistic grant match opportunities. For each match:
1. Pick a realistic funding program from the funding sources list
2. Reference a plausible recent Norwegian news topic relevant to the org profile
3. Score the alignment (0-100)
4. Write a concise alignment insight in English
5. Identify the most relevant Norwegian organisation to contact
6. Provide a contact email (use realistic-looking Norwegian org emails)
7. Set a realistic application deadline (within the next 6 months)
8. Suggest a funding amount in NOK
9. Draft a 3-paragraph project proposal in Norwegian

Only include matches with score >= ${threshold}.

Respond ONLY with a valid JSON array, no markdown, no explanation. Format:
[
  {
    "score": number,
    "fund": "string - funding program name",
    "news": "string - news topic and source",
    "insight": "string - alignment explanation in English",
    "org": "string - Norwegian organisation name",
    "contact": "string - email address",
    "deadline": "YYYY-MM-DD",
    "amount": "NOK X XXX XXX",
    "draft": "string - full Norwegian draft letter",
    "status": "new"
  }
]`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4000,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    return new Response(JSON.stringify({ error: `Anthropic API error: ${err}` }), {
      status: 502,
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

export const config = {
  path: "/api/match",
};
