/**
 * AI Citation Research — Core Library
 *
 * Queries ChatGPT, Claude, and Gemini with customer-like questions,
 * detects brand citations, tracks competitor mentions,
 * and generates gap analysis reports.
 *
 * Brand-specific data (queries, competitors, detection patterns, product description)
 * is loaded from config.yml via loadCitationConfig().
 *
 * ## Current AI Providers (3)
 *
 * | Provider  | Model                  | Secret                       |
 * |-----------|------------------------|------------------------------|
 * | ChatGPT   | gpt-4o                 | OPENAI_API_KEY               |
 * | Claude    | claude-sonnet-4-6      | ANTHROPIC_API_KEY_RESEARCH   |
 * | Gemini    | gemini-2.0-flash       | GOOGLE_AI_API_KEY            |
 *
 * ## Recommended Future Additions
 *
 * | Provider   | Model                | Why                                               |
 * |------------|----------------------|---------------------------------------------------|
 * | Perplexity | sonar-pro            | AI search engine — real web results with sources. |
 * | Grok (xAI) | grok-3               | Growing user base via X/Twitter.                  |
 * | Mistral    | mistral-large-latest | Popular in Europe, Le Chat growing.               |
 */

import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { loadConfig } from "./config-loader.mjs";

// ============================================================================
// Config loader — reads citation_research section from config.yml
// ============================================================================

let _citationConfig = null;

/**
 * Load and return citation research config from config.yml.
 * Falls back to LeadHunter defaults if not set (for backwards compatibility).
 */
export async function loadCitationConfig() {
  if (_citationConfig) return _citationConfig;

  const config = await loadConfig();
  const cr = config.citation_research || {};

  _citationConfig = {
    // Brand detection patterns (regex strings, case-insensitive)
    brandPatterns: cr.brand_patterns || ["leadhunter", "lead\\s*hunter", "lhunter\\.cc"],

    // One-line product description injected into gap analysis prompt
    productDescription: cr.product_description ||
      "LeadHunter (lhunter.cc) is a LinkedIn automation tool: AI lead scoring (0-100), buying intent detection, AI-written personalized messages, AI reply handling, $49/month, 14-day free trial.",

    // Competitor list: [{name, pattern, requiresContext?}]
    competitors: cr.competitors || LEADHUNTER_DEFAULT_COMPETITORS,

    // Query categories: {id: {label, queries: []}}
    queryCategories: cr.query_categories || LEADHUNTER_DEFAULT_QUERIES,
  };

  return _citationConfig;
}

// ============================================================================
// LeadHunter defaults (used when config.yml has no citation_research section)
// ============================================================================

const LEADHUNTER_DEFAULT_COMPETITORS = [
  { name: "Expandi", pattern: "expandi" },
  { name: "Dripify", pattern: "dripify" },
  { name: "Dux-Soup", pattern: "dux[- ]?soup" },
  { name: "Octopus CRM", pattern: "octopus\\s*crm" },
  { name: "PhantomBuster", pattern: "phantom\\s*buster" },
  { name: "Waalaxy", pattern: "waalaxy" },
  { name: "Zopto", pattern: "zopto" },
  { name: "LinkedHelper", pattern: "linked\\s*helper" },
  { name: "Salesflow", pattern: "salesflow" },
  { name: "Skylead", pattern: "skylead" },
  { name: "Closely", pattern: "closely", requiresContext: true },
  { name: "Meet Alfred", pattern: "meet\\s*alfred" },
  { name: "We-Connect", pattern: "we[- ]?connect" },
  { name: "Lemlist", pattern: "lemlist" },
  { name: "Reply.io", pattern: "reply\\.io" },
  { name: "Snov.io", pattern: "snov\\.io" },
  { name: "Apollo.io", pattern: "apollo\\.io" },
  { name: "Apollo", pattern: "apollo", requiresContext: true },
  { name: "11x.ai", pattern: "11x(?:\\.ai)?" },
  { name: "AiSDR", pattern: "aisdr" },
  { name: "SalesRobot", pattern: "sales\\s*robot" },
  { name: "Amplemarket", pattern: "amplemarket" },
  { name: "HeyReach", pattern: "hey\\s*reach" },
];

