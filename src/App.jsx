import { useState, useEffect, useCallback } from "react";

// ── Design Tokens ──────────────────────────────────────────────────────────
const T = {
  bg:       "#0b0f1a",
  surface:  "#131825",
  card:     "#1a2133",
  border:   "rgba(255,255,255,0.07)",
  borderHi: "rgba(255,255,255,0.14)",
  text:     "#e8edf5",
  muted:    "#7a8599",
  accent:   "#3b82f6",
  accentLo: "rgba(59,130,246,0.12)",
  green:    "#22c55e",
  greenLo:  "rgba(34,197,94,0.12)",
  amber:    "#f59e0b",
  amberLo:  "rgba(245,158,11,0.12)",
  red:      "#ef4444",
  redLo:    "rgba(239,68,68,0.12)",
  purple:   "#a855f7",
  purpleLo: "rgba(168,85,247,0.12)",
};

const css = String.raw;

const GLOBAL_CSS = css`
  @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&family=DM+Mono:wght@400;500&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: ${T.bg}; color: ${T.text}; font-family: 'DM Sans', sans-serif; }
  ::-webkit-scrollbar { width: 6px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 3px; }
  @keyframes fadeUp { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes spin { to { transform: rotate(360deg); } }
  .fade-up { animation: fadeUp 0.4s ease-out both; }
  .fade-up-1 { animation-delay: 0.05s; }
  .fade-up-2 { animation-delay: 0.10s; }
  .fade-up-3 { animation-delay: 0.15s; }
  .fade-up-4 { animation-delay: 0.20s; }
  .fade-up-5 { animation-delay: 0.25s; }
`;

// ── Initial data ───────────────────────────────────────────────────────────
const INITIAL_SOURCES = {
  funding: [
    { id: "dam",       name: "DAM Stiftelsen",      url: "https://www.dam.no/organisasjoner/", active: true,  tag: "Health",   color: T.green  },
    { id: "extra",     name: "Extrastiftelsen",      url: "https://www.extrastiftelsen.no",     active: true,  tag: "Health",   color: T.green  },
    { id: "kulturrad", name: "Kulturrådet",          url: "https://www.kulturradet.no",         active: false, tag: "Culture",  color: T.purple },
    { id: "innov",     name: "Innovasjon Norge",     url: "https://www.innovasjonnorge.no",     active: true,  tag: "Business", color: T.amber  },
    { id: "nfr",       name: "Norsk Forskningsråd", url: "https://www.forskningsradet.no",     active: false, tag: "Research", color: T.accent },
    { id: "eu",        name: "EU Horizon Europe",   url: "https://ec.europa.eu/info/funding",  active: false, tag: "EU",       color: T.purple },
  ],
  news: [
    { id: "aftenposten", name: "Aftenposten", url: "https://www.aftenposten.no", active: true,  tag: "News" },
    { id: "vg",          name: "VG",          url: "https://www.vg.no",         active: true,  tag: "News" },
    { id: "nrk",         name: "NRK",         url: "https://www.nrk.no",        active: true,  tag: "News" },
    { id: "dagsavisen",  name: "Dagsavisen",  url: "https://www.dagsavisen.no", active: false, tag: "News" },
  ],
  political: [
    { id: "stortinget", name: "Stortinget.no",  url: "https://www.stortinget.no",  active: true, tag: "Politics" },
    { id: "regjering",  name: "Regjeringen.no", url: "https://www.regjeringen.no", active: true, tag: "Politics" },
  ],
};

const PIPELINE_STEPS = [
  { id: 1, icon: "⬇", label: "Collect",  desc: "Scrape funding portals, news & political sources",     color: T.accent },
  { id: 2, icon: "🔍", label: "Parse",    desc: "Extract structured data: deadlines, amounts, topics",  color: T.purple },
  { id: 3, icon: "🤖", label: "Match",    desc: "Claude AI cross-references sources with your profile", color: T.amber  },
  { id: 4, icon: "✉",  label: "Draft",   desc: "Generate tailored project proposals & cover letters",  color: T.green  },
  { id: 5, icon: "📤", label: "Deliver",  desc: "Send to Gmail for review + log to Google Drive/Excel", color: T.accent },
];

// ── Shared UI helpers ──────────────────────────────────────────────────────
const Badge = ({ children, color = T.accent }) => (
  <span style={{
    display: "inline-flex", alignItems: "center", gap: 4,
    padding: "2px 8px", borderRadius: 99, fontSize: 11, fontWeight: 600,
    letterSpacing: "0.04em", background: color + "20", color,
    border: `1px solid ${color}30`,
  }}>{children}</span>
);

