#!/usr/bin/env node

/**
 * GSC Keyword Performance Report — Weekly search position tracking
 *
 * Flow:
 * 1. Query GSC Search Analytics API for this week (last 7 days) — top 500 keywords by impressions
 * 2. Query GSC Search Analytics API for previous week — same top 500
 * 3. Merge data: calculate position delta, clicks delta, CTR delta per keyword
 * 4. Categorize keywords: top performers, rising, declining, strike distance, new
 * 5. Query by page dimension — top 20 pages by clicks
 * 5c. Query Umami Analytics API — pageviews + avg time per page (optional, graceful fallback)
 * 6. Write results to /tmp/gsc-keyword-results.json
 * 7. Write markdown report to /tmp/gsc-keyword-report.md
 *
 * Auth:
 *   GSC_CREDENTIALS_JSON — service account key JSON string
 *   UMAMI_API_KEY        — Umami Cloud API key (optional, from account settings)
 *   UMAMI_WEBSITE_ID     — Umami website UUID (optional, from website settings)
 * Rate limits: 200ms between API calls, retry with exponential backoff
 */

import { google } from "googleapis";
import { writeFileSync } from "fs";
import https from "https";
import { loadConfig } from "./lib/config-loader.mjs";

const config = await loadConfig();
const SITE_URL = config.gsc_site_url;
const RESULTS_PATH = "/tmp/gsc-keyword-results.json";
const REPORT_PATH = "/tmp/gsc-keyword-report.md";
const API_DELAY_MS = 200;
const MAX_RETRIES = 3;
const RETRY_BASE_MS = 1000;
const ROW_LIMIT = 500;

// Brand terms — ranking drops/gaps here are fixed by backlinks, not content edits.
// Content tasks for these are useless and create noise.
const BRAND_TERMS = config.brand_terms.length > 0
  ? config.brand_terms
  : ["leadhunter", "lead hunter", "lhunter", "ledhunter"];

// Minimum impressions to treat a signal as real vs statistical noise.
// 1-2 impressions/week = Google barely showed the page. Position deltas at
// this scale are meaningless — position 26 vs 30 is the same: nobody sees it.
const MIN_IMPRESSIONS_FOR_ACTION = 5;

// Minimum position drop to treat declining as actionable.
// A 2-3 spot drop at position 30+ is noise. Only flag if it's meaningful.
const MIN_DECLINE_DROP_FOR_ACTION = 3;

function isBrandTerm(query) {
  const q = query.toLowerCase().trim();
  return BRAND_TERMS.some((b) => q === b || q.includes(b));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Umami Analytics helpers
// ---------------------------------------------------------------------------

/**
 * Fetch JSON from Umami Cloud API.
 * Returns null (never throws) — Umami data is supplementary; GSC is the source
 * of truth. If Umami is unavailable the report still generates fine.
 */
async function umamiGet(path, apiKey) {
  return new Promise((resolve) => {
    const options = {
      hostname: "api.umami.is",
      path,
      method: "GET",
      headers: {
        "x-umami-api-key": apiKey,
        Accept: "application/json",
      },
    };

    const req = https.request(options, (res) => {
      let body = "";
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => {
        try {
          resolve(JSON.parse(body));
        } catch {
          resolve(null);
        }
      });
    });

    req.on("error", () => resolve(null));
    req.setTimeout(10000, () => { req.destroy(); resolve(null); });
    req.end();
  });
}

/**
 * Fetch per-page pageview data from Umami for the given date range.
 * Returns a Map: path → { pageviews, avgDurationSec }
 * Returns an empty Map if Umami credentials are missing or request fails.
 */
async function fetchUmamiPageStats(startDate, endDate) {
  const apiKey = process.env.UMAMI_API_KEY;
  const websiteId = process.env.UMAMI_WEBSITE_ID;

  if (!apiKey || !websiteId) {
    console.log("Umami: UMAMI_API_KEY or UMAMI_WEBSITE_ID not set — skipping");
    return new Map();
  }

  const startAt = new Date(startDate).getTime();
  const endAt = new Date(endDate + "T23:59:59Z").getTime();

  // Fallback: if this week has no data (Umami tracking started recently),
  // expand to last 30 days so we still get engagement signals for action items.
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;

  console.log("\nQuerying Umami page metrics...");

  // GET /v1/websites/:id/metrics?type=url — Umami Cloud uses /v1/ prefix
  let urlMetrics = await umamiGet(
    `/v1/websites/${websiteId}/metrics?type=url&startAt=${startAt}&endAt=${endAt}&limit=200`,
    apiKey
  );

  // GET /v1/websites/:id/stats — overall session/time data
  let siteStats = await umamiGet(
    `/v1/websites/${websiteId}/stats?startAt=${startAt}&endAt=${endAt}`,
    apiKey
  );

  // If this week has no data, fall back to last 30 days
  if (
    (!urlMetrics || !Array.isArray(urlMetrics) || urlMetrics.length === 0) &&
    startAt > thirtyDaysAgo
  ) {
    console.log("  Umami: no data for this week, falling back to last 30 days");
    urlMetrics = await umamiGet(
      `/v1/websites/${websiteId}/metrics?type=url&startAt=${thirtyDaysAgo}&endAt=${endAt}&limit=200`,
      apiKey
    );
    siteStats = await umamiGet(
      `/v1/websites/${websiteId}/stats?startAt=${thirtyDaysAgo}&endAt=${endAt}`,
      apiKey
    );
  }

  if (!urlMetrics || !Array.isArray(urlMetrics) || urlMetrics.length === 0) {
    console.log("  Umami: no page metrics returned");
    return new Map();
  }

  // Overall avg session duration (seconds) — used as fallback per-page estimate
  const overallAvgSec = siteStats?.totaltime && siteStats?.visits
    ? Math.round(siteStats.totaltime / siteStats.visits)
    : null;

  const map = new Map();
  for (const row of urlMetrics) {
    // row shape: { x: "/path", y: pageviewCount }
    const path = row.x || "";
    const pageviews = row.y || 0;
    if (!path) continue;
    map.set(path, { pageviews, avgDurationSec: overallAvgSec });
  }

  console.log(`  Umami: ${map.size} pages with data`);
  return map;
}

