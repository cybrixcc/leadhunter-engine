/**
 * Quality Checker
 *
 * 20 automated checks for article quality.
 * These checks are code-based and don't require AI.
 */

import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(__dirname, '..', '..');

/**
 * @typedef {Object} CheckResult
 * @property {string} name - Check name
 * @property {boolean} passed - Whether the check passed
 * @property {string} message - Detailed message
 * @property {string} severity - 'error' | 'warning'
 */

/**
 * Run all quality checks
 * @param {string} content - Article content
 * @param {object} brief - Original brief
 * @param {string} [slug] - Expected slug for URL validation
 * @returns {CheckResult[]}
 */
export function runQualityChecks(content, brief, slug = null) {
  const checks = [
    checkImports,
    checkMetadata,
    checkMetadataFields,
    checkSEOEssentials,      // canonical, keywords, description length
    checkOpenGraphComplete,   // OG with all required fields
    checkSEOStatistics,       // No unsubstantiated stats in title/description/h1
    checkHeroSection,
    checkH1Tag,
    checkH2Count,
    checkFAQSection,
    checkFAQCount,
    checkFAQJsonLdUsage,     // FAQJsonLd actually used in JSX
    checkCTAButtons,
    checkUmamiTracking,
    checkInternalLinks,
    checkValidInternalLinks,  // Verify links point to existing pages
    checkLeadhunterMention,
    checkNoTodoComments,
    checkNoPlaceholders,
    checkValidJSX,
    checkAccessibility,
    checkRelatedArticles,
    checkArticleNavigation,
    checkArticleAuthor
  ];

  const results = checks.map(check => check(content, brief));

  // Add slug-dependent checks if slug provided
  if (slug) {
    results.push(checkUrlsMatchSlug(content, slug));
    results.push(checkUmamiEventsMatchSlug(content, slug));
  }

  return results;
}

/**
 * Check 1: Required imports present
 */
function checkImports(content) {
  const requiredImports = [
    '@/components/ui/badge',
    '@/components/ui/button',
    '@/components/Header',
    '@/components/Footer'
  ];

  const missingImports = requiredImports.filter(imp => !content.includes(imp));

  return {
    name: 'Required Imports',
    passed: missingImports.length === 0,
    message: missingImports.length === 0
      ? 'All required imports present'
      : `Missing imports: ${missingImports.join(', ')}`,
    severity: 'error'
  };
}

/**
 * Check 2: Metadata export exists
 */
function checkMetadata(content) {
  const hasMetadata = content.includes('export const metadata: Metadata');

  return {
    name: 'Metadata Export',
    passed: hasMetadata,
    message: hasMetadata ? 'Metadata export found' : 'Missing metadata export',
    severity: 'error'
  };
}

/**
 * Check 3: Metadata has all required fields
 */
function checkMetadataFields(content) {
  const requiredFields = ['title:', 'description:', 'keywords:', 'openGraph:'];
  const metadataMatch = content.match(/export const metadata: Metadata = \{[\s\S]*?\n\};/);

  if (!metadataMatch) {
    return {
      name: 'Metadata Fields',
      passed: false,
      message: 'Could not parse metadata block',
      severity: 'error'
    };
  }

  const metadataBlock = metadataMatch[0];
  const missingFields = requiredFields.filter(field => !metadataBlock.includes(field));

  return {
    name: 'Metadata Fields',
    passed: missingFields.length === 0,
    message: missingFields.length === 0
      ? 'All metadata fields present'
      : `Missing metadata fields: ${missingFields.join(', ')}`,
    severity: 'error'
  };
}

/**
 * Check 4: SEO Essentials - canonical, keywords count, description length
 */
