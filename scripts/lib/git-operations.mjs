/**
 * Git Operations
 *
 * Handles git operations for the article generation workflow:
 * - Create branch
 * - Commit changes
 * - Push to remote
 * - Create Pull Request via gh CLI
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// When running as reusable engine, GH_WORKING_DIR points to the calling repo root.
// Fall back to process.cwd() for standalone/local use.
const WORKING_DIR = process.env.GH_WORKING_DIR || process.cwd();

/**
 * Execute git command
 * @param {string} command
 * @returns {Promise<string>}
 */
async function git(command) {
  try {
    const { stdout, stderr } = await execAsync(`git ${command}`, { cwd: WORKING_DIR });
    if (stderr && !stderr.includes('warning')) {
      console.warn('Git warning:', stderr);
    }
    return stdout.trim();
  } catch (error) {
    throw new Error(`Git command failed: git ${command}\n${error.message}`);
  }
}

/**
 * Get current branch name (internal use)
 * @returns {Promise<string>}
 */
async function getCurrentBranch() {
  return await git('branch --show-current');
}

/**
 * Get the default branch name (master or main)
 * @returns {Promise<string>}
 */
async function getDefaultBranch() {
  try {
    // Try to get from remote HEAD
    const remoteHead = await git('remote show origin').catch(() => '');
    const match = remoteHead.match(/HEAD branch:\s*(\S+)/);
    if (match) return match[1];
  } catch {
    // Fallback: check which branch exists
  }

  // Fallback: check if main or master exists
  try {
    await git('rev-parse --verify main');
    return 'main';
  } catch {
    return 'master';
  }
}

/**
 * Create a new branch for the article
 * @param {string} slug
 * @returns {Promise<string>} - Branch name
 */
export async function createBranch(slug) {
  const branchName = `article/${slug}`;
  const defaultBranch = await getDefaultBranch();

  // Check if on default branch
  const currentBranch = await getCurrentBranch();
  if (currentBranch !== defaultBranch) {
    console.log(`Switching from ${currentBranch} to ${defaultBranch}...`);
    await git(`checkout ${defaultBranch}`);
    await git(`pull origin ${defaultBranch}`);
  }

  // Delete local branch if it exists (from previous failed run)
  try {
    await git(`branch -D ${branchName}`);
    console.log(`Deleted existing local branch: ${branchName}`);
  } catch {
    // Branch doesn't exist locally, that's fine
  }

  // Delete remote branch if it exists (from previous failed run)
  try {
    await git(`push origin --delete ${branchName}`);
    console.log(`Deleted existing remote branch: ${branchName}`);
  } catch {
    // Branch doesn't exist on remote, that's fine
  }

  // Create and checkout new branch
  await git(`checkout -b ${branchName}`);
  console.log(`Created branch: ${branchName}`);

  return branchName;
}

/**
 * Stage and commit changes
 * @param {string} message
 * @param {string[]} files - Files to stage (or empty for all)
 */