/**
 * Fetch top referrers from Umami for the given date range.
 * Returns array of { referrer, visits } sorted by visits desc, or [] on failure.
 */
async function fetchUmamiReferrers(startAt, endAt) {
  const apiKey = process.env.UMAMI_API_KEY;
  const websiteId = process.env.UMAMI_WEBSITE_ID;
  if (!apiKey || !websiteId) return [];

  const data = await umamiGet(
    `/v1/websites/${websiteId}/metrics?type=referrer&startAt=${startAt}&endAt=${endAt}&limit=10`,
    apiKey
  );

  if (!Array.isArray(data) || data.length === 0) return [];

  return data
    .filter((r) => r.x) // skip null/empty referrers (direct traffic has no referrer)
    .map((r) => ({ referrer: r.x, visits: r.y }))
    .slice(0, 8);
}

/**
 * Fetch top countries from Umami for the given date range.
 * Returns array of { country, visits } sorted by visits desc, or [] on failure.
 */
async function fetchUmamiCountries(startAt, endAt) {
  const apiKey = process.env.UMAMI_API_KEY;
  const websiteId = process.env.UMAMI_WEBSITE_ID;
  if (!apiKey || !websiteId) return [];

  const data = await umamiGet(
    `/v1/websites/${websiteId}/metrics?type=country&startAt=${startAt}&endAt=${endAt}&limit=10`,
    apiKey
  );

  if (!Array.isArray(data) || data.length === 0) return [];

  return data.map((r) => ({ country: r.x || "Unknown", visits: r.y })).slice(0, 8);
}

/**
 * Format seconds as "1m 23s" or "45s"
 */
function formatDuration(seconds) {
  if (!seconds || seconds <= 0) return null;
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

/**
 * Retry wrapper with exponential backoff for transient API errors
 */
async function withRetry(fn, label) {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const status = err.code || err.status || err.response?.status;
      const isTransient =
        status === 429 || status === 500 || status === 503 || status === 502;

      if (isTransient && attempt < MAX_RETRIES) {
        const delayMs = RETRY_BASE_MS * Math.pow(2, attempt - 1);
        console.log(
          `  ⟳ ${label}: attempt ${attempt}/${MAX_RETRIES} failed (${status}), retrying in ${delayMs}ms...`
        );
        await sleep(delayMs);
      } else {
        throw err;
      }
    }
  }
}

function getAuthClient() {
  const credentialsJson = process.env.GSC_CREDENTIALS_JSON;
  if (!credentialsJson) {
    throw new Error("GSC_CREDENTIALS_JSON environment variable is not set");
  }

  const credentials = JSON.parse(credentialsJson);

  return new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/webmasters.readonly"],
  });
}

/**
 * Format a date as YYYY-MM-DD
 */
function formatDate(date) {
  return date.toISOString().split("T")[0];
}

/**
 * Get date ranges for this week and previous week
 * "This week" = 7 days ending yesterday (GSC data has ~2 day lag)
 */
function getDateRanges() {
  const now = new Date();

  // Yesterday
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);

  // 7 days ago (this week start)
  const thisWeekStart = new Date(yesterday);
  thisWeekStart.setDate(thisWeekStart.getDate() - 6);

  // Previous week: 8-14 days ago
  const prevWeekEnd = new Date(thisWeekStart);
  prevWeekEnd.setDate(prevWeekEnd.getDate() - 1);

  const prevWeekStart = new Date(prevWeekEnd);
  prevWeekStart.setDate(prevWeekStart.getDate() - 6);

  return {
    thisWeek: {
      start: formatDate(thisWeekStart),
      end: formatDate(yesterday),
    },
    prevWeek: {
      start: formatDate(prevWeekStart),
      end: formatDate(prevWeekEnd),
    },
  };
}

/**
 * Query GSC Search Analytics API
 */
async function querySearchAnalytics(
  searchconsole,
  startDate,
  endDate,
  dimensions,
  rowLimit = ROW_LIMIT
) {
  const res = await withRetry(
    () =>
      searchconsole.searchanalytics.query({
        siteUrl: SITE_URL,
        requestBody: {
          startDate,
          endDate,
          dimensions,
          rowLimit,
          dataState: "final",
        },
      }),
    `query ${dimensions.join("+")} ${startDate}`
  );

  return res.data.rows || [];
}

/**
 * Build a map from rows keyed by the first dimension value
 */
function buildMap(rows) {
  const map = new Map();
  for (const row of rows) {
    const key = row.keys[0];
    map.set(key, {
      clicks: row.clicks,
      impressions: row.impressions,
      ctr: round(row.ctr * 100, 1),
      position: round(row.position, 1),
    });
  }
  return map;
}

function round(n, decimals) {
  const factor = Math.pow(10, decimals);
  return Math.round(n * factor) / factor;
}

function pctDelta(current, previous) {
  if (previous === 0) return current > 0 ? "+∞" : "0%";
  const delta = ((current - previous) / previous) * 100;
  const sign = delta >= 0 ? "+" : "";
  return `${sign}${round(delta, 0)}%`;
}

function formatNumber(n) {
  return n.toLocaleString("en-US");
}

/**
 * Merge this week and previous week data, calculate deltas
 */
