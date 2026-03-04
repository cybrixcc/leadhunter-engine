#!/usr/bin/env node

/**
 * AI Citation Research — Orchestrator
 *
 * Queries ChatGPT, Claude, and Gemini with 25 customer-like questions,
 * checks if LeadHunter is cited, and generates a gap report.
 *
 * Usage:
 *   OPENAI_API_KEY=x ANTHROPIC_API_KEY_RESEARCH=x GOOGLE_AI_API_KEY=x \
 *     node scripts/ai-citation-research.mjs
 *
 * Output: /tmp/citation-research-results.json
 */

import { writeFileSync } from "fs";
import {
  runAllQueries,
  runGapAnalysis,
  analyzeResults,
  buildReport,
  generateMarkdownReport,
  getAvailableProviders,
  getQueryCategories,
} from "./lib/citation-research.mjs";
import { loadConfig } from "./lib/config-loader.mjs";

const OUTPUT_PATH = "/tmp/citation-research-results.json";
const REPORT_PATH = "/tmp/citation-research-report.md";

async function main() {
  const config = await loadConfig();
  const queryCategories = await getQueryCategories();

  console.log("=".repeat(60));
  console.log(`  AI Citation Research — ${config.site_name}`);
  console.log("=".repeat(60));

  const providers = getAvailableProviders();
  if (providers.length === 0) {
    console.error(
      "\n❌ No AI API keys found. Set at least one of:\n" +
        "   OPENAI_API_KEY, ANTHROPIC_API_KEY_RESEARCH, GOOGLE_AI_API_KEY\n"
    );
    process.exit(1);
  }

  const totalQueries = Object.values(queryCategories).reduce(
    (sum, cat) => sum + cat.queries.length,
    0
  );
  console.log(`\n📋 ${totalQueries} queries × ${providers.length} AI(s) = ${totalQueries * providers.length} API calls`);
  console.log(`   Estimated time: ~${Math.ceil((totalQueries * providers.length * 4) / 60)} minutes\n`);

  const startTime = Date.now();

  // Run all queries
  const results = await runAllQueries({
    delayMs: 2000,
    onProgress: (completed, total, providerName, query) => {
      const pct = Math.round((completed / total) * 100);
      const shortQuery = query.length > 50 ? query.slice(0, 47) + "..." : query;
      console.log(
        `  [${completed}/${total}] ${pct}% — ${providerName}: "${shortQuery}"`
      );
    },
  });

  // Analyze
  const analysis = analyzeResults(results);

  // Run deep gap analysis on uncited queries (skip with SKIP_GAP_ANALYSIS=1)
  let deepGapAnalysis = null;
  if (process.env.SKIP_GAP_ANALYSIS === "1") {
    console.log("\n⏭  Skipping gap analysis (SKIP_GAP_ANALYSIS=1)");
  } else {
    deepGapAnalysis = await runGapAnalysis(results, {
      delayMs: 2000,
      onProgress: (completed, total) => {
        console.log(`  [${completed}/${total}] Gap analysis...`);
      },
    });
  }

  const durationMs = Date.now() - startTime;

  const report = buildReport(results, analysis, durationMs, deepGapAnalysis);

  // Write JSON output
  writeFileSync(OUTPUT_PATH, JSON.stringify(report, null, 2));
  console.log(`\n📄 Results written to ${OUTPUT_PATH}`);

  // Write Markdown report
  const markdownReport = generateMarkdownReport(report);
  writeFileSync(REPORT_PATH, markdownReport);
  console.log(`📝 Markdown report written to ${REPORT_PATH}`);

  // Print summary
  console.log("\n" + "=".repeat(60));
  console.log("  RESULTS SUMMARY");
  console.log("=".repeat(60));

  const rate = analysis.summary.overallCitationRate;
  const rateStr = `${(rate * 100).toFixed(1)}%`;
  const emoji = rate > 0.3 ? "🟢" : rate > 0.1 ? "🟡" : "🔴";

  console.log(`\n${emoji} Overall Citation Rate: ${rateStr}`);
  console.log(
    `   (${analysis.summary.totalCitations} citations out of ${analysis.summary.totalQueryProviderPairs} query-provider pairs)`
  );

  console.log("\n📊 Per AI:");
  for (const [, ai] of Object.entries(analysis.summary.perAI)) {
    const aiRate = (ai.citationRate * 100).toFixed(1);
    console.log(
      `   ${ai.name} (${ai.model}): ${aiRate}% (${ai.citationCount}/${ai.queriesAnswered})`
    );
  }

  console.log("\n📂 Per Category:");
  for (const [, cat] of Object.entries(analysis.summary.perCategory)) {
    const catRate = (cat.citationRate * 100).toFixed(1);
    console.log(
      `   ${cat.label}: ${catRate}% (${cat.citationCount}/${cat.queryCount} queries)`
    );
  }

  if (analysis.summary.competitorRanking.length > 0) {
    console.log("\n🏆 Top Competitors (by mentions):");
    const top5 = analysis.summary.competitorRanking.slice(0, 5);
    for (const { name, mentions } of top5) {
      console.log(`   ${name}: ${mentions}`);
    }
  }

  if (analysis.gapAnalysis.recommendations.length > 0) {
    console.log("\n💡 Recommendations:");
    for (const rec of analysis.gapAnalysis.recommendations) {
      const icon = rec.priority === "high" ? "🔴" : "🟡";
      console.log(`   ${icon} [${rec.area}] ${rec.detail}`);
    }
  }

  if (deepGapAnalysis && deepGapAnalysis.actionPlan && deepGapAnalysis.actionPlan.length > 0) {
    console.log("\n📋 Gap Analysis Action Items:");
    for (const item of deepGapAnalysis.actionPlan.slice(0, 5)) {
      const icon = item.priority === "high" ? "🔴" : item.priority === "medium" ? "🟡" : "🟢";
      console.log(
        `   ${icon} ${item.action} ${item.target} — "${item.title}" (${item.queryCount} ${item.queryCount === 1 ? "query" : "queries"})`
      );
    }
    if (deepGapAnalysis.actionPlan.length > 5) {
      console.log(`   ... and ${deepGapAnalysis.actionPlan.length - 5} more`);
    }
  }

  console.log(`\n⏱  Duration: ${Math.round(durationMs / 1000)}s`);
  console.log("=".repeat(60));

  // Output GitHub Actions-friendly values
  const topCompetitor =
    analysis.summary.competitorRanking[0]?.name || "none";
  const gapsCount = analysis.gapAnalysis.recommendations.length;

  const actionItemsCount = deepGapAnalysis?.actionPlan?.length || 0;

  console.log(`\n::set-output name=citation_rate::${rateStr}`);
  console.log(`::set-output name=citation_rate_raw::${rate}`);
  console.log(`::set-output name=top_competitor::${topCompetitor}`);
  console.log(`::set-output name=gaps_count::${gapsCount}`);
  console.log(`::set-output name=total_citations::${analysis.summary.totalCitations}`);
  console.log(`::set-output name=action_items_count::${actionItemsCount}`);
  console.log(`::set-output name=report_path::${REPORT_PATH}`);
}

main().catch((err) => {
  console.error("\n❌ Fatal error:", err.message);
  console.error(err.stack);
  process.exit(1);
});
