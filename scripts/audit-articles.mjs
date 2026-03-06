/**
 * audit-articles.mjs
 *
 * Weekly audit of all published blog articles. Checks structural compliance,
 * broken internal links, sync between blog-data.ts / llms.txt and actual files,
 * and common style violations.
 *
 * Exit codes:
 *   0 — all clear
 *   1 — errors found (broken links, missing required components, desync)
 *   2 — warnings only (stale dates, missing OG image, minor issues)
 *
 * The calling workflow reads exit code and creates a GitHub Issue if > 0.
 *
 * Usage:
 *   node scripts/audit-articles.mjs
 *   node scripts/audit-articles.mjs --blog-glob="src/app/blog"
 */

import fs from "fs";
import path from "path";

const args = process.argv.slice(2);
const BLOG_DIR =
  args.find((a) => a.startsWith("--blog-glob="))?.split("=")[1] ||
  "src/app/blog";
const BLOG_DATA_PATH = "src/lib/blog-data.ts";
const LLMS_TXT_PATH = "public/llms.txt";

const issues = [];

function issue(severity, file, message) {
  issues.push({ severity, file, message });
  const prefix = severity === "ERROR" ? "[ERROR]" : "[WARN] ";
  console.log(`${prefix} ${file}: ${message}`);
}

// --- 1. Collect article slugs ---

if (!fs.existsSync(BLOG_DIR)) {
  console.error(`Blog directory not found: ${BLOG_DIR}`);
  process.exit(1);
}

const slugs = fs.readdirSync(BLOG_DIR).filter((f) => {
  const p = path.join(BLOG_DIR, f);
  return (
    fs.statSync(p).isDirectory() &&
    fs.existsSync(path.join(p, "page.tsx"))
  );
});

console.log(`Auditing ${slugs.length} articles...\n`);

// --- 2. blog-data.ts sync ---

if (fs.existsSync(BLOG_DATA_PATH)) {
  const blogData = fs.readFileSync(BLOG_DATA_PATH, "utf8");

  for (const slug of slugs) {
    if (!blogData.includes(`slug: "${slug}"`) && !blogData.includes(`slug: '${slug}'`)) {
      issue("ERROR", BLOG_DATA_PATH, `Missing entry for slug: "${slug}"`);
    }
  }

  // Detect duplicates
  const slugMatches = [
    ...blogData.matchAll(/slug:\s*["']([^"']+)["']/g),
  ].map((m) => m[1]);
  const seen = new Set();
  for (const s of slugMatches) {
    if (seen.has(s)) {
      issue("ERROR", BLOG_DATA_PATH, `Duplicate slug: "${s}"`);
    }
    seen.add(s);
  }
} else {
  console.warn(`${BLOG_DATA_PATH} not found — skipping blog-data sync check.`);
}

// --- 3. llms.txt sync ---

if (fs.existsSync(LLMS_TXT_PATH)) {
  const llmsTxt = fs.readFileSync(LLMS_TXT_PATH, "utf8");
  for (const slug of slugs) {
    if (!llmsTxt.includes(`/blog/${slug}`)) {
      issue("WARN", LLMS_TXT_PATH, `Missing entry for /blog/${slug}`);
    }
  }
} else {
  console.warn(`${LLMS_TXT_PATH} not found — skipping llms.txt sync check.`);
}

// --- 4. Per-article checks ---

