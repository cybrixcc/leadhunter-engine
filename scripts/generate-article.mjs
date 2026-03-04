#!/usr/bin/env node

/**
 * Article Generation Orchestrator
 *
 * Main entry point for automated blog article generation.
 *
 * Usage:
 *   node scripts/generate-article.mjs           # Generate next ready topic
 *   node scripts/generate-article.mjs --dry-run # Run without committing
 *   node scripts/generate-article.mjs --topic=6 # Generate specific topic
 *
 * Environment Variables:
 *   ANTHROPIC_API_KEY - Required for Claude API
 *   GITHUB_TOKEN      - Required for PR creation (optional for dry-run)
 */

import { getNextReadyTopic, parseArticleIndex } from './lib/content-plan-parser.mjs';
import { readBrief, generateSlug } from './lib/brief-reader.mjs';
import { buildContext } from './lib/context-builder.mjs';
import { generateArticle } from './lib/article-generator.mjs';
import { runImprovementLoop, formatReport } from './lib/article-improver.mjs';
import { updateAllFiles } from './lib/file-updater.mjs';
import { verifyBuild } from './lib/build-verifier.mjs';
import { prepareGitBranch, completeGitWorkflow } from './lib/git-operations.mjs';

// Parse CLI arguments
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const topicArg = args.find(a => a.startsWith('--topic='));
const specificTopic = topicArg ? parseInt(topicArg.split('=')[1]) : null;

