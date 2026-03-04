/**
 * netlify/functions/scrape-forskningsradet.js
 *
 * Scrapes live grant listings from Norsk Forskningsråd (Research Council of Norway).
 *
 * Strategy:
 *  1. Fetch the /en/call-for-proposals/ listing page
 *  2. Extract all grant page links matching the /YEAR/slug/ pattern
 *  3. Fetch each grant page and parse: title, deadline, amount, topics, description
 *  4. Fall back to a curated hardcoded list if the site is unreachable
 *
 * GET  /.netlify/functions/scrape-forskningsradet
 * GET  /.netlify/functions/scrape-forskningsradet?year=2026   (filter by year)
 * GET  /.netlify/functions/scrape-forskningsradet?limit=5     (default: 10)
 *
 * Returns:
 * {
 *   source: "nfr",
 *   scraped_at: ISO string,
 *   live: boolean,          // true = fetched from website, false = fallback data
 *   count: number,
 *   grants: Grant[]
 * }
 *
 * Grant shape (matches what /api/match expects):
 * {
 *   id, source, source_id, title, url,
 *   deadline,         // ISO "YYYY-MM-DD" or null
 *   deadline_display, // human string e.g. "5 March 2025"
 *   rolling,          // boolean — true if open-ended
 *   amount,           // string or null, e.g. "NOK 750 000 000"
 *   description,      // ≤500 chars
 *   topics,           // string[]
 *   eligible,         // who can apply, e.g. "Research organisations"
 *   language,         // "en"
 * }
 */

const BASE_URL   = "https://www.forskningsradet.no";
const LIST_PATH  = "/en/call-for-proposals/";
const USER_AGENT = "Mozilla/5.0 (compatible; GrantIntelligenceBot/1.0; +https://github.com)";

// ── Entry point ───────────────────────────────────────────────────────────────

export const handler = async (event) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: corsHeaders, body: "" };
  }

  const params = event.queryStringParameters || {};
  const yearFilter = params.year ? parseInt(params.year, 10) : null;
  const limit      = Math.min(parseInt(params.limit || "10", 10), 20);

  try {
    const result = await scrapeForskningsradet({ yearFilter, limit });
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(result),
    };
  } catch (err) {
    console.error("[NFR] Unhandled error:", err);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: err.message }),
    };
  }
};

// ── Main scraper ──────────────────────────────────────────────────────────────

async function scrapeForskningsradet({ yearFilter, limit }) {
  // Step 1 — fetch listing page
  let listingHtml;
  try {
    listingHtml = await fetchWithTimeout(`${BASE_URL}${LIST_PATH}`, 10_000);
  } catch (e) {
    console.warn("[NFR] Listing page fetch failed:", e.message, "→ using fallback");
    return {
      source: "nfr",
      scraped_at: new Date().toISOString(),
      live: false,
      count: FALLBACK_GRANTS.length,
      grants: FALLBACK_GRANTS,
    };
  }

  // Step 2 — extract grant links from listing
  const grantLinks = extractGrantLinks(listingHtml, yearFilter);

  if (grantLinks.length === 0) {
    console.warn("[NFR] No grant links found on listing page → using fallback");
    return {
      source: "nfr",
      scraped_at: new Date().toISOString(),
      live: false,
      count: FALLBACK_GRANTS.length,
      grants: FALLBACK_GRANTS,
    };
  }

  // Step 3 — fetch individual grant pages (in parallel, up to `limit`)
  const toFetch = grantLinks.slice(0, limit);
  const settled = await Promise.allSettled(
    toFetch.map(link => fetchGrantPage(link.url, link.title))
  );

  const grants = settled
    .map(r => (r.status === "fulfilled" ? r.value : null))
    .filter(Boolean);

  // Deduplicate by URL
  const seen = new Set();
  const unique = grants.filter(g => {
    if (seen.has(g.url)) return false;
    seen.add(g.url);
    return true;
  });

  return {
    source: "nfr",
    scraped_at: new Date().toISOString(),
    live: true,
    count: unique.length,
    grants: unique,
  };
}

// ── Extract grant links from listing HTML ─────────────────────────────────────

