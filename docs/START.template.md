# START.md — Project Bootstrap File

> This file is the single source of truth for an AI agent starting work on this project.
> Read it fully before making any changes. All key decisions are documented here.

---

## 1. Client

| Field              | Value                          |
|--------------------|--------------------------------|
| **Name**           | {{CLIENT_NAME}}                |
| **Contact**        | {{CONTACT_NAME}} — {{CONTACT}} |
| **Website**        | {{WEBSITE_URL}}                |
| **Blog (new)**     | {{BLOG_URL}}                   |
| **Niche**          | {{NICHE}}                      |
| **Target audience**| {{TARGET_AUDIENCE}}            |
| **Geography**      | {{GEOGRAPHY}}                  |
| **Tone**           | {{TONE}}                       |
| **Language**       | {{LANGUAGE}}                   |

### What the client does

{{CLIENT_DESCRIPTION}}

### Key claims to reference in content

- {{CLAIM_1}}
- {{CLAIM_2}}
- {{CLAIM_3}}

---

## 2. Service Plan

| Item                        | Value                                              |
|-----------------------------|----------------------------------------------------|
| **Plan**                    | {{PLAN_NAME}}                                      |
| **Price**                   | {{PRICE}}/mo                                       |
| **Articles**                | {{ARTICLES_PER_DAY}} article/day (~{{ARTICLES_PER_MONTH}}/month) |
| **Keyword research**        | {{KEYWORD_CADENCE}} ranking report                 |
| **GSC indexing**            | {{GSC_STATUS}}                                     |
| **Daily report**            | {{REPORT_CHANNEL}}                                 |
| **A/B testing**             | {{AB_TESTING}}                                     |
| **Outreach integrations**   | {{OUTREACH}}                                       |
| **Started**                 | {{START_DATE}}                                     |

---

## 3. Technical Decisions

### Stack
- **Framework:** Next.js (App Router) + TypeScript + Tailwind CSS 4
- **Deployment:** Cloudflare Pages
- **Repo:** github.com/cybrixcc/{{REPO_NAME}}
- **Node version:** 22 (see `.nvmrc`)
- **Design:** {{DESIGN_NOTES}}

### Site architecture

| Route          | Purpose                          |
|----------------|----------------------------------|
| `/`            | {{HOME_PURPOSE}}                 |
| `/blog`        | Article index                    |
| `/blog/[slug]` | Individual articles              |

### Article generation
- Uses `leadhunter-engine` — shared pipeline (Haiku 4.5 generation, Sonnet 4.6 JSX fixes)
- Briefs in `docs/briefs/` — numbered `01-slug.md`, `02-slug.md`, etc.
- Workflows call engine via GitHub Reusable Workflows
- Runs on GitHub Actions: daily at 09:00 UTC and 17:00 UTC

### Notifications
- Shared Telegram bot `@LeadHunterReportsBot`
- Client's `TELEGRAM_CHAT_ID` = their group chat with the bot added
- All notifications go to client's group only

### GSC
- {{GSC_NOTES}}

---

## 4. Content Strategy

### Target keywords (seed topics)
- {{KEYWORD_1}}
- {{KEYWORD_2}}
- {{KEYWORD_3}}
- {{KEYWORD_4}}
- {{KEYWORD_5}}

### Content pillars
1. {{PILLAR_1}}
2. {{PILLAR_2}}
3. {{PILLAR_3}}
4. {{PILLAR_4}}

### Tone rules
- {{TONE_RULE_1}}
- {{TONE_RULE_2}}
- Every article must include a CTA pointing to {{CTA_URL}}

### Internal linking
- Always link back to {{WEBSITE_URL}} for CTAs
- Link between blog articles where relevant

---

## 5. Repo Structure

```
{{REPO_NAME}}/
├── START.md                    ← This file
├── config.yml                  ← Site params (site_name, site_url, cta_url, niche)
├── src/
│   └── app/
│       ├── globals.css
│       ├── layout.tsx
│       ├── page.tsx
│       └── blog/
│           ├── page.tsx
│           └── [slug]/
│               └── page.tsx
├── docs/
│   └── briefs/                 ← Article briefs for generator
├── .github/
│   └── workflows/
│       ├── generate-article.yml     ← calls leadhunter-engine
│       ├── gsc-index-check.yml      ← calls leadhunter-engine
│       └── gsc-keyword-performance.yml ← calls leadhunter-engine
└── .nvmrc                      ← "22"
```

---

## 6. GitHub Secrets Required

| Secret                  | Value                      | Status              |
|-------------------------|----------------------------|---------------------|
| `ANTHROPIC_API_KEY`     | shared key                 | ✅ Ready             |
| `TELEGRAM_BOT_TOKEN`    | shared bot token           | ✅ Ready             |
| `TELEGRAM_CHAT_ID`      | client's group chat_id     | {{TELEGRAM_STATUS}} |
| `DATAFORSEO_LOGIN`      | ds@lhv3.cc                 | ✅ Ready             |
| `DATAFORSEO_PASSWORD`   | see 1Password              | ✅ Ready             |
| `GH_PAT`                | PAT with repo scope        | ✅ Ready             |
| `GSC_CLIENT_EMAIL`      | add later                  | ⏳ Deferred          |
| `GSC_PRIVATE_KEY`       | add later                  | ⏳ Deferred          |

---

## 7. Open Items

- [ ] {{OPEN_ITEM_1}}
- [ ] {{OPEN_ITEM_2}}
- [ ] {{OPEN_ITEM_3}}
- [ ] Write first 5 article briefs (see Content Strategy above)
- [ ] GSC setup — defer 2-3 weeks after launch

---

## 8. Engine Reference

This repo uses `cybrixcc/leadhunter-engine` for all automation.
See engine repo for: article generation pipeline, GSC scripts, Telegram notifications, quality checks.

`config.yml` in this repo controls: `site_name`, `site_url`, `cta_url`, `niche`, `git_user_name`, `git_user_email`, `telegram_site_label`.

See `config.schema.yml` in engine for full reference.
