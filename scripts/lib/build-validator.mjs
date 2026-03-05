/**
 * Build Validator
 *
 * Runs `npm run build` and captures the result.
 * Used to verify that generated articles compile correctly
 * before committing and creating a PR.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const execAsync = promisify(exec);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = process.env.CLIENT_REPO_PATH || join(__dirname, '..', '..');

/**
 * Run `npm run build` and return the result.
 * @returns {Promise<{success: boolean, output: string}>}
 */
export async function validateBuild() {
  console.log('Running `npm run build` to verify compilation...\n');

  try {
    const { stdout, stderr } = await execAsync('npm run build', {
      cwd: ROOT_DIR,
      timeout: 5 * 60 * 1000, // 5 minute timeout
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer for build output
    });

    const output = [stdout, stderr].filter(Boolean).join('\n');
    return { success: true, output };
  } catch (error) {
    // exec rejects when the process exits with non-zero code
    const output = [error.stdout, error.stderr].filter(Boolean).join('\n');
    return { success: false, output };
  }
}