const LEADHUNTER_DEFAULT_QUERIES = {
  "tool-comparison": {
    label: "Tool Comparison",
    queries: [
      "What are the best LinkedIn automation tools in 2026?",
      "What is the best LinkedIn outreach tool for B2B sales?",
      "Top LinkedIn lead generation tools for small businesses",
      "Best alternatives to LinkedIn Sales Navigator for prospecting",
      "What tools do sales teams use for LinkedIn outreach?",
      "Best AI-powered LinkedIn automation platforms",
      "What are the safest LinkedIn automation tools that won't get my account banned?",
      "Best LinkedIn automation tools under $100 per month",
    ],
  },
  "head-to-head": {
    label: "Head-to-Head",
    queries: [
      "Expandi vs Dripify — which LinkedIn automation tool is better?",
      "Compare Waalaxy, Dux-Soup, and other LinkedIn automation tools",
      "Is Octopus CRM or PhantomBuster better for LinkedIn outreach?",
      "What are the best alternatives to Expandi for LinkedIn automation?",
      "Skylead vs Lemlist for LinkedIn outreach campaigns",
    ],
  },
  "how-to": {
    label: "How-To / Use Case",
    queries: [
      "How to automate LinkedIn outreach without getting banned",
      "How to set up automated LinkedIn connection requests and follow-ups",
      "How to use AI to personalize LinkedIn messages at scale",
      "How to generate B2B leads on LinkedIn automatically",
      "How do I automate LinkedIn prospecting for my SaaS company?",
    ],
  },
  "feature-capability": {
    label: "Feature / Capability",
    queries: [
      "Which LinkedIn tools have AI lead scoring features?",
      "LinkedIn automation tools with buying intent detection",
      "Tools that use AI to write personalized LinkedIn connection messages",
      "LinkedIn automation with AI reply handling and conversation management",
    ],
  },
  "pricing-decision": {
    label: "Pricing / Decision",
    queries: [
      "How much do LinkedIn automation tools cost in 2026?",
      "Cheapest LinkedIn automation tool with AI features",
      "Is it worth paying for LinkedIn automation software?",
    ],
  },
};

// Words that must appear near a context-sensitive competitor name to count as a match
const CONTEXT_WORDS =
  /\b(linkedin|automation|outreach|prospecting|lead\s*gen|sales\s*tool|crm|platform|software|recruitment|hiring|staffing|talent|agency)\b/i;

// ============================================================================
// Brand & competitor detection
// ============================================================================

/**
 * Check if the brand is mentioned in text.
 * Uses patterns from config.yml citation_research.brand_patterns.
 */
export async function detectBrand(text) {
  const { brandPatterns } = await loadCitationConfig();
  return brandPatterns.some((p) => new RegExp(`\\b${p}\\b`, "i").test(text));
}

/**
 * Find all competitor mentions in text.
 * For context-sensitive names, require a nearby context word.
 */
export async function detectCompetitors(text) {
  const { competitors } = await loadCitationConfig();
  const found = new Set();

  for (const comp of competitors) {
    const regex = new RegExp(`\\b${comp.pattern}\\b`, "i");
    if (!regex.test(text)) continue;

    if (comp.requiresContext) {
      const match = text.match(regex);
      if (match) {
        const idx = match.index;
        const window = text.slice(Math.max(0, idx - 200), Math.min(text.length, idx + 200));
        if (CONTEXT_WORDS.test(window)) found.add(comp.name);
      }
    } else {
      found.add(comp.name);
    }
  }

  // Deduplicate: if both "Apollo.io" and "Apollo" matched, keep only "Apollo.io"
  if (found.has("Apollo.io") && found.has("Apollo")) found.delete("Apollo");

  return [...found];
}

// ============================================================================
// Query categories export (for orchestrator)
// ============================================================================