function extractGrantLinks(html, yearFilter) {
  // NFR listing uses anchors like:
  //   /en/call-for-proposals/2025/some-grant-slug/
  //   /en/call-for-proposals/2026/another-grant/
  const re = /href="(\/en\/call-for-proposals\/(\d{4})\/([^"\/]+)\/)"/gi;
  const seen = new Set();
  const links = [];
  let m;

  while ((m = re.exec(html)) !== null) {
    const [, path, year, slug] = m;
    if (yearFilter && parseInt(year, 10) !== yearFilter) continue;
    const url = `${BASE_URL}${path}`;
    if (seen.has(url)) continue;
    seen.add(url);

    // Extract link text from surrounding context (grab the <a> text nearby)
    const anchorRe = new RegExp(`href="${escapeRegex(path)}"[^>]*>([\\s\\S]{0,200}?)<\\/a>`, "i");
    const textMatch = anchorRe.exec(html);
    const title = textMatch
      ? textMatch[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
      : slugToTitle(slug);

    links.push({ url, year: parseInt(year, 10), slug, title });
  }

  // Sort: most recent year first
  links.sort((a, b) => b.year - a.year);
  return links;
}

// ── Fetch + parse a single grant page ────────────────────────────────────────

async function fetchGrantPage(url, fallbackTitle) {
  const html = await fetchWithTimeout(url, 12_000);
  return parseGrantPage(html, url, fallbackTitle);
}

function parseGrantPage(html, url, fallbackTitle) {
  // ── Title ──
  const title = firstMatch(html, [
    /<h1[^>]*>([\s\S]*?)<\/h1>/i,
    /<title>([\s\S]*?)<\/title>/i,
  ]) || fallbackTitle || "Untitled grant";

  // ── Description: og:description or first <p> in main ──
  const description = (
    metaContent(html, "og:description") ||
    metaContent(html, "description") ||
    firstMatch(html, [/<p[^>]*>([\s\S]{60,600}?)<\/p>/i]) ||
    ""
  ).replace(/\s+/g, " ").slice(0, 500);

  // ── Deadline ──
  // NFR pages show e.g. "Application deadline: 5 March 2025" or "Søknadsfrist: ..."
  const deadlinePatterns = [
    /[Aa]pplication\s+deadline[^:]*:\s*<[^>]*>([^<]+)/,
    /[Aa]pplication\s+deadline[^:]*:?\s*([A-Z][a-z]+\s+\d{1,2},?\s+\d{4})/,
    /[Dd]eadline[^:]*:?\s*<[^>]*>([^<]+)/,
    /[Dd]eadline[^:]*:?\s*(\d{1,2}\s+[A-Za-z]+\s+\d{4})/,
    /(\d{1,2}\.\s*(?:januar|februar|mars|april|mai|juni|juli|august|september|oktober|november|desember)\s+\d{4})/i,
    /(\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4})/i,
  ];
  let deadlineRaw = null;
  for (const re of deadlinePatterns) {
    const m = re.exec(html);
    if (m) { deadlineRaw = m[1].replace(/<[^>]+>/g, "").trim(); break; }
  }

  const rolling = !deadlineRaw &&
    /rolling|open.?ended|fortløpende|åpen frist|no deadline/i.test(html);

  // ── Amount ──
  const amountMatch = html.match(
    /NOK\s*([\d\s]+(?:\s*(?:million|billion|mill\.|mrd|000))?)/i
  );
  const amount = amountMatch
    ? `NOK ${amountMatch[1].replace(/\s+/g, " ").trim()}`
    : null;

  // ── Topics / Thematic areas ──
  // NFR lists them in a section like "Relevant thematic areas for this call"
  const topicSection = html.match(
    /[Tt]hematic\s+area[^<]{0,60}<[^>]+>([\s\S]{0,800})/
  );
  let topics = [];
  if (topicSection) {
    const raw = topicSection[1].replace(/<[^>]+>/g, "\n");
    topics = raw
      .split("\n")
      .map(t => t.trim())
      .filter(t => t.length > 2 && t.length < 60)
      .slice(0, 8);
  }

  // ── Who can apply ──
  const eligibleMatch = html.match(
    /(?:[Ee]ligible\s+applicants?|[Ww]ho\s+can\s+apply)[^:]*:?\s*<[^>]*>([^<]+)/
  );
  const eligible = eligibleMatch
    ? eligibleMatch[1].replace(/<[^>]+>/g, "").trim()
    : null;

  // ── Derive ID from slug ──
  const slug = url.split("/").filter(Boolean).slice(-1)[0] || String(Date.now());
  const id = `nfr_${slug.slice(0, 60)}`;

  return {
    id,
    source: "Norsk Forskningsråd",
    source_id: "nfr",
    title: stripTags(title).replace(/\s+/g, " ").slice(0, 160),
    url,
    deadline: parseToISO(deadlineRaw),
    deadline_display: deadlineRaw || (rolling ? "Open-ended / rolling" : "See website"),
    rolling,
    amount,
    description,
    topics,
    eligible,
    language: "en",
  };
}