async function main() {
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║     LeadHunter Article Generator v1.0        ║');
  console.log('╚══════════════════════════════════════════════╝\n');

  // Check for API key
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('Error: ANTHROPIC_API_KEY environment variable is required');
    process.exit(1);
  }

  // Step 1: Find topic to generate
  console.log('Step 1: Finding topic to generate...\n');

  let topic;
  if (specificTopic) {
    const allTopics = await parseArticleIndex();
    topic = allTopics.find(t => t.number === specificTopic);
    if (!topic) {
      console.error(`Topic #${specificTopic} not found in CONTENT_PLAN.md`);
      process.exit(1);
    }
    if (topic.status !== 'ready') {
      console.warn(`Warning: Topic #${specificTopic} has status '${topic.status}' (not 'ready')`);
    }
  } else {
    topic = await getNextReadyTopic();
  }

  if (!topic) {
    console.log('No topics ready for generation.');
    console.log('Topics need status "ready" in CONTENT_PLAN.md.');
    console.log('\nExiting with success (nothing to do).');
    process.exit(0);
  }

  console.log(`Found topic: #${topic.number} - ${topic.title}`);
  console.log(`Status: ${topic.status}\n`);

  // Step 2: Read brief
  console.log('Step 2: Reading brief...\n');

  const brief = await readBrief(topic.number);
  console.log(`Title: ${brief.title}`);
  console.log(`Keywords: ${brief.targetKeywords.join(', ')}`);
  console.log(`Key Points: ${brief.keyPoints.length}`);
  console.log(`Sources: ${brief.sources.length}`);

  const slug = generateSlug(brief.title);
  console.log(`Generated slug: ${slug}\n`);

  // Step 3: Build context
  console.log('Step 3: Building context...\n');

  const context = await buildContext(brief);
  console.log(`Article Type: ${context.articleType}`);
  console.log(`Reference Article: ${context.referenceArticle?.slug || 'None'}\n`);

  // Step 4: Generate article
  console.log('Step 4: Generating article with Claude API...\n');

  const initialArticle = await generateArticle(context);
  console.log(`Generated ${initialArticle.length} characters of content\n`);

  // Step 5: Quality assessment and improvement
  console.log('Step 5: Running quality assessment...\n');

  const improvementResult = await runImprovementLoop(initialArticle, brief, slug, context.existingBlogPages);

  // Print quality report
  console.log(formatReport(improvementResult));

  if (!improvementResult.passedAllChecks) {
    console.log('\n⚠️  Warning: Some quality checks did not pass.');
    console.log('The article will still be created for manual review.\n');
  }

  const finalArticle = improvementResult.content;

  // Dry run: stop here
  if (dryRun) {
    console.log('\n=== DRY RUN MODE ===');
    console.log('Skipping file updates and git operations.\n');

    // Save to temp file for inspection
    const { writeFile } = await import('fs/promises');
    const tempPath = `/tmp/generated-article-${slug}.tsx`;
    await writeFile(tempPath, finalArticle);
    console.log(`Article saved to: ${tempPath}`);
    console.log('\nRun without --dry-run to commit and create PR.');
    process.exit(0);
  }

  // Step 6: Prepare git branch (before file modifications)
  console.log('Step 6: Preparing git branch...\n');

  const branchName = await prepareGitBranch(slug);

  // Step 7: Update files
  console.log('\nStep 7: Updating files...\n');

  await updateAllFiles(brief, slug, finalArticle, context.articleType);

  // Step 8: Build verification (auto-fix if fails)
  console.log('\nStep 8: Verifying build...\n');

  const buildResult = await verifyBuild(slug, brief, context.existingBlogPages);

  if (!buildResult.success) {
    console.error(`\n⛔ Build failed after ${buildResult.attempts} fix attempts.`);
    console.error('Cannot commit broken code. Stopping here.');
    console.error('\nLast build error:');
    console.error(buildResult.errors[buildResult.errors.length - 1]);

    // Write result for CI notification (failed state)
    const { writeFile } = await import('fs/promises');
    await writeFile('/tmp/article-result.json', JSON.stringify({
      success: false,
      topicNumber: brief.number,
      title: brief.title,
      slug,
      branch: branchName,
      error: 'Build failed after auto-fix attempts',
      buildAttempts: buildResult.attempts,
    }, null, 2));

    process.exit(1);
  }

  if (buildResult.attempts > 1) {
    console.log(`\n✅ Build passed after ${buildResult.attempts} attempt(s) (auto-fixed ${buildResult.attempts - 1} build error(s))`);
  }

  // Step 9: Complete git workflow (commit, push, PR)
  console.log('\nStep 9: Completing git workflow...\n');

  const { prUrl } = await completeGitWorkflow(slug, branchName, brief, improvementResult);

  // Summary
  console.log('\n╔══════════════════════════════════════════════╗');
  console.log('║              Generation Complete!            ║');
  console.log('╚══════════════════════════════════════════════╝\n');

  console.log(`Article: ${brief.title}`);
  console.log(`Slug: /blog/${slug}`);
  console.log(`Branch: ${branchName}`);
  if (prUrl) {
    console.log(`Pull Request: ${prUrl}`);
  }
  console.log(`\nQuality: ${improvementResult.finalResults.checkSummary.passed}/${improvementResult.finalResults.checkSummary.total} checks passed`);
  console.log(`Word Count: ${improvementResult.finalResults.aiValidation.evaluation.wordCount}`);
  console.log(`Build: passed${buildResult.attempts > 1 ? ` (${buildResult.attempts - 1} auto-fix)` : ''}`);

  console.log('\nNext steps:');
  console.log('1. Review the PR');
  console.log('2. Check article content for accuracy');
  console.log('3. Approve and merge when ready');

  // Write result for CI/CD integration
  const { writeFile } = await import('fs/promises');
  const result = {
    success: true,
    topicNumber: brief.number,
    title: brief.title,
    slug,
    prUrl,
    branch: branchName,
    quality: {
      passed: improvementResult.finalResults.checkSummary.passed,
      total: improvementResult.finalResults.checkSummary.total,
      wordCount: improvementResult.finalResults.aiValidation.evaluation.wordCount
    },
    build: {
      passed: true,
      attempts: buildResult.attempts,
      autoFixed: buildResult.attempts > 1
    }
  };
  await writeFile('/tmp/article-result.json', JSON.stringify(result, null, 2));
}

// Run
main().catch(error => {
  console.error('\n\n❌ Error:', error.message);
  console.error(error.stack);
  process.exit(1);
});