export async function commit(message, files = []) {
  if (files.length > 0) {
    await git(`add ${files.join(' ')}`);
  } else {
    await git('add .');
  }

  // Check if there are changes to commit
  const status = await git('status --porcelain');
  if (!status) {
    console.log('No changes to commit');
    return false;
  }

  // Escape message for shell - use single quotes and escape any single quotes
  // This prevents $, backticks, and other shell metacharacters from being interpreted
  const escapedMessage = message.replace(/'/g, "'\\''");
  await git(`commit -m '${escapedMessage}'`);
  console.log(`Committed: ${message}`);
  return true;
}

/**
 * Push branch to origin
 * @param {string} branchName
 */
export async function push(branchName) {
  await git(`push -u origin ${branchName}`);
  console.log(`Pushed to origin/${branchName}`);
}

/**
 * Create Pull Request using gh CLI
 * @param {object} prData
 * @returns {Promise<string>} - PR URL
 */
export async function createPullRequest(prData) {
  const { title, body, baseBranch } = prData;
  const targetBranch = baseBranch || await getDefaultBranch();

  // Write body to temp file to preserve newlines and formatting
  const { writeFile, unlink } = await import('fs/promises');
  const { tmpdir } = await import('os');
  const { join } = await import('path');

  const tempBodyFile = join(tmpdir(), `pr-body-${Date.now()}.md`);

  try {
    await writeFile(tempBodyFile, body, 'utf-8');

    // Escape title for shell - use single quotes to prevent metacharacter interpretation
    const escapedTitle = title.replace(/'/g, "'\\''");

    const { stdout } = await execAsync(
      `gh pr create --title '${escapedTitle}' --body-file "${tempBodyFile}" --base ${targetBranch}`,
      { cwd: WORKING_DIR }
    );
    const prUrl = stdout.trim();
    console.log(`Created PR: ${prUrl}`);

    // Cleanup temp file
    await unlink(tempBodyFile).catch(() => {});

    return prUrl;
  } catch (error) {
    // Cleanup temp file on error
    await unlink(tempBodyFile).catch(() => {});

    // If gh CLI is not available or fails
    console.error('Could not create PR via gh CLI:', error.message);
    console.log('Please create PR manually.');
    return null;
  }
}

/**
 * Create branch before making file changes
 * @param {string} slug
 * @returns {Promise<string>} - Branch name
 */
export async function prepareGitBranch(slug) {
  console.log('Preparing git branch...');
  return await createBranch(slug);
}

/**
 * Complete git workflow after files are modified
 * @param {string} slug
 * @param {string} branchName
 * @param {object} brief
 * @param {object} qualityReport
 * @returns {Promise<{branchName: string, prUrl: string | null}>}
 */
export async function completeGitWorkflow(slug, branchName, brief, qualityReport) {
  console.log('\n=== Completing Git Workflow ===\n');

  // 2. Commit changes
  const commitMessage = `Add blog post: ${brief.title}

Generated article for topic #${brief.number}
- ${qualityReport.finalResults.checkSummary.passed}/${qualityReport.finalResults.checkSummary.total} quality checks passed
- Word count: ${qualityReport.finalResults.aiValidation.evaluation.wordCount}
- Key points covered: ${qualityReport.finalResults.aiValidation.evaluation.keyPointsCovered.length}/${brief.keyPoints.length}

Auto-generated by article-generator script`;

  await commit(commitMessage);

  // 3. Push to origin
  await push(branchName);

  // 4. Create PR
  const prBody = `## New Blog Article: ${brief.title}

### Summary
- **Topic**: #${brief.number}
- **Slug**: /blog/${slug}
- **Type**: ${brief.searchIntent}

### Quality Report
- Quality Checks: ${qualityReport.finalResults.checkSummary.passed}/${qualityReport.finalResults.checkSummary.total} passed
- Word Count: ${qualityReport.finalResults.aiValidation.evaluation.wordCount}
- Key Points: ${qualityReport.finalResults.aiValidation.evaluation.keyPointsCovered.length}/${brief.keyPoints.length} covered
- Internal Links: ${qualityReport.finalResults.aiValidation.evaluation.internalLinks.length}
- Iterations: ${qualityReport.iterations}

### Files Changed
- \`src/app/blog/${slug}/page.tsx\` (new)
- \`src/app/blog/page.tsx\` (updated index)
- \`public/llms.txt\` (updated)
- \`CONTENT_PLAN.md\` (status updated)

### Checklist
- [ ] Review article content for accuracy
- [ ] Check internal links work correctly
- [ ] Verify metadata and SEO settings
- [ ] Test responsive design
- [ ] Approve and merge`;

  const prUrl = await createPullRequest({
    title: `Add blog: ${brief.title}`,
    body: prBody
  });

  return { branchName, prUrl };
}