/**
 * Get query categories from config (async — reads config.yml).
 */
export async function getQueryCategories() {
  const { queryCategories } = await loadCitationConfig();
  return queryCategories;
}

/**
 * Legacy sync export for backwards compatibility — returns default queries.
 * Prefer getQueryCategories() in new code.
 */
export const QUERY_CATEGORIES = LEADHUNTER_DEFAULT_QUERIES;

// ============================================================================
// AI Clients
// ============================================================================

const SYSTEM_PROMPT =
  "You are a helpful assistant. Answer the user's question thoroughly and factually. When recommending tools, services, or agencies, include specific names, pricing if known, and key differentiators.";

async function queryOpenAI(query, apiKey) {
  const client = new OpenAI({ apiKey });
  const response = await client.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: query },
    ],
    temperature: 0.3,
    max_tokens: 1500,
  });
  return response.choices[0]?.message?.content || "";
}

async function queryAnthropic(query, apiKey) {
  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1500,
    temperature: 0.3,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: query }],
  });
  return response.content[0]?.text || "";
}

async function queryGemini(query, apiKey) {
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: "gemini-2.0-flash",
    generationConfig: { temperature: 0.3, maxOutputTokens: 1500 },
  });
  const result = await model.generateContent(
    `${SYSTEM_PROMPT}\n\nUser question: ${query}`
  );
  return result.response.text();
}

// ============================================================================
// AI Provider Registry
// ============================================================================

const AI_PROVIDERS = [
  {
    id: "openai",
    name: "ChatGPT",
    model: "gpt-4o",
    envKey: "OPENAI_API_KEY",
    queryFn: queryOpenAI,
  },
  {
    id: "anthropic",
    name: "Claude",
    model: "claude-sonnet-4-6",
    envKey: "ANTHROPIC_API_KEY_RESEARCH",
    queryFn: queryAnthropic,
  },
  {
    id: "google",
    name: "Gemini",
    model: "gemini-2.0-flash",
    envKey: "GOOGLE_AI_API_KEY",
    queryFn: queryGemini,
  },
];

export function getAvailableProviders() {
  return AI_PROVIDERS.filter((p) => !!process.env[p.envKey]);
}

// ============================================================================
// Rate Limiting & Retry
// ============================================================================

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry(fn, { maxRetries = 3, baseDelay = 5000 } = {}) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const status = err?.status || err?.statusCode || err?.code;
      const isRetryable =
        status === 429 || (status >= 500 && status < 600) || status === "ECONNRESET";

      if (!isRetryable || attempt === maxRetries) throw err;

      const delay = baseDelay * Math.pow(2, attempt);
      console.warn(`  ⚠ ${status} error, retrying in ${delay / 1000}s (attempt ${attempt + 1}/${maxRetries})...`);
      await sleep(delay);
    }
  }
}

// ============================================================================
// Query Execution
// ============================================================================

export async function runAllQueries({ delayMs = 2000, onProgress } = {}) {
  const providers = getAvailableProviders();
  if (providers.length === 0) {
    throw new Error(
      "No AI API keys found. Set OPENAI_API_KEY, ANTHROPIC_API_KEY_RESEARCH, or GOOGLE_AI_API_KEY."
    );
  }

  const queryCategories = await getQueryCategories();

  console.log(`\n🤖 Using ${providers.length} AI provider(s): ${providers.map((p) => p.name).join(", ")}`);

  const allQueries = [];
  for (const [categoryId, category] of Object.entries(queryCategories)) {
    for (const query of category.queries) {
      allQueries.push({ categoryId, categoryLabel: category.label, query });
    }
  }

  const totalOps = allQueries.length * providers.length;
  let completed = 0;
  const results = [];

  for (const { categoryId, categoryLabel, query } of allQueries) {
    const queryResult = {
      query,
      category: categoryId,
      categoryLabel,
      responses: {},
      brandCited: false,
      competitorsMentioned: [],
    };

    for (const provider of providers) {
      const apiKey = process.env[provider.envKey];

      try {
        const text = await withRetry(() => provider.queryFn(query, apiKey));

        const cited = await detectBrand(text);
        const competitors = await detectCompetitors(text);

        queryResult.responses[provider.id] = {
          model: provider.model,
          text,
          brandCited: cited,
          competitorsFound: competitors,
        };

        if (cited) queryResult.brandCited = true;

        for (const c of competitors) {
          if (!queryResult.competitorsMentioned.includes(c)) {
            queryResult.competitorsMentioned.push(c);
          }
        }
      } catch (err) {
        console.error(`  ✗ ${provider.name} failed for query: "${query.slice(0, 50)}..." — ${err.message}`);
        queryResult.responses[provider.id] = {
          model: provider.model,
          text: null,
          error: err.message,
          brandCited: false,
          competitorsFound: [],
        };
      }

      completed++;
      if (onProgress) onProgress(completed, totalOps, provider.name, query);
      if (completed < totalOps) await sleep(delayMs);
    }

    results.push(queryResult);
  }

  return results;
}

