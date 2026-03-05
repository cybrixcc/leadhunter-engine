/**
 * Content Plan Parser
 *
 * Parses CONTENT_PLAN.md and selects the next topic for generation.
 *
 * Status values:
 * - idea: Brief incomplete or missing, not ready for generation
 * - ready: Brief complete, can be generated
 * - published: Article has been generated and published
 */

import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// When running as reusable engine, CLIENT_REPO_PATH points to calling repo root.
// Fall back to __dirname/../.. for standalone/local use.
const ROOT_DIR = process.env.CLIENT_REPO_PATH || join(__dirname, '..', '..');

/**
 * Parse the Article Index table from CONTENT_PLAN.md
 * @returns {Promise<Array<{number: number, title: string, status: string, priority: string}>>}
 */
export async function parseArticleIndex() {
  const contentPlanPath = join(ROOT_DIR, 'CONTENT_PLAN.md');
  const content = await readFile(contentPlanPath, 'utf-8');

  // Find the Article Index table (4 columns: #, Title, Status, Priority)
  const tableMatch = content.match(/### Article Index \(\d+ topics\)\n\n\|[^|]+\|[^|]+\|[^|]+\|[^|]+\|\n\|[-\s|]+\|\n([\s\S]*?)(?=\n\n|\n>|\n##|$)/);

  if (!tableMatch) {
    throw new Error('Could not find Article Index table in CONTENT_PLAN.md');
  }

  const tableContent = tableMatch[1];
  const rows = tableContent.trim().split('\n').filter(row => row.trim());

  const articles = [];

  for (const row of rows) {
    // Parse: | 6  | LinkedIn vs Email for B2B Outreach | ready     | P1       |
    const match = row.match(/\|\s*(\d+)\s*\|\s*([^|]+)\s*\|\s*(\w+)\s*\|\s*([^\|]*)\s*\|/);
    if (match) {
      articles.push({
        number: parseInt(match[1], 10),
        title: match[2].trim(),
        status: match[3].trim(),
        priority: match[4].trim() || '—' // Default to '—' if empty
      });
    }
  }

  return articles;
}

/**
 * Get the next topic ready for generation (sorted by priority)
 * @returns {Promise<{number: number, title: string, status: string, priority: string} | null>}
 */
export async function getNextReadyTopic() {
  const articles = await parseArticleIndex();

  // Filter ready topics
  const readyTopics = articles.filter(article => article.status === 'ready');

  if (readyTopics.length === 0) {
    return null;
  }

  // Sort by priority: **P0** > P0 > P1 > P2 > —
  // Extract priority level (P0, P1, P2) and check for bold (**P0**)
  const priorityOrder = (priority) => {
    const isBold = priority.includes('**');
    const level = priority.replace(/\*/g, '').trim();

    // Priority mapping: **P0** = 0, P0 = 1, P1 = 2, P2 = 3, — = 999
    if (level === 'P0') return isBold ? 0 : 1;
    if (level === 'P1') return 2;
    if (level === 'P2') return 3;
    return 999; // Default for '—' or unknown
  };

  readyTopics.sort((a, b) => priorityOrder(a.priority) - priorityOrder(b.priority));

  return readyTopics[0];
}

/**
 * Get all published articles for reference matching
 * @returns {Promise<Array<{slug: string, title: string, category: string}>>}
 */
export async function getPublishedArticles() {
  const contentPlanPath = join(ROOT_DIR, 'CONTENT_PLAN.md');
  const content = await readFile(contentPlanPath, 'utf-8');

  // Find the Blog Articles table
  const tableMatch = content.match(/### Blog Articles \(\d+ total\)\n\n\|[^|]+\|[^|]+\|[^|]+\|[^|]+\|\n\|[-\s|]+\|\n([\s\S]*?)(?=\n\n|\n###|$)/);

  if (!tableMatch) {
    throw new Error('Could not find Blog Articles table in CONTENT_PLAN.md');
  }

  const tableContent = tableMatch[1];
  const rows = tableContent.trim().split('\n').filter(row => row.trim());

  const articles = [];

  for (const row of rows) {
    // Parse: | /blog/linkedin-warmup-guide | How to Warm Up a LinkedIn Account | Safety Guide | linkedin warmup, ... |
    const match = row.match(/\|\s*([^|]+)\s*\|\s*([^|]+)\s*\|\s*([^|]+)\s*\|\s*([^|]+)\s*\|/);
    if (match) {
      const slug = match[1].trim();
      if (slug.startsWith('/blog/')) {
        articles.push({
          slug: slug.replace('/blog/', ''),
          title: match[2].trim(),
          category: match[3].trim()
        });
      }
    }
  }

  return articles;
}

/**
 * Classify article type based on brief content and title
 * @param {object} brief - The parsed brief
 * @returns {string} - Article type: guide, data, analysis, problem-solving, strategy
 */
export function classifyArticleType(brief) {
  const { title, searchIntent, keyPoints } = brief;
  const text = `${title} ${searchIntent} ${keyPoints.join(' ')}`.toLowerCase();

  // Classification rules based on content
  if (text.includes('benchmark') || text.includes('statistics') || text.includes('data') || text.includes('research')) {
    return 'data';
  }
  if (text.includes('how to') || text.includes('guide') || text.includes('step-by-step') || text.includes('tutorial')) {
    return 'guide';
  }
  if (text.includes('why') || text.includes('analysis') || text.includes('explained') || text.includes('understanding')) {
    return 'analysis';
  }
  if (text.includes('not working') || text.includes('problem') || text.includes('fix') || text.includes('recovery')) {
    return 'problem-solving';
  }
  if (text.includes('strategy') || text.includes('playbook') || text.includes('approach')) {
    return 'strategy';
  }

  // Default to guide
  return 'guide';
}

/**
 * Map category names to types
 * @param {string} category
 * @returns {string}
 */
export function categoryToType(category) {
  const mapping = {
    'Guide': 'guide',
    'Safety Guide': 'guide',
    'Data': 'data',
    'Data & Research': 'data',      // Display name from getCategoryDisplayName
    'Analysis': 'analysis',
    'Problem-solving': 'problem-solving',
    'Problem-Solving': 'problem-solving', // Display name from getCategoryDisplayName
    'Strategy': 'strategy',
    'Review': 'analysis'
  };
  return mapping[category] || 'guide';
}