function mergeKeywordData(thisWeekRows, prevWeekRows) {
  const thisMap = buildMap(thisWeekRows);
  const prevMap = buildMap(prevWeekRows);

  const allKeys = new Set([...thisMap.keys(), ...prevMap.keys()]);
  const merged = [];

  for (const query of allKeys) {
    const curr = thisMap.get(query);
    const prev = prevMap.get(query);

    if (!curr) continue; // Only include keywords that appeared this week

    const entry = {
      query,
      clicks: curr.clicks,
      impressions: curr.impressions,
      position: curr.position,
      ctr: curr.ctr,
      positionDelta: prev ? round(prev.position - curr.position, 1) : null,
      clicksDelta: prev ? curr.clicks - prev.clicks : null,
      ctrDelta: prev ? round(curr.ctr - prev.ctr, 1) : null,
      isNew: !prev,
    };

    merged.push(entry);
  }

  return merged;
}

/**
 * Categorize keywords into groups
 */
function categorizeKeywords(merged) {
  // Top 10 by clicks
  const topByClicks = [...merged]
    .sort((a, b) => b.clicks - a.clicks)
    .slice(0, 10);

  // Rising: position improved by ≥2 spots (positionDelta > 0 means improvement)
  const rising = merged
    .filter((k) => k.positionDelta !== null && k.positionDelta >= 2)
    .sort((a, b) => b.positionDelta - a.positionDelta);

  // Declining: position dropped by ≥2 spots (positionDelta < 0 means decline)
  const declining = merged
    .filter((k) => k.positionDelta !== null && k.positionDelta <= -2)
    .sort((a, b) => a.positionDelta - b.positionDelta);

  // Strike distance: position 8-20
  const strikeDistance = merged
    .filter((k) => k.position >= 8 && k.position <= 20)
    .sort((a, b) => a.position - b.position);

  // New keywords
  const newKeywords = merged
    .filter((k) => k.isNew)
    .sort((a, b) => b.impressions - a.impressions);

  return { topByClicks, rising, declining, strikeDistance, newKeywords };
}

/**
 * Calculate summary stats
 */
function calculateSummary(thisWeekRows, prevWeekRows) {
  const thisClicks = thisWeekRows.reduce((sum, r) => sum + r.clicks, 0);
  const thisImpressions = thisWeekRows.reduce(
    (sum, r) => sum + r.impressions,
    0
  );
  const prevClicks = prevWeekRows.reduce((sum, r) => sum + r.clicks, 0);
  const prevImpressions = prevWeekRows.reduce(
    (sum, r) => sum + r.impressions,
    0
  );

  const avgPosition =
    thisWeekRows.length > 0
      ? round(
          thisWeekRows.reduce((sum, r) => sum + r.position, 0) /
            thisWeekRows.length,
          1
        )
      : 0;

  const avgCtr =
    thisClicks > 0 && thisImpressions > 0
      ? round((thisClicks / thisImpressions) * 100, 1)
      : 0;

  return {
    totalKeywords: thisWeekRows.length,
    totalClicks: thisClicks,
    totalImpressions: thisImpressions,
    avgPosition,
    avgCtr,
    clicksDelta: pctDelta(thisClicks, prevClicks),
    impressionsDelta: pctDelta(thisImpressions, prevImpressions),
  };
}

/**
 * Format position delta for display
 */
function formatPositionDelta(delta) {
  if (delta === null) return "NEW";
  if (delta > 0) return `↑ ${delta}`;
  if (delta < 0) return `↓ ${Math.abs(delta)}`;
  return "—";
}

/**
 * Generate a short human-readable TLDR summary (3-5 sentences).
 * Plain English — written like a colleague would explain what happened this week.
 */