function checkSEOEssentials(content) {
  const issues = [];

  // Check canonical URL
  if (!content.includes('alternates:') || !content.includes('canonical:')) {
    issues.push('Missing canonical URL (alternates.canonical)');
  }

  // Check keywords count (minimum 5)
  const keywordsMatch = content.match(/keywords:\s*\[([\s\S]*?)\]/);
  if (keywordsMatch) {
    // Count both double-quoted and single-quoted strings
    const doubleQuoted = (keywordsMatch[1].match(/"[^"]+"/g) || []).length;
    const singleQuoted = (keywordsMatch[1].match(/'[^']+'/g) || []).length;
    const keywordsCount = doubleQuoted + singleQuoted;
    if (keywordsCount < 5) {
      issues.push(`Only ${keywordsCount} keywords (need at least 5)`);
    }
  } else {
    issues.push('Keywords array not found');
  }

  // Check description length (120-160 chars optimal for SERP)
  // Match description with proper quote handling (don't stop at apostrophes)
  const descMatch = content.match(/description:\s*"([^"]+)"/) ||
                    content.match(/description:\s*'([^']+)'/) ||
                    content.match(/description:\s*`([^`]+)`/);
  if (descMatch) {
    const descLength = descMatch[1].length;
    if (descLength < 120) {
      issues.push(`Description too short: ${descLength} chars (aim for 120-160)`);
    } else if (descLength > 160) {
      issues.push(`Description too long: ${descLength} chars (may be truncated in SERP)`);
    }
  }

  return {
    name: 'SEO Essentials',
    passed: issues.length === 0,
    message: issues.length === 0
      ? 'Canonical URL, keywords (5+), description length OK'
      : issues.join('; '),
    severity: 'error'
  };
}

/**
 * Check 5: OpenGraph complete with image
 */
function checkOpenGraphComplete(content) {
  const issues = [];

  // Required OG fields
  const ogFields = ['title:', 'description:', 'url:', 'type:'];
  const ogMatch = content.match(/openGraph:\s*\{([\s\S]*?)\},?\s*(?:alternates|twitter|\})/);

  if (!ogMatch) {
    return {
      name: 'OpenGraph Complete',
      passed: false,
      message: 'Could not parse openGraph block',
      severity: 'error'
    };
  }

  const ogBlock = ogMatch[1];

  for (const field of ogFields) {
    if (!ogBlock.includes(field)) {
      issues.push(`Missing og:${field.replace(':', '')}`);
    }
  }

  // OG image is generated as a separate opengraph-image.tsx file (Next.js convention)
  // so we don't check for images:/image: in metadata — that would be a false positive

  return {
    name: 'OpenGraph Complete',
    passed: issues.length === 0,
    message: issues.length === 0
      ? 'OpenGraph has all required fields'
      : issues.join('; '),
    severity: 'error'
  };
}

/**
 * Check: No unsubstantiated statistics in SEO-critical elements
 *
 * Detects specific numbers/percentages in title, description, openGraph title, and H1
 * that are not backed by sources. These claims in SEO elements mislead users
 * clicking from search results.
 *
 * Examples of problematic patterns:
 * - "85% More Replies" in title without source
 * - "3x higher response rates" in description without backing
 */
function checkSEOStatistics(content, brief) {
  const issues = [];

  // Pattern to match statistics: percentages and multipliers only
  // - \d+% matches "85%"
  // - \d+x matches "3x"
  // - \d+\s*times matches "5 times" (equivalent to 5x)
  // Avoids false positives on listicle titles like "5 More LinkedIn Tips" or "10 Better Ways"
  const statsPattern = /(\d+%|\d+x|\d+\s*times)/gi;

  // Extract SEO elements - try each quote type separately to handle apostrophes in text
  // E.g., "What's the Best Approach" should capture the full title, not stop at apostrophe
  const titleMatch = content.match(/title:\s*"([^"]+)"/) ||
                     content.match(/title:\s*'([^']+)'/) ||
                     content.match(/title:\s*`([^`]+)`/);
  const descMatch = content.match(/description:\s*"([^"]+)"/) ||
                    content.match(/description:\s*'([^']+)'/) ||
                    content.match(/description:\s*`([^`]+)`/);
  // Use [\s\S]*? instead of [^}]* to handle nested objects like images: [{...}]
  const ogTitleMatch = content.match(/openGraph:\s*\{[\s\S]*?title:\s*"([^"]+)"/s) ||
                       content.match(/openGraph:\s*\{[\s\S]*?title:\s*'([^']+)'/s) ||
                       content.match(/openGraph:\s*\{[\s\S]*?title:\s*`([^`]+)`/s);
  // Use [\s\S]*? to handle H1 with nested elements like <span>, <br/>, <strong>
  const h1Match = content.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  // Strip HTML tags from H1 content to get plain text
  const h1Text = h1Match?.[1]?.replace(/<[^>]+>/g, '');

  const seoElements = [
    { name: 'metadata title', text: titleMatch?.[1] },
    { name: 'metadata description', text: descMatch?.[1] },
    { name: 'openGraph title', text: ogTitleMatch?.[1] },
    { name: 'H1', text: h1Text }
  ];

  // Check if sources are provided in brief
  const hasSources = brief.sources && brief.sources.length > 0;

  for (const element of seoElements) {
    if (!element.text) continue;

    const stats = element.text.match(statsPattern);
    if (stats && stats.length > 0) {
      if (!hasSources) {
        // No sources at all - any statistic is unsubstantiated
        issues.push(`${element.name} contains statistics (${stats.join(', ')}) but brief has no sources`);
      }
      // Note: If sources exist, we trust Claude used them correctly
      // A more thorough check would verify each stat appears with citation in content
    }
  }

  return {
    name: 'SEO Statistics Substantiated',
    passed: issues.length === 0,
    message: issues.length === 0
      ? 'No unsubstantiated statistics in SEO elements'
      : issues.join('; '),
    severity: 'error'  // Critical - misleads users from search results
  };
}

