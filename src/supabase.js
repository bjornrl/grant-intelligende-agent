/**
 * Supabase REST client — no npm package required.
 * Uses the Supabase HTTP API directly via fetch.
 *
 * Set these env vars to enable persistence:
 *   VITE_SUPABASE_URL      = https://<ref>.supabase.co
 *   VITE_SUPABASE_ANON_KEY = your-anon-key
 */

const URL  = import.meta.env.VITE_SUPABASE_URL      ?? "";
const KEY  = import.meta.env.VITE_SUPABASE_ANON_KEY ?? "";

export const isEnabled = !!(URL && KEY);

// ── REST helpers ────────────────────────────────────────────────────────────

const headers = () => ({
  "Content-Type":  "application/json",
  "apikey":        KEY,
  "Authorization": `Bearer ${KEY}`,
  "Prefer":        "return=representation",
});

async function rest(path, opts = {}) {
  if (!isEnabled) return null;
  try {
    const res = await fetch(`${URL}/rest/v1${path}`, { headers: headers(), ...opts });
    if (!res.ok) {
      const text = await res.text();
      console.error(`Supabase ${opts.method ?? "GET"} ${path} →`, res.status, text);
      return null;
    }
    return res.status === 204 ? null : await res.json();
  } catch (e) {
    console.error("Supabase fetch error:", e);
    return null;
  }
}

// ── Sources ─────────────────────────────────────────────────────────────────

/** Load all sources grouped by category. Returns null if Supabase is not configured. */
export async function loadSources() {
  const rows = await rest("/sources?order=created_at.asc");
  if (!rows) return null;
  const grouped = {};
  for (const r of rows) {
    if (!grouped[r.category]) grouped[r.category] = [];
    grouped[r.category].push({
      id:     r.id,
      name:   r.name,
      url:    r.url,
      active: r.active,
      tag:    r.tag  ?? "",
      color:  r.color ?? "",
    });
  }
  return grouped;
}

/** Upsert a single source row. */
export async function upsertSource(category, source) {
  await rest("/sources", {
    method: "POST",
    headers: { ...headers(), Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({
      id:       source.id,
      category,
      name:     source.name,
      url:      source.url,
      active:   source.active,
      tag:      source.tag   || null,
      color:    source.color || null,
    }),
  });
}

/** Delete a source by id. */
export async function removeSource(id) {
  await rest(`/sources?id=eq.${encodeURIComponent(id)}`, { method: "DELETE" });
}

/** Toggle active on a single source. */
export async function toggleSource(id, active) {
  await rest(`/sources?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ active }),
  });
}

// ── Matches ─────────────────────────────────────────────────────────────────

/** Insert new matches. */
export async function saveMatches(matches) {
  if (!matches?.length) return;
  await rest("/matches", {
    method: "POST",
    headers: { ...headers(), Prefer: "return=minimal" },
    body: JSON.stringify(
      matches.map(m => ({
        score:    m.score,
        fund:     m.fund,
        fund_url: m.fundUrl  ?? null,
        news:     m.news,
        news_url: m.newsUrl  ?? null,
        insight:  m.insight,
        org:      m.org,
        org_url:  m.orgUrl   ?? null,
        contact:  m.contact,
        deadline: m.deadline,
        amount:   m.amount,
        draft:    m.draft,
        status:   m.status ?? "new",
      }))
    ),
  });
}

/** Load recent matches (most recent first). */
export async function loadMatches(limit = 20) {
  const rows = await rest(`/matches?order=created_at.desc&limit=${limit}`);
  if (!rows) return null;
  return rows.map(m => ({
    score:    m.score,
    fund:     m.fund,
    fundUrl:  m.fund_url,
    news:     m.news,
    newsUrl:  m.news_url,
    insight:  m.insight,
    org:      m.org,
    orgUrl:   m.org_url,
    contact:  m.contact,
    deadline: m.deadline,
    amount:   m.amount,
    draft:    m.draft,
    status:   m.status,
  }));
}
