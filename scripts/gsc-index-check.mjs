#!/usr/bin/env node

/**
 * GSC Index Check — Parse sitemap, inspect index status, submit unindexed + stale pages
 *
 * Flow:
 * 1. Parse public/sitemap.xml for all URLs + lastmod dates
 * 2. Call GSC URL Inspection API for each URL
 * 3. Collect pages that need submission:
 *    a) Not indexed (verdict !== PASS)
 *    b) Stale — indexed but lastmod > lastCrawlTime (content updated since last crawl)
 * 4. Submit via Indexing API urlNotifications:publish with URL_UPDATED
 * 5. Write results to /tmp/gsc-index-results.json
 *
 * Auth: GSC_CREDENTIALS_JSON env var (service account key JSON string)
 * Rate limits: 200ms between inspections, 5s between submissions, max 50 submissions/run
 * Retry: 3 attempts with exponential backoff (1s, 2s, 4s) for transient errors
 */

import { google } from "googleapis";
import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { loadConfig } from "./lib/config-loader.mjs";

const config = await loadConfig();
const SITE_URL = config.gsc_site_url;
const SITEMAP_PATH = resolve("public/sitemap.xml");
const RESULTS_PATH = "/tmp/gsc-index-results.json";
const INSPECTION_DELAY_MS = 200;
const SUBMISSION_DELAY_MS = 5000;
const MAX_SUBMISSIONS = 50;
const MAX_RETRIES = 3;
const RETRY_BASE_MS = 1000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

/**
 * Parse sitemap.xml and return array of { url, lastmod }
 */
function parseSitemap(xml) {
  const entries = [];
  const urlBlockRegex = /<url>([\s\S]*?)<\/url>/g;
  const locRegex = /<loc>(.*?)<\/loc>/;
  const lastmodRegex = /<lastmod>(.*?)<\/lastmod>/;

  let match;
  while ((match = urlBlockRegex.exec(xml)) !== null) {
    const block = match[1];
    const locMatch = block.match(locRegex);
    const lastmodMatch = block.match(lastmodRegex);

    if (locMatch) {
      entries.push({
        url: locMatch[1],
        lastmod: lastmodMatch ? lastmodMatch[1] : null,
      });
    }
  }
  return entries;
}

function getAuthClient() {
  const credentialsJson = process.env.GSC_CREDENTIALS_JSON;
  if (!credentialsJson) {
    throw new Error("GSC_CREDENTIALS_JSON environment variable is not set");
  }

  const credentials = JSON.parse(credentialsJson);

  return new google.auth.GoogleAuth({
    credentials,
    scopes: [
      "https://www.googleapis.com/auth/webmasters.readonly",
      "https://www.googleapis.com/auth/indexing",
    ],
  });
}

async function inspectUrl(auth, url) {
  const searchconsole = google.searchconsole({ version: "v1", auth });

  const res = await withRetry(
    () =>
      searchconsole.urlInspection.index.inspect({
        requestBody: {
          inspectionUrl: url,
          siteUrl: SITE_URL,
        },
      }),
    `inspect ${new URL(url).pathname}`
  );

  const result = res.data.inspectionResult?.indexStatusResult;
  const verdict = result?.verdict || "VERDICT_UNSPECIFIED";
  const coverageState = result?.coverageState || "";
  const lastCrawlTime = result?.lastCrawlTime || null;

  return {
    url,
    verdict,
    coverageState,
    lastCrawlTime,
    isIndexed: verdict === "PASS",
  };
}

async function submitUrl(auth, url) {
  const indexing = google.indexing({ version: "v3", auth });

  await withRetry(
    () =>
      indexing.urlNotifications.publish({
        requestBody: {
          url,
          type: "URL_UPDATED",
        },
      }),
    `submit ${new URL(url).pathname}`
  );
}

/**
 * Check if a page is stale — indexed, but sitemap lastmod is newer than last crawl
 */
function isStale(lastmod, lastCrawlTime) {
  if (!lastmod || !lastCrawlTime) return false;

  const modDate = new Date(lastmod);
  const crawlDate = new Date(lastCrawlTime);

  if (isNaN(modDate.getTime()) || isNaN(crawlDate.getTime())) return false;

  return modDate > crawlDate;
}