/**
 * Check 6: Hero section with Badge
 */
function checkHeroSection(content) {
  const hasHero = content.includes('<section') &&
    content.includes('py-20') &&
    content.includes('<Badge');

  return {
    name: 'Hero Section',
    passed: hasHero,
    message: hasHero ? 'Hero section with Badge found' : 'Missing hero section with Badge',
    severity: 'warning'
  };
}

/**
 * Check 5: H1 tag exists
 */
function checkH1Tag(content) {
  const hasH1 = /<h1[\s>]/.test(content);

  return {
    name: 'H1 Tag',
    passed: hasH1,
    message: hasH1 ? 'H1 tag found' : 'Missing H1 tag (required for SEO)',
    severity: 'error'
  };
}

/**
 * Check 6: At least 4 H2 sections
 */
function checkH2Count(content) {
  const h2Matches = content.match(/<h2[\s>]/g) || [];
  const count = h2Matches.length;

  return {
    name: 'H2 Sections',
    passed: count >= 4,
    message: count >= 4
      ? `${count} H2 sections found`
      : `Only ${count} H2 sections (need at least 4)`,
    severity: 'warning'
  };
}

/**
 * Check 7: FAQ section with FAQJsonLd
 */
function checkFAQSection(content) {
  const hasFAQJsonLd = content.includes('FAQJsonLd') && content.includes('faqs={');

  return {
    name: 'FAQ JsonLd',
    passed: hasFAQJsonLd,
    message: hasFAQJsonLd ? 'FAQJsonLd component found' : 'Missing FAQJsonLd for FAQ schema',
    severity: 'warning'
  };
}

/**
 * Check 8: At least 4 FAQ questions
 */
function checkFAQCount(content) {
  // Count objects in faqs array
  const faqsMatch = content.match(/const faqs = \[([\s\S]*?)\];/);
  if (!faqsMatch) {
    return {
      name: 'FAQ Count',
      passed: false,
      message: 'Could not find faqs array',
      severity: 'warning'
    };
  }

  const questionCount = (faqsMatch[1].match(/question:/g) || []).length;

  return {
    name: 'FAQ Count',
    passed: questionCount >= 4,
    message: questionCount >= 4
      ? `${questionCount} FAQ questions found`
      : `Only ${questionCount} FAQ questions (need at least 4)`,
    severity: 'warning'
  };
}

/**
 * Check 9: FAQJsonLd actually used in JSX (not just imported)
 */
function checkFAQJsonLdUsage(content) {
  const hasImport = content.includes('FAQJsonLd');
  const hasUsage = /<FAQJsonLd\s+faqs=/.test(content);

  if (!hasImport) {
    return {
      name: 'FAQJsonLd Usage',
      passed: false,
      message: 'FAQJsonLd not imported - missing structured data for Google',
      severity: 'error'
    };
  }

  if (!hasUsage) {
    return {
      name: 'FAQJsonLd Usage',
      passed: false,
      message: 'FAQJsonLd imported but not used in JSX',
      severity: 'error'
    };
  }

  return {
    name: 'FAQJsonLd Usage',
    passed: true,
    message: 'FAQJsonLd imported and used correctly',
    severity: 'error'
  };
}

/**
 * Check 10: CTA buttons present
 */
function checkCTAButtons(content) {
  const ctaCount = (content.match(/href="https:\/\/app\.lhunter\.cc"/g) || []).length;

  return {
    name: 'CTA Buttons',
    passed: ctaCount >= 2,
    message: ctaCount >= 2
      ? `${ctaCount} CTA buttons found`
      : `Only ${ctaCount} CTA button(s) (need at least 2)`,
    severity: 'warning'
  };
}