const Toggle = ({ checked, onChange }) => (
  <button type="button" onClick={() => onChange(!checked)} style={{
    width: 36, height: 20, borderRadius: 10, border: "none", cursor: "pointer",
    background: checked ? T.accent : "rgba(255,255,255,0.1)",
    position: "relative", transition: "background 0.2s", flexShrink: 0,
  }}>
    <span style={{
      position: "absolute", top: 2, left: checked ? 18 : 2,
      width: 16, height: 16, borderRadius: "50%", background: "#fff",
      transition: "left 0.2s", display: "block",
    }} />
  </button>
);

const Spinner = ({ size = 14, color = "#fff" }) => (
  <span style={{
    width: size, height: size,
    border: `2px solid rgba(255,255,255,0.2)`,
    borderTopColor: color,
    borderRadius: "50%", display: "inline-block",
    animation: "spin 0.8s linear infinite",
    flexShrink: 0,
  }} />
);

const ScoreRing = ({ score }) => {
  const c = score >= 85 ? T.green : score >= 70 ? T.amber : T.red;
  const r = 18, circ = 2 * Math.PI * r, dash = (score / 100) * circ;
  return (
    <svg width={48} height={48} style={{ flexShrink: 0 }}>
      <circle cx={24} cy={24} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={4} />
      <circle cx={24} cy={24} r={r} fill="none" stroke={c} strokeWidth={4}
        strokeDasharray={`${dash} ${circ}`} strokeLinecap="round" transform="rotate(-90 24 24)" />
      <text x={24} y={28} textAnchor="middle" fill={c} fontSize={11} fontWeight={700} fontFamily="DM Mono">{score}</text>
    </svg>
  );
};

const StatusBadge = ({ status }) => {
  const map = {
    draft_ready: { label: "Draft Ready", color: T.green },
    reviewing:   { label: "Reviewing",   color: T.amber },
    new:         { label: "New Match",   color: T.accent },
  };
  const s = map[status] || map.new;
  return <Badge color={s.color}>{s.label}</Badge>;
};

// Toast notification
const Toast = ({ msg, type }) => {
  if (!msg) return null;
  const color = type === "error" ? T.red : type === "warn" ? T.amber : T.green;
  return (
    <div style={{
      position: "fixed", bottom: 24, right: 24, zIndex: 999,
      background: T.card, border: `1px solid ${color}40`, borderRadius: 10,
      padding: "12px 20px", fontSize: 13, color: T.text,
      display: "flex", alignItems: "center", gap: 10,
      boxShadow: `0 4px 24px rgba(0,0,0,0.4)`,
      animation: "fadeUp 0.3s ease-out",
    }}>
      <span style={{ color }}>{type === "error" ? "✗" : type === "warn" ? "⚠" : "✓"}</span>
      {msg}
    </div>
  );
};

