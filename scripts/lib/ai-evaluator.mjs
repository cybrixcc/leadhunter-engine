/**
 * AI Evaluator
 *
 * Uses Claude to extract facts from the article (not ratings).
 * Then compares extracted facts with brief requirements.
 */

import { evaluateArticle } from './article-generator.mjs';

/**
 * @typedef {Object} EvaluationResult
 * @property {number} wordCount
 * @property {string[]} keyPointsCovered
 * @property {string[]} keyPointsMissing
 * @property {Array<{stat: string, context: string, source: string|null, cited: boolean}>} statistics
 * @property {string[]} internalLinks
 */

/**
 * @typedef {Object} ValidationResult
 * @property {boolean} passed
 * @property {string[]} issues
 * @property {EvaluationResult} evaluation
 */

const MIN_WORD_COUNT = 1500;
const MIN_KEY_POINTS_COVERED = 0.75; // 75% of key points must be covered
const MIN_INTERNAL_LINKS = 3;

/**
 * Run AI evaluation and validate results
 * @param {string} articleContent
 * @param {object} brief
 * @returns {Promise<ValidationResult>}
 */
export async function runAIEvaluation(articleContent, brief) {
  // Get AI extraction
  const evaluation = await evaluateArticle(articleContent, brief);

  // Validate extracted facts against requirements
  const issues = [];

  // Check 1: Word count
  if (evaluation.wordCount < MIN_WORD_COUNT) {
    issues.push(`Word count too low: ${evaluation.wordCount} (minimum ${MIN_WORD_COUNT})`);
  }

  // Check 2: Key points coverage
  const totalKeyPoints = brief.keyPoints?.length || 0;
  const coveredCount = evaluation.keyPointsCovered?.length || 0;
  const coverageRatio = totalKeyPoints > 0 ? coveredCount / totalKeyPoints : 1;

  if (totalKeyPoints > 0 && coverageRatio < MIN_KEY_POINTS_COVERED) {
    const percentage = Math.round(coverageRatio * 100);
    issues.push(`Key points coverage too low: ${percentage}% (${coveredCount}/${totalKeyPoints})`);
    if (evaluation.keyPointsMissing.length > 0) {
      issues.push(`Missing key points:\n${evaluation.keyPointsMissing.map(p => `  - ${p}`).join('\n')}`);
    }
  }

  // Check 3: Uncited statistics
  const uncitedStats = evaluation.statistics.filter(s => !s.cited);
  if (uncitedStats.length > 0) {
    issues.push(`Uncited statistics found:\n${uncitedStats.map(s => `  - "${s.stat}" (${s.context})`).join('\n')}`);
  }

  // Check 4: Statistics not from brief sources
  const briefSourceUrls = brief.sources.map(s => s.url.toLowerCase());
  const unknownSourceStats = evaluation.statistics.filter(s =>
    s.source && !briefSourceUrls.some(url => url.includes(s.source.toLowerCase()))
  );
  if (unknownSourceStats.length > 0) {
    // This is a warning, not blocking
    console.warn('Statistics from sources not in brief:', unknownSourceStats);
  }

  // Check 5: Internal links
  if (evaluation.internalLinks.length < MIN_INTERNAL_LINKS) {
    issues.push(`Not enough internal links: ${evaluation.internalLinks.length} (minimum ${MIN_INTERNAL_LINKS})`);
  }

  // Check 6: Suspicious/hallucinated statistics
  const suspicious = detectSuspiciousStatistics(evaluation, brief);
  if (suspicious.length > 0) {
    issues.push(`Suspicious statistics detected:\n${suspicious.map(s => `  - ${s}`).join('\n')}`);
  }

  return {
    passed: issues.length === 0,
    issues,
    evaluation
  };
}

/**
 * Compare statistics in article with those in brief sources
 * This helps detect hallucinated statistics
 * @param {EvaluationResult} evaluation
 * @param {object} brief
 * @returns {string[]} - List of suspicious statistics
 */
export function detectSuspiciousStatistics(evaluation, brief) {
  const suspicious = [];

  // Get known source names from brief
  const knownSources = brief.sources.map(s => s.name.toLowerCase());

  for (const stat of evaluation.statistics) {
    // If the stat claims a source but we don't have that source in brief
    if (stat.source) {
      const sourceMatch = knownSources.some(s =>
        stat.source.toLowerCase().includes(s) ||
        s.includes(stat.source.toLowerCase())
      );

      if (!sourceMatch) {
        suspicious.push(`"${stat.stat}" claims source "${stat.source}" but this source is not in the brief`);
      }
    }

    // Flag very specific percentages that might be made up
    const percentMatch = stat.stat.match(/(\d+\.?\d*)\s*%/);
    if (percentMatch) {
      const percent = parseFloat(percentMatch[1]);
      // Very precise decimals are suspicious
      if (percent !== Math.round(percent) && !stat.cited) {
        suspicious.push(`"${stat.stat}" - precise decimal percentage without citation`);
      }
    }
  }

  return suspicious;
}

/**
 * Generate improvement suggestions based on evaluation
 * @param {ValidationResult} validation
 * @param {object} brief
 * @returns {string[]}
 */
export function generateImprovementSuggestions(validation, brief) {
  const suggestions = [];

  // Word count suggestions
  if (validation.evaluation.wordCount < MIN_WORD_COUNT) {
    const deficit = MIN_WORD_COUNT - validation.evaluation.wordCount;
    suggestions.push(`Add approximately ${deficit} more words. Expand existing sections with more detail, examples, or add a new section.`);
  }

  // Key points suggestions
  if (validation.evaluation.keyPointsMissing.length > 0) {
    for (const point of validation.evaluation.keyPointsMissing) {
      suggestions.push(`Add coverage of: "${point}"`);
    }
  }

  // Citation suggestions
  const uncitedStats = validation.evaluation.statistics.filter(s => !s.cited);
  for (const stat of uncitedStats) {
    const matchingSource = brief.sources.find(s =>
      stat.context.toLowerCase().includes(s.name.toLowerCase()) ||
      s.name.toLowerCase().includes(stat.context.toLowerCase().split(' ')[0])
    );

    if (matchingSource) {
      suggestions.push(`Cite "${stat.stat}" with source: ${matchingSource.name} (${matchingSource.url})`);
    } else {
      suggestions.push(`Either cite "${stat.stat}" or remove it - no clear source found`);
    }
  }

  // Internal links suggestions
  if (validation.evaluation.internalLinks.length < MIN_INTERNAL_LINKS) {
    const briefLinks = brief.internalLinks.filter(link =>
      !validation.evaluation.internalLinks.includes(link)
    );
    if (briefLinks.length > 0) {
      suggestions.push(`Add these internal links from brief: ${briefLinks.join(', ')}`);
    }
  }

  return suggestions;
}
