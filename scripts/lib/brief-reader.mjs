/**
 * Brief Reader
 *
 * Reads and parses brief files from docs/briefs/
 */

import { readFile, readdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = process.env.CLIENT_REPO_PATH || join(__dirname, '..', '..');
const BRIEFS_DIR = join(ROOT_DIR, 'docs', 'briefs');

/**
 * Find brief file by topic number
 * @param {number} topicNumber
 * @returns {Promise<string>} - Path to brief file
 */
export async function findBriefFile(topicNumber) {
  const files = await readdir(BRIEFS_DIR);
  const paddedNumber = String(topicNumber).padStart(2, '0');

  // Find file starting with the padded number
  const briefFile = files.find(f =>
    f.startsWith(`${paddedNumber}-`) && f.endsWith('.md')
  );

  if (!briefFile) {
    // Try without padding for numbers > 9
    const unpaddedFile = files.find(f =>
      f.startsWith(`${topicNumber}-`) && f.endsWith('.md')
    );
    if (unpaddedFile) {
      return join(BRIEFS_DIR, unpaddedFile);
    }
    throw new Error(`Brief file not found for topic ${topicNumber}`);
  }

  return join(BRIEFS_DIR, briefFile);
}

/**
 * Parse brief file content
 * @param {string} content - Raw markdown content
 * @returns {object} - Parsed brief
 */
export function parseBrief(content) {
  const brief = {
    title: '',
    targetKeywords: [],
    searchIntent: '',
    mainThesis: '',
    keyPoints: [],
    whyItMatters: '',
    leadhunterAngle: '',
    internalLinks: [],
    sources: []
  };

  // Extract title
  const titleMatch = content.match(/^####?\s*\d+\.\s*(.+)$/m);
  if (titleMatch) {
    brief.title = titleMatch[1].trim();
  }

  // Extract Target Keywords
  const keywordsMatch = content.match(/\*\*Target Keywords:\*\*\s*(.+)/);
  if (keywordsMatch) {
    brief.targetKeywords = keywordsMatch[1].split(',').map(k => k.trim());
  }

  // Extract Search Intent
  const intentMatch = content.match(/\*\*Search Intent:\*\*\s*(.+)/);
  if (intentMatch) {
    brief.searchIntent = intentMatch[1].trim();
  }

  // Extract Main Thesis
  const thesisMatch = content.match(/\*\*Main Thesis:\*\*\s*(.+)/);
  if (thesisMatch) {
    brief.mainThesis = thesisMatch[1].trim();
  }

  // Extract Key Points
  const keyPointsMatch = content.match(/\*\*Key Points:\*\*\n([\s\S]*?)(?=\n\n\*\*|$)/);
  if (keyPointsMatch) {
    const pointsText = keyPointsMatch[1];
    const points = pointsText.match(/^-\s*(.+)$/gm);
    if (points) {
      brief.keyPoints = points.map(p => p.replace(/^-\s*/, '').trim());
    }
  }

  // Extract Why It Matters
  const whyMatch = content.match(/\*\*Why It Matters:\*\*\s*(.+)/);
  if (whyMatch) {
    brief.whyItMatters = whyMatch[1].trim();
  }

  // Extract LeadHunter Angle
  const angleMatch = content.match(/\*\*LeadHunter Angle:\*\*\s*(.+)/);
  if (angleMatch) {
    brief.leadhunterAngle = angleMatch[1].trim();
  }

  // Extract Internal Links
  const linksMatch = content.match(/\*\*Internal Links:\*\*\s*(.+)/);
  if (linksMatch) {
    brief.internalLinks = linksMatch[1].split(',').map(l => l.trim());
  }

  // Extract Sources
  const sourcesMatch = content.match(/\*\*Sources:\*\*\n([\s\S]*?)(?=\n\n|$)/);
  if (sourcesMatch) {
    const sourcesText = sourcesMatch[1];
    const sourceLinks = sourcesText.match(/\[([^\]]+)\]\(([^)]+)\)/g);
    if (sourceLinks) {
      brief.sources = sourceLinks.map(s => {
        const match = s.match(/\[([^\]]+)\]\(([^)]+)\)/);
        return { name: match[1], url: match[2] };
      });
    }
  }

  return brief;
}

/**
 * Read and parse a brief by topic number
 * @param {number} topicNumber
 * @returns {Promise<object>} - Parsed brief
 */
export async function readBrief(topicNumber) {
  const briefPath = await findBriefFile(topicNumber);
  const content = await readFile(briefPath, 'utf-8');
  const brief = parseBrief(content);
  brief.filePath = briefPath;
  brief.number = topicNumber;
  return brief;
}

/**
 * Generate slug from brief title
 *
 * Problem this solves:
 * Long titles like "LinkedIn vs Email for B2B Outreach: Data-Driven Comparison"
 * would be truncated mid-word to "linkedin-vs-email-for-b2b-outreach-data-driven-com"
 * which looks like a domain (.com) and loses SEO keyword "comparison".
 *
 * Solution:
 * Truncate at word boundaries (last hyphen before limit) to get clean slugs:
 * "linkedin-vs-email-for-b2b-outreach-data-driven" (clean cut at word boundary)
 *
 * The 60% threshold ensures we don't cut too aggressively on titles where
 * the last word happens to be very long.
 *
 * @param {string} title - Article title to slugify
 * @param {number} maxLength - Maximum slug length (default 50)
 * @returns {string} - URL-safe slug
 * @throws {Error} if title is empty or produces empty slug
 */
export function generateSlug(title, maxLength = 50) {
  if (!title || typeof title !== 'string') {
    throw new Error('Cannot generate slug: title is empty or invalid');
  }

  let slug = title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')  // Remove special chars
    .replace(/\s+/g, '-')           // Replace spaces with hyphens
    .replace(/-+/g, '-')            // Replace multiple hyphens with single
    .replace(/^-|-$/g, '');         // Remove leading/trailing hyphens

  // Truncate at word boundary if too long
  if (slug.length > maxLength) {
    const truncated = slug.substring(0, maxLength);
    const lastHyphen = truncated.lastIndexOf('-');

    if (lastHyphen > maxLength * 0.6) {
      // Truncate at last word boundary if it keeps >60% of max length
      slug = truncated.substring(0, lastHyphen);
    } else {
      // Word boundary too early - just truncate and clean up
      slug = truncated.replace(/-$/, '');
    }
  }

  if (!slug) {
    throw new Error(`Cannot generate slug: title "${title}" produces empty slug`);
  }

  return slug;
}