function generateTldr(summary, categories, actionItems, referrers, countries) {
  const sentences = [];

  // Sentence 1 — Traffic state
  if (summary.totalClicks === 0) {
    sentences.push(
      `No clicks recorded this week — the site is indexed but not yet competitive on page 1.`
    );
  } else {
    const trend = summary.clicksDelta.startsWith("+")
      ? `up ${summary.clicksDelta}`
      : summary.clicksDelta.startsWith("-")
      ? `down ${summary.clicksDelta}`
      : "flat";
    sentences.push(
      `${formatNumber(summary.totalClicks)} clicks this week (${trend} vs last week) from ${formatNumber(summary.totalImpressions)} impressions across ${formatNumber(summary.totalKeywords)} keywords.`
    );
  }

  // Sentence 2 — Biggest opportunity / top priority
  const highPriority = actionItems.filter((a) => a.priority === "high");
  const strikeTasks = actionItems.filter((a) => a.type === "strike-distance");
  const brandTask = actionItems.find((a) => a.type === "brand-backlinks");

  if (brandTask) {
    sentences.push(
      `Brand terms like "${brandTask.keywords[0]}" are not ranking on page 1 yet — this is a backlink authority problem, not a content issue; submit to SaaS directories to fix it.`
    );
  }
  if (strikeTasks.length > 0) {
    const top = strikeTasks[0];
    sentences.push(
      `Biggest content opportunity: "${top.keywords[0]}" is at position ${categories.strikeDistance.find(k => k.query === top.keywords[0])?.position ?? "~"} — a few targeted edits to \`${top.page}\` could push it to page 1.`
    );
  } else if (summary.avgPosition > 20) {
    sentences.push(
      `Average position is ${summary.avgPosition} — most keywords are buried on page 2+. New content targeting specific long-tail queries will have the fastest impact.`
    );
  }

  // Sentence 3 — Declining / risk
  const decliningTasks = actionItems.filter((a) => a.type === "declining");
  if (decliningTasks.length > 0) {
    sentences.push(
      `${decliningTasks.length} page(s) are losing rankings: ${decliningTasks.map(t => `\`${t.page}\``).join(", ")} — refresh content before competitors cement the advantage.`
    );
  }

  // Sentence 4 — Traffic sources (if available)
  if (referrers.length > 0) {
    const topRef = referrers[0];
    sentences.push(
      `Top referral source: ${topRef.referrer} (${topRef.visits} visits); ${referrers.length > 1 ? `other sources: ${referrers.slice(1, 3).map(r => r.referrer).join(", ")}.` : "no other significant referrers yet."}`
    );
  }

  // Sentence 5 — What to do this week
  if (highPriority.length > 0) {
    sentences.push(
      `This week: focus on the ${highPriority.length} HIGH-priority task${highPriority.length > 1 ? "s" : ""} in the Action Plan below.`
    );
  } else if (actionItems.length > 0) {
    sentences.push(
      `This week: ${actionItems.length} MEDIUM-priority task${actionItems.length > 1 ? "s" : ""} in the Action Plan — no fires, but steady improvement will compound.`
    );
  } else {
    sentences.push(
      `No urgent action items this week — keep publishing content and building backlinks.`
    );
  }

  return sentences.join(" ");
}

/**
 * Generate Markdown report
 */
function generateMarkdownReport(dates, summary, categories, topPages, actionItems, keywordPageMap, umamiStats, referrers, countries) {
  const lines = [];

  lines.push(
    `# GSC Weekly Report — ${dates.thisWeek.start} to ${dates.thisWeek.end}`
  );
  lines.push("");

  // TLDR — plain English summary at the very top
  const tldr = generateTldr(summary, categories, actionItems, referrers, countries);
  lines.push("> **TLDR:** " + tldr);
  lines.push("");

  // Summary table
  const clicksEmoji = summary.totalClicks === 0 ? "⚠️" : summary.clicksDelta.startsWith("+") ? "📈" : "📉";
  const impressionsEmoji = summary.impressionsDelta.startsWith("+") ? "📈" : "📉";
  lines.push("## Overview");
  lines.push("");
  lines.push("| Metric | This Week | vs Last Week |");
  lines.push("|--------|-----------|--------------|");
  lines.push(`| ${clicksEmoji} Clicks (GSC) | ${formatNumber(summary.totalClicks)} | ${summary.clicksDelta} |`);
  lines.push(`| ${impressionsEmoji} Impressions | ${formatNumber(summary.totalImpressions)} | ${summary.impressionsDelta} |`);
  lines.push(`| 🎯 Avg Position | ${summary.avgPosition} | — |`);
  lines.push(`| 📊 Total Keywords | ${formatNumber(summary.totalKeywords)} | — |`);
  lines.push(`| 🖱 Avg CTR | ${summary.avgCtr}% | — |`);

  // Umami summary row if available
  if (umamiStats.size > 0) {
    const totalUmamiViews = [...umamiStats.values()].reduce((s, p) => s + p.pageviews, 0);
    lines.push(`| 👁 Pageviews (Umami) | ${formatNumber(totalUmamiViews)} | — |`);
  }
  lines.push("");

  // Referrers table (from Umami)
  if (referrers.length > 0) {
    lines.push("**Top Traffic Sources (Umami)**");
    lines.push("");
    lines.push("| Source | Visits |");
    lines.push("|--------|--------|");
    for (const r of referrers) {
      lines.push(`| ${r.referrer} | ${r.visits} |`);
    }
    lines.push("");
  }

  // Country breakdown (from Umami)
  if (countries.length > 0) {
    lines.push("**Top Countries (Umami)**");
    lines.push("");
    lines.push("| Country | Visits |");
    lines.push("|---------|--------|");
    for (const c of countries) {
      lines.push(`| ${c.country} | ${c.visits} |`);
    }
    lines.push("");
  }

  // Diagnosis
  lines.push("## Diagnosis");
  lines.push("");
  const diagLines = [];

  if (summary.totalClicks === 0 && summary.avgPosition > 20) {
    diagLines.push("**No clicks yet** — all keywords are below position 20. Site is being indexed but not competitive yet. Focus on strike-distance keywords to reach page 1.");
  } else if (summary.totalClicks === 0 && summary.avgPosition <= 20) {
    diagLines.push("**Zero clicks despite decent positions** — titles/descriptions aren't compelling enough to click. Prioritize CTR optimization.");
  } else if (summary.clicksDelta.startsWith("-")) {
    diagLines.push(`**Clicks declining** (${summary.clicksDelta}) — check declining keywords for pages that lost rankings.`);
  } else {
    diagLines.push(`**${summary.totalClicks} clicks this week** (${summary.clicksDelta} vs last week).`);
  }

  // Brand terms diagnosis
  const brandInStrike = categories.strikeDistance.filter(k => isBrandTerm(k.query));
  if (brandInStrike.length > 0) {
    diagLines.push(`**Brand terms not on page 1** (${brandInStrike.map(k => `"${k.query}" pos ${k.position}`).join(", ")}) — this is a backlink problem, not a content problem. Fix: submit to SaaS directories.`);
  }

  // Non-brand strike distance with real signal
  const realStrike = categories.strikeDistance.filter(k => !isBrandTerm(k.query) && k.impressions >= MIN_IMPRESSIONS_FOR_ACTION);
  if (realStrike.length > 0) {
    const top = realStrike[0];
    diagLines.push(`**${realStrike.length} non-brand keyword(s) within reach of page 1** — best opportunity: "${top.query}" at position ${top.position} with ${top.impressions} impressions/week.`);
  }

  // Real declining (not noise, not brand)
  const realDeclining = categories.declining.filter(
    k => !isBrandTerm(k.query) && k.impressions >= MIN_IMPRESSIONS_FOR_ACTION && Math.abs(k.positionDelta) >= MIN_DECLINE_DROP_FOR_ACTION
  );
  if (realDeclining.length > 0) {
    const pages = [...new Set(realDeclining.map(k => keywordPageMap.get(k.query)?.page).filter(Boolean))];
    diagLines.push(`**${realDeclining.length} keyword(s) dropped significantly** — affected page(s): ${pages.join(", ")}. Act before it compounds.`);
  }

  // Noise disclaimer
  const noiseCount = categories.declining.length - realDeclining.length;
  if (noiseCount > 0) {
    diagLines.push(`**${noiseCount} other "declining" keyword(s) ignored** — under ${MIN_IMPRESSIONS_FOR_ACTION} impressions or under ${MIN_DECLINE_DROP_FOR_ACTION} spot drop. Not enough data to act on.`);
  }

  if (categories.rising.length > 0) {
    diagLines.push(`**${categories.rising.length} keyword(s) rising** — no action needed, monitor.`);
  }

  for (const d of diagLines) {
    lines.push(`- ${d}`);
  }
  lines.push("");

  // Action Plan
  lines.push("## Action Plan");
  lines.push("");
  lines.push("_Ordered by expected impact. Each task is self-contained — can be assigned to an agent._");
  lines.push("");

  if (actionItems.length === 0) {
    lines.push("_No action items this week — all keywords performing well._");
  } else {
    let taskNum = 1;
    for (const item of actionItems) {
      const priorityLabel = item.priority === "high" ? "🔴 HIGH" : "🟡 MEDIUM";
      lines.push(`### Task ${taskNum}: ${item.taskTitle}`);
      lines.push(`**Priority:** ${priorityLabel} | **Page:** \`${item.page}\``);
      lines.push("");
      lines.push(`**Why:** ${item.why}`);
      lines.push("");
      lines.push(`**What to do:**`);
      for (const step of item.steps) {
        lines.push(`- ${step}`);
      }
      lines.push("");
      lines.push(`**Keywords affected:** ${item.keywords.map(k => `\`${k}\``).join(", ")}`);
      lines.push("");
      lines.push("---");
      lines.push("");
      taskNum++;
    }
  }

  // Raw data (collapsible)
  lines.push("<details>");
  lines.push("<summary>📊 Full keyword data</summary>");
  lines.push("");

  // Top 10 by clicks
  lines.push("### Top Keywords by Clicks");
  if (categories.topByClicks.filter(k => k.clicks > 0).length === 0) {
    lines.push("_No clicks recorded this week._");
  } else {
    lines.push("| Keyword | Clicks | Position | Δ | CTR |");
    lines.push("|---------|--------|----------|---|-----|");
    for (const k of categories.topByClicks.filter(k => k.clicks > 0)) {
      lines.push(`| ${k.query} | ${k.clicks} | ${k.position} | ${formatPositionDelta(k.positionDelta)} | ${k.ctr}% |`);
    }
  }
  lines.push("");

  // Strike distance
  lines.push("### Strike Distance (pos 8–20)");
  if (categories.strikeDistance.length === 0) {
    lines.push("_None._");
  } else {
    lines.push("| Keyword | Position | Δ | Impressions | CTR | Page |");
    lines.push("|---------|----------|---|-------------|-----|------|");
    for (const k of categories.strikeDistance) {
      const page = keywordPageMap.get(k.query)?.page || "?";
      lines.push(`| ${k.query} | ${k.position} | ${formatPositionDelta(k.positionDelta)} | ${k.impressions} | ${k.ctr}% | \`${page}\` |`);
    }
  }
  lines.push("");

  // Rising
  lines.push("### Rising (improved ≥2 positions)");
  if (categories.rising.length === 0) {
    lines.push("_None._");
  } else {
    lines.push("| Keyword | Position | Δ | Impressions |");
    lines.push("|---------|----------|---|-------------|");
    for (const k of categories.rising.slice(0, 20)) {
      lines.push(`| ${k.query} | ${k.position} | ${formatPositionDelta(k.positionDelta)} | ${k.impressions} |`);
    }
  }
  lines.push("");

  // Declining
  lines.push("### Declining (dropped ≥2 positions)");
  if (categories.declining.length === 0) {
    lines.push("_None._");
  } else {
    lines.push("| Keyword | Position | Δ | Impressions | Page |");
    lines.push("|---------|----------|---|-------------|------|");
    for (const k of categories.declining.slice(0, 20)) {
      const page = keywordPageMap.get(k.query)?.page || "?";
      lines.push(`| ${k.query} | ${k.position} | ${formatPositionDelta(k.positionDelta)} | ${k.impressions} | \`${page}\` |`);
    }
  }
  lines.push("");

  // New keywords
  lines.push("### New Keywords (first seen this week)");
  if (categories.newKeywords.length === 0) {
    lines.push("_None._");
  } else {
    lines.push("| Keyword | Position | Impressions |");
    lines.push("|---------|----------|-------------|");
    for (const k of categories.newKeywords.slice(0, 20)) {
      lines.push(`| ${k.query} | ${k.position} | ${k.impressions} |`);
    }
  }
  lines.push("");

  // Top pages
  lines.push("### Top Pages by Clicks");
  const hasUmami = umamiStats.size > 0;
  if (hasUmami) {
    lines.push("| Page | Clicks | Impressions | Avg Pos | CTR | Pageviews (Umami) | Avg Time |");
    lines.push("|------|--------|-------------|---------|-----|-------------------|----------|");
  } else {
    lines.push("| Page | Clicks | Impressions | Avg Position | CTR |");
    lines.push("|------|--------|-------------|--------------|-----|");
  }
  for (const p of topPages) {
    const path = p.page.replace(config.site_url, "") || "/";
    if (hasUmami) {
      const u = umamiStats.get(path);
      const views = u ? u.pageviews : "—";
      const dur = u ? (formatDuration(u.avgDurationSec) ?? "—") : "—";
      lines.push(`| \`${path}\` | ${p.clicks} | ${p.impressions} | ${p.position} | ${p.ctr}% | ${views} | ${dur} |`);
    } else {
      lines.push(`| \`${path}\` | ${p.clicks} | ${p.impressions} | ${p.position} | ${p.ctr}% |`);
    }
  }
  lines.push("");

  lines.push("</details>");
  lines.push("");

  return lines.join("\n");
}