// ============================================================================
// Gap Analysis
// ============================================================================

/**
 * Build the gap analysis prompt using product description from config.
 */
async function buildGapPrompt(query, response) {
  const { productDescription } = await loadCitationConfig();
  return `You are an AI marketing analyst. I asked an AI this question:

"${query}"

The AI responded:
---
${response}
---

${productDescription} It was NOT mentioned in this response.

Analyze:
1. WHY was this brand not cited? (brand awareness, content gaps, positioning?)
2. What COMPETITORS were mentioned and what qualities made AI recommend them?
3. What SPECIFIC content should be created to get cited for this query?
   Be specific: page title, key points to cover, data to include.

Respond with ONLY a JSON object (no markdown, no explanation, no code fences):
{
  "why_not_cited": "string — 1-2 sentence explanation",
  "competitor_advantages": [
    {"name": "CompetitorName", "reason": "Why AI recommended them"}
  ],
  "content_recommendation": {
    "action": "create|improve|add-section",
    "target": "blog/slug or vs-competitor or /page-path",
    "title": "Suggested page/section title",
    "key_points": ["Point 1", "Point 2", "Point 3"],
    "priority": "high|medium|low"
  }
}`;
}

function extractJsonObject(text) {
  const stripped = text.replace(/```(?:json)?\s*/g, "").replace(/```/g, "");
  const start = stripped.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < stripped.length; i++) {
    const ch = stripped[i];
    if (escape) { escape = false; continue; }
    if (ch === "\\") { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return stripped.slice(start, i + 1);
    }
  }
  return null;
}

function pickBestResponse(queryResult) {
  const preferredOrder = ["openai", "anthropic", "google"];
  for (const providerId of preferredOrder) {
    const resp = queryResult.responses[providerId];
    if (resp && !resp.error && resp.text) return { providerId, text: resp.text, model: resp.model };
  }
  return null;
}

