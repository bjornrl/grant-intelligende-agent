/**
 * fetch-news.mts
 *
 * Fetches recent Norwegian news from RSS feeds and stores them in the
 * Supabase `news` table. Designed to be called periodically (e.g. every
 * few hours via a scheduled Netlify function or external cron).
 *
 * Supported call modes:
 *   POST /api/fetch-news          – fetch from all configured RSS feeds
 *   POST /api/fetch-news { sources: [...] } – fetch from specific sources only
 *
 * Each article is upserted by URL (ON CONFLICT DO NOTHING) so duplicate
 * runs are safe.
 */

import type { Context, Config } from "@netlify/functions";

interface RSSSource {
  name: string;
  url: string;
  category: string;
}

// Norwegian news & political RSS feeds relevant to health / social sector
const DEFAULT_SOURCES: RSSSource[] = [
  { name: "NRK Helse",         url: "https://www.nrk.no/toppsaker.rss",                           category: "news"      },
  { name: "Aftenposten",       url: "https://www.aftenposten.no/rss/nyheter/",                    category: "news"      },
  { name: "VG",                url: "https://www.vg.no/rss/feed/forsiden/",                       category: "news"      },
  { name: "Dagbladet",         url: "https://www.dagbladet.no/rss/rss.xml",                       category: "news"      },
  { name: "Dagsavisen",        url: "https://www.dagsavisen.no/rss/frontpage.rss",                category: "news"      },
  { name: "Stortinget saker",  url: "https://www.stortinget.no/no/Stortinget-og-demokratiet/Feeds/Feeds/?feedtype=3",  category: "politics" },
  { name: "Regjeringen HOD",   url: "https://www.regjeringen.no/contentassets/rss/departement/hod.xml", category: "politics" },
  { name: "Regjeringen BFD",   url: "https://www.regjeringen.no/contentassets/rss/departement/bfd.xml", category: "politics" },
  { name: "Helsedirektoratet", url: "https://www.helsedirektoratet.no/rss",                       category: "health"    },
  { name: "FHI",               url: "https://www.fhi.no/rss/",                                   category: "health"    },
];

interface ParsedItem {
  title: string;
  url: string;
  source: string;
  published_at: string | null;
  summary: string | null;
  keywords: string[];
  raw_text: string;
}

/** Very lightweight XML/RSS parser – no dependencies required */
function extractTagText(xml: string, tag: string): string {
  const re = new RegExp(`<${tag}[^>]*>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/${tag}>`, "si");
  const m = xml.match(re);
  return m ? m[1].trim() : "";
}

function parseRSSItems(xml: string, sourceName: string): ParsedItem[] {
  const items: ParsedItem[] = [];

  // Split on <item> blocks
  const itemRegex = /<item[^>]*>([\s\S]*?)<\/item>/gi;
  let match: RegExpExecArray | null;

  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];

    const title   = extractTagText(block, "title");
    const link    = extractTagText(block, "link") || extractTagText(block, "guid");
    const pubDate = extractTagText(block, "pubDate") || extractTagText(block, "dc:date") || extractTagText(block, "published");
    const desc    = extractTagText(block, "description") || extractTagText(block, "summary") || extractTagText(block, "content:encoded");

    if (!title || !link) continue;

    // Clean HTML from description
    const cleanDesc = desc.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 500);

    // Parse date
    let publishedAt: string | null = null;
    if (pubDate) {
      const d = new Date(pubDate);
      if (!isNaN(d.getTime())) publishedAt = d.toISOString();
    }

    // Extract simple keywords from title + description
    const text = `${title} ${cleanDesc}`.toLowerCase();
    const healthKeywords = [
      "helse", "psykisk", "rus", "alkohol", "narkotika", "rehabilitering",
      "funksjonshemm", "funksjonsnedset", "pårørende", "brukerorg", "tilskudd",
      "støtte", "stiftelse", "frivillig", "barn", "unge", "eldre", "demens",
      "kreft", "hjerte", "diabetes", "folkehelse", "forebygging", "levekår",
      "fattigdom", "utenforskap", "integrering", "flyktning", "innvandrer",
    ];
    const kw = healthKeywords.filter(k => text.includes(k));

    items.push({
      title,
      url: link,
      source: sourceName,
      published_at: publishedAt,
      summary: cleanDesc || null,
      keywords: kw,
      raw_text: `${title}\n${cleanDesc}`,
    });
  }

  return items;
}

async function fetchRSSFeed(source: RSSSource): Promise<ParsedItem[]> {
  try {
    const res = await fetch(source.url, {
      headers: { "User-Agent": "GrantIntelligenceAgent/1.0" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return [];
    const xml = await res.text();
    return parseRSSItems(xml, source.name);
  } catch {
    return [];
  }
}

async function upsertNewsItems(
  supabaseUrl: string,
  supabaseKey: string,
  items: ParsedItem[],
): Promise<{ inserted: number; errors: number }> {
  if (!items.length) return { inserted: 0, errors: 0 };

  // Upsert in batches of 50
  let inserted = 0;
  let errors = 0;
  const batchSize = 50;

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const res = await fetch(`${supabaseUrl}/rest/v1/news`, {
      method: "POST",
      headers: {
        "apikey": supabaseKey,
        "Authorization": `Bearer ${supabaseKey}`,
        "Content-Type": "application/json",
        "Prefer": "resolution=ignore-duplicates,return=minimal",
      },
      body: JSON.stringify(batch),
    });

    if (res.ok) {
      inserted += batch.length;
    } else {
      errors += batch.length;
    }
  }

  return { inserted, errors };
}

export default async (req: Request, context: Context) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const SUPABASE_URL = Netlify.env.get("SUPABASE_URL") ?? process.env.SUPABASE_URL;
  // Prefer service role key for upserts; fall back to anon key (will fail on RLS-protected tables)
  const SUPABASE_KEY = Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? process.env.SUPABASE_SERVICE_ROLE_KEY
                    ?? Netlify.env.get("SUPABASE_ANON_KEY") ?? process.env.SUPABASE_ANON_KEY;

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return new Response(
      JSON.stringify({ error: "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ANON_KEY) must be set" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  let sources = DEFAULT_SOURCES;
  try {
    const body = await req.json();
    if (Array.isArray(body?.sources) && body.sources.length > 0) {
      sources = body.sources;
    }
  } catch { /* use defaults */ }

  // Fetch all RSS feeds in parallel
  const allItems: ParsedItem[] = [];
  const fetchResults = await Promise.allSettled(sources.map(fetchRSSFeed));

  const sourceStats: Record<string, number> = {};
  fetchResults.forEach((result, i) => {
    if (result.status === "fulfilled") {
      allItems.push(...result.value);
      sourceStats[sources[i].name] = result.value.length;
    } else {
      sourceStats[sources[i].name] = 0;
    }
  });

  // Filter to items with at least one health keyword (or published in last 7 days)
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const relevant = allItems.filter(item =>
    item.keywords.length > 0 ||
    (item.published_at && item.published_at > cutoff),
  );

  const { inserted, errors } = await upsertNewsItems(SUPABASE_URL, SUPABASE_KEY, relevant);

  return new Response(
    JSON.stringify({
      success: true,
      total_fetched: allItems.length,
      relevant_items: relevant.length,
      inserted,
      errors,
      by_source: sourceStats,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
};

export const config: Config = {
  path:    "/api/fetch-news",
  timeout: 30,
};
