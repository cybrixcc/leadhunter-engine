/**
 * Article Generator
 *
 * Uses Claude API to generate blog articles based on briefs and context.
 */

import Anthropic from '@anthropic-ai/sdk';
import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { generateSlug } from './brief-reader.mjs';
import { loadConfig } from './config-loader.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = join(__dirname, '..', 'templates', 'prompts');

// Lazy-initialize Anthropic client to allow API key check in main() to run first
let _anthropic = null;
function getClient() {
  if (!_anthropic) {
    _anthropic = new Anthropic();
  }
  return _anthropic;
}

/**
 * Load and populate prompt template
 * @param {string} templateName - 'generate', 'evaluate', or 'improve'
 * @param {object} vars - Variables to substitute
 * @returns {Promise<string>}
 */
async function loadPrompt(templateName, vars) {
  const templatePath = join(PROMPTS_DIR, `${templateName}.md`);
  let template = await readFile(templatePath, 'utf-8');

  // Build lookup map with stringified values
  const valueMap = {};
  for (const [key, value] of Object.entries(vars)) {
    valueMap[key] = Array.isArray(value)
      ? value.map(v => typeof v === 'object' ? JSON.stringify(v) : `- ${v}`).join('\n')
      : (typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value));
  }

  // Single-pass replacement to prevent cross-variable injection
  // (e.g., if ARTICLE_CONTENT contains "{{TITLE}}", it won't be double-substituted)
  template = template.replace(/\{\{([A-Z_]+)\}\}/g, (match, key) => {
    return key in valueMap ? valueMap[key] : match;
  });

  return template;
}

/**
 * Generate article using Claude API
 * @param {object} context - Context from context-builder
 * @returns {Promise<string>} - Generated article content
 */
export async function generateArticle(context) {
  const { brief, referenceArticle, projectGuidelines, articleType, existingBlogPages } = context;
  const config = await loadConfig();

  const slug = generateSlug(brief.title);

  // Format existing pages for prompt
  const existingPagesFormatted = (existingBlogPages || [])
    .map(p => `- ${p.slug} — "${p.title}"`)
    .join('\n');

  const promptVars = {
    TITLE: brief.title,
    KEYWORDS: brief.targetKeywords.join(', '),
    SEARCH_INTENT: brief.searchIntent,
    MAIN_THESIS: brief.mainThesis,
    ARTICLE_TYPE: articleType,
    KEY_POINTS: brief.keyPoints,
    WHY_IT_MATTERS: brief.whyItMatters,
    LEADHUNTER_ANGLE: brief.leadhunterAngle,
    INTERNAL_LINKS: brief.internalLinks.join(', '),
    SOURCES: brief.sources,
    REFERENCE_ARTICLE: referenceArticle?.content || '// No reference article available',
    PROJECT_GUIDELINES: projectGuidelines,
    EXISTING_BLOG_PAGES: existingPagesFormatted || 'No existing pages yet',
    SLUG: slug,
    YEAR: new Date().getFullYear(),
    SITE_URL: config.site_url,
    SITE_NAME: config.site_name,
    CTA_URL: config.cta_url,
    NICHE: config.niche
  };

  const prompt = await loadPrompt('generate', promptVars);

  console.log('Generating article with Claude API...');

  const message = await getClient().messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 16000,
    messages: [
      {
        role: 'user',
        content: prompt
      }
    ]
  });

  // Extract text content from response
  const textContent = message.content.find(c => c.type === 'text');
  if (!textContent) {
    throw new Error('No text content in Claude response');
  }

  let articleContent = textContent.text;

  // Clean up any markdown code blocks if present
  articleContent = articleContent
    .replace(/^```tsx?\n?/gm, '')
    .replace(/^```\n?$/gm, '')
    .trim();

  return articleContent;
}

/**
 * Evaluate article quality using Claude
 * @param {string} articleContent - Generated article
 * @param {object} brief - Original brief
 * @returns {Promise<object>} - Evaluation results
 */