export async function runGapAnalysis(results, { delayMs = 2000, onProgress } = {}) {
  const apiKey = process.env.ANTHROPIC_API_KEY_RESEARCH;
  if (!apiKey) {
    console.warn("⚠ ANTHROPIC_API_KEY_RESEARCH not set — skipping gap analysis");
    return null;
  }

  const uncited = results.filter((r) => !r.brandCited);
  if (uncited.length === 0) {
    console.log("🎉 Brand was cited in all queries — no gap analysis needed!");
    return { detailed: [], actionPlan: [], topCompetitorThreats: [] };
  }

  console.log(`\n🔍 Gap Analysis: analyzing ${uncited.length} uncited queries with Claude...`);

  const client = new Anthropic({ apiKey });
  const detailed = [];
  let completed = 0;

  for (const queryResult of uncited) {
    const bestResponse = pickBestResponse(queryResult);
    if (!bestResponse) {
      completed++;
      if (onProgress) onProgress(completed, uncited.length);
      continue;
    }

    const prompt = await buildGapPrompt(queryResult.query, bestResponse.text);

    try {
      const response = await withRetry(() =>
        client.messages.create({
          model: "claude-sonnet-4-6",
          max_tokens: 800,
          temperature: 0,
          messages: [{ role: "user", content: prompt }],
        })
      );

      const rawText = response.content[0]?.text || "";
      const jsonStr = extractJsonObject(rawText);

      if (jsonStr) {
        const parsed = JSON.parse(jsonStr);
        detailed.push({
          query: queryResult.query,
          category: queryResult.categoryLabel,
          analyzedResponse: { provider: bestResponse.providerId, model: bestResponse.model },
          ...parsed,
        });
      } else {
        console.warn(`  ⚠ Could not parse JSON for: "${queryResult.query.slice(0, 50)}..."`);
        detailed.push({
          query: queryResult.query,
          category: queryResult.categoryLabel,
          analyzedResponse: { provider: bestResponse.providerId, model: bestResponse.model },
          why_not_cited: rawText.slice(0, 200),
          competitor_advantages: [],
          content_recommendation: null,
          parseError: true,
        });
      }
    } catch (err) {
      console.error(`  ✗ Gap analysis failed for: "${queryResult.query.slice(0, 50)}..." — ${err.message}`);
      detailed.push({
        query: queryResult.query,
        category: queryResult.categoryLabel,
        why_not_cited: `Analysis failed: ${err.message}`,
        competitor_advantages: [],
        content_recommendation: null,
        error: true,
      });
    }

    completed++;
    if (onProgress) onProgress(completed, uncited.length);
    if (completed < uncited.length) await sleep(delayMs);
  }

  const { items: actionPlan, topCompetitorThreats } = aggregateRecommendations(detailed);
  return { detailed, actionPlan, topCompetitorThreats };
}

function aggregateRecommendations(detailed) {
  const competitorFrequency = Object.create(null);
  for (const item of detailed) {
    for (const adv of item.competitor_advantages || []) {
      if (adv.name && typeof adv.name === "string" && adv.name.trim()) {
        competitorFrequency[adv.name] = (competitorFrequency[adv.name] || 0) + 1;
      }
    }
  }

  const recMap = new Map();
  for (const item of detailed) {
    const rec = item.content_recommendation;
    if (!rec || !rec.target) continue;

    const key = `${rec.action}:${rec.target}`;
    if (recMap.has(key)) {
      const existing = recMap.get(key);
      existing.queryCount++;
      if (rec.priority === "high" || existing.queryCount >= 3) existing.priority = "high";
      for (const point of rec.key_points || []) {
        if (!existing.key_points.includes(point)) existing.key_points.push(point);
      }
      existing.queries.push(item.query);
    } else {
      recMap.set(key, {
        action: rec.action,
        target: rec.target,
        title: rec.title,
        priority: rec.priority || "medium",
        key_points: [...(rec.key_points || [])],
        queryCount: 1,
        queries: [item.query],
      });
    }
  }

  const priorityOrder = { high: 0, medium: 1, low: 2 };
  const plan = [...recMap.values()].sort((a, b) => {
    const pDiff = (priorityOrder[a.priority] ?? 1) - (priorityOrder[b.priority] ?? 1);
    return pDiff !== 0 ? pDiff : b.queryCount - a.queryCount;
  });

  const topCompetitorThreats = Object.entries(competitorFrequency)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, count]) => ({ name, gapMentions: count }));

  return { items: plan, topCompetitorThreats };
}

// ============================================================================
// Analysis & Reporting
// ============================================================================