// ── HTML/date helpers ─────────────────────────────────────────────────────────

function stripTags(str) {
  return str.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function firstMatch(html, patterns) {
  for (const re of patterns) {
    const m = re.exec(html);
    if (m) return stripTags(m[1]);
  }
  return null;
}

function metaContent(html, name) {
  const re = new RegExp(
    `<meta[^>]+(?:name|property)=["']${name}["'][^>]+content=["']([^"']+)["']` +
    `|<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["']${name}["']`,
    "i"
  );
  const m = re.exec(html);
  return m ? (m[1] || m[2]).trim() : null;
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function slugToTitle(slug) {
  return slug
    .replace(/-/g, " ")
    .replace(/\b\w/g, c => c.toUpperCase());
}

const EN_MONTHS = {
  january: "01", february: "02", march: "03", april: "04",
  may: "05", june: "06", july: "07", august: "08",
  september: "09", october: "10", november: "11", december: "12",
};
const NO_MONTHS = {
  januar: "01", februar: "02", mars: "03", april: "04",
  mai: "05", juni: "06", juli: "07", august: "08",
  september: "09", oktober: "10", november: "11", desember: "12",
};

function parseToISO(str) {
  if (!str) return null;

  // Already ISO
  if (/^\d{4}-\d{2}-\d{2}$/.test(str.trim())) return str.trim();

  // "5 March 2025" / "5. mars 2025"
  const m = str.match(/(\d{1,2})\.?\s+([A-Za-z]+)\s+(\d{4})/);
  if (m) {
    const monthKey = m[2].toLowerCase();
    const month = EN_MONTHS[monthKey] || NO_MONTHS[monthKey];
    if (month) {
      return `${m[3]}-${month}-${m[1].padStart(2, "0")}`;
    }
  }

  return null;
}

async function fetchWithTimeout(url, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-GB,en;q=0.9",
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

// ── Hardcoded fallback (used when site is unreachable) ────────────────────────
// Kept up-to-date with known active/recent calls as of March 2026.

const FALLBACK_GRANTS = [
  {
    id: "nfr_fripro-experienced-scientists",
    source: "Norsk Forskningsråd",
    source_id: "nfr",
    title: "Researcher Project for Experienced Scientists (FRIPRO)",
    url: "https://www.forskningsradet.no/en/call-for-proposals/2025/researcher-project-experienced-scientists-fripro/",
    deadline: null,
    deadline_display: "Open-ended / rolling",
    rolling: true,
    amount: "NOK 750 000 000",
    description: "Funds curiosity-driven and bold research advancing the state-of-the-art. Open to experienced scientists (6+ years post-PhD) in all research areas, both basic and applied.",
    topics: ["Basic research", "Applied research", "All disciplines"],
    eligible: "Approved Norwegian research organisations",
    language: "en",
  },
  {
    id: "nfr_fripro-early-career-scientists",
    source: "Norsk Forskningsråd",
    source_id: "nfr",
    title: "Researcher Project for Early Career Scientists (FRIPRO)",
    url: "https://www.forskningsradet.no/en/call-for-proposals/2025/researcher-project-early-career-scientists-fripro/",
    deadline: null,
    deadline_display: "Open-ended / rolling",
    rolling: true,
    amount: "NOK 510 000 000",
    description: "For researchers 2–7 years post-PhD to gain experience leading a research project. Supports both basic and applied research in all disciplines.",
    topics: ["Early career research", "All disciplines"],
    eligible: "Approved Norwegian research organisations",
    language: "en",
  },
  {
    id: "nfr_collaborative-project-societal-industry-challenges",
    source: "Norsk Forskningsråd",
    source_id: "nfr",
    title: "Collaborative Project to Meet Societal and Industry-related Challenges",
    url: "https://www.forskningsradet.no/en/call-for-proposals/2025/collaborative-project-societal-industry-challenges/",
    deadline: "2025-03-05",
    deadline_display: "5 March 2025",
    rolling: false,
    amount: "NOK 95 000 000 (Health theme)",
    description: "Supports research organisations collaborating with society/industry on research-based innovation. Thematic areas include Health, Energy, Food & bio-resources, Enabling technologies, Welfare.",
    topics: ["Health", "Energy", "Food & bio-resources", "Enabling technologies", "Welfare", "Democracy"],
    eligible: "Research organisations + industry/society partners",
    language: "en",
  },
  {
    id: "nfr_industrial-phd-2025",
    source: "Norsk Forskningsråd",
    source_id: "nfr",
    title: "Industrial PhD Scheme – Doctoral Projects in Industry 2025",
    url: "https://www.forskningsradet.no/en/call-for-proposals/2025/industrial-phd-scheme--doctoral-projects-in-industry-2025/",
    deadline: null,
    deadline_display: "See website",
    rolling: false,
    amount: "Up to 57 projects funded",
    description: "Enhances research capacity and long-term competence-building in Norwegian trade and industry through doctoral candidates. Themes: AI (15 projects), climate, maritime, transport.",
    topics: ["AI", "Industry", "PhD", "Climate", "Maritime", "Transport"],
    eligible: "Norwegian companies",
    language: "en",
  },
  {
    id: "nfr_innovation-project-industrial-sector-2026",
    source: "Norsk Forskningsråd",
    source_id: "nfr",
    title: "Innovation Project for the Industrial Sector: Industry and Services 2026",
    url: "https://www.forskningsradet.no/en/call-for-proposals/2026/innovation-project-for-the-industrial-sector-industry-and-services-2026/",
    deadline: null,
    deadline_display: "2026 – see website",
    rolling: false,
    amount: null,
    description: "Supports companies and research organisations carrying out research-based innovation projects. Aims to commercialise results and generate broader societal value.",
    topics: ["Industrial innovation", "Services", "Industry", "Research-based innovation"],
    eligible: "Companies registered in Norway",
    language: "en",
  },
  {
    id: "nfr_pre-projects-global-health",
    source: "Norsk Forskningsråd",
    source_id: "nfr",
    title: "Pre-projects on Global Health",
    url: "https://www.forskningsradet.no/en/call-for-proposals/2025/pre-projects-global-health/",
    deadline: "2025-12-12",
    deadline_display: "12 December 2025",
    rolling: false,
    amount: "Up to NOK 250 000 per project",
    description: "Prepares applications for the 2026 Researcher Project on Global Health; funds travel, workshops, meetings with research partners in low- and lower-middle-income countries.",
    topics: ["Global health", "International collaboration", "LMICs", "Development"],
    eligible: "Approved Norwegian research organisations",
    language: "en",
  },
  {
    id: "nfr_eligible-erc-applications-2026",
    source: "Norsk Forskningsråd",
    source_id: "nfr",
    title: "Funding for Eligible ERC Applications (2026)",
    url: "https://www.forskningsradet.no/en/call-for-proposals/2026/eligible-erc-applications/",
    deadline: null,
    deadline_display: "2026 – invitation only",
    rolling: false,
    amount: null,
    description: "Bridges funding for Norwegian researchers who qualify for but missed ERC grants. Stimulates world-leading research groups and increases Norwegian ERC applications.",
    topics: ["ERC", "Excellence", "World-leading research", "All disciplines"],
    eligible: "Invited applicants only",
    language: "en",
  },
];
