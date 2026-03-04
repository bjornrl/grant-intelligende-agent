/**
 * netlify/functions/match.js
 *
 * Grant intelligence pipeline:
 *  1. Fetches real grants from dedicated scraper functions
 *  2. Sends them + org profile to Claude for relevance scoring + draft generation
 *
 * POST /api/match
 * Body: {
 *   profile:       string,
 *   keywords:      string[],
 *   threshold:     number (0-100),
 *   fundingSources: Source[],  // active sources from the UI
 *   newsSources:    Source[],
 *   extraSources:   Source[],
 * }
 */

export const handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_API_KEY) {
    return {
      statusCode: 500, headers,
      body: JSON.stringify({ error: "ANTHROPIC_API_KEY not configured in environment variables" }),
    };
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid JSON body" }) };
  }

  const {
    profile        = "",
    keywords       = [],
    threshold      = 70,
    fundingSources = [],
    newsSources    = [],
    extraSources   = [],
  } = body;

  const siteBase = process.env.URL || process.env.DEPLOY_URL || "http://localhost:8888";

  try {
    // ── Step 1: Collect grants from scrapers ─────────────────────────────────
    //
    // Each scraper is its own Netlify function file.
    // Only call scrapers whose source is active in the UI.
    //
    // Currently implemented:
    //   scrape-forskningsradet  →  source ids: "nfr"
    //
    // To add more later, duplicate the pattern below:
    //   scrape-innovasjonnorge  →  source ids: "innov"
    //   scrape-dam              →  source ids: "dam", "extra"
    //   scrape-eu               →  source ids: "eu"

    const activeIds  = new Set(fundingSources.map(s => s.id));
    const activeUrls = fundingSources.map(s => s.url || "");

    // Run all active scrapers. If no funding sources specified, run all.
    const scraperCalls = [];

    const wantsNFR = fundingSources.length === 0
      || activeIds.has("nfr")
      || activeUrls.some(u => u.includes("forskningsradet"));

    if (wantsNFR) {
      scraperCalls.push(
        callScraper(`${siteBase}/.netlify/functions/scrape-forskningsradet`)
      );
    }

    const scraperResults = await Promise.allSettled(scraperCalls);

    let grants = [];
    for (const result of scraperResults) {
      if (result.status === "fulfilled") {
        grants = grants.concat(result.value);
      } else {
        console.warn("[match] Scraper failed:", result.reason?.message);
      }
    }

    // Deduplicate by URL
    const seen = new Set();
    grants = grants.filter(g => {
      if (!g.url || seen.has(g.url)) return false;
      seen.add(g.url);
      return true;
    });

    console.log(`[match] ${grants.length} grants collected (live: ${grants.filter(g => !g._fallback).length})`);

    // ── Step 2: Ask Claude to score + match ──────────────────────────────────

    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: 4096,
        system: buildSystemPrompt(),
        messages: [{
          role: "user",
          content: buildUserPrompt({ profile, keywords, threshold, grants, newsSources, extraSources }),
        }],
      }),
    });

    if (!claudeRes.ok) {
      const err = await claudeRes.json().catch(() => ({}));
      const msg = err?.error?.message || `Claude API HTTP ${claudeRes.status}`;
      if (claudeRes.status === 529 || msg.toLowerCase().includes("overloaded")) {
        throw new Error("Claude is temporarily overloaded — please try again in a moment.");
      }
      throw new Error(msg);
    }

    const claudeData = await claudeRes.json();
    const rawText    = claudeData.content?.[0]?.text || "{}";

    let parsed;
    try {
      const clean = rawText
        .replace(/^```(?:json)?\s*/m, "")
        .replace(/\s*```\s*$/m, "")
        .trim();
      parsed = JSON.parse(clean);
    } catch {
      console.error("[match] Claude bad JSON:", rawText.slice(0, 300));
      throw new Error("Claude returned invalid JSON — please try again.");
    }

    const matches = (parsed.matches || []).map(m => ({
      ...m,
      status: m.status || deriveStatus(m.score),
    }));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        matches,
        meta: {
          grants_scraped: grants.length,
          live_data: grants.some(g => !g._fallback),
          sources_used: [...new Set(grants.map(g => g.source_id))],
        },
      }),
    };
  } catch (err) {
    console.error("[match] Error:", err.message);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message }),
    };
  }
};

// ── Helpers ───────────────────────────────────────────────────────────────────

async function callScraper(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Scraper ${url} → HTTP ${res.status}`);
  const data = await res.json();
  return (data.grants || []).map(g => ({ ...g, _fallback: !data.live }));
}

function deriveStatus(score) {
  if (score >= 85) return "draft_ready";
  if (score >= 70) return "reviewing";
  return "new";
}

// ── Prompt builders ───────────────────────────────────────────────────────────

function buildSystemPrompt() {
  return `You are a Norwegian grant intelligence assistant specialising in matching organisations with funding opportunities.

You receive:
- An organisation profile
- Topic keywords
- A minimum relevance threshold (0–100)
- Real grant opportunities scraped live from Norwegian funding portals
- Optionally: news sources and partner organisations

Your task:
1. Score each grant for relevance to the organisation (0–100)
2. Discard grants below the threshold
3. Return the top 5 matches, ranked by score descending
4. For each match, write a tailored draft proposal introduction (150–200 words)

Return ONLY valid JSON, no preamble, no markdown fences.

Schema:
{
  "matches": [
    {
      "score": number,
      "fund": string,
      "fundUrl": string,
      "news": string,
      "newsUrl": string,
      "org": string,
      "orgUrl": string,
      "contact": string,
      "deadline": string,
      "amount": string,
      "insight": string,
      "explanation": string,
      "draft": string,
      "status": "new" | "reviewing" | "draft_ready"
    }
  ]
}

Field rules:
- fund:        Grant title from the scraped data
- fundUrl:     The grant's direct URL (from the scraped url field — use it exactly)
- news:        Short label for a news search, e.g. "Mental helse forskning Norge 2025"
- newsUrl:     Google News URL: https://news.google.com/search?q=<encoded>&hl=no
- org:         A relevant partner or applicant organisation name
- orgUrl:      That organisation's website
- contact:     Suggested contact, e.g. "NFR programme officer — see grant page"
- deadline:    deadline_display from grant data, or "Rolling" if rolling
- amount:      amount from grant data, or "See website"
- insight:     One sentence on why this grant suits the organisation
- explanation: 2–3 sentences on match rationale
- draft:       150–200 word proposal intro in the grant's language (no/en)
- status:      draft_ready ≥ 85, reviewing 70–84, new otherwise`;
}

function buildUserPrompt({ profile, keywords, threshold, grants, newsSources, extraSources }) {
  const grantsJson = JSON.stringify(
    grants.slice(0, 15).map(({ _fallback, ...g }) => g),
    null, 2
  );

  const extras = extraSources.length > 0
    ? `\nPartner organisations:\n${extraSources.slice(0, 8).map(s => `- ${s.name}: ${s.url}`).join("\n")}\n`
    : "";

  const news = newsSources.length > 0
    ? `\nActive news sources: ${newsSources.map(s => s.name).join(", ")}\n`
    : "";

  return `Organisation profile:
"${profile}"

Keywords: ${keywords.join(", ")}
Threshold: ${threshold}/100
${extras}${news}
Grants to evaluate (${grants.length} total, live-scraped):
${grantsJson}

Return top matches as JSON.`;
}
