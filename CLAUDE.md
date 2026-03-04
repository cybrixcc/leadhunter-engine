# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Language

**Everything must be in English** — code, comments, commit messages, PR titles and descriptions, GitHub issue text, any text written to files.

## Project Overview

Shared engine for automated SEO article generation for client blogs. Cloned from `cybrixcc/leadhunter-website`. Client repos call this engine via GitHub Reusable Workflows.

## Commands

```bash
npm install                          # install deps (Node 22+)
node scripts/generate-article.mjs   # generate next ready topic
node scripts/generate-article.mjs --dry-run       # preview without committing
node scripts/generate-article.mjs --topic=6       # generate specific topic
node scripts/gsc-index-check.mjs                  # check/submit GSC index
node scripts/gsc-keyword-performance.mjs          # weekly keyword report
node scripts/ai-citation-research.mjs             # AI citation research
bash scripts/geo-health-check.sh                  # GEO content health score
```

## Architecture

### How clients use this engine

Client repos (e.g. `vami-blog`) call reusable workflows:

```yaml
# vami-blog/.github/workflows/generate-article.yml
jobs:
  generate:
    uses: cybrixcc/leadhunter-engine/.github/workflows/generate-article.yml@main
    with:
      config_path: ./config.yml
    secrets: inherit
```

The engine checkout happens inside the reusable workflow — it copies `scripts/` into the calling repo's workspace so all relative paths resolve correctly.

### Client config.yml

Lives in the **client repo**, not here. Full schema: `config.schema.yml`.

```yaml
site_name: "VAMI Blog"
site_url: "https://blog.vami.agency"
cta_url: "https://vami.agency/#contact-form"
niche: "AI recruitment"
```

Config is loaded via `scripts/lib/config-loader.mjs` — reads `config.yml` from `process.cwd()` with fallback to env vars (for CI usage in calling workflows).

### Article generation pipeline (`generate-article.mjs`)

Orchestrates 9 steps:
1. Find next `ready` topic in `CONTENT_PLAN.md` (or `--topic=N`)
2. Read brief from `briefs/` directory
3. Build context — reference article, project guidelines (`CLAUDE.md`), existing blog pages
4. Generate article with Claude API (Haiku) using `scripts/templates/prompts/generate.md`
5. Quality check loop — `quality-checker.mjs` (20+ structural checks) + `ai-evaluator.mjs` (Claude fact-checks)
6. Auto-improve with `article-improver.mjs` (up to 3 iterations)
7. Create git branch `article/<slug>`
8. Write files: `src/app/blog/<slug>/page.tsx`, OG image, update `CONTENT_PLAN.md`, `src/lib/blog-data.ts`, RSS feed, `public/llms.txt`
9. Verify build (auto-fix JSX errors with Sonnet), commit, push, create PR

### Key library modules (`scripts/lib/`)

| File | Purpose |
|------|---------|
| `config-loader.mjs` | Load client `config.yml` — all scripts use this |
| `article-generator.mjs` | Claude API calls (generate/evaluate/improve/fixJSX) |
| `article-improver.mjs` | Improvement loop with regression protection |
| `quality-checker.mjs` | 20+ automated checks (imports, metadata, SEO, JSX validity) |
| `ai-evaluator.mjs` | Claude extracts facts, checks key points, detects uncited stats |
| `brief-reader.mjs` | Parse brief `.md` files from `briefs/` |
| `content-plan-parser.mjs` | Parse `CONTENT_PLAN.md`, select next ready topic |
| `context-builder.mjs` | Build full context for article generation |
| `file-updater.mjs` | Atomic updates to all tracking files |
| `git-operations.mjs` | Branch, commit, push, create PR via `gh` CLI |
| `build-verifier.mjs` | Run `npm run build`, auto-fix with Claude (3 attempts) |
| `citation-research.mjs` | Multi-AI citation testing (ChatGPT, Claude, Gemini) |

### Parameterization

All hardcoded `lhunter.cc` values have been replaced with config:
- `SITE_URL`, `SITE_NAME` injected into Claude prompts as `{{SITE_URL}}`, `{{SITE_NAME}}`
- `gsc-index-check.mjs` and `gsc-keyword-performance.mjs` use `config.gsc_site_url` and `config.brand_terms`
- `send-telegram-notification.sh` reads `$SITE_LABEL` and `$SITE_URL` env vars
- `geo-health-check.sh` reads `$SITE_LABEL` and `$BLOG_GLOB` env vars

### Reusable workflows (`.github/workflows/`)

All workflows support `workflow_call` with `config_path` input. They:
1. Checkout the calling repo
2. Checkout this engine repo into `.engine/`
3. Install engine deps (`npm ci --prefix .engine`)
4. Parse `config.yml` and export env vars
5. Copy `scripts/` into workspace

| Workflow | Trigger in client |
|---------|------------------|
| `generate-article.yml` | schedule or manual, generates articles |
| `gsc-index-check.yml` | schedule, submits unindexed pages to GSC |
| `gsc-keyword-performance.yml` | schedule, weekly keyword report → GitHub issue |
| `geo-health-check.yml` | schedule, GEO score → GitHub issue |
| `ai-article-review.yml` | PR trigger, auto-reviews blog article PRs |

### Required secrets (in client repo)

| Secret | Used by |
|--------|---------|
| `ANTHROPIC_API_KEY` | Article generation, review |
| `GH_PAT` | PR creation (needs `repo` scope) |
| `WORKFLOW_TOKEN` | AI article review (must trigger subsequent workflow runs) |
| `GSC_CREDENTIALS_JSON` | GSC index check, keyword performance |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | All notifications |
| `UMAMI_API_KEY` / `UMAMI_WEBSITE_ID` | Optional analytics in keyword report |

### Content briefs

Briefs are `.md` files in `briefs/` with structured sections:
- Title, Target Keywords, Search Intent, Main Thesis
- Key Points, Why It Matters, LeadHunter Angle
- Internal Links, Sources

`content-plan-parser.mjs` reads `CONTENT_PLAN.md` to select the next `ready` topic and matches it to a brief file by topic number.

### Prompt templates (`scripts/templates/prompts/`)

- `generate.md` — main article generation prompt (uses `{{SITE_URL}}`, `{{SITE_NAME}}`, `{{CTA_URL}}`, `{{SLUG}}`, `{{YEAR}}`)
- `improve.md` — improvement prompt
- `evaluate.md` — fact extraction/evaluation prompt (returns JSON)

### AI models used

- **Haiku** (`claude-haiku-4-5-20251001`) — article generation, improvement, evaluation
- **Sonnet** (`claude-sonnet-4-6`) — JSX structural repair, AI article review workflow
