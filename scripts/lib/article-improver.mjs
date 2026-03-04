/**
 * Article Improver
 *
 * Orchestrates the improvement process combining:
 * - Quality checker results (automated checks)
 * - AI evaluator results (5 extraction questions)
 * - Improvement via Claude API
 */

import { runQualityChecks, getIssues, summarizeResults } from './quality-checker.mjs';
import { runAIEvaluation, generateImprovementSuggestions } from './ai-evaluator.mjs';
import { improveArticle, fixJSXStructure } from './article-generator.mjs';

const MAX_IMPROVEMENT_ITERATIONS = 2;

/**
 * @typedef {Object} ImprovementResult
 * @property {string} content - Final article content
 * @property {number} iterations - Number of improvement iterations
 * @property {boolean} passedAllChecks - Whether all checks passed
 * @property {object} finalResults - Final check results
 */

/**
 * Run the full improvement loop
 *
 * Includes regression protection: if an improvement iteration makes
 * the article worse (more errors), we rollback to the previous version.
 *
 * @param {string} initialContent - Initial generated article
 * @param {object} brief - Original brief
 * @param {string} [slug] - Expected slug for URL validation
 * @param {Array} [existingBlogPages] - List of existing blog pages for link fixing
 * @returns {Promise<ImprovementResult>}
 */
export async function runImprovementLoop(initialContent, brief, slug = null, existingBlogPages = []) {
  let content = initialContent;
  let iterations = 0;
  let allIssues = [];

  // Track best version for regression protection
  let bestContent = content;
  let bestCheckSummary = null;
  let bestAiValidation = null;
  let bestCheckResults = null;

  console.log('\n=== Starting Quality Assessment ===\n');

  // Pre-check: fix JSX structural issues before entering the improvement loop.
  // Unmatched tags (div, section, main, etc.) cause cryptic EOF build errors.
  // Use a focused Sonnet prompt that ONLY closes tags — faster and more reliable
  // than asking the general improver to handle both content and structure.
  const preCheckResults = runQualityChecks(content, brief, slug);
  const jsxCheck = preCheckResults.find(r => r.name === 'Valid JSX' && !r.passed);
  if (jsxCheck) {
    console.log(`\n⚠️  JSX structural issues detected before improvement loop:`);
    console.log(`   ${jsxCheck.message}`);
    console.log('   Running focused JSX fix (Sonnet)...');
    content = await fixJSXStructure(content, [jsxCheck.message]);
    const postJsxCheck = runQualityChecks(content, brief, slug);
    const jsxFixed = postJsxCheck.find(r => r.name === 'Valid JSX');
    if (jsxFixed?.passed) {
      console.log('   ✅ JSX structure fixed.');
    } else {
      console.log(`   ⚠️  JSX issues remain: ${jsxFixed?.message}`);
    }
  }

  while (iterations < MAX_IMPROVEMENT_ITERATIONS) {
    iterations++;
    console.log(`\n--- Iteration ${iterations} ---\n`);

    // Run automated checks
    const checkResults = runQualityChecks(content, brief, slug);
    const checkSummary = summarizeResults(checkResults);
    const checkIssues = getIssues(checkResults);

    console.log(`Running ${checkSummary.total} automated checks...`);
    console.log(`Automated checks: ${checkSummary.passed}/${checkSummary.total} passed`);
    console.log(`  - Errors: ${checkSummary.errors}`);
    console.log(`  - Warnings: ${checkSummary.warnings}`);

    // Run AI evaluation
    console.log('\nRunning AI evaluation (5 extraction questions)...');
    const aiValidation = await runAIEvaluation(content, brief);

    console.log(`AI validation: ${aiValidation.passed ? 'PASSED' : 'ISSUES FOUND'}`);
    console.log(`  - Word count: ${aiValidation.evaluation.wordCount}`);
    console.log(`  - Key points covered: ${aiValidation.evaluation.keyPointsCovered.length}/${brief.keyPoints.length}`);
    console.log(`  - Internal links: ${aiValidation.evaluation.internalLinks.length}`);

    // Regression protection: check if this iteration is worse than previous best
    if (bestCheckSummary !== null) {
      const gotWorse = checkSummary.errors > bestCheckSummary.errors ||
        (checkSummary.errors === bestCheckSummary.errors && checkSummary.passed < bestCheckSummary.passed);

      if (gotWorse) {
        console.log('\n⚠️  REGRESSION DETECTED: Improvement made article worse!');
        console.log(`   Previous: ${bestCheckSummary.passed}/${bestCheckSummary.total} passed, ${bestCheckSummary.errors} errors`);
        console.log(`   Current:  ${checkSummary.passed}/${checkSummary.total} passed, ${checkSummary.errors} errors`);
        console.log('   Rolling back to previous version...');

        // Reconstruct allIssues for best version (same criteria as normal path)
        const bestAllIssues = [
          ...getIssues(bestCheckResults),
          ...bestAiValidation.issues
        ];

        // Return the best version we had
        return {
          content: bestContent,
          iterations,
          passedAllChecks: bestAllIssues.length === 0,
          finalResults: {
            checkResults: bestCheckResults,
            checkSummary: bestCheckSummary,
            aiValidation: bestAiValidation
          }
        };
      }
    }

    // This version is better or same - save as best
    bestContent = content;
    bestCheckSummary = checkSummary;
    bestAiValidation = aiValidation;
    bestCheckResults = checkResults;

    // Combine all issues
    allIssues = [
      ...checkIssues,
      ...aiValidation.issues
    ];

    // Filter to only blocking issues (errors, not warnings)
    const blockingIssues = checkResults
      .filter(r => !r.passed && r.severity === 'error')
      .map(r => `${r.name}: ${r.message}`);

    const criticalAIIssues = aiValidation.issues.filter(i =>
      i.includes('Word count') || i.includes('Key points') || i.includes('internal links')
    );

    const mustFix = [...blockingIssues, ...criticalAIIssues];

    // Check if we can pass
    if (mustFix.length === 0) {
      console.log('\n✅ All critical checks passed!');

      // Log remaining warnings
      if (checkSummary.warnings > 0) {
        console.log(`\nRemaining warnings (non-blocking):`);
        checkResults
          .filter(r => !r.passed && r.severity === 'warning')
          .forEach(r => console.log(`  - ${r.name}: ${r.message}`));
      }

      return {
        content,
        iterations,
        passedAllChecks: allIssues.length === 0,
        finalResults: {
          checkResults,
          checkSummary,
          aiValidation
        }
      };
    }

    // Generate improvement suggestions
    console.log('\nGenerating improvement plan...');
    const suggestions = generateImprovementSuggestions(aiValidation, brief);
    const allSuggestions = [...mustFix, ...suggestions];

    console.log(`Found ${allSuggestions.length} things to improve.`);

    // Check if we've used all improvement attempts
    if (iterations >= MAX_IMPROVEMENT_ITERATIONS) {
      console.log(`\n⏱️  Maximum iterations (${MAX_IMPROVEMENT_ITERATIONS}) reached.`);
      console.log('Remaining issues:');
      mustFix.forEach(issue => console.log(`  - ${issue}`));

      // Return final results without another improvement
      return {
        content,
        iterations,
        passedAllChecks: false,
        finalResults: {
          checkResults,
          checkSummary,
          aiValidation
        }
      };
    }

    // Run improvement
    console.log('\nRunning improvement via Claude API...');
    content = await improveArticle(content, brief, allSuggestions, slug, existingBlogPages);
    console.log('Improvement complete. Re-checking...');
  }

  // This point is only reached if the loop completes without returning
  // (which shouldn't happen with current logic, but kept for safety)
  const finalCheckResults = runQualityChecks(content, brief, slug);
  const finalCheckSummary = summarizeResults(finalCheckResults);

  return {
    content,
    iterations,
    passedAllChecks: finalCheckSummary.errors === 0,
    finalResults: {
      checkResults: finalCheckResults,
      checkSummary: finalCheckSummary,
      aiValidation: {
        passed: false,
        issues: ['Loop completed unexpectedly'],
        evaluation: {
          wordCount: 0,
          keyPointsCovered: [],
          keyPointsMissing: [],
          statistics: [],
          internalLinks: []
        }
      }
    }
  };
}

