/**
 * File Updater
 *
 * Updates tracking files after article generation:
 * - CONTENT_PLAN.md (status update)
 * - src/lib/blog-data.ts (add to articles array)
 * - src/app/blog/feed.xml/route.ts (add to RSS feed)
 * - public/llms.txt (add blog entry)
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getCategoryDisplayName } from './og-image-generator.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(__dirname, '..', '..');

/**
 * Add article to blog data file (src/lib/blog-data.ts)
 * @param {object} articleData
 */
export async function addToBlogIndex(articleData) {
  const { slug, title, description, badge, badgeColor } = articleData;

  const blogDataPath = join(ROOT_DIR, 'src', 'lib', 'blog-data.ts');
  let content = await readFile(blogDataPath, 'utf-8');

  // Create new article entry - use JSON.stringify for proper escaping
  const newEntry = `  // Latest
  {
    slug: ${JSON.stringify(slug)},
    title: ${JSON.stringify(title)},
    description:
      ${JSON.stringify(description)},
    badge: ${JSON.stringify(badge)},
    badgeColor: ${JSON.stringify(badgeColor)},
  },`;

  // Remove existing "// Latest" comment if any to avoid duplicates
  content = content.replace(/\s*\/\/ Latest\n  \{/g, '\n  {');

  // Insert after "const articles" array opening and before the first entry
  // IMPORTANT: Find position AFTER the replace to avoid stale indices
  const insertPoint = content.indexOf('const articles');
  if (insertPoint === -1) {
    throw new Error('Could not find articles array in src/lib/blog-data.ts');
  }

  const arrayStart = content.indexOf('= [', insertPoint) + 3;

  // Insert the new entry
  const newContent = content.slice(0, arrayStart) + '\n' + newEntry + content.slice(arrayStart);

  await writeFile(blogDataPath, newContent, 'utf-8');
  console.log(`Added to blog index: ${slug}`);
}

/**
 * Add article to RSS feed (src/app/blog/feed.xml/route.ts)
 * @param {object} articleData
 */
export async function addToFeedXml(articleData) {
  const { slug, title, description } = articleData;

  const feedPath = join(ROOT_DIR, 'src', 'app', 'blog', 'feed.xml', 'route.ts');
  let content = await readFile(feedPath, 'utf-8');

  const today = new Date().toISOString().split('T')[0];

  const newEntry = `  {
    slug: ${JSON.stringify(slug)},
    title: ${JSON.stringify(title)},
    description: ${JSON.stringify(description)},
    date: ${JSON.stringify(today)},
  },`;

  const insertPoint = content.indexOf('const articles = [');
  if (insertPoint === -1) {
    console.warn('Could not find articles array in feed.xml/route.ts — skipping RSS update');
    return;
  }

  const arrayStart = content.indexOf('[', insertPoint) + 1;
  const newContent = content.slice(0, arrayStart) + '\n' + newEntry + content.slice(arrayStart);

  await writeFile(feedPath, newContent, 'utf-8');
  console.log(`Added to RSS feed: ${slug}`);
}

/**
 * Add article to llms.txt
 * @param {object} articleData
 */
export async function addToLlmsTxt(articleData) {
  const { slug, title, description } = articleData;

  const llmsPath = join(ROOT_DIR, 'public', 'llms.txt');
  let content = await readFile(llmsPath, 'utf-8');

  // Find the Blog Articles section
  const blogSectionMatch = content.match(/### Blog Articles\n([\s\S]*?)(?=\n###|\n## |$)/);
  if (!blogSectionMatch) {
    throw new Error('Could not find Blog Articles section in llms.txt');
  }

  // Create new entry
  const newEntry = `- /blog/${slug}: ${title} — ${description}`;

  // Insert at the end of the Blog Articles section (before the last entry)
  const blogSection = blogSectionMatch[0];
  const lines = blogSection.split('\n');

  // Find the last blog entry line and insert after it
  const lastEntryIndex = lines.reduce((acc, line, i) =>
    line.startsWith('- /blog/') ? i : acc, 0
  );

  lines.splice(lastEntryIndex + 1, 0, newEntry);

  const newBlogSection = lines.join('\n');
  // Use function replacer to avoid $& $' $` special pattern interpretation
  const newContent = content.replace(blogSection, () => newBlogSection);

  await writeFile(llmsPath, newContent, 'utf-8');
  console.log(`Added to llms.txt: /blog/${slug}`);
}

/**
 * Create the article file
 * @param {string} slug
 * @param {string} content
 */
export async function createArticleFile(slug, content) {
  const articleDir = join(ROOT_DIR, 'src', 'app', 'blog', slug);

  // Create directory
  await mkdir(articleDir, { recursive: true });

  // Write page.tsx
  const pagePath = join(articleDir, 'page.tsx');
  await writeFile(pagePath, content, 'utf-8');

  console.log(`Created article file: ${pagePath}`);
  return pagePath;
}

/**
 * Create OG image file for article
 * @param {string} slug
 * @param {string} title
 * @param {string} category - Display name (e.g. "Guide", "Data & Research")
 */
export async function createOGImage(slug, title, category) {
  const articleDir = join(ROOT_DIR, 'src', 'app', 'blog', slug);
  await mkdir(articleDir, { recursive: true });

  // Shorten title for OG image if needed (max ~60 chars looks good)
  const ogTitle = title.length > 65 ? title.substring(0, 62) + '...' : title;

  const ogContent = `import { BlogOGImage } from "@/components/seo/BlogOGImage";

export const dynamic = "force-static";
export const alt = ${JSON.stringify(title)};
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  return BlogOGImage({
    title: ${JSON.stringify(ogTitle)},
    category: ${JSON.stringify(category)},
  });
}
`;

  const ogPath = join(articleDir, 'opengraph-image.tsx');
  await writeFile(ogPath, ogContent, 'utf-8');
  console.log(`Created OG image: ${ogPath}`);
}

/**
 * Prepare article metadata for all updates
 * @param {object} brief
 * @param {string} slug
 * @param {string} articleContent
 * @param {string} articleType
 * @returns {object}
 */
export function prepareArticleMetadata(brief, slug, articleContent, articleType) {
  // Extract description from metadata - handle quotes correctly
  // Match description: "..." or description: '...' capturing content between matching quotes
  const descMatch = articleContent.match(/description:\s*"([^"]+)"/) ||
                    articleContent.match(/description:\s*'([^']+)'/);
  const description = descMatch
    ? descMatch[1].trim()
    : brief.mainThesis;

  // Get badge info
  const badge = getCategoryDisplayName(articleType);
  const badgeColors = {
    guide: 'neon-green',
    data: 'neon-cyan',
    analysis: 'neon-yellow',
    'problem-solving': 'primary',
    strategy: 'neon-purple'
  };

  return {
    slug,
    title: brief.title,
    description,
    badge,
    badgeColor: badgeColors[articleType] || 'neon-green',
    category: badge,
    keywords: brief.targetKeywords
  };
}