export async function analyzeResults(results) {
  const providers = getAvailableProviders();
  const queryCategories = await getQueryCategories();

  const totalQueryProviderPairs = results.reduce(
    (sum, r) => sum + Object.values(r.responses).filter((resp) => !resp.error).length, 0
  );
  const totalCitations = results.reduce(
    (sum, r) => sum + Object.values(r.responses).filter((resp) => resp.brandCited).length, 0
  );
  const overallCitationRate = totalQueryProviderPairs > 0 ? totalCitations / totalQueryProviderPairs : 0;

  const perAI = {};
  for (const provider of providers) {
    const responses = results.map((r) => r.responses[provider.id]).filter(Boolean).filter((r) => !r.error);
    const cited = responses.filter((r) => r.brandCited).length;
    perAI[provider.id] = {
      name: provider.name,
      model: provider.model,
      queriesAnswered: responses.length,
      citationCount: cited,
      citationRate: responses.length > 0 ? cited / responses.length : 0,
    };
  }

  const perCategory = {};
  for (const [categoryId, category] of Object.entries(queryCategories)) {
    const categoryResults = results.filter((r) => r.category === categoryId);
    const categoryPairs = categoryResults.reduce(
      (sum, r) => sum + Object.values(r.responses).filter((resp) => !resp.error).length, 0
    );
    const categoryCited = categoryResults.reduce(
      (sum, r) => sum + Object.values(r.responses).filter((resp) => resp.brandCited).length, 0
    );
    perCategory[categoryId] = {
      label: category.label,
      queryCount: categoryResults.length,
      citationCount: categoryCited,
      citationRate: categoryPairs > 0 ? categoryCited / categoryPairs : 0,
    };
  }

  const competitorCounts = {};
  for (const result of results) {
    for (const resp of Object.values(result.responses)) {
      if (resp.error) continue;
      for (const comp of resp.competitorsFound || []) {
        competitorCounts[comp] = (competitorCounts[comp] || 0) + 1;
      }
    }
  }
  const competitorRanking = Object.entries(competitorCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, mentions: count }));

  const neverCitedCategories = Object.entries(perCategory)
    .filter(([, data]) => data.citationCount === 0)
    .map(([id, data]) => ({ categoryId: id, label: data.label }));

  const neverCitedQueries = results
    .filter((r) => !r.brandCited)
    .map((r) => ({ query: r.query, category: r.categoryLabel }));

  const recommendations = [];

  if (neverCitedCategories.length > 0) {
    recommendations.push({
      priority: "high",
      area: "Content Gaps",
      detail: `Brand is never cited in ${neverCitedCategories.length} category(ies): ${neverCitedCategories.map((c) => c.label).join(", ")}. Create targeted content addressing these topics.`,
    });
  }

  if (competitorRanking.length > 0 && competitorRanking[0].mentions > totalCitations) {
    recommendations.push({
      priority: "high",
      area: "Competitor Dominance",
      detail: `${competitorRanking[0].name} is cited ${competitorRanking[0].mentions} times vs brand's ${totalCitations}. Focus on head-to-head comparison content.`,
    });
  }

  const lowCitationAIs = Object.values(perAI).filter(
    (ai) => ai.citationRate === 0 && ai.queriesAnswered > 0
  );
  if (lowCitationAIs.length > 0) {
    recommendations.push({
      priority: "medium",
      area: "AI-Specific Gaps",
      detail: `Brand is not cited at all by: ${lowCitationAIs.map((a) => a.name).join(", ")}. Investigate training data and content indexing for these platforms.`,
    });
  }

  if (overallCitationRate < 0.1) {
    recommendations.push({
      priority: "high",
      area: "Overall Visibility",
      detail: `Citation rate is ${(overallCitationRate * 100).toFixed(1)}% — below 10% threshold. Prioritize GEO content optimization, structured data, and authoritative backlinks.`,
    });
  }

  return {
    summary: {
      overallCitationRate,
      totalQueries: results.length,
      totalQueryProviderPairs,
      totalCitations,
      providersUsed: providers.map((p) => ({ id: p.id, name: p.name, model: p.model })),
      perAI,
      perCategory,
      competitorRanking,
    },
    gapAnalysis: { neverCitedCategories, neverCitedQueries, recommendations },
  };
}