async function main() {
  const results = {
    period: null,
    summary: null,
    topByClicks: [],
    rising: [],
    declining: [],
    strikeDistance: [],
    newKeywords: [],
    topPages: [],
    actionItems: [],
    error: null,
  };

  try {
    // 1. Auth
    const auth = getAuthClient();
    const searchconsole = google.searchconsole({ version: "v1", auth });

    // 2. Calculate date ranges
    const dates = getDateRanges();
    results.period = {
      thisWeek: `${dates.thisWeek.start} — ${dates.thisWeek.end}`,
      prevWeek: `${dates.prevWeek.start} — ${dates.prevWeek.end}`,
    };

    console.log(`This week: ${dates.thisWeek.start} to ${dates.thisWeek.end}`);
    console.log(`Prev week: ${dates.prevWeek.start} to ${dates.prevWeek.end}`);

    // 3. Query this week's keywords
    console.log("\nQuerying this week's keywords...");
    const thisWeekKeywords = await querySearchAnalytics(
      searchconsole,
      dates.thisWeek.start,
      dates.thisWeek.end,
      ["query"]
    );
    console.log(`  → ${thisWeekKeywords.length} keywords`);

    await sleep(API_DELAY_MS);

    // 4. Query previous week's keywords
    console.log("Querying previous week's keywords...");
    const prevWeekKeywords = await querySearchAnalytics(
      searchconsole,
      dates.prevWeek.start,
      dates.prevWeek.end,
      ["query"]
    );
    console.log(`  → ${prevWeekKeywords.length} keywords`);

    await sleep(API_DELAY_MS);

    // 5. Query this week's pages
    console.log("Querying this week's pages...");
    const thisWeekPages = await querySearchAnalytics(
      searchconsole,
      dates.thisWeek.start,
      dates.thisWeek.end,
      ["page"],
      20
    );
    console.log(`  → ${thisWeekPages.length} pages`);

    await sleep(API_DELAY_MS);

    // 5b. Query keyword+page pairs (for action items — which page ranks for which keyword)
    console.log("Querying keyword+page pairs...");
    const queryPageRows = await querySearchAnalytics(
      searchconsole,
      dates.thisWeek.start,
      dates.thisWeek.end,
      ["query", "page"],
      500
    );
    console.log(`  → ${queryPageRows.length} keyword+page pairs`);

    // Build keyword → page map (best page per keyword)
    const keywordPageMap = new Map();
    for (const row of queryPageRows) {
      const query = row.keys[0];
      const page = row.keys[1];
      if (
        !keywordPageMap.has(query) ||
        row.clicks > keywordPageMap.get(query).clicks
      ) {
        keywordPageMap.set(query, {
          page: page.replace(config.site_url, "") || "/",
          clicks: row.clicks,
          impressions: row.impressions,
        });
      }
    }

    // 5c. Fetch Umami per-page stats (optional — graceful fallback if unavailable)
    const umamiStats = await fetchUmamiPageStats(
      dates.thisWeek.start,
      dates.thisWeek.end
    );

    // 5d. Fetch Umami referrers and countries (optional — same fallback)
    const umamiStartAt = new Date(dates.thisWeek.start).getTime();
    const umamiEndAt = new Date(dates.thisWeek.end + "T23:59:59Z").getTime();
    // If no page data for the week (tracking started recently), use 30-day range
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const effectiveStartAt = umamiStats.size > 0 ? umamiStartAt : thirtyDaysAgo;

    console.log("\nQuerying Umami referrers and countries...");
    const [referrers, countries] = await Promise.all([
      fetchUmamiReferrers(effectiveStartAt, umamiEndAt),
      fetchUmamiCountries(effectiveStartAt, umamiEndAt),
    ]);
    console.log(`  Referrers: ${referrers.length}, Countries: ${countries.length}`);

    // 6. Calculate summary
    const summary = calculateSummary(thisWeekKeywords, prevWeekKeywords);
    results.summary = summary;

    console.log(
      `\nSummary: ${summary.totalKeywords} keywords, ${summary.totalClicks} clicks (${summary.clicksDelta}), ${summary.totalImpressions} impressions (${summary.impressionsDelta})`
    );

    // 7. Merge and categorize keywords
    const merged = mergeKeywordData(thisWeekKeywords, prevWeekKeywords);
    const categories = categorizeKeywords(merged);

    results.topByClicks = categories.topByClicks;
    results.rising = categories.rising;
    results.declining = categories.declining;
    results.strikeDistance = categories.strikeDistance;
    results.newKeywords = categories.newKeywords;

    console.log(`  Top by clicks: ${categories.topByClicks.length}`);
    console.log(`  Rising: ${categories.rising.length}`);
    console.log(`  Declining: ${categories.declining.length}`);
    console.log(`  Strike distance: ${categories.strikeDistance.length}`);
    console.log(`  New keywords: ${categories.newKeywords.length}`);

    // 8. Generate action items — grouped by page, structured for agents
    const actionItems = [];

    // Collect brand-term strike-distance keywords separately — they need backlinks, not content edits
    const brandStrikeKeywords = categories.strikeDistance.filter(k => isBrandTerm(k.query));

    if (brandStrikeKeywords.length > 0) {
      actionItems.push({
        type: "brand-backlinks",
        priority: "high",
        taskTitle: `Build backlinks for brand terms (pos ${brandStrikeKeywords.map(k => k.position).join(", ")})`,
        page: "/",
        why: `"${brandStrikeKeywords.map(k => k.query).join('", "')}" — your own brand name — ranks at position ${brandStrikeKeywords[0].position}. This is not a content problem. Google hasn't seen enough external sites linking to ${config.site_url} with the brand name. Content edits won't help here.`,
        keywords: brandStrikeKeywords.map(k => k.query),
        steps: [
          "Submit LeadHunter to SaaS directories (see docs/GUIDE_DIRECTORIES.md) — G2, Product Hunt, SaaSHub are highest priority",
          "Each directory listing creates a backlink with the brand name as anchor text",
          "No code changes needed — this is an off-site task",
        ],
      });
    }

    // Group non-brand strike-distance keywords by page, skip noise (< MIN_IMPRESSIONS_FOR_ACTION)
    const strikeByPage = new Map();
    for (const k of categories.strikeDistance.slice(0, 15)) {
      if (isBrandTerm(k.query)) continue; // handled above
      if (k.impressions < MIN_IMPRESSIONS_FOR_ACTION) continue; // not enough signal
      const pageInfo = keywordPageMap.get(k.query);
      const page = pageInfo ? pageInfo.page : "unknown";
      if (!strikeByPage.has(page)) strikeByPage.set(page, []);
      strikeByPage.get(page).push(k);
    }

    for (const [page, keywords] of strikeByPage) {
      const topKw = keywords[0];
      const isHomepage = page === "/" || page === "";
      const isBlog = page.startsWith("/blog/");
      const umami = umamiStats.get(page);
      const duration = umami ? formatDuration(umami.avgDurationSec) : null;
      const lowEngagement = umami?.avgDurationSec && umami.avgDurationSec < 60;

      const steps = [];
      if (isHomepage) {
        steps.push(`Open \`src/app/page.tsx\` (or the relevant homepage component)`);
        steps.push(`Add "${keywords.map(k => k.query).join('", "')}" naturally into h1, h2, or first paragraph — the page barely mentions these terms`);
        steps.push(`Check that the metadata \`title\` and \`description\` include the primary keyword`);
        steps.push(`Add a blockquote or stat that references the keyword context`);
      } else if (isBlog) {
        const slug = page.replace("/blog/", "");
        steps.push(`Open \`src/app/blog/${slug}/page.tsx\``);
        steps.push(`Add "${keywords.map(k => k.query).join('", "')}" in h2 headings or early in the article body`);
        steps.push(`Add 1-2 blockquotes with specific data points related to the keyword`);
        steps.push(`Update \`metadata.title\` and \`metadata.description\` to include the exact keyword phrase`);
        steps.push(`Add internal links from related pages pointing to this article`);
      } else {
        steps.push(`Open the page at \`src/app${page}/page.tsx\``);
        steps.push(`Add "${keywords.map(k => k.query).join('", "')}" in h1/h2 headings`);
        steps.push(`Update \`metadata.title\` and \`metadata.description\` to include the exact phrase`);
      }
      if (lowEngagement) {
        steps.push(`⚠️ Avg time on page is only ${duration} — visitors leave quickly. Strengthen the opening paragraph to hook readers in the first 3 sentences`);
      }

      const umamiNote = umami
        ? ` Umami: ${umami.pageviews} real pageviews this week${duration ? `, avg time ${duration}` : ""}${lowEngagement ? " — low engagement" : ""}.`
        : "";

      actionItems.push({
        type: "strike-distance",
        priority: topKw.position <= 12 ? "high" : "medium",
        taskTitle: `Push "${topKw.query}" to page 1 (currently pos ${topKw.position})`,
        page,
        why: `${keywords.length} keyword(s) at positions ${keywords.map(k=>k.position).join(", ")} — a few spots from page 1. GSC: ${topKw.impressions} impressions/week, ${topKw.clicks} clicks.${umamiNote}`,
        keywords: keywords.map(k => k.query),
        steps,
      });
    }

    // Group declining keywords by page — filter out noise and brand terms
    const decliningByPage = new Map();
    for (const k of categories.declining.slice(0, 10)) {
      if (isBrandTerm(k.query)) continue; // brand ranking = backlinks problem, not content
      if (k.impressions < MIN_IMPRESSIONS_FOR_ACTION) continue; // 1-2 impressions = statistical noise
      if (Math.abs(k.positionDelta) < MIN_DECLINE_DROP_FOR_ACTION) continue; // minor fluctuation, not a real drop
      const pageInfo = keywordPageMap.get(k.query);
      const page = pageInfo ? pageInfo.page : "unknown";
      if (!decliningByPage.has(page)) decliningByPage.set(page, []);
      decliningByPage.get(page).push(k);
    }

    for (const [page, keywords] of decliningByPage) {
      const isBlog = page.startsWith("/blog/");
      const maxDrop = Math.max(...keywords.map(k => Math.abs(k.positionDelta)));
      const umami = umamiStats.get(page);
      const duration = umami ? formatDuration(umami.avgDurationSec) : null;
      const lowEngagement = umami?.avgDurationSec && umami.avgDurationSec < 60;
      const steps = [];

      if (isBlog) {
        const slug = page.replace("/blog/", "");
        steps.push(`Open \`src/app/blog/${slug}/page.tsx\``);
        steps.push(`Check that the article still matches search intent for: "${keywords.map(k=>k.query).join('", "')}" — Google may have re-ranked because competing pages better match intent`);
        steps.push(`Update the article's publish/update date reference if content is stale`);
        steps.push(`Add fresh data points or statistics — stale articles lose rankings`);
        steps.push(`Strengthen the h1 and first 100 words to directly answer the query`);
        steps.push(`Add 2-3 blockquotes with specific numbers (Google rewards citable facts)`);
      } else {
        steps.push(`Open \`src/app${page}/page.tsx\``);
        steps.push(`Review whether page content directly answers "${keywords[0].query}"`);
        steps.push(`Strengthen h1 and metadata to match the declining keyword`);
        steps.push(`Check if a competitor page recently outranked this — compare structure`);
      }
      if (lowEngagement) {
        steps.push(`⚠️ Avg time on page is only ${duration} — visitors aren't reading. Content quality may be the root cause of the ranking drop`);
      }

      const umamiNote = umami
        ? ` Umami: ${umami.pageviews} real pageviews this week${duration ? `, avg time ${duration}` : ""}${lowEngagement ? " — low engagement, likely root cause" : ""}.`
        : "";

      actionItems.push({
        type: "declining",
        priority: maxDrop >= 5 ? "high" : "medium",
        taskTitle: `Stop ranking drop on \`${page}\` (lost up to ${maxDrop} positions)`,
        page,
        why: `${keywords.length} keyword(s) dropped: ${keywords.map(k=>`"${k.query}" −${Math.abs(k.positionDelta)}`).join(", ")}. Likely causes: competitor improved, content is stale, or internal links weakened.${umamiNote}`,
        keywords: keywords.map(k => k.query),
        steps,
      });
    }

    // High-impression low-CTR — improve titles/descriptions
    const lowCtr = merged
      .filter((k) => k.position <= 10 && k.impressions >= 50 && k.ctr < 2)
      .sort((a, b) => b.impressions - a.impressions)
      .slice(0, 5);

    // Group by page
    const lowCtrByPage = new Map();
    for (const k of lowCtr) {
      const pageInfo = keywordPageMap.get(k.query);
      const page = pageInfo ? pageInfo.page : "unknown";
      if (!lowCtrByPage.has(page)) lowCtrByPage.set(page, []);
      lowCtrByPage.get(page).push(k);
    }

    for (const [page, keywords] of lowCtrByPage) {
      const isBlog = page.startsWith("/blog/");
      const slug = isBlog ? page.replace("/blog/", "") : null;
      const umami = umamiStats.get(page);
      const duration = umami ? formatDuration(umami.avgDurationSec) : null;
      const lowEngagement = umami?.avgDurationSec && umami.avgDurationSec < 60;
      const steps = [];

      steps.push(
        isBlog
          ? `Open \`src/app/blog/${slug}/page.tsx\` metadata`
          : `Open \`src/app${page === "/" ? "" : page}/page.tsx\` metadata`
      );
      steps.push(`Rewrite \`metadata.title\` to be more click-worthy — add a number, year, or specific benefit. Example: instead of "LinkedIn Automation Guide", use "LinkedIn Automation in 2025: What Works (and What Gets You Banned)"`);
      steps.push(`Rewrite \`metadata.description\` to include a hook: what the reader gets, not just what the page is about. Max 155 chars.`);
      steps.push(`Check the h1 — does it match what someone searching "${keywords[0].query}" expects to find?`);
      if (lowEngagement) {
        steps.push(`⚠️ Avg time on page is only ${duration} — people click but leave immediately. Fix the opening: first paragraph must answer the query directly, no intro fluff`);
      }

      const umamiNote = umami
        ? ` Umami: ${umami.pageviews} real pageviews this week${duration ? `, avg time ${duration}` : ""}${lowEngagement ? " — visitors leave fast, content doesn't match expectations" : ""}.`
        : "";

      const expectedCtr = keywords[0].position <= 3 ? "8–15" : keywords[0].position <= 5 ? "4–8" : "2–4";
      actionItems.push({
        type: "low-ctr",
        priority: keywords[0].impressions >= 200 ? "high" : "medium",
        taskTitle: `Improve CTR on \`${page}\` (${keywords[0].impressions} impressions, ${keywords[0].ctr}% CTR)`,
        page,
        why: `Position ${keywords[0].position}, ${keywords[0].impressions} impressions/week but only ${keywords[0].ctr}% CTR. Expected for this position: ~${expectedCtr}%. Better title/description = more clicks without touching rankings.${umamiNote}`,
        keywords: keywords.map(k => k.query),
        steps,
      });
    }

    results.actionItems = actionItems;

    console.log(`  Action items: ${actionItems.length}`);

    // 9. Format top pages
    results.topPages = thisWeekPages.map((row) => ({
      page: row.keys[0],
      clicks: row.clicks,
      impressions: row.impressions,
      position: round(row.position, 1),
      ctr: round(row.ctr * 100, 1),
    }));

    // 9. Generate Markdown report
    const mdReport = generateMarkdownReport(
      dates,
      summary,
      categories,
      results.topPages,
      actionItems,
      keywordPageMap,
      umamiStats,
      referrers,
      countries
    );
    writeFileSync(REPORT_PATH, mdReport);
    console.log(`\nMarkdown report written to ${REPORT_PATH}`);

    // Emit outputs for GitHub Actions
    console.log(`::set-output name=total_keywords::${summary.totalKeywords}`);
    console.log(`::set-output name=total_clicks::${summary.totalClicks}`);
    console.log(`::set-output name=clicks_delta::${summary.clicksDelta}`);
    console.log(
      `::set-output name=total_impressions::${summary.totalImpressions}`
    );
    console.log(
      `::set-output name=impressions_delta::${summary.impressionsDelta}`
    );
    console.log(`::set-output name=avg_position::${summary.avgPosition}`);
    console.log(`::set-output name=avg_ctr::${summary.avgCtr}`);
    console.log(`::set-output name=rising_count::${categories.rising.length}`);
    console.log(
      `::set-output name=declining_count::${categories.declining.length}`
    );
    console.log(
      `::set-output name=strike_distance_count::${categories.strikeDistance.length}`
    );
    console.log(
      `::set-output name=new_keywords_count::${categories.newKeywords.length}`
    );
    console.log(
      `::set-output name=action_items_count::${actionItems.length}`
    );
    const topKeyword = categories.topByClicks[0];
    if (topKeyword) {
      console.log(`::set-output name=top_keyword::${topKeyword.query}`);
      console.log(
        `::set-output name=top_keyword_position::${topKeyword.position}`
      );
      console.log(
        `::set-output name=top_keyword_clicks::${topKeyword.clicks}`
      );
    }
  } catch (err) {
    console.error(`Fatal error: ${err.message}`);
    results.error = err.message;
  }

  // Write results JSON
  writeFileSync(RESULTS_PATH, JSON.stringify(results, null, 2));
  console.log(`Results written to ${RESULTS_PATH}`);

  if (results.error) {
    process.exit(1);
  }
}

main();
