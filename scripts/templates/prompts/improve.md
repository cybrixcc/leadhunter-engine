# Article Improvement Prompt

You are a senior editor. Your task is to improve the article based on specific quality issues found during evaluation.

## Current Article
```tsx
{{ARTICLE_CONTENT}}
```

## Issues to Fix

{{ISSUES}}

## Brief (for reference)
Title: {{TITLE}}
Slug (use exactly): {{SLUG}}
Key Points:
{{KEY_POINTS}}

Sources:
{{SOURCES}}

### Existing Blog Pages (ONLY use these for internal links!)
{{EXISTING_BLOG_PAGES}}

### CRITICAL: Slug Consistency
The article slug is: `{{SLUG}}`
All URLs and analytics events MUST use this exact slug:
- Canonical: `{{SITE_URL}}/blog/{{SLUG}}`
- OpenGraph URL: `{{SITE_URL}}/blog/{{SLUG}}`
- Umami events: `cta-blog-{{SLUG}}-hero`, `cta-blog-{{SLUG}}-bottom`

## Improvement Instructions

1. **Only fix the listed issues** - don't make unrelated changes
2. **NO EMOJI** - Do not add or keep any emoji anywhere in the article. Remove any that exist.
3. **Preserve the structure** - keep sections, imports, and patterns intact
3. **Add missing content** - if key points are missing, add them as new sections or expand existing ones
4. **Fix uncited statistics** - either cite them properly or remove them
5. **Add internal links** - integrate them naturally in the text where relevant

### How to Fix Each Issue Type

**Low word count**: Expand sections with more detail, examples, or additional data. Add a new section if needed.

**Missing key points**: Add a new subsection covering the missing point, or expand an existing section.

**Uncited statistics**: Either:
- Add proper attribution: "According to [Source](url)..."
- Use data tables with source column
- Remove the statistic if no source available

**Missing internal links**: Add relevant links in context:
- In body text: "see our [guide to X](/path)"
- In related articles section

## Output

Generate the COMPLETE improved page.tsx file. No explanations - just the raw TypeScript/JSX code starting with imports.