export function buildReport(results, analysis, durationMs, deepGapAnalysis = null) {
  return {
    metadata: {
      runDate: new Date().toISOString(),
      models: analysis.summary.providersUsed,
      totalQueries: analysis.summary.totalQueries,
      durationSeconds: Math.round(durationMs / 1000),
    },
    summary: {
      citationRate: analysis.summary.overallCitationRate,
      citationRatePercent: `${(analysis.summary.overallCitationRate * 100).toFixed(1)}%`,
      totalCitations: analysis.summary.totalCitations,
      totalQueryProviderPairs: analysis.summary.totalQueryProviderPairs,
      perAI: analysis.summary.perAI,
      perCategory: analysis.summary.perCategory,
      competitorRanking: analysis.summary.competitorRanking,
    },
    results: results.map((r) => ({
      query: r.query,
      category: r.category,
      categoryLabel: r.categoryLabel,
      brandCited: r.brandCited,
      competitorsMentioned: r.competitorsMentioned,
      responses: r.responses,
    })),
    gap_analysis: analysis.gapAnalysis,
    deep_gap_analysis: deepGapAnalysis,
  };
}

// ============================================================================
// Markdown Report Generation
// ============================================================================

function formatDuration(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function rateEmoji(rate) {
  if (rate > 0.3) return "🟢";
  if (rate > 0.1) return "🟡";
  return "🔴";
}

export function generateMarkdownReport(report) {
  const { metadata, summary, results, gap_analysis, deep_gap_analysis } = report;
  const date = new Date(metadata.runDate).toLocaleDateString("en-US", {
    year: "numeric", month: "short", day: "numeric",
  });
  const aiNames = metadata.models.map((m) => m.name).join(", ");
  const duration = formatDuration(metadata.durationSeconds);
  const ratePercent = summary.citationRatePercent;
  const emoji = rateEmoji(summary.citationRate);

  const lines = [];

  lines.push(`# AI Citation Research Report — ${date}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push("| Metric | Value |");
  lines.push("|--------|-------|");
  lines.push(`| Citation Rate | ${emoji} ${ratePercent} (${summary.totalCitations}/${summary.totalQueryProviderPairs}) |`);
  lines.push(`| Queries | ${metadata.totalQueries} |`);
  lines.push(`| AI Models | ${aiNames} |`);
  lines.push(`| Duration | ${duration} |`);
  lines.push("");

  lines.push("## Citation by AI Model");
  lines.push("");
  lines.push("| AI | Model | Cited | Total | Rate |");
  lines.push("|----|-------|-------|-------|------|");
  for (const ai of Object.values(summary.perAI)) {
    const pct = (ai.citationRate * 100).toFixed(1) + "%";
    lines.push(`| ${ai.name} | ${ai.model} | ${ai.citationCount} | ${ai.queriesAnswered} | ${pct} |`);
  }
  lines.push("");

  lines.push("## Citation by Category");
  lines.push("");
  lines.push("| Category | Cited | Queries | Rate |");
  lines.push("|----------|-------|---------|------|");
  for (const cat of Object.values(summary.perCategory)) {
    const pct = (cat.citationRate * 100).toFixed(1) + "%";
    lines.push(`| ${cat.label} | ${cat.citationCount} | ${cat.queryCount} | ${rateEmoji(cat.citationRate)} ${pct} |`);
  }
  lines.push("");

  if (summary.competitorRanking.length > 0) {
    lines.push("## Top 10 Competitors by Mentions");
    lines.push("");
    lines.push("| # | Competitor | Mentions |");
    lines.push("|---|-----------|----------|");
    summary.competitorRanking.slice(0, 10).forEach((comp, i) => {
      lines.push(`| ${i + 1} | ${comp.name} | ${comp.mentions} |`);
    });
    lines.push("");
  }

  const citedResults = results.filter((r) => r.brandCited);
  if (citedResults.length > 0) {
    lines.push("## Queries Where Brand Was Cited");
    lines.push("");
    for (const r of citedResults) {
      const citedBy = Object.entries(r.responses)
        .filter(([, resp]) => resp.brandCited)
        .map(([, resp]) => resp.model);
      lines.push(`- ✅ "${r.query}" (${citedBy.join(", ")})`);
    }
    lines.push("");
  }

  const uncitedResults = results.filter((r) => !r.brandCited);
  if (uncitedResults.length > 0) {
    lines.push("## Queries Where Brand Was NOT Cited");
    lines.push("");
    for (const r of uncitedResults) {
      const competitors = r.competitorsMentioned.slice(0, 3).join(", ");
      const compStr = competitors ? ` (competitors: ${competitors})` : "";
      lines.push(`- ❌ "${r.query}"${compStr}`);
    }
    lines.push("");
  }

  if (gap_analysis.recommendations.length > 0) {
    lines.push("## Recommendations");
    lines.push("");
    for (const rec of gap_analysis.recommendations) {
      lines.push(`${rec.priority === "high" ? "🔴" : "🟡"} **${rec.area}** — ${rec.detail}`);
      lines.push("");
    }
  }

  if (deep_gap_analysis?.detailed?.length > 0) {
    lines.push("## Gap Analysis: Why Brand Is Not Cited");
    lines.push("");

    for (const item of deep_gap_analysis.detailed) {
      lines.push(`### Query: "${item.query}"`);
      lines.push("");
      lines.push(`**Category:** ${item.category}`);
      lines.push("");

      if (item.error) {
        lines.push(`> ⚠ Analysis failed for this query.`);
        lines.push("");
        continue;
      }

      lines.push(`**Why not cited:** ${item.why_not_cited}`);
      lines.push("");

      if (item.competitor_advantages?.length > 0) {
        lines.push("**Competitors cited instead:**");
        for (const adv of item.competitor_advantages) {
          lines.push(`- **${adv.name}** — ${adv.reason}`);
        }
        lines.push("");
      }

      if (item.content_recommendation) {
        const rec = item.content_recommendation;
        const icon = rec.priority === "high" ? "🔴" : rec.priority === "medium" ? "🟡" : "🟢";
        lines.push(`**Recommendation:** ${rec.action === "create" ? "Create" : rec.action === "improve" ? "Improve" : "Add section to"} \`${rec.target}\``);
        if (rec.title) lines.push(`Title: "${rec.title}"`);
        for (const point of rec.key_points || []) lines.push(`- ${point}`);
        lines.push(`Priority: ${icon} ${rec.priority}`);
        lines.push("");
      }

      lines.push("---");
      lines.push("");
    }

    if (deep_gap_analysis.topCompetitorThreats?.length > 0) {
      lines.push("## Competitor Threat Ranking (from Gap Analysis)");
      lines.push("");
      lines.push("These competitors were most frequently cited as reasons AI recommended them over the brand:");
      lines.push("");
      lines.push("| # | Competitor | Gap Mentions |");
      lines.push("|---|-----------|-------------|");
      deep_gap_analysis.topCompetitorThreats.forEach((comp, i) => {
        lines.push(`| ${i + 1} | ${comp.name} | ${comp.gapMentions} |`);
      });
      lines.push("");
    }

    if (deep_gap_analysis.actionPlan?.length > 0) {
      lines.push("## Aggregated Action Plan");
      lines.push("");

      let itemNum = 1;
      for (const [label, icon, priority] of [
        ["🔴 High Priority (create immediately)", "🔴", "high"],
        ["🟡 Medium Priority", "🟡", "medium"],
        ["🟢 Low Priority", "🟢", "low"],
      ]) {
        const items = deep_gap_analysis.actionPlan.filter((a) => a.priority === priority);
        if (items.length === 0) continue;
        lines.push(`### ${label}`);
        lines.push("");
        for (const item of items) {
          lines.push(`${itemNum}. **${item.title || item.target}** — mentioned in ${item.queryCount} gap ${item.queryCount === 1 ? "analysis" : "analyses"}. Action: ${item.action} \`${item.target}\``);
          for (const point of item.key_points.slice(0, 3)) lines.push(`   - ${point}`);
          itemNum++;
        }
        lines.push("");
      }
    }
  }

  return lines.join("\n");
}
