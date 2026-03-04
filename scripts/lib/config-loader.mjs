/**
 * Config Loader
 *
 * Reads config.yml from the client repo root (process.cwd()).
 * Falls back to environment variables for CI usage.
 *
 * Expected config.yml shape (see config.schema.yml for full docs):
 *   site_name: "VAMI Blog"
 *   site_url: "https://blog.vami.agency"
 *   cta_url: "https://vami.agency/#contact-form"
 *   niche: "AI recruitment"
 */

import { readFile } from 'fs/promises';
import { join } from 'path';
import { parse } from 'yaml';

let _config = null;

/**
 * Load and return the client config (cached after first call).
 * @returns {Promise<object>}
 */
export async function loadConfig() {
  if (_config) return _config;

  const configPath = join(process.cwd(), 'config.yml');

  let raw = {};
  try {
    const content = await readFile(configPath, 'utf-8');
    raw = parse(content) || {};
  } catch {
    // config.yml is optional when env vars are provided
  }

  _config = {
    site_name:       raw.site_name       || process.env.SITE_NAME       || 'LeadHunter Blog',
    site_url:        raw.site_url        || process.env.SITE_URL        || 'https://lhunter.cc',
    cta_url:         raw.cta_url         || process.env.CTA_URL         || 'https://app.lhunter.cc',
    niche:           raw.niche           || process.env.NICHE           || 'LinkedIn automation',
    git_user_name:   raw.git_user_name   || process.env.GIT_USER_NAME   || 'LeadHunter Bot',
    git_user_email:  raw.git_user_email  || process.env.GIT_USER_EMAIL  || 'bot@lhunter.cc',
    gsc_site_url:    raw.gsc_site_url    || process.env.GSC_SITE_URL    || null,
    brand_terms:     raw.brand_terms     || (process.env.BRAND_TERMS ? process.env.BRAND_TERMS.split(',').map(s => s.trim()) : []),
    telegram_site_label: raw.telegram_site_label || process.env.TELEGRAM_SITE_LABEL || null,
    og_image_style:  raw.og_image_style  || process.env.OG_IMAGE_STYLE  || 'default',
    content_plan_path: raw.content_plan_path !== undefined ? raw.content_plan_path : 'CONTENT_PLAN.md',
  };

  // Derived: GSC site property defaults to sc-domain:<hostname>
  if (!_config.gsc_site_url) {
    try {
      const hostname = new URL(_config.site_url).hostname;
      _config.gsc_site_url = `sc-domain:${hostname}`;
    } catch {
      _config.gsc_site_url = `sc-domain:lhunter.cc`;
    }
  }

  // Derived: Telegram label defaults to site_name
  if (!_config.telegram_site_label) {
    _config.telegram_site_label = _config.site_name;
  }

  return _config;
}

/**
 * Synchronous getter — only works after loadConfig() has been awaited once.
 * @returns {object}
 */
export function getConfig() {
  if (!_config) throw new Error('Config not loaded yet. Call await loadConfig() first.');
  return _config;
}
