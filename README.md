# leadhunter-engine

The automation engine behind LeadHunter client blogs.

Each client blog is a standalone Next.js site that calls this engine via GitHub Actions. The engine handles everything that happens after the site is set up — writing articles, monitoring search performance, and tracking brand mentions across the web.

---

## What it does

**Brief generation**
Keeps the content queue full automatically. Reads the keyword research doc and existing topics, generates new briefs with Claude when the queue drops below 5 ready topics. Runs daily at 08:00 UTC before article generation.

**Article generation**
Reads the content plan, researches the topic, writes a fully structured SEO article, and opens it as a Pull Request. The client reviews and merges — no writing required.

**AI article review**
Every Pull Request with a new article is automatically reviewed for quality, SEO structure, and brand consistency before it goes live. Auto-fixes issues and commits to the PR branch — up to 5 rounds.

**Weekly article audit**
Every Sunday, scans all published articles for broken internal links, missing required components, desync between blog-data.ts and llms.txt, stale dates, and style violations. Opens a GitHub Issue with a labeled list of findings. Closes the issue automatically when all issues are resolved.

**Google Search Console monitoring**
Checks which pages are indexed, flags coverage issues, and tracks keyword performance over time.

**GEO health check**
Scores how well the site is optimized for AI-powered search (ChatGPT, Perplexity, Google AI Overviews). Flags gaps and suggests improvements.

**Citation research**
Monitors whether the brand is being cited by AI models and authoritative sources. Tracks competitor mentions for comparison.

---

## How it connects to a client blog

Each client blog is a separate repository created from [blog-client-template](https://github.com/cybrixcc/blog-client-template). That repo contains thin GitHub Actions workflows that call this engine:

```
client-blog/.github/workflows/generate-article.yml
    ↓
uses: cybrixcc/leadhunter-engine/.github/workflows/generate-article.yml@master
```

The client repo provides its own `config.yml` with site-specific settings. The engine does the rest.

When the engine is updated, all client blogs get the improvements automatically — no changes needed on the client side.

---

## For clients

You do not need to interact with this repository directly. Your blog has its own repository with a content plan and configuration. To trigger a new article, go to your repo → **Actions** → **Generate Blog Article** → **Run workflow**.

If you have questions about your blog setup, refer to the `GETTING_STARTED.md` or `CLAUDE.md` in your blog repository.