/**
 * Update CONTENT_PLAN.md atomically (both status and published content)
 * Single read-modify-write to avoid stale data between operations
 * @param {number} topicNumber
 * @param {object} metadata
 */
async function updateContentPlanAtomic(topicNumber, metadata) {
  const contentPlanPath = join(ROOT_DIR, 'CONTENT_PLAN.md');
  let content = await readFile(contentPlanPath, 'utf-8');

  // 1. Update topic status from 'ready' to 'published' (preserving column alignment)
  // Table format: | # | Title | Status |
  const rowPattern = new RegExp(
    `(\\|\\s*${topicNumber}\\s*\\|[^|]+\\|\\s*)(ready\\s*)(\\|)`,
    'g'
  );
  const afterStatusUpdate = content.replace(rowPattern, (match, before, statusCell, after) => {
    // Pad "published" to same width as original cell (e.g., "ready     " -> "published ")
    const newStatus = 'published'.padEnd(statusCell.length);
    return before + newStatus + after;
  });

  if (afterStatusUpdate === content) {
    console.warn(`Could not find topic ${topicNumber} with status 'ready' in CONTENT_PLAN.md`);
  } else {
    console.log(`Updated CONTENT_PLAN.md: topic ${topicNumber} -> published`);
  }
  content = afterStatusUpdate;

  // 2. Update the Blog Articles count
  const countMatch = content.match(/### Blog Articles \((\d+) total\)/);
  if (countMatch) {
    const newCount = parseInt(countMatch[1]) + 1;
    content = content.replace(
      /### Blog Articles \(\d+ total\)/,
      `### Blog Articles (${newCount} total)`
    );
  }

  // 3. Add new row to Published Content table
  const { slug, title, category, keywords } = metadata;
  const newRow = `| /blog/${slug} | ${title} | ${category} | ${keywords.join(', ')} |`;

  const lines = content.split('\n');
  let insertIndex = -1;
  let inBlogArticlesSection = false;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('### Blog Articles')) {
      inBlogArticlesSection = true;
      continue;
    }
    if (inBlogArticlesSection && lines[i].startsWith('###')) {
      insertIndex = i;
      break;
    }
    if (inBlogArticlesSection && lines[i].startsWith('| /blog/')) {
      insertIndex = i + 1;
    }
  }

  if (insertIndex !== -1) {
    lines.splice(insertIndex, 0, newRow);
    content = lines.join('\n');
    console.log(`Added to Published Content: ${title}`);
  } else {
    console.warn('Could not find insertion point in Blog Articles table');
  }

  // Single write with all changes
  await writeFile(contentPlanPath, content, 'utf-8');
}

/**
 * Run all file updates
 * @param {object} brief
 * @param {string} slug
 * @param {string} articleContent
 * @param {string} articleType
 */
export async function updateAllFiles(brief, slug, articleContent, articleType) {
  const metadata = prepareArticleMetadata(brief, slug, articleContent, articleType);

  console.log('\n=== Updating Files ===\n');

  // 1. Create article file
  await createArticleFile(slug, articleContent);

  // 2. Create OG image
  await createOGImage(slug, brief.title, metadata.badge);

  // 3. Update CONTENT_PLAN.md atomically (status + published content)
  await updateContentPlanAtomic(brief.number, metadata);

  // 4. Add to blog index (src/lib/blog-data.ts)
  await addToBlogIndex(metadata);

  // 5. Add to RSS feed (feed.xml)
  await addToFeedXml(metadata);

  // 6. Add to llms.txt
  await addToLlmsTxt(metadata);

  console.log('\nAll files updated successfully!');
  return metadata;
}