async function main() {
  const results = {
    total: 0,
    indexed: 0,
    submitted: 0,
    staleResubmitted: 0,
    notIndexed: 0,
    errors: 0,
    submittedPages: [],
    stalePages: [],
    notIndexedPages: [],
    errorPages: [],
    error: null,
  };

  try {
    // 1. Parse sitemap
    const sitemapXml = readFileSync(SITEMAP_PATH, "utf-8");
    const entries = parseSitemap(sitemapXml);
    results.total = entries.length;

    console.log(`Found ${entries.length} URLs in sitemap`);

    // 2. Authenticate
    const auth = getAuthClient();

    // 3. Inspect each URL
    const toSubmit = []; // { url, reason: "not_indexed" | "stale" }

    for (let i = 0; i < entries.length; i++) {
      const { url, lastmod } = entries[i];
      const path = new URL(url).pathname;
      console.log(`[${i + 1}/${entries.length}] Inspecting ${path}`);

      try {
        const inspection = await inspectUrl(auth, url);

        if (inspection.isIndexed) {
          // Check if content is stale (updated since last crawl)
          if (isStale(lastmod, inspection.lastCrawlTime)) {
            console.log(
              `  → Stale: lastmod ${lastmod} > crawled ${inspection.lastCrawlTime}`
            );
            toSubmit.push({ url, reason: "stale" });
          } else {
            results.indexed++;
          }
        } else {
          console.log(
            `  → Not indexed: ${inspection.verdict} (${inspection.coverageState})`
          );
          toSubmit.push({ url, reason: "not_indexed" });
        }
      } catch (err) {
        console.error(`  ✗ Inspection failed: ${err.message}`);
        results.errors++;
        results.errorPages.push({ path, phase: "inspect", error: err.message });
      }

      if (i < entries.length - 1) {
        await sleep(INSPECTION_DELAY_MS);
      }
    }

    const unindexedCount = toSubmit.filter(
      (e) => e.reason === "not_indexed"
    ).length;
    const staleCount = toSubmit.filter((e) => e.reason === "stale").length;
    console.log(
      `\nInspection complete: ${results.indexed} indexed, ${unindexedCount} not indexed, ${staleCount} stale, ${results.errors} errors`
    );

    // 4. Submit pages — unindexed first, then stale (up to MAX_SUBMISSIONS)
    const prioritized = [
      ...toSubmit.filter((e) => e.reason === "not_indexed"),
      ...toSubmit.filter((e) => e.reason === "stale"),
    ];
    const batch = prioritized.slice(0, MAX_SUBMISSIONS);
    const overflow = prioritized.slice(MAX_SUBMISSIONS);

    for (let i = 0; i < batch.length; i++) {
      const { url, reason } = batch[i];
      const path = new URL(url).pathname;
      const label = reason === "stale" ? "stale" : "new";
      console.log(`[${i + 1}/${batch.length}] Submitting ${path} (${label})`);

      try {
        await submitUrl(auth, url);

        if (reason === "stale") {
          results.staleResubmitted++;
          results.stalePages.push(path);
        } else {
          results.submitted++;
          results.submittedPages.push(path);
        }
        console.log(`  → Submitted`);
      } catch (err) {
        console.error(`  ✗ Submission failed: ${err.message}`);
        results.errors++;
        results.errorPages.push({ path, phase: "submit", error: err.message });
      }

      if (i < batch.length - 1) {
        await sleep(SUBMISSION_DELAY_MS);
      }
    }

    // Overflow pages go to notIndexed
    for (const { url } of overflow) {
      const path = new URL(url).pathname;
      results.notIndexed++;
      results.notIndexedPages.push(path);
    }

    console.log(
      `\nDone: ${results.submitted} new submitted, ${results.staleResubmitted} stale resubmitted, ${results.notIndexed} overflow, ${results.errors} errors`
    );
  } catch (err) {
    console.error(`Fatal error: ${err.message}`);
    results.error = err.message;
  }

  // 5. Write results
  writeFileSync(RESULTS_PATH, JSON.stringify(results, null, 2));
  console.log(`Results written to ${RESULTS_PATH}`);
}

main();
