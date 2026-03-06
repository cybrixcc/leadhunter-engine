/**
 * generate-briefs.mjs
 *
 * Keeps the content queue full by auto-generating briefs when the number of
 * "ready" topics in CONTENT_PLAN.md drops below MIN_READY.
 *
 * Designed to run daily (e.g. 08:00 UTC) — one hour before generate-article.mjs.
 *
 * Usage:
 *   node scripts/generate-briefs.mjs                  # auto mode
 *   node scripts/generate-briefs.mjs --count=3        # force generate N briefs
 *   node scripts/generate-briefs.mjs --min-ready=10   # custom threshold
 *   node scripts/generate-briefs.mjs --dry-run        # preview without writing files
 */

import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";
import path from "path";
import { loadConfig } from "./lib/config-loader.mjs";

const DEFAULT_MIN_READY = 5;
const BRIEFS_DIR = "docs/briefs";
const CONTENT_PLAN_PATH = "CONTENT_PLAN.md";
const KEYWORD_RESEARCH_PATH = "docs/KEYWORD_RESEARCH.md";

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const FORCE_COUNT = parseInt(
  args.find((a) => a.startsWith("--count="))?.split("=")[1] || "0"
);
const MIN_READY = parseInt(
  args.find((a) => a.startsWith("--min-ready="))?.split("=")[1] ||
  String(DEFAULT_MIN_READY)
);

// --- Load config ---
const config = await loadConfig();
const siteName = config.site_name || "Blog";
const niche = config.niche || "content marketing";
const productDescription =
  config.citation_research?.product_description || siteName;
const ctaUrl = config.cta_url || "/";

// --- Read current state ---

if (!fs.existsSync(CONTENT_PLAN_PATH)) {
  console.error(`CONTENT_PLAN.md not found at ${CONTENT_PLAN_PATH}`);
  process.exit(1);
}

const contentPlan = fs.readFileSync(CONTENT_PLAN_PATH, "utf8");
const keywordResearch = fs.existsSync(KEYWORD_RESEARCH_PATH)
  ? fs.readFileSync(KEYWORD_RESEARCH_PATH, "utf8")
  : "";

// Count ready topics
const readyCount = (contentPlan.match(/\|\s+ready\s+\|/g) || []).length;
console.log(`Ready topics in queue: ${readyCount}`);

const needed = FORCE_COUNT > 0 ? FORCE_COUNT : Math.max(0, MIN_READY - readyCount);

if (needed === 0) {
  console.log(`Queue is full (${readyCount} >= ${MIN_READY}). Nothing to do.`);
  process.exit(0);
}

console.log(`Generating ${needed} new brief(s)...`);
if (DRY_RUN) console.log("DRY RUN — no files will be written.");

// --- Read existing content to avoid duplicates ---

if (!fs.existsSync(BRIEFS_DIR)) {
  fs.mkdirSync(BRIEFS_DIR, { recursive: true });
}

