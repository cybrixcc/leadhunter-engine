/**
 * Context Builder
 *
 * Builds context for Claude by finding similar reference articles
 * and assembling all necessary information for article generation.
 */

import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getPublishedArticles, classifyArticleType, categoryToType } from './content-plan-parser.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(__dirname, '..', '..');

/**
 * Find the most similar reference article based on type
 * @param {object} brief - The parsed brief
 * @param {Array} publishedArticles - List of published articles
 * @returns {Promise<{slug: string, title: string, content: string} | null>}
 */
export async function findReferenceArticle(brief, publishedArticles) {
  const targetType = classifyArticleType(brief);

  // Find articles of the same type
  const sameTypeArticles = publishedArticles.filter(
    article => categoryToType(article.category) === targetType
  );

  // If no same type, pick any guide as fallback
  const candidateArticles = sameTypeArticles.length > 0
    ? sameTypeArticles
    : publishedArticles.filter(a => categoryToType(a.category) === 'guide');

  if (candidateArticles.length === 0) {
    // Ultimate fallback: use any published article
    if (publishedArticles.length > 0) {
      return await loadArticleContent(publishedArticles[0].slug);
    }
    return null;
  }

  // Pick the best match based on keyword similarity
  // Use word-level matching (not substring) by splitting keywords into a Set
  const briefKeywordWords = new Set(
    brief.targetKeywords.flatMap(k => k.toLowerCase().split(/\s+/))
      .filter(w => w.length > 3)
  );
  let bestMatch = candidateArticles[0];
  let bestScore = 0;

  for (const article of candidateArticles) {
    const titleWords = article.title.toLowerCase().split(/\s+/);
    const score = titleWords.filter(word =>
      briefKeywordWords.has(word) && word.length > 3
    ).length;

    if (score > bestScore) {
      bestScore = score;
      bestMatch = article;
    }
  }

  return await loadArticleContent(bestMatch.slug);
}

/**
 * Load the content of an article
 * @param {string} slug
 * @returns {Promise<{slug: string, title: string, content: string}>}
 */
async function loadArticleContent(slug) {
  const articlePath = join(ROOT_DIR, 'src', 'app', 'blog', slug, 'page.tsx');

  try {
    const content = await readFile(articlePath, 'utf-8');
    // Extract title from metadata
    const titleMatch = content.match(/title:\s*["']([^"']+)["']/);
    return {
      slug,
      title: titleMatch ? titleMatch[1] : slug,
      content
    };
  } catch (error) {
    console.warn(`Could not load article: ${slug}`, error.message);
    return null;
  }
}

/**
 * Read CLAUDE.md for project guidelines
 * @returns {Promise<string>}
 */
export async function readProjectGuidelines() {
  const claudePath = join(ROOT_DIR, 'CLAUDE.md');
  try {
    return await readFile(claudePath, 'utf-8');
  } catch {
    return '';
  }
}

/**
 * Get existing component imports from reference article
 * @param {string} articleContent
 * @returns {string[]}
 */
export function extractImports(articleContent) {
  const importMatch = articleContent.match(/^import[\s\S]*?(?=\n\n|export)/m);
  if (importMatch) {
    return importMatch[0].split('\n').filter(line => line.startsWith('import'));
  }
  return [];
}

/**
 * Build the full context for article generation
 * @param {object} brief - The parsed brief
 * @returns {Promise<object>}
 */
export async function buildContext(brief) {
  const publishedArticles = await getPublishedArticles();
  const referenceArticle = await findReferenceArticle(brief, publishedArticles);
  const projectGuidelines = await readProjectGuidelines();

  // Build list of existing blog pages for internal linking
  const existingBlogPages = publishedArticles.map(a => ({
    slug: `/blog/${a.slug}`,
    title: a.title
  }));

  return {
    brief,
    referenceArticle,
    projectGuidelines,
    articleType: classifyArticleType(brief),
    imports: referenceArticle ? extractImports(referenceArticle.content) : [],
    existingBlogPages,
    timestamp: new Date().toISOString()
  };
}

/**
 * Extract data structures/arrays from reference article
 * These are useful patterns to follow for similar content
 * (Internal utility - not currently used but available for future enhancements)
 * @param {string} content
 * @returns {string[]}
 */
function extractDataPatterns(content) {
  const patterns = [];

  // Find const declarations that are arrays or objects
  const constMatches = content.match(/const\s+\w+\s*=\s*\[[\s\S]*?\];/g);
  if (constMatches) {
    patterns.push(...constMatches);
  }

  return patterns;
}

/**
 * Get UI patterns used in reference (Badge, Button, tables, etc.)
 * (Internal utility - not currently used but available for future enhancements)
 * @param {string} content
 * @returns {string[]}
 */
function extractUIPatterns(content) {
  const patterns = [];

  // Check for common UI elements
  if (content.includes('<Badge')) patterns.push('Badge');
  if (content.includes('<Button')) patterns.push('Button');
  if (content.includes('<table')) patterns.push('table');
  if (content.includes('className="grid')) patterns.push('grid');
  if (content.includes('FAQJsonLd')) patterns.push('FAQJsonLd');

  return patterns;
}
