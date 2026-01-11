/**
 * GitHub Integration Module
 * Handles commits to GitHub for approved proposals
 */

import { Octokit } from 'octokit';

const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN
});

const GITHUB_OWNER = process.env.GITHUB_OWNER || 'Montinou';
const GITHUB_REPO = process.env.GITHUB_REPO || 'quoth-mcp';
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main';

export interface CommitResult {
  success: boolean;
  sha?: string;
  url?: string;
  error?: string;
}

/**
 * Commits a proposal's changes to GitHub
 * @param proposal - The proposal object from Supabase
 * @returns CommitResult with success status, SHA, and URL
 */
export async function commitProposalToGitHub(proposal: any): Promise<CommitResult> {
  try {
    // Path must include the knowledge base directory
    const filePath = `quoth-knowledge-base/${proposal.file_path}`;

    // Get current file SHA (required for updates, optional for new files)
    let currentSha: string | undefined;
    try {
      const { data: currentFile } = await octokit.rest.repos.getContent({
        owner: GITHUB_OWNER,
        repo: GITHUB_REPO,
        path: filePath,
        ref: GITHUB_BRANCH
      });

      if ('sha' in currentFile) {
        currentSha = currentFile.sha;
      }
    } catch (error: any) {
      // File doesn't exist (new file) - that's ok
      if (error.status !== 404) {
        throw error;
      }
    }

    // Extract file name for commit message
    const fileName = proposal.file_path.split('/').pop();
    const commitMessage = `[Quoth Auto-Fix] Update ${fileName}

${proposal.reasoning.substring(0, 200)}${proposal.reasoning.length > 200 ? '...' : ''}

Proposal ID: ${proposal.id}`;

    // Commit file (create or update)
    const { data: commit } = await octokit.rest.repos.createOrUpdateFileContents({
      owner: GITHUB_OWNER,
      repo: GITHUB_REPO,
      path: filePath,
      message: commitMessage,
      content: Buffer.from(proposal.proposed_content).toString('base64'),
      sha: currentSha, // Required for updates, undefined for new files
      branch: GITHUB_BRANCH
    });

    return {
      success: true,
      sha: commit.commit.sha,
      url: commit.commit.html_url
    };
  } catch (error) {
    console.error('GitHub commit failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Verifies that GitHub is properly configured
 * @returns boolean indicating if GitHub integration is ready
 */
export function isGitHubConfigured(): boolean {
  return !!(process.env.GITHUB_TOKEN && GITHUB_OWNER && GITHUB_REPO);
}

/**
 * Validates GitHub token has necessary permissions
 * @returns Promise<boolean> indicating if token is valid
 */
export async function validateGitHubToken(): Promise<boolean> {
  try {
    await octokit.rest.repos.get({
      owner: GITHUB_OWNER,
      repo: GITHUB_REPO
    });
    return true;
  } catch (error) {
    console.error('GitHub token validation failed:', error);
    return false;
  }
}