const existingBriefSummaries = fs
  .readdirSync(BRIEFS_DIR)
  .filter((f) => f.endsWith(".md"))
  .map((f) => {
    const content = fs.readFileSync(path.join(BRIEFS_DIR, f), "utf8");
    const titleMatch = content.match(/## Title\s*\n([^\n]+)/);
    return titleMatch ? titleMatch[1].trim() : f;
  });

const existingTitles = [
  ...contentPlan.matchAll(/\|\s*\d+\s*\|\s*([^|]+)\|/g),
].map((m) => m[1].trim());

// --- Build prompt ---

const client = new Anthropic();

const prompt = `You are a content strategist for ${siteName}.

Product: ${productDescription}

Your task: generate ${needed} new article brief(s) for the ${siteName} blog.
Niche: ${niche}

${keywordResearch ? `## Keyword research to draw from:\n${keywordResearch}\n` : ""}

## Existing article titles — do NOT duplicate these:
${[...existingTitles, ...existingBriefSummaries].map((t) => `- ${t}`).join("\n")}

## Rules:
- Target keywords with commercial or informational intent relevant to the niche
- Each article must be directly useful to the target audience
- Tone: direct, expert, no fluff
- Each brief must follow the EXACT format below — no deviations

## Brief format:
\`\`\`
# Brief: [Article Title]

## Title
[Full article title]

## Target Keywords
- [primary keyword]
- [secondary keyword]
- [secondary keyword]

## Search Intent
[One sentence: who is searching and why]

## Main Thesis
[One sentence: the core argument of the article]

## Key Points
- [Point 1]
- [Point 2]
- [Point 3]
- [Point 4]
- [Point 5]

## Why It Matters
[2-3 sentences: why this topic matters to the audience]

## Brand Angle
[2-3 sentences: how ${siteName} connects to this topic. CTA URL: ${ctaUrl}]

## Internal Links
- /blog/[existing-slug] — anchor: "[anchor text]"

## Sources
- [Source 1 — real, credible, publicly known]
- [Source 2]
- [Source 3]
\`\`\`

Generate exactly ${needed} brief(s). Return ONLY the briefs separated by a line containing only "---".
No intro text, no explanations, no markdown code fences around the output.`;

console.log("Calling Claude API...");
const message = await client.messages.create({
  model: "claude-haiku-4-5-20251001",
  max_tokens: 4000,
  messages: [{ role: "user", content: prompt }],
});

const response = message.content[0].text.trim();
const briefs = response
  .split(/\n---\n/)
  .map((b) => b.trim())
  .filter((b) => b.length > 100);

console.log(`Claude returned ${briefs.length} brief(s).`);

if (briefs.length === 0) {
  console.error("No valid briefs returned. Exiting.");
  process.exit(1);
}

// --- Write briefs and update CONTENT_PLAN.md ---

// Find next brief number
const existingNumbers = fs
  .readdirSync(BRIEFS_DIR)
  .filter((f) => f.endsWith(".md"))
  .map((f) => parseInt(f.match(/^(\d+)/)?.[1] || "0"))
  .filter((n) => !isNaN(n) && n > 0);
let nextNumber =
  existingNumbers.length > 0 ? Math.max(...existingNumbers) + 1 : 1;

// Find next topic number
const topicNumbers = [...contentPlan.matchAll(/\|\s*(\d+)\s*\|/g)].map((m) =>
  parseInt(m[1])
);
let nextTopicNumber =
  topicNumbers.length > 0 ? Math.max(...topicNumbers) + 1 : 1;

const newTopicLines = [];

for (const brief of briefs) {
  const titleMatch = brief.match(/## Title\s*\n([^\n]+)/);
  if (!titleMatch) {
    console.warn("Could not extract title from brief — skipping.");
    continue;
  }
  const title = titleMatch[1].trim();

  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);

  const fileName = `${String(nextNumber).padStart(2, "0")}-${slug}.md`;
  const filePath = path.join(BRIEFS_DIR, fileName);

  if (DRY_RUN) {
    console.log(`[dry-run] Would write: ${filePath}`);
    console.log(`[dry-run] Title: ${title}`);
  } else {
    fs.writeFileSync(filePath, brief + "\n");
    console.log(`Written: ${filePath}`);
  }

  const paddedNum = String(nextTopicNumber).padEnd(2);
  const paddedTitle = title.slice(0, 66).padEnd(66);
  newTopicLines.push(
    `| ${paddedNum} | ${paddedTitle} | ready     | P1       |`
  );

  nextNumber++;
  nextTopicNumber++;
}

// Update CONTENT_PLAN.md
if (newTopicLines.length > 0) {
  const currentCount = topicNumbers.length;
  const newCount = currentCount + newTopicLines.length;

  let updated = contentPlan;

  updated = updated.replace(
    /### Article Index \(\d+ topics\)/,
    `### Article Index (${newCount} topics)`
  );

  // Insert new rows directly before the "> Status values:" line,
  // stripping any blank lines between the table and the legend so rows
  // are never orphaned from the table by a blank line.
  updated = updated.replace(
    /\n+> Status values:/,
    "\n" + newTopicLines.join("\n") + "\n\n> Status values:"
  );

  if (DRY_RUN) {
    console.log(
      `[dry-run] Would add ${newTopicLines.length} topic(s) to CONTENT_PLAN.md`
    );
  } else {
    fs.writeFileSync(CONTENT_PLAN_PATH, updated);
    console.log(
      `Updated CONTENT_PLAN.md with ${newTopicLines.length} new topic(s).`
    );
  }
}

console.log("Done.");
