-- ─────────────────────────────────────────────────────────────────────────────
-- Grant Intelligence Agent — Supabase Schema
-- Run this in: Supabase Dashboard → SQL Editor → New query → Run
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Sources ──────────────────────────────────────────────────────────────────
-- Stores all configurable match sources: funding portals, news, political,
-- organisations, or any custom category the user creates.

CREATE TABLE IF NOT EXISTS public.sources (
  id         TEXT        PRIMARY KEY,          -- client-generated id (e.g. timestamp)
  category   TEXT        NOT NULL,             -- 'funding' | 'news' | 'political' | custom
  name       TEXT        NOT NULL,
  url        TEXT        NOT NULL,
  active     BOOLEAN     NOT NULL DEFAULT true,
  tag        TEXT,                             -- display label e.g. 'Health', 'NGO'
  color      TEXT,                             -- hex color for the badge
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Row Level Security — allow public read/write (anon key is safe for this app)
ALTER TABLE public.sources ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='sources' AND policyname='sources_public_select') THEN
    CREATE POLICY sources_public_select ON public.sources FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='sources' AND policyname='sources_public_insert') THEN
    CREATE POLICY sources_public_insert ON public.sources FOR INSERT WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='sources' AND policyname='sources_public_update') THEN
    CREATE POLICY sources_public_update ON public.sources FOR UPDATE USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='sources' AND policyname='sources_public_delete') THEN
    CREATE POLICY sources_public_delete ON public.sources FOR DELETE USING (true);
  END IF;
END $$;

-- ── Matches ───────────────────────────────────────────────────────────────────
-- Stores every AI-generated match run result for historical tracking.

CREATE TABLE IF NOT EXISTS public.matches (
  id         BIGSERIAL   PRIMARY KEY,
  score      INTEGER,
  fund       TEXT,
  fund_url   TEXT,
  news       TEXT,
  news_url   TEXT,
  insight    TEXT,
  org        TEXT,
  org_url    TEXT,
  contact    TEXT,
  deadline   TEXT,
  amount     TEXT,
  draft      TEXT,
  status     TEXT        NOT NULL DEFAULT 'new',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.matches ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='matches' AND policyname='matches_public_select') THEN
    CREATE POLICY matches_public_select ON public.matches FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='matches' AND policyname='matches_public_insert') THEN
    CREATE POLICY matches_public_insert ON public.matches FOR INSERT WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='matches' AND policyname='matches_public_update') THEN
    CREATE POLICY matches_public_update ON public.matches FOR UPDATE USING (true);
  END IF;
END $$;
