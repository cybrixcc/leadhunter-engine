# leadhunter-engine

The automation engine behind LeadHunter client blogs.

Each client blog is a standalone Next.js site that calls this engine via GitHub Actions. The engine handles everything that happens after the site is set up — writing articles, monitoring search performance, and tracking brand mentions across the web.

---

## What it does

**Article generation**
Reads the content plan, researches the topic, writes a fully structured SEO article, and opens it as a Pull Request. The client reviews and merges — no writing required.

**Google Search Console monitoring**
Checks which pages are indexed, flags coverage issues, and tracks keyword performance over time.

**GEO health check**
Scores how well the site is optimized for AI-powered search (ChatGPT, Perplexity, Google AI Overviews). Flags gaps and suggests improvements.

**Citation research**
Monitors whether the brand is being cited by AI models and authoritative sources. Tracks competitor mentions for comparison.

**AI article review**
Every Pull Request with a new article is automatically reviewed for quality, SEO structure, and brand consistency before it goes live.

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