export async function evaluateArticle(articleContent, brief) {
  const promptVars = {
    ARTICLE_CONTENT: articleContent,
    TITLE: brief.title,
    KEY_POINTS: brief.keyPoints,
    SOURCES: brief.sources
  };

  const prompt = await loadPrompt('evaluate', promptVars);

  console.log('Evaluating article with Claude API...');

  const message = await getClient().messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 4000,
    messages: [
      {
        role: 'user',
        content: prompt
      }
    ]
  });

  const textContent = message.content.find(c => c.type === 'text');
  if (!textContent) {
    throw new Error('No text content in Claude response');
  }

  // Extract JSON from response - find balanced braces (accounting for strings)
  const text = textContent.text;
  const startIndex = text.indexOf('{');
  if (startIndex === -1) {
    throw new Error('Could not find JSON start in evaluation response');
  }

  // Find matching closing brace, skipping braces inside strings
  let braceCount = 0;
  let endIndex = -1;
  let inString = false;
  let escapeNext = false;

  for (let i = startIndex; i < text.length; i++) {
    const char = text[i];

    if (escapeNext) {
      escapeNext = false;
      continue;
    }

    if (char === '\\' && inString) {
      escapeNext = true;
      continue;
    }

    if (char === '"' && !escapeNext) {
      inString = !inString;
      continue;
    }

    // Only count braces outside of strings
    if (!inString) {
      if (char === '{') braceCount++;
      if (char === '}') braceCount--;
      if (braceCount === 0) {
        endIndex = i + 1;
        break;
      }
    }
  }

  if (endIndex === -1) {
    throw new Error('Could not find matching JSON end brace');
  }

  const jsonStr = text.slice(startIndex, endIndex);
  return JSON.parse(jsonStr);
}

/**
 * Fix JSX structural issues (unmatched tags) using a focused prompt.
 * Used when quality checker detects tag imbalances before sending to build.
 * Uses Sonnet instead of Haiku — structural JSX repair needs stronger reasoning.
 *
 * @param {string} articleContent - Current article with JSX issues
 * @param {string[]} jsxIssues - List of JSX issues from quality checker
 * @returns {Promise<string>} - Fixed article content
 */
export async function fixJSXStructure(articleContent, jsxIssues) {
  const issuesList = jsxIssues.join('\n');

  const prompt = `You are a JSX/TypeScript code fixer. A React/Next.js article component has unmatched HTML tags that will cause a build failure.

DETECTED ISSUES:
${issuesList}

YOUR TASK:
- Find and fix ALL unmatched/unclosed tags listed above
- Do NOT change any article content, text, or logic
- Do NOT add or remove sections
- Do NOT reformat code
- ONLY add missing closing tags or remove extra opening tags

Return the COMPLETE fixed file. No explanation, no markdown code blocks — just the raw TypeScript/JSX code.

ARTICLE TO FIX:
${articleContent}`;

  console.log('Fixing JSX structure with Claude API (Sonnet)...');

  const message = await getClient().messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 16000,
    messages: [{ role: 'user', content: prompt }]
  });

  const textContent = message.content.find(c => c.type === 'text');
  if (!textContent) {
    throw new Error('No text content in Claude response');
  }

  return textContent.text
    .replace(/^```tsx?\n?/gm, '')
    .replace(/^```\n?$/gm, '')
    .trim();
}

/**
 * Improve article based on issues
 * @param {string} articleContent - Current article
 * @param {object} brief - Original brief
 * @param {string[]} issues - List of issues to fix
 * @param {string} [slug] - Expected slug for consistency
 * @param {Array} [existingBlogPages] - List of existing blog pages for link fixing
 * @returns {Promise<string>} - Improved article
 */
export async function improveArticle(articleContent, brief, issues, slug = null, existingBlogPages = []) {
  const articleSlug = slug || generateSlug(brief.title);
  const config = await loadConfig();

  // Format existing pages for prompt
  const existingPagesFormatted = (existingBlogPages || [])
    .map(p => `- ${p.slug} — "${p.title}"`)
    .join('\n');

  const promptVars = {
    ARTICLE_CONTENT: articleContent,
    TITLE: brief.title,
    SLUG: articleSlug,
    KEY_POINTS: brief.keyPoints,
    SOURCES: brief.sources,
    EXISTING_BLOG_PAGES: existingPagesFormatted || 'No existing pages yet',
    ISSUES: issues.join('\n'),
    SITE_URL: config.site_url,
    SITE_NAME: config.site_name
  };

  const prompt = await loadPrompt('improve', promptVars);

  console.log('Improving article with Claude API...');

  const message = await getClient().messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 16000,
    messages: [
      {
        role: 'user',
        content: prompt
      }
    ]
  });

  const textContent = message.content.find(c => c.type === 'text');
  if (!textContent) {
    throw new Error('No text content in Claude response');
  }

  let improvedContent = textContent.text;

  // Clean up any markdown code blocks if present
  improvedContent = improvedContent
    .replace(/^```tsx?\n?/gm, '')
    .replace(/^```\n?$/gm, '')
    .trim();

  return improvedContent;
}
