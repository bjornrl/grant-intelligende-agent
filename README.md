# Grant Intelligence Agent

A Vite + React dashboard for the Grant Intelligence agent: manage funding sources, news and political feeds, AI matching (Claude), and delivery (Gmail, Google Drive, n8n).

## Stack

- **Vite 7** – dev server and production build
- **React 19** – UI
- **ESLint** – linting (React hooks + refresh)

No UI framework: the dashboard uses design tokens and inline styles (DM Sans / DM Mono, dark theme).

## Scripts

| Command       | Description                |
|---------------|----------------------------|
| `npm run dev` | Start dev server (HMR)      |
| `npm run build` | Production build to `dist/` |
| `npm run preview` | Preview production build  |
| `npm run lint` | Run ESLint                 |

## Dashboard tabs

- **Overview** – Stats, agent pipeline, latest matches
- **Sources** – Funding, news, and political sources (toggle active)
- **AI Config** – Organisation profile, keywords, match threshold, prompt preview
- **Matches** – Match list, actions, draft letter generation
- **Delivery** – Output channels (Gmail, Drive, Slack, Excel), schedule, n8n workflow JSON

## Recommended integrations

- **n8n** – Workflow orchestration
- **Apify** – Web scraping (DAM, news)
- **Claude API** – AI matching and drafting
- **Google Workspace** – Gmail + Drive output
- **EU Funding API** – EU Horizon grant data
