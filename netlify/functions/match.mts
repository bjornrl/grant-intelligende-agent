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

    if (res.ok || res.status !== 529) return res;

    lastResponse = res;
    if (attempt < maxAttempts - 1) {
      await new Promise(r => setTimeout(r, delays[attempt]));
    }
  }

  return lastResponse!;
}

interface Grant {
  id: number;
  title: string;
  funder: string;
  funder_url: string | null;
  program_url: string | null;
  description: string | null;
  focus_areas: string[] | null;
  keywords: string[] | null;
  amount_min: number | null;
  amount_max: number | null;
  deadline_text: string | null;
  deadline_date: string | null;
  eligibility: string | null;
  status: string;
}

interface NewsItem {
  id: number;
  title: string;
  url: string | null;
  source: string | null;
  summary: string | null;
  keywords: string[] | null;
  published_at: string | null;
}

async function fetchGrantsFromSupabase(
  supabaseUrl: string,
  supabaseKey: string,
): Promise<Grant[]> {
  const res = await fetch(
    `${supabaseUrl}/rest/v1/grants?status=eq.active&select=*`,
    {
      headers: {
        "apikey": supabaseKey,
        "Authorization": `Bearer ${supabaseKey}`,
      },
    },
  );
  if (!res.ok) return [];
  return res.json();
}

async function fetchRecentNewsFromSupabase(
  supabaseUrl: string,
  supabaseKey: string,
): Promise<NewsItem[]> {
  const res = await fetch(
    `${supabaseUrl}/rest/v1/news?select=*&order=published_at.desc&limit=20`,
    {
      headers: {
        "apikey": supabaseKey,
        "Authorization": `Bearer ${supabaseKey}`,
      },
    },
  );
  if (!res.ok) return [];
  return res.json();
}

async function saveMatchesToSupabase(
  supabaseUrl: string,
  supabaseKey: string,
  matches: Array<Record<string, unknown>>,
): Promise<void> {
  if (!matches.length) return;
  await fetch(`${supabaseUrl}/rest/v1/matches`, {
    method: "POST",
    headers: {
      "apikey": supabaseKey,
      "Authorization": `Bearer ${supabaseKey}`,
      "Content-Type": "application/json",
      "Prefer": "return=minimal",
    },
    body: JSON.stringify(matches),
  });
}

