/**
 * Build Verifier
 *
 * Runs `npm run build` after article files are written to disk.
 * If the build fails, extracts the error, sends it to Claude API
 * for a fix, rewrites the file, and retries.
 *
 * Fits into the generation pipeline between file updates (Step 7)
 * and git workflow (Step 8).
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { readFile, writeFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { improveArticle, fixJSXStructure } from './article-generator.mjs';
import { runQualityChecks } from './quality-checker.mjs';

const execAsync = promisify(exec);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = process.env.CLIENT_REPO_PATH || join(__dirname, '..', '..');

const MAX_BUILD_FIX_ATTEMPTS = 3;

/**
 * Run `npm run build` and return result
 * @returns {Promise<{success: boolean, error: string|null}>}
 */
async function runBuild() {
  try {
    await execAsync('npm run build', {
      cwd: ROOT_DIR,
      maxBuffer: 10 * 1024 * 1024, // 10MB — build output can be large
      timeout: 5 * 60 * 1000,      // 5 minutes max
    });
    return { success: true, error: null };
  } catch (error) {
    // Extract useful error info from build output
    const output = (error.stdout || '') + '\n' + (error.stderr || '');
    const cleanError = extractBuildError(output);
    return { success: false, error: cleanError };
  }
}

/**
 * Extract the meaningful part of a build error
 * Strips noise and keeps only the actionable error message
 * @param {string} rawOutput
 * @returns {string}
 */
function extractBuildError(rawOutput) {
  const lines = rawOutput.split('\n');
  const errorLines = [];
  let capturing = false;

  for (const line of lines) {
    // Start capturing at TypeScript/Next.js error indicators
    if (
      line.includes('Type error:') ||
      line.includes('Error:') ||
      line.includes('SyntaxError') ||
      line.includes('Module not found') ||
      line.includes('Cannot find') ||
      line.includes("is not assignable") ||
      line.includes('Unexpected token') ||
      line.includes('Expected') ||
      line.match(/^\s*\d+\s*\|/) || // Source code lines with line numbers
      line.includes('./src/') ||
      capturing
    ) {
      capturing = true;
      errorLines.push(line);

      // Stop after we have enough context (50 lines max)
      if (errorLines.length >= 50) break;
    }
  }

  if (errorLines.length === 0) {
    // Fallback: return last 30 lines which usually contain the error
    return lines.slice(-30).join('\n');
  }

  return errorLines.join('\n');
}

/**
 * Verify build passes, auto-fix if it fails
 *
 * @param {string} slug - Article slug
 * @param {object} brief - Article brief (for improveArticle context)
 * @param {Array} [existingBlogPages] - Existing blog pages for link context
 * @returns {Promise<{success: boolean, attempts: number, errors: string[]}>}
 */
export async function verifyBuild(slug, brief, existingBlogPages = []) {
  const articlePath = join(ROOT_DIR, 'src', 'app', 'blog', slug, 'page.tsx');
  const errors = [];

  for (let attempt = 1; attempt <= MAX_BUILD_FIX_ATTEMPTS; attempt++) {
    console.log(`\n🔨 Build verification (attempt ${attempt}/${MAX_BUILD_FIX_ATTEMPTS})...`);

    const result = await runBuild();

    if (result.success) {
      console.log('✅ Build passed!');
      return { success: true, attempts: attempt, errors };
    }

    // Build failed
    console.log(`❌ Build failed (attempt ${attempt})`);
    console.log(`   Error:\n${result.error.split('\n').slice(0, 10).map(l => '   ' + l).join('\n')}`);
    errors.push(result.error);

    // Don't try to fix on last attempt
    if (attempt >= MAX_BUILD_FIX_ATTEMPTS) {
      console.log(`\n⛔ Build still failing after ${MAX_BUILD_FIX_ATTEMPTS} attempts.`);
      break;
    }

    // Read current article content
    const currentContent = await readFile(articlePath, 'utf-8');

    // Check if this is a JSX structural error (EOF = unmatched tags)
    // Use focused JSX fix instead of general improver — much more reliable
    const isJSXError = result.error.includes('<eof>') ||
      result.error.includes('Expected') ||
      result.error.includes('Parsing ecmascript');

    let fixedContent;

    if (isJSXError) {
      console.log(`\n🔧 JSX/EOF build error detected — running focused JSX structure fix (Sonnet)...`);

      // Run quality checker to get specific tag mismatch info
      const checkResults = runQualityChecks(currentContent, brief, slug);
      const jsxCheck = checkResults.find(r => r.name === 'Valid JSX' && !r.passed);
      const jsxIssues = jsxCheck
        ? [jsxCheck.message, `Build error: ${result.error.split('\n').slice(0, 5).join(' ')}`]
        : [`Build error: ${result.error.split('\n').slice(0, 5).join(' ')}`];

      fixedContent = await fixJSXStructure(currentContent, jsxIssues);
    } else {
      console.log(`\n🔧 Sending build error to Claude API for fix...`);

      const buildIssues = [
        `BUILD ERROR: The Next.js build (npm run build) is failing with the following error. Fix this TypeScript/JSX error in the article:`,
        `\`\`\``,
        result.error,
        `\`\`\``,
        `IMPORTANT: Fix ONLY the build error. Do not change article content, structure, or quality. Return the complete fixed page.tsx.`,
      ];

      fixedContent = await improveArticle(
        currentContent,
        brief,
        buildIssues,
        slug,
        existingBlogPages
      );
    }

    // Write fixed content
    await writeFile(articlePath, fixedContent, 'utf-8');
    console.log('   ✓ Fixed article written to disk, retrying build...');
  }

  return { success: false, attempts: MAX_BUILD_FIX_ATTEMPTS, errors };
}