// ── Tab: Overview ──────────────────────────────────────────────────────────
function OverviewTab({ sources, matches }) {
  const activeFunding = sources.funding.filter(s => s.active).length;
  const activeNews    = sources.news.filter(s => s.active).length;
  const activePol     = sources.political.filter(s => s.active).length;

  const stats = [
    { label: "Funding Sources",   value: activeFunding, total: sources.funding.length,  color: T.green  },
    { label: "News Sources",      value: activeNews,    total: sources.news.length,      color: T.amber  },
    { label: "Political Sources", value: activePol,     total: sources.political.length, color: T.purple },
    { label: "Matches Found",     value: matches.length, total: null,                    color: T.accent },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 16 }}>
        {stats.map((s, i) => (
          <div key={s.label} className={`fade-up fade-up-${i+1}`} style={{
            background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: "20px 24px",
          }}>
            <div style={{ fontSize: 28, fontWeight: 600, color: s.color, fontFamily: "DM Mono" }}>
              {s.value}{s.total ? <span style={{ fontSize: 16, color: T.muted }}>/{s.total}</span> : ""}
            </div>
            <div style={{ fontSize: 13, color: T.muted, marginTop: 4 }}>{s.label}</div>
            {s.total && (
              <div style={{ marginTop: 10, height: 3, background: "rgba(255,255,255,0.06)", borderRadius: 2 }}>
                <div style={{ width: `${(s.value / s.total) * 100}%`, height: "100%", background: s.color, borderRadius: 2 }} />
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="fade-up fade-up-2" style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: 28 }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, color: T.muted, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 24 }}>
          Agent Pipeline
        </h3>
        <div style={{ display: "flex", alignItems: "center", overflowX: "auto" }}>
          {PIPELINE_STEPS.map((step, i) => (
            <div key={step.id} style={{ display: "flex", alignItems: "center", flex: 1, minWidth: 0 }}>
              <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
                <div style={{
                  width: 52, height: 52, borderRadius: 14,
                  background: step.color + "18", border: `1.5px solid ${step.color}40`,
                  display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22,
                  boxShadow: `0 0 20px ${step.color}20`,
                }}>{step.icon}</div>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: step.color }}>{step.label}</div>
                  <div style={{ fontSize: 11, color: T.muted, marginTop: 3, lineHeight: 1.4, maxWidth: 110 }}>{step.desc}</div>
                </div>
              </div>
              {i < PIPELINE_STEPS.length - 1 && (
                <div style={{ width: 32, flexShrink: 0, display: "flex", alignItems: "center", paddingBottom: 38 }}>
                  <svg width={32} height={16}>
                    <line x1={0} y1={8} x2={24} y2={8} stroke={T.borderHi} strokeWidth={1.5} strokeDasharray="4 3" />
                    <polygon points="22,4 30,8 22,12" fill={T.borderHi} />
                  </svg>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {matches.length > 0 && (
        <div className="fade-up fade-up-3" style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: 28 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
            <h3 style={{ fontSize: 14, fontWeight: 600, color: T.muted, letterSpacing: "0.06em", textTransform: "uppercase" }}>Latest Matches</h3>
            <Badge color={T.accent}>{matches.length} found</Badge>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {matches.slice(0, 3).map((m, idx) => (
              <div key={idx} style={{
                display: "flex", alignItems: "center", gap: 16, padding: "14px 16px",
                background: T.surface, borderRadius: 10, border: `1px solid ${T.border}`,
              }}>
                <ScoreRing score={m.score} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: T.text, marginBottom: 2 }}>{m.fund}</div>
                  <div style={{ fontSize: 12, color: T.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>↔ {m.news}</div>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={{ fontSize: 12, color: T.muted, fontFamily: "DM Mono" }}>{m.amount}</span>
                  <StatusBadge status={m.status} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Tab: Sources ───────────────────────────────────────────────────────────
function SourcesTab({ sources, setSources }) {
  const toggle = (category, id) =>
    setSources(prev => ({
      ...prev,
      [category]: prev[category].map(s => s.id === id ? { ...s, active: !s.active } : s),
    }));

  const sections = [
    { key: "funding",   label: "💰 Funding Sources",  accent: T.green  },
    { key: "news",      label: "📰 News Sources",      accent: T.amber  },
    { key: "political", label: "🏛 Political Sources", accent: T.purple },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {sections.map((sec, si) => (
        <div key={sec.key} className={`fade-up fade-up-${si+1}`} style={{
          background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, overflow: "hidden",
        }}>
          <div style={{ padding: "14px 24px", borderBottom: `1px solid ${T.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>{sec.label}</span>
            <span style={{ fontSize: 12, color: T.muted }}>{sources[sec.key].filter(s => s.active).length}/{sources[sec.key].length} active</span>
          </div>
          <div style={{ padding: 8 }}>
            {sources[sec.key].map(source => (
              <div key={source.id} style={{
                display: "flex", alignItems: "center", gap: 12, padding: "12px 16px",
                borderRadius: 8, background: source.active ? sec.accent + "08" : "transparent",
              }}>
                <Toggle checked={source.active} onChange={() => toggle(sec.key, source.id)} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: source.active ? T.text : T.muted }}>{source.name}</div>
                  <div style={{ fontSize: 11, color: T.muted, marginTop: 2, fontFamily: "DM Mono", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{source.url}</div>
                </div>
                {source.tag && <Badge color={source.color || sec.accent}>{source.tag}</Badge>}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Tab: AI Config ─────────────────────────────────────────────────────────
function MatchingTab({ profile, setProfile, keywords, setKeywords, threshold, setThreshold }) {
  const [newKw, setNewKw] = useState("");

  const addKw = () => {
    if (newKw.trim() && !keywords.includes(newKw.trim())) {
      setKeywords([...keywords, newKw.trim()]);
      setNewKw("");
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div className="fade-up fade-up-1" style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: 28 }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: T.muted, marginBottom: 16 }}>
          Organisation Profile
        </h3>
        <p style={{ fontSize: 12, color: T.muted, marginBottom: 10 }}>Describe your organisation&apos;s mission. Claude uses this to assess alignment.</p>
        <textarea value={profile} onChange={e => setProfile(e.target.value)} rows={4} style={{
          width: "100%", background: T.surface, border: `1px solid ${T.border}`,
          borderRadius: 8, color: T.text, fontSize: 13, padding: "12px 14px",
          fontFamily: "DM Sans", resize: "vertical", outline: "none", lineHeight: 1.6,
        }}
          onFocus={e => e.target.style.borderColor = T.accent}
          onBlur={e => e.target.style.borderColor = T.border}
        />
      </div>

      <div className="fade-up fade-up-2" style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: 28 }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: T.muted, marginBottom: 16 }}>Topic Keywords</h3>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
          {keywords.map(kw => (
            <span key={kw} style={{
              display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 12px", borderRadius: 99,
              background: T.accentLo, color: T.accent, border: `1px solid ${T.accent}30`, fontSize: 12, fontWeight: 500,
            }}>
              {kw}
              <button type="button" onClick={() => setKeywords(keywords.filter(k => k !== kw))}
                style={{ background: "none", border: "none", cursor: "pointer", color: T.muted, fontSize: 14, lineHeight: 1, padding: 0 }}>×</button>
            </span>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <input value={newKw} onChange={e => setNewKw(e.target.value)} onKeyDown={e => e.key === "Enter" && addKw()}
            placeholder="Add keyword…" style={{
              flex: 1, background: T.surface, border: `1px solid ${T.border}`,
              borderRadius: 8, color: T.text, fontSize: 13, padding: "10px 14px", fontFamily: "DM Sans", outline: "none",
            }}
            onFocus={e => e.target.style.borderColor = T.accent}
            onBlur={e => e.target.style.borderColor = T.border}
          />
          <button type="button" onClick={addKw} style={{
            padding: "10px 20px", borderRadius: 8, border: "none",
            background: T.accent, color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer",
          }}>Add</button>
        </div>
      </div>

      <div className="fade-up fade-up-3" style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: 28 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: T.muted }}>Match Threshold</h3>
          <span style={{ fontFamily: "DM Mono", fontSize: 16, fontWeight: 700, color: threshold >= 85 ? T.green : threshold >= 70 ? T.amber : T.red }}>{threshold}%</span>
        </div>
        <input type="range" min={40} max={95} value={threshold} onChange={e => setThreshold(+e.target.value)} style={{ width: "100%", accentColor: T.accent }} />
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
          <span style={{ fontSize: 11, color: T.muted }}>40 – Broad</span>
          <span style={{ fontSize: 11, color: T.muted }}>95 – Strict</span>
        </div>
      </div>

      <div className="fade-up fade-up-4" style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: 24 }}>
        <div style={{ fontSize: 12, color: T.muted, marginBottom: 10, letterSpacing: "0.06em", textTransform: "uppercase", fontWeight: 600 }}>Claude Prompt Preview</div>
        <pre style={{ fontSize: 11.5, color: T.muted, fontFamily: "DM Mono", lineHeight: 1.7, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{`Organisation: "${profile.slice(0, 80)}…"
Keywords: ${keywords.join(", ")}
Threshold: >= ${threshold}

→ Claude will generate ${threshold >= 85 ? "3–4 strict" : threshold >= 70 ? "4–5 focused" : "5+ broad"} matches with Norwegian draft letters.`}</pre>
      </div>
    </div>
  );
}

// ── Tab: Matches ───────────────────────────────────────────────────────────
function MatchesTab({ matches, deliveryEmail, showToast }) {
  const [selected, setSelected] = useState(null);
  const [draft, setDraft]       = useState(null);
  const [sending, setSending]   = useState(false);
  const [logging, setLogging]   = useState(false);

  useEffect(() => {
    if (selected) {
      setDraft(selected.draft || null);
    }
  }, [selected]);

  const handleSendEmail = async () => {
    if (!selected) return;
    if (!deliveryEmail) { showToast("Set an email address in the Delivery tab first.", "warn"); return; }
    setSending(true);
    try {
      const html = `
        <h2 style="font-family:sans-serif">Grant Match: ${selected.fund}</h2>
        <p style="font-family:sans-serif;color:#666">Score: <strong>${selected.score}/100</strong> &nbsp;|&nbsp; Amount: <strong>${selected.amount}</strong> &nbsp;|&nbsp; Deadline: <strong>${selected.deadline}</strong></p>
        <hr/>
        <p style="font-family:sans-serif"><strong>News alignment:</strong> ${selected.news}</p>
        <p style="font-family:sans-serif"><strong>Insight:</strong> ${selected.insight}</p>
        <p style="font-family:sans-serif"><strong>Contact:</strong> ${selected.org} — ${selected.contact}</p>
        <hr/>
        <h3 style="font-family:sans-serif">Draft Proposal</h3>
        <pre style="font-family:monospace;white-space:pre-wrap;background:#f5f5f5;padding:16px;border-radius:8px">${draft || selected.draft || ""}</pre>
        <hr/>
        <p style="font-family:sans-serif;font-size:12px;color:#999">Generated by Grant Intelligence Agent</p>
      `;
      const res = await fetch("/api/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: deliveryEmail,
          subject: `Grant Match (${selected.score}/100): ${selected.fund}`,
          html,
          text: `Grant Match: ${selected.fund}\n\n${draft || selected.draft || ""}`,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Send failed");
      showToast("Email sent to " + deliveryEmail, "success");
    } catch (e) {
      showToast(e.message.includes("not configured") ? "Gmail not set up yet — see Delivery tab for instructions." : e.message, "error");
    } finally {
      setSending(false);
    }
  };

  const handleLogMatch = async () => {
    if (!selected) return;
    setLogging(true);
    try {
      const res = await fetch("/api/log-match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ match: selected }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Log failed");
      showToast("Match logged to Google Sheets!", "success");
    } catch (e) {
      showToast(e.message.includes("not configured") ? "Google Drive not set up yet — see Delivery tab for instructions." : e.message, "error");
    } finally {
      setLogging(false);
    }
  };

  if (matches.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: "64px 24px", color: T.muted }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>🤖</div>
        <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8, color: T.text }}>No matches yet</div>
        <div style={{ fontSize: 13 }}>Click <strong style={{ color: T.accent }}>▶ Run Agent</strong> in the top bar to generate real AI matches using Claude.</div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", gap: 20 }}>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 12 }}>
        {matches.map((m, i) => (
          <div key={i} className={`fade-up fade-up-${Math.min(i+1,5)}`}
            onClick={() => setSelected(m)}
            onKeyDown={e => e.key === "Enter" && setSelected(m)}
            role="button" tabIndex={0}
            style={{
              background: selected === m ? T.accentLo : T.card,
              border: `1px solid ${selected === m ? T.accent + "60" : T.border}`,
              borderRadius: 12, padding: 20, cursor: "pointer", transition: "all 0.15s",
            }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
              <ScoreRing score={m.score} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, marginBottom: 6 }}>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{m.fund}</div>
                  <StatusBadge status={m.status} />
                </div>
                <div style={{ fontSize: 12, color: T.muted, marginBottom: 8 }}>↔ <span style={{ color: T.amber }}>{m.news}</span></div>
                <div style={{ fontSize: 12, color: T.text + "bb", lineHeight: 1.5 }}>{m.insight}</div>
                <div style={{ display: "flex", gap: 16, marginTop: 12, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 11, color: T.green, fontFamily: "DM Mono", fontWeight: 600 }}>{m.amount}</span>
                  <span style={{ fontSize: 11, color: T.muted }}>Deadline: <span style={{ color: T.text }}>{m.deadline}</span></span>
                  <span style={{ fontSize: 11, color: T.muted }}>{m.contact}</span>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div style={{ width: 360, flexShrink: 0 }}>
        {selected ? (
          <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: 24, position: "sticky", top: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 16, color: T.muted, letterSpacing: "0.06em", textTransform: "uppercase" }}>Actions</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <button type="button" onClick={handleSendEmail} disabled={sending} style={{
                padding: "11px 0", borderRadius: 8, border: `1px solid ${T.green}40`,
                background: T.greenLo, color: T.green, fontSize: 13, fontWeight: 600, cursor: sending ? "not-allowed" : "pointer",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              }}>
                {sending ? <><Spinner color={T.green} /> Sending…</> : "📧 Send to Gmail"}
              </button>
              <button type="button" onClick={handleLogMatch} disabled={logging} style={{
                padding: "11px 0", borderRadius: 8, border: `1px solid ${T.purple}40`,
                background: T.purpleLo, color: T.purple, fontSize: 13, fontWeight: 600, cursor: logging ? "not-allowed" : "pointer",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              }}>
                {logging ? <><Spinner color={T.purple} /> Logging…</> : "📊 Log to Google Drive"}
              </button>
            </div>

            {(draft || selected.draft) && (
              <div style={{ marginTop: 20 }}>
                <div style={{ fontSize: 12, color: T.muted, marginBottom: 8, letterSpacing: "0.06em", textTransform: "uppercase", fontWeight: 600 }}>Draft</div>
                <textarea value={draft ?? selected.draft ?? ""} onChange={e => setDraft(e.target.value)} rows={14} style={{
                  width: "100%", background: T.surface, border: `1px solid ${T.border}`,
                  borderRadius: 8, color: T.text, fontSize: 12, padding: "12px 14px",
                  fontFamily: "DM Mono", resize: "vertical", outline: "none", lineHeight: 1.6,
                }} />
              </div>
            )}
          </div>
        ) : (
          <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: 48, textAlign: "center", color: T.muted }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>←</div>
            <div style={{ fontSize: 13 }}>Select a match to send to Gmail or log to Google Drive</div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Tab: Delivery ──────────────────────────────────────────────────────────
function DeliveryTab({ deliveryEmail, setDeliveryEmail }) {
  const [schedule, setSchedule]     = useState("weekly");
  const [outputs, setOutputs]       = useState({ gmail: true, gdrive: true, slack: false, excel: true });
  const [n8nExpanded, setN8nExpanded] = useState(false);
  const toggleOutput = k => setOutputs(prev => ({ ...prev, [k]: !prev[k] }));

  const n8nWorkflow = JSON.stringify({
    name: "Grant Intelligence Agent",
    nodes: [
      { name: "Schedule Trigger", type: "n8n-nodes-base.scheduleTrigger", parameters: { rule: { interval: [{ field: "weeks", weeksInterval: 1 }] } } },
      { name: "Call Match API", type: "n8n-nodes-base.httpRequest", parameters: { url: "https://your-site.netlify.app/api/match", method: "POST", authentication: "none" } },
      { name: "Send Gmail", type: "n8n-nodes-base.httpRequest", parameters: { url: "https://your-site.netlify.app/api/send-email", method: "POST" } },
      { name: "Log to Sheets", type: "n8n-nodes-base.httpRequest", parameters: { url: "https://your-site.netlify.app/api/log-match", method: "POST" } },
    ],
  }, null, 2);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* Output toggles */}
      <div className="fade-up fade-up-1" style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: 28 }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: T.muted, marginBottom: 20 }}>Output Channels</h3>
        {[
          { key: "gmail",  label: "Gmail",        desc: "Send draft proposals to your email for review",          icon: "📧", color: T.accent  },
          { key: "gdrive", label: "Google Drive", desc: "Log matches to a Google Sheet for tracking",             icon: "📁", color: T.green   },
          { key: "excel",  label: "Excel Log",    desc: "Append matches to an Excel sheet (via n8n)",             icon: "📊", color: T.amber   },
          { key: "slack",  label: "Slack",         desc: "Post a weekly summary to a Slack channel (via n8n)",    icon: "💬", color: T.purple  },
        ].map(o => (
          <div key={o.key} style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 0", borderBottom: `1px solid ${T.border}` }}>
            <span style={{ fontSize: 22 }}>{o.icon}</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>{o.label}</div>
              <div style={{ fontSize: 12, color: T.muted }}>{o.desc}</div>
            </div>
            <Toggle checked={outputs[o.key]} onChange={() => toggleOutput(o.key)} />
          </div>
        ))}
      </div>

      {/* Email + schedule */}
      <div className="fade-up fade-up-2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: 24 }}>
          <label style={{ fontSize: 12, color: T.muted, fontWeight: 600, display: "block", marginBottom: 8, letterSpacing: "0.04em" }}>EMAIL ADDRESS</label>
          <input value={deliveryEmail} onChange={e => setDeliveryEmail(e.target.value)} placeholder="you@example.com" style={{
            width: "100%", background: T.surface, border: `1px solid ${T.border}`,
            borderRadius: 8, color: T.text, fontSize: 13, padding: "10px 12px", fontFamily: "DM Sans", outline: "none",
          }}
            onFocus={e => e.target.style.borderColor = T.accent}
            onBlur={e => e.target.style.borderColor = T.border}
          />
        </div>
        <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: 24 }}>
          <label style={{ fontSize: 12, color: T.muted, fontWeight: 600, display: "block", marginBottom: 8, letterSpacing: "0.04em" }}>SCHEDULE</label>
          <select value={schedule} onChange={e => setSchedule(e.target.value)} style={{
            width: "100%", background: T.surface, border: `1px solid ${T.border}`,
            borderRadius: 8, color: T.text, fontSize: 13, padding: "10px 12px", fontFamily: "DM Sans", outline: "none", appearance: "none",
          }}>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="biweekly">Bi-weekly</option>
            <option value="manual">Manual only</option>
          </select>
        </div>
      </div>

      {/* Setup instructions */}
      <div className="fade-up fade-up-3" style={{ background: T.card, border: `1px solid ${T.amber}30`, borderRadius: 12, padding: 24 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: T.amber, marginBottom: 12 }}>⚙ API Setup Required</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {[
            { key: "ANTHROPIC_API_KEY", label: "Claude AI", desc: "Get from console.anthropic.com", required: true },
            { key: "GMAIL_CLIENT_ID + GMAIL_CLIENT_SECRET + GMAIL_REFRESH_TOKEN + GMAIL_FROM_EMAIL", label: "Gmail", desc: "OAuth2 via Google Cloud Console → Gmail API", required: false },
            { key: "GDRIVE_CLIENT_ID + GDRIVE_CLIENT_SECRET + GDRIVE_REFRESH_TOKEN + GDRIVE_SHEET_ID", label: "Google Sheets", desc: "OAuth2 via Google Cloud Console → Sheets API", required: false },
          ].map(item => (
            <div key={item.key} style={{ display: "flex", gap: 12, padding: "10px 12px", background: T.surface, borderRadius: 8 }}>
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: item.required ? T.red : T.amber, marginTop: 5, flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 2 }}>{item.label} {item.required && <span style={{ color: T.red, fontSize: 10 }}>REQUIRED</span>}</div>
                <code style={{ fontSize: 10, color: T.accent, fontFamily: "DM Mono" }}>{item.key}</code>
                <div style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>{item.desc}</div>
              </div>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 12, color: T.muted, marginTop: 12 }}>
          Add these in Netlify → Site configuration → Environment variables
        </div>
      </div>

      {/* n8n JSON */}
      <div className="fade-up fade-up-4" style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, overflow: "hidden" }}>
        <button type="button" onClick={() => setN8nExpanded(!n8nExpanded)} style={{
          width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center",
          padding: "18px 24px", background: "none", border: "none", cursor: "pointer", color: T.text,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 20 }}>⚙</span>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, textAlign: "left" }}>n8n Workflow JSON</div>
              <div style={{ fontSize: 12, color: T.muted, textAlign: "left" }}>Import into n8n to schedule automated runs</div>
            </div>
          </div>
          <span style={{ color: T.muted, transform: n8nExpanded ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>▾</span>
        </button>
        {n8nExpanded && (
          <div style={{ borderTop: `1px solid ${T.border}` }}>
            <div style={{ display: "flex", justifyContent: "flex-end", padding: "8px 16px" }}>
              <button type="button" onClick={() => navigator.clipboard?.writeText(n8nWorkflow)} style={{
                padding: "6px 14px", borderRadius: 6, border: `1px solid ${T.border}`,
                background: T.surface, color: T.muted, fontSize: 12, cursor: "pointer",
              }}>Copy JSON</button>
            </div>
            <pre style={{ padding: "0 24px 20px", fontSize: 11, fontFamily: "DM Mono", color: T.muted, overflow: "auto", maxHeight: 300, lineHeight: 1.6 }}>{n8nWorkflow}</pre>
          </div>
        )}
      </div>
    </div>
  );
}

// ── App ────────────────────────────────────────────────────────────────────
export default function App() {
  const [tab,           setTab]          = useState("overview");
  const [sources,       setSources]      = useState(INITIAL_SOURCES);
  const [matches,       setMatches]      = useState([]);
  const [running,       setRunning]      = useState(false);
  const [toast,         setToast]        = useState({ msg: "", type: "success" });
  const [deliveryEmail, setDeliveryEmail] = useState("");

  // AI config (lifted so MatchingTab can share with run)
  const [profile,   setProfile]   = useState("Vi arbeider med forebygging og mestring av sykdom i Norge, med fokus på mental helse, rehabilitering og pasientstøtte.");
  const [keywords,  setKeywords]  = useState(["helse", "rehabilitering", "forebygging", "pasient", "mental helse"]);
  const [threshold, setThreshold] = useState(70);

  const showToast = useCallback((msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast({ msg: "", type: "success" }), 4000);
  }, []);

  const handleRun = async () => {
    setRunning(true);
    setMatches([]);
    try {
      const activeFunding = sources.funding.filter(s => s.active);
      const activeNews    = [...sources.news, ...sources.political].filter(s => s.active);

      const res = await fetch("/api/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile, keywords, threshold, fundingSources: activeFunding, newsSources: activeNews }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Agent run failed");

      setMatches(data.matches || []);
      showToast(`Found ${data.matches?.length ?? 0} matches!`, "success");
      setTab("matches");
    } catch (e) {
      showToast(e.message.includes("ANTHROPIC_API_KEY") ? "Add ANTHROPIC_API_KEY in Netlify → Environment variables" : e.message, "error");
    } finally {
      setRunning(false);
    }
  };

  // Inject global styles once
  useEffect(() => {
    if (document.getElementById("grant-styles")) return;
    const s = document.createElement("style");
    s.id = "grant-styles";
    s.textContent = GLOBAL_CSS;
    document.head.appendChild(s);
  }, []);

  const tabs = [
    { id: "overview", label: "Overview"  },
    { id: "sources",  label: "Sources"   },
    { id: "matching", label: "AI Config" },
    { id: "matches",  label: `Matches${matches.length ? ` (${matches.length})` : ""}` },
    { id: "delivery", label: "Delivery"  },
  ];

  return (
    <div style={{ minHeight: "100vh", background: T.bg, color: T.text }}>
      <header style={{
        height: 56, display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 32px", borderBottom: `1px solid ${T.border}`,
        background: T.surface, position: "sticky", top: 0, zIndex: 100, backdropFilter: "blur(12px)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{
            width: 28, height: 28, borderRadius: 7,
            background: `linear-gradient(135deg, ${T.accent}, ${T.purple})`,
            display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14,
          }}>⚡</div>
          <span style={{ fontWeight: 700, fontSize: 15, letterSpacing: "-0.01em" }}>Grant Intelligence</span>
          <Badge color={T.green}>Live</Badge>
        </div>

        <nav style={{ display: "flex", gap: 4 }}>
          {tabs.map(t => (
            <button key={t.id} type="button" onClick={() => setTab(t.id)} style={{
              padding: "6px 14px", borderRadius: 7, border: "none",
              background: tab === t.id ? T.accentLo : "transparent",
              color: tab === t.id ? T.accent : T.muted,
              fontSize: 13, fontWeight: tab === t.id ? 600 : 400,
              cursor: "pointer", transition: "all 0.15s",
            }}>{t.label}</button>
          ))}
        </nav>

        <button type="button" onClick={handleRun} disabled={running} style={{
          padding: "8px 20px", borderRadius: 8, border: "none",
          background: running ? "rgba(255,255,255,0.05)" : T.accent,
          color: running ? T.muted : "#fff",
          fontSize: 13, fontWeight: 600, cursor: running ? "not-allowed" : "pointer",
          display: "flex", alignItems: "center", gap: 8, transition: "all 0.2s",
        }}>
          {running ? <><Spinner /> Running Claude…</> : "▶ Run Agent"}
        </button>
      </header>

      <main style={{ maxWidth: 1200, margin: "0 auto", padding: "32px 32px 64px" }}>
        {tab === "overview" && <OverviewTab sources={sources} matches={matches} />}
        {tab === "sources"  && <SourcesTab  sources={sources} setSources={setSources} />}
        {tab === "matching" && <MatchingTab profile={profile} setProfile={setProfile} keywords={keywords} setKeywords={setKeywords} threshold={threshold} setThreshold={setThreshold} />}
        {tab === "matches"  && <MatchesTab  matches={matches} deliveryEmail={deliveryEmail} showToast={showToast} />}
        {tab === "delivery" && <DeliveryTab deliveryEmail={deliveryEmail} setDeliveryEmail={setDeliveryEmail} />}
      </main>

      <Toast msg={toast.msg} type={toast.type} />
    </div>
  );
}