export default async (req: Request, context: Context) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const ANTHROPIC_API_KEY  = Netlify.env.get("ANTHROPIC_API_KEY") ?? process.env.ANTHROPIC_API_KEY;
  const SUPABASE_URL       = Netlify.env.get("SUPABASE_URL") ?? process.env.SUPABASE_URL;
  // Use anon key for reads (public RLS policies) and service role for writes
  const SUPABASE_READ_KEY  = Netlify.env.get("SUPABASE_ANON_KEY") ?? process.env.SUPABASE_ANON_KEY
                          ?? Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  const SUPABASE_WRITE_KEY = Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? process.env.SUPABASE_SERVICE_ROLE_KEY;

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
    // Legacy fields – still accepted for backwards compatibility
    fundingSources?: { name: string; url: string; tag: string }[];
    newsSources?:    { name: string; url: string }[];
    extraSources?:   { category: string; name: string; url: string }[];
    // New fields
    saveToSupabase?: boolean;  // if true, persist matches back to Supabase
    org_id?: number;           // if provided, tag saved matches with organisation FK
  };

  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const {
    profile,
    keywords,
    threshold,
    fundingSources = [],
    newsSources = [],
    extraSources = [],
    saveToSupabase = false,
    org_id,
  } = body;

  // ------------------------------------------------------------------
  // 1. Load grants from Supabase (if configured), fall back to provided
  // ------------------------------------------------------------------
  let grantsFromDB: Grant[] = [];
  let newsFromDB: NewsItem[] = [];

  if (SUPABASE_URL && SUPABASE_READ_KEY) {
    [grantsFromDB, newsFromDB] = await Promise.all([
      fetchGrantsFromSupabase(SUPABASE_URL, SUPABASE_READ_KEY),
      fetchRecentNewsFromSupabase(SUPABASE_URL, SUPABASE_READ_KEY),
    ]);
  }

  // Build funding list – prefer DB grants over provided fundingSources
  let fundingList: string;
  if (grantsFromDB.length > 0) {
    fundingList = grantsFromDB
      .map(g => {
        const amount = g.amount_min || g.amount_max
          ? `${g.amount_min ? `NOK ${g.amount_min.toLocaleString()}` : ""}${g.amount_min && g.amount_max ? "–" : ""}${g.amount_max ? `NOK ${g.amount_max.toLocaleString()}` : ""}`.trim()
          : "";
        const deadline = g.deadline_text ?? g.deadline_date ?? "Se nettsiden";
        const focus = g.focus_areas?.join(", ") ?? "";
        return `  - [ID:${g.id}] ${g.funder} – ${g.title} → ${g.program_url ?? g.funder_url}\n    Søknadsfrist: ${deadline}${amount ? " | " + amount : ""}${focus ? " | Fokus: " + focus : ""}`;
      })
      .join("\n");
  } else {
    fundingList = fundingSources
      .map(f => `  - ${f.name} (${f.tag ?? ""}) → ${f.url}`)
      .join("\n");
  }

  // Build news list – prefer DB news over provided newsSources
  let newsList: string;
  if (newsFromDB.length > 0) {
    newsList = newsFromDB
      .map(n => {
        const date = n.published_at ? n.published_at.split("T")[0] : "";
        return `  - [NID:${n.id}] (${n.source ?? "ukjent"} ${date}) ${n.title} → ${n.url ?? ""}${n.summary ? "\n    Sammendrag: " + n.summary.slice(0, 150) : ""}`;
      })
      .join("\n");
  } else {
    newsList = newsSources
      .map(n => `  - ${n.name} → ${n.url}`)
      .join("\n");
  }

  const extraList = extraSources.length
    ? "\nExtra sources to consider:\n" +
      extraSources.map(e => `  - [${e.category}] ${e.name} → ${e.url}`).join("\n")
    : "";

  const usingDBGrants = grantsFromDB.length > 0;
  const usingDBNews   = newsFromDB.length > 0;

  // ------------------------------------------------------------------
  // 2. Build prompt
  // ------------------------------------------------------------------
  const prompt = `You are a Norwegian grant intelligence agent.

Organisation profile: "${profile.slice(0, 500)}"
Keywords: ${keywords.slice(0, 10).join(", ")}
Min match score: ${threshold}

${usingDBGrants ? "Grant programs (from database):" : "Funding sources:"}
${fundingList}

${usingDBNews ? "Recent Norwegian news items (from database):" : "News / political sources (name → URL):"}
${newsList}${extraList}

Find the 3–5 best matches between a grant program and a relevant news/political topic for this organisation profile.
${usingDBGrants ? 'When referencing a grant, include its [ID:X] number as "grantId" in your JSON.' : ""}
${usingDBNews ? 'When referencing a news item, include its [NID:X] number as "newsId" in your JSON.' : ""}

For each match return one JSON object with the following rules:

- fundUrl:  the direct program URL if available, otherwise a Google search URL.
  Format: https://www.google.com/search?q=FUND+NAME+tilskudd+søknad

- newsUrl:  a Google search URL that will find real news articles about this specific topic.
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
  "grantId": 1,
  "newsId": null,
  "fund": "Stiftelsen Dam – Helse – Prosjektstøtte",
  "fundUrl": "https://www.dam.no/programmer/helse/",
  "news": "Psykisk helse blant unge (NRK)",
  "newsUrl": "https://www.google.com/search?q=psykisk+helse+unge+site:nrk.no",
  "insight": "one sentence in English explaining the alignment",
  "explanation": "NRK has been reporting extensively on the mental health crisis among Norwegian youth, with studies showing a significant rise in anxiety and depression post-pandemic. Mental Helse Norge is a user-led organisation focused specifically on mental health advocacy and support, making them an ideal applicant for a mental-health-focused grant. DAM's Helse programme funds preventive health initiatives, and the alignment between current public debate, the organisation's purpose, and the funder's criteria is very strong. The combination of high media attention and direct thematic overlap gives this match a high probability of success.",
  "org": "Mental Helse Norge",
  "orgUrl": "https://www.mentalhelse.no",
  "contact": "post@mentalhelse.no",
  "deadline": "2025-09-01",
  "amount": "NOK 400 000",
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

  let matches: Array<Record<string, unknown>>;
  try {
    const clean = text.replace(/```json|```/g, "").trim();
    matches = JSON.parse(clean);
  } catch {
    return new Response(JSON.stringify({ error: "Failed to parse Claude response", raw: text }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  // ------------------------------------------------------------------
  // 3. Optionally save to Supabase matches table
  // ------------------------------------------------------------------
  if (saveToSupabase && SUPABASE_URL && SUPABASE_WRITE_KEY && matches.length > 0) {
    const rows = matches.map(m => ({
      score:           m.score,
      fund:            m.fund,
      fund_url:        m.fundUrl,
      news:            m.news,
      news_url:        m.newsUrl,
      insight:         m.insight,
      org:             m.org,
      org_url:         m.orgUrl,
      contact:         m.contact,
      deadline:        m.deadline,
      amount:          m.amount,
      draft:           m.draft,
      status:          m.status ?? "new",
      explanation:     m.explanation,
      // New FK columns – only set if we have IDs
      grant_id:        typeof m.grantId === "number" ? m.grantId : null,
      news_id:         typeof m.newsId  === "number" ? m.newsId  : null,
      organisation_id: org_id ?? null,
    }));

    await saveMatchesToSupabase(SUPABASE_URL, SUPABASE_WRITE_KEY, rows);
  }

  return new Response(JSON.stringify({ matches }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};

export const config: Config = {
  path:    "/api/match",
  timeout: 60,
};