/**
 * Format results as a report
 * @param {ImprovementResult} result
 * @returns {string}
 */
export function formatReport(result) {
  const { iterations, passedAllChecks, finalResults } = result;
  const { checkSummary, aiValidation } = finalResults;

  let report = `
=== Article Quality Report ===

Iterations: ${iterations}
Status: ${passedAllChecks ? 'PASSED' : 'ISSUES REMAIN'}

Automated Checks (${checkSummary.total}):
  - Passed: ${checkSummary.passed}
  - Errors: ${checkSummary.errors}
  - Warnings: ${checkSummary.warnings}

AI Evaluation:
  - Word Count: ${aiValidation.evaluation.wordCount}
  - Key Points: ${aiValidation.evaluation.keyPointsCovered.length} covered
  - Internal Links: ${aiValidation.evaluation.internalLinks.length}
  - Statistics: ${aiValidation.evaluation.statistics.length} found
`;

  if (aiValidation.evaluation.keyPointsMissing.length > 0) {
    report += `\nMissing Key Points:\n`;
    aiValidation.evaluation.keyPointsMissing.forEach(p => {
      report += `  - ${p}\n`;
    });
  }

  if (!passedAllChecks) {
    report += `\nRemaining Issues:\n`;
    getIssues(finalResults.checkResults).forEach(i => {
      report += `  ${i}\n`;
    });
    aiValidation.issues.forEach(i => {
      report += `  [AI] ${i}\n`;
    });
  }

  return report;
}