/**
 * Check 10: Umami tracking on CTAs
 */
function checkUmamiTracking(content) {
  const umamiCount = (content.match(/data-umami-event=/g) || []).length;

  return {
    name: 'Umami Tracking',
    passed: umamiCount >= 2,
    message: umamiCount >= 2
      ? `${umamiCount} Umami events found`
      : `Only ${umamiCount} Umami event(s) (need tracking on CTAs)`,
    severity: 'warning'
  };
}

/**
 * Check 11: Internal links present
 */
function checkInternalLinks(content) {
  // Match href="/..." but not href="https://..."
  const internalLinks = content.match(/href="\/[^"]+"/g) || [];

  return {
    name: 'Internal Links',
    passed: internalLinks.length >= 3,
    message: internalLinks.length >= 3
      ? `${internalLinks.length} internal links found`
      : `Only ${internalLinks.length} internal link(s) (need at least 3 for SEO)`,
    severity: 'error'
  };
}

/**
 * Check 12: LeadHunter mentioned (brand awareness)
 */
function checkLeadhunterMention(content) {
  const mentions = (content.match(/LeadHunter/g) || []).length;

  return {
    name: 'LeadHunter Mentions',
    passed: mentions >= 2,
    message: mentions >= 2
      ? `${mentions} LeadHunter mentions found`
      : `Only ${mentions} LeadHunter mention(s) (need brand visibility)`,
    severity: 'warning'
  };
}

/**
 * Check 13: No TODO/FIXME comments left
 */