for (const slug of slugs) {
  const filePath = path.join(BLOG_DIR, slug, "page.tsx");
  const content = fs.readFileSync(filePath, "utf8");

  // 4a. Required components
  for (const component of [
    "ArticleAuthor",
    "FAQJsonLd",
    "ArticleJsonLd",
    "Header",
    "Footer",
  ]) {
    if (!content.includes(component)) {
      issue("ERROR", filePath, `Missing required component: ${component}`);
    }
  }

  // 4b. Broken internal links (href="/blog/<slug>" pointing to non-existent article)
  for (const match of content.matchAll(/href=["']\/blog\/([^"'/?\s]+)["']/g)) {
    const linkedSlug = match[1];
    if (!slugs.includes(linkedSlug)) {
      issue(
        "ERROR",
        filePath,
        `Broken internal link: /blog/${linkedSlug} does not exist`
      );
    }
  }

  // 4c. Hardcoded absolute domain in hrefs (should use relative paths)
  for (const match of content.matchAll(
    /href=["'](https?:\/\/[^"']+)["']/g
  )) {
    const url = match[1];
    // Flag internal-looking URLs that should be relative
    if (
      url.includes("/blog/") &&
      !url.startsWith("https://schema.org") &&
      !url.startsWith("https://twitter") &&
      !url.startsWith("https://linkedin")
    ) {
      issue(
        "WARN",
        filePath,
        `Hardcoded absolute URL in href — consider using relative path: ${url}`
      );
    }
  }

  // 4d. Missing opengraph-image.tsx
  const ogPath = path.join(BLOG_DIR, slug, "opengraph-image.tsx");
  if (!fs.existsSync(ogPath)) {
    issue("WARN", filePath, `Missing opengraph-image.tsx`);
  }

  // 4e. ArticleAuthor missing date prop
  if (
    content.includes("ArticleAuthor") &&
    !content.match(/ArticleAuthor[^/\n]*date=/)
  ) {
    issue("WARN", filePath, `ArticleAuthor is missing the date prop`);
  }

  // 4f. Emoji in content (style violation)
  if (/[\u{1F300}-\u{1F9FF}\u{2600}-\u{27BF}]/u.test(content)) {
    issue("WARN", filePath, `Contains emoji — style violation`);
  }

  // 4g. Stale year: only mentions a past year, no current year
  const currentYear = new Date().getFullYear().toString();
  const prevYear = (parseInt(currentYear) - 1).toString();
  if (
    content.includes(prevYear) &&
    !content.includes(currentYear) &&
    !content.includes(String(parseInt(currentYear) + 1))
  ) {
    issue(
      "WARN",
      filePath,
      `Only mentions ${prevYear} — may need year references updated to ${currentYear}`
    );
  }
}

// --- 5. Report ---

console.log(`\n${"─".repeat(50)}`);
console.log(`Audit complete`);
console.log(`Articles checked : ${slugs.length}`);
console.log(`Total issues     : ${issues.length}`);

const errors = issues.filter((i) => i.severity === "ERROR");
const warnings = issues.filter((i) => i.severity === "WARN");
console.log(`  Errors         : ${errors.length}`);
console.log(`  Warnings       : ${warnings.length}`);

// Write markdown report for GitHub Issue
const today = new Date().toISOString().slice(0, 10);
const reportLines = [
  `## Weekly Article Audit — ${today}`,
  ``,
  `**Articles checked:** ${slugs.length} | **Errors:** ${errors.length} | **Warnings:** ${warnings.length}`,
  ``,
];

if (errors.length > 0) {
  reportLines.push(`### Errors (must fix)`);
  reportLines.push(``);
  for (const i of errors) {
    reportLines.push(`- \`${i.file}\`: ${i.message}`);
  }
  reportLines.push(``);
}

if (warnings.length > 0) {
  reportLines.push(`### Warnings (should fix)`);
  reportLines.push(``);
  for (const i of warnings) {
    reportLines.push(`- \`${i.file}\`: ${i.message}`);
  }
  reportLines.push(``);
}

if (issues.length === 0) {
  reportLines.push(`All checks passed. No issues found.`);
  reportLines.push(``);
}

reportLines.push(
  `---`,
  `*Generated by audit-articles.mjs — runs every Sunday at 07:00 UTC*`
);

fs.writeFileSync("audit-report.md", reportLines.join("\n"));
console.log(`\nReport written to audit-report.md`);

if (errors.length > 0) process.exit(1);
if (warnings.length > 0) process.exit(2);