function checkNoTodoComments(content) {
  const hasTodos = /\/\/\s*(TODO|FIXME|XXX)/i.test(content) ||
    /\{\/\*\s*(TODO|FIXME|XXX)/i.test(content);

  return {
    name: 'No TODO Comments',
    passed: !hasTodos,
    message: hasTodos ? 'Found TODO/FIXME comments - remove before publishing' : 'No TODO comments found',
    severity: 'error'
  };
}

/**
 * Check 14: No placeholder text
 */
function checkNoPlaceholders(content) {
  const placeholders = [
    /\[INSERT/i,
    /\[PLACEHOLDER/i,
    /\[TBD/i,
    /lorem ipsum/i,
    /\{\{\s*[A-Z][A-Z0-9_]*\s*\}\}/,  // Template vars like {{VAR}}, not JSX {{ style }}
    /YOUR_.*?_HERE/
  ];

  const hasPlaceholders = placeholders.some(p => p.test(content));

  return {
    name: 'No Placeholders',
    passed: !hasPlaceholders,
    message: hasPlaceholders ? 'Found placeholder text - replace with real content' : 'No placeholders found',
    severity: 'error'
  };
}

/**
 * Check 15: Valid JSX (basic syntax check)
 */
function checkValidJSX(content) {
  // Check for common JSX errors
  const issues = [];

  // Check unmatched tags for the most common structural elements
  // These mismatches cause Turbopack to report cryptic EOF errors
  const tagsToCheck = ['section', 'div', 'main', 'article', 'aside', 'ul', 'ol', 'table'];
  for (const tag of tagsToCheck) {
    // Count opening tags (exclude self-closing like <div/>)
    const openCount = (content.match(new RegExp(`<${tag}[\\s>]`, 'g')) || []).length;
    const closeCount = (content.match(new RegExp(`<\\/${tag}>`, 'g')) || []).length;
    if (openCount !== closeCount) {
      issues.push(`Unmatched <${tag}> tags: ${openCount} open, ${closeCount} close`);
    }
  }

  // Check for class= (should be className= in JSX)
  // Match class= but not className=
  if (/\sclass=["'{]/.test(content)) {
    issues.push('Using "class" instead of "className" (JSX requires className)');
  }

  // Check for proper export default
  if (!content.includes('export default function')) {
    issues.push('Missing export default function');
  }

  return {
    name: 'Valid JSX',
    passed: issues.length === 0,
    message: issues.length === 0
      ? 'JSX syntax appears valid'
      : `JSX issues: ${issues.join('; ')}`,
    severity: 'error'
  };
}

/**
 * Check 16: Accessibility basics
 */
function checkAccessibility(content) {
  const issues = [];

  // Check images have alt text
  const imgsWithoutAlt = content.match(/<img(?![^>]*alt=)[^>]*>/g) || [];
  if (imgsWithoutAlt.length > 0) {
    issues.push(`${imgsWithoutAlt.length} images missing alt text`);
  }

  // Check buttons have accessible text
  const emptyButtons = content.match(/<Button[^>]*>\s*<\/Button>/g) || [];
  if (emptyButtons.length > 0) {
    issues.push(`${emptyButtons.length} empty buttons`);
  }

  return {
    name: 'Accessibility',
    passed: issues.length === 0,
    message: issues.length === 0
      ? 'Basic accessibility checks passed'
      : `Accessibility issues: ${issues.join('; ')}`,
    severity: 'warning'
  };
}

/**
 * Check 20: Validate that internal links point to existing pages
 * @param {string} content
 * @returns {CheckResult}
 */
function checkValidInternalLinks(content) {
  const linkMatches = content.match(/href="(\/[^"]+)"/g) || [];
  const links = linkMatches.map(m => m.match(/href="([^"]+)"/)[1]);

  const invalidLinks = [];

  for (const link of links) {
    // Strip URL fragments (#...) and query strings (?...) before checking
    const cleanLink = link.split(/[#?]/)[0];

    // Skip root path
    if (cleanLink === '/') continue;

    // Convert /blog/slug to file path
    let filePath;
    if (cleanLink.startsWith('/blog/')) {
      const slug = cleanLink.replace('/blog/', '');
      filePath = join(ROOT_DIR, 'src', 'app', 'blog', slug, 'page.tsx');
    } else {
      // Root level pages
      const pageName = cleanLink.replace('/', '');
      filePath = join(ROOT_DIR, 'src', 'app', pageName, 'page.tsx');
    }

    if (!existsSync(filePath)) {
      invalidLinks.push(link);
    }
  }

  return {
    name: 'Valid Internal Links',
    passed: invalidLinks.length === 0,
    message: invalidLinks.length === 0
      ? 'All internal links point to existing pages'
      : `Invalid links: ${invalidLinks.join(', ')}`,
    severity: 'error'  // Broken links are critical - will trigger improvement loop
  };
}

/**
 * Check: RelatedArticles component used in JSX
 */
function checkRelatedArticles(content) {
  const hasImport = content.includes('@/components/RelatedArticles');
  const hasUsage = /<RelatedArticles\s/.test(content);

  if (!hasImport || !hasUsage) {
    return {
      name: 'RelatedArticles Component',
      passed: false,
      message: !hasImport
        ? 'RelatedArticles not imported — add import { RelatedArticles } from "@/components/RelatedArticles"'
        : 'RelatedArticles imported but not used in JSX — add <RelatedArticles articles={relatedArticles} />',
      severity: 'error'
    };
  }

  return {
    name: 'RelatedArticles Component',
    passed: true,
    message: 'RelatedArticles imported and used correctly',
    severity: 'error'
  };
}

/**
 * Check: ArticleNavigation component used in JSX
 */
function checkArticleNavigation(content) {
  const hasImport = content.includes('@/components/ArticleNavigation');
  const hasUsage = /<ArticleNavigation/.test(content);

  if (!hasImport || !hasUsage) {
    return {
      name: 'ArticleNavigation Component',
      passed: false,
      message: !hasImport
        ? 'ArticleNavigation not imported — add import { ArticleNavigation } from "@/components/ArticleNavigation"'
        : 'ArticleNavigation imported but not used in JSX — add <ArticleNavigation /> at the bottom',
      severity: 'warning'
    };
  }

  return {
    name: 'ArticleNavigation Component',
    passed: true,
    message: 'ArticleNavigation imported and used correctly',
    severity: 'warning'
  };
}

/**
 * Check: ArticleAuthor component used in JSX
 */
function checkArticleAuthor(content) {
  const hasImport = content.includes('@/components/ArticleAuthor');
  const hasUsage = /<ArticleAuthor\s/.test(content);

  if (!hasImport || !hasUsage) {
    return {
      name: 'ArticleAuthor Component',
      passed: false,
      message: !hasImport
        ? 'ArticleAuthor not imported — add import { ArticleAuthor } from "@/components/ArticleAuthor"'
        : 'ArticleAuthor imported but not used in JSX — add <ArticleAuthor date="..." /> in hero section',
      severity: 'error'
    };
  }

  return {
    name: 'ArticleAuthor Component',
    passed: true,
    message: 'ArticleAuthor imported and used correctly',
    severity: 'error'
  };
}

/**
 * Get summary of check results
 * @param {CheckResult[]} results
 * @returns {{passed: number, failed: number, errors: number, warnings: number, total: number}}
 */
export function summarizeResults(results) {
  const total = results.length;
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const errors = results.filter(r => !r.passed && r.severity === 'error').length;
  const warnings = results.filter(r => !r.passed && r.severity === 'warning').length;

  return { passed, failed, errors, warnings, total };
}

/**
 * Get list of issues that need fixing
 * @param {CheckResult[]} results
 * @returns {string[]}
 */
export function getIssues(results) {
  return results
    .filter(r => !r.passed)
    .map(r => `[${r.severity.toUpperCase()}] ${r.name}: ${r.message}`);
}

/**
 * Check that Umami event names use the correct slug
 *
 * Problem this solves:
 * When slug is truncated (e.g., "data-driven-marketing" from longer title),
 * Claude might generate events using full title slug instead:
 *   - Expected: cta-blog-data-driven-marketing-hero
 *   - Actual:   cta-blog-data-driven-marketing-strategies-for-growth-hero
 *
 * Simple `includes()` check would pass (substring match), so we need exact match.
 *
 * @param {string} content - Article content
 * @param {string} expectedSlug - The slug that should be used
 * @returns {CheckResult}
 */
function checkUmamiEventsMatchSlug(content, expectedSlug) {
  const issues = [];

  // Valid event patterns - must match EXACTLY
  // Only -hero and -bottom are specified in prompts (generate.md)
  const validEvents = [
    `cta-blog-${expectedSlug}-hero`,
    `cta-blog-${expectedSlug}-bottom`
  ];

  // Find all umami event names
  const eventMatches = content.match(/data-umami-event="([^"]+)"/g) || [];

  for (const match of eventMatches) {
    const eventName = match.match(/data-umami-event="([^"]+)"/)[1];

    // Only check blog CTA events (skip other tracking events)
    if (!eventName.startsWith('cta-blog-')) {
      continue;
    }

    // Exact match required - substring matching would miss truncation issues
    if (!validEvents.includes(eventName)) {
      // Extract the slug that was actually used for clear error message
      const usedSlugMatch = eventName.match(/^cta-blog-(.+)-(hero|bottom)$/);
      if (usedSlugMatch) {
        issues.push(`Event uses slug "${usedSlugMatch[1]}" but expected "${expectedSlug}"`);
      } else {
        issues.push(`Event "${eventName}" doesn't match pattern cta-blog-{slug}-(hero|bottom)`);
      }
    }
  }

  return {
    name: 'Umami Events Match Slug',
    passed: issues.length === 0,
    message: issues.length === 0
      ? `All Umami events use correct slug: ${expectedSlug}`
      : issues.join('; '),
    severity: 'error'  // Must be 'error' to trigger auto-fix in improvement loop
  };
}

/**
 * Check that canonical URL and OpenGraph URL match the expected slug
 * @param {string} content
 * @param {string} expectedSlug
 * @returns {CheckResult}
 */
function checkUrlsMatchSlug(content, expectedSlug) {
  const issues = [];
  const expectedPath = `/blog/${expectedSlug}`;

  // Check canonical URL
  const canonicalMatch = content.match(/canonical:\s*["'`]([^"'`]+)["'`]/);
  if (canonicalMatch) {
    const canonicalUrl = canonicalMatch[1];
    if (!canonicalUrl.endsWith(expectedPath)) {
      issues.push(`Canonical URL "${canonicalUrl}" doesn't match expected slug "${expectedSlug}"`);
    }
  }

  // Check OpenGraph URL
  const ogUrlMatch = content.match(/url:\s*["'`](https:\/\/lhunter\.cc[^"'`]+)["'`]/);
  if (ogUrlMatch) {
    const ogUrl = ogUrlMatch[1];
    if (!ogUrl.endsWith(expectedPath)) {
      issues.push(`OpenGraph URL "${ogUrl}" doesn't match expected slug "${expectedSlug}"`);
    }
  }

  return {
    name: 'URLs Match Slug',
    passed: issues.length === 0,
    message: issues.length === 0
      ? `All URLs correctly use slug: ${expectedSlug}`
      : issues.join('; '),
    severity: 'error'
  };
}
