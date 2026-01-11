#!/usr/bin/env node

/**
 * Quoth CLI
 * Simple CLI for authenticating Quoth MCP server
 *
 * Commands:
 *   quoth login   - Authenticate and configure Claude Code
 *   quoth logout  - Remove authentication
 *   quoth status  - Show current configuration
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const readline = require('readline');

const QUOTH_URL = 'https://quoth.ai-innovation.site';
const PUBLIC_MCP_URL = `${QUOTH_URL}/api/mcp/public`;
const PRIVATE_MCP_URL = `${QUOTH_URL}/api/mcp`;
const AUTH_URL = `${QUOTH_URL}/auth/cli`;

// ANSI colors
const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  violet: '\x1b[35m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
};

function log(message) {
  console.log(message);
}

function logSuccess(message) {
  console.log(`${colors.green}✓${colors.reset} ${message}`);
}

function logError(message) {
  console.error(`${colors.red}✗${colors.reset} ${message}`);
}

function logInfo(message) {
  console.log(`${colors.cyan}ℹ${colors.reset} ${message}`);
}

function logHeader() {
  console.log(`
${colors.violet}${colors.bold}    ╔═══════════════════════════════════════╗
    ║           QUOTH MCP                   ║
    ║   The Living Source of Truth          ║
    ╚═══════════════════════════════════════╝${colors.reset}
`);
}

// Get Claude Code config path
function getClaudeConfigPath() {
  const home = process.env.HOME || process.env.USERPROFILE;

  // Check multiple possible locations
  const locations = [
    path.join(home, '.claude', 'config.json'),
    path.join(home, '.config', 'claude', 'config.json'),
  ];

  for (const loc of locations) {
    if (fs.existsSync(loc)) {
      return loc;
    }
  }

  // Default to .claude
  return path.join(home, '.claude', 'config.json');
}

// Read Claude Code config
function readConfig() {
  const configPath = getClaudeConfigPath();

  if (!fs.existsSync(configPath)) {
    return { mcpServers: {} };
  }

  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch {
    return { mcpServers: {} };
  }
}

// Write Claude Code config
function writeConfig(config) {
  const configPath = getClaudeConfigPath();
  const configDir = path.dirname(configPath);

  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

// Open URL in browser
function openBrowser(url) {
  const platform = process.platform;

  try {
    if (platform === 'darwin') {
      execSync(`open "${url}"`);
    } else if (platform === 'win32') {
      execSync(`start "" "${url}"`);
    } else {
      // Linux
      execSync(`xdg-open "${url}" 2>/dev/null || sensible-browser "${url}" 2>/dev/null || x-www-browser "${url}"`);
    }
    return true;
  } catch {
    return false;
  }
}

// Prompt for input
function prompt(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// Login command
async function login() {
  logHeader();
  log('Authenticating with Quoth...\n');

  // Open browser
  logInfo(`Opening browser to: ${colors.dim}${AUTH_URL}${colors.reset}`);
  const opened = openBrowser(AUTH_URL);

  if (!opened) {
    log(`\n${colors.yellow}Could not open browser automatically.${colors.reset}`);
    log(`Please open this URL manually:\n`);
    log(`  ${colors.cyan}${AUTH_URL}${colors.reset}\n`);
  }

  log('');
  log(`${colors.dim}1. Sign in or create an account${colors.reset}`);
  log(`${colors.dim}2. Click "Generate Token"${colors.reset}`);
  log(`${colors.dim}3. Copy the token and paste it below${colors.reset}`);
  log('');

  // Wait for token
  const token = await prompt(`${colors.violet}Paste your token here:${colors.reset} `);

  if (!token) {
    logError('No token provided. Authentication cancelled.');
    process.exit(1);
  }

  // Validate token format (basic check)
  if (!token.startsWith('eyJ')) {
    logError('Invalid token format. Tokens should start with "eyJ".');
    process.exit(1);
  }

  // Update config
  const config = readConfig();
  config.mcpServers = config.mcpServers || {};
  config.mcpServers.quoth = {
    type: 'http',
    url: PRIVATE_MCP_URL,
    headers: {
      Authorization: `Bearer ${token}`,
    },
  };

  writeConfig(config);

  log('');
  logSuccess('Authentication successful!');
  log('');
  log(`${colors.dim}Quoth MCP is now configured with your private project.${colors.reset}`);
  log(`${colors.dim}Restart Claude Code to apply changes.${colors.reset}`);
  log('');
  log(`Tools available:`);
  log(`  ${colors.violet}•${colors.reset} quoth_search_index - Semantic search`);
  log(`  ${colors.violet}•${colors.reset} quoth_read_doc - Read documents`);
  log(`  ${colors.violet}•${colors.reset} quoth_propose_update - Propose changes`);
  log('');
}

// Logout command
async function logout() {
  logHeader();

  const config = readConfig();

  if (!config.mcpServers?.quoth) {
    logInfo('Quoth is not configured. Nothing to remove.');
    return;
  }

  // Check if authenticated
  const hasAuth = config.mcpServers.quoth.headers?.Authorization;

  if (hasAuth) {
    // Remove authentication, keep public access
    config.mcpServers.quoth = {
      type: 'http',
      url: PUBLIC_MCP_URL,
    };
    writeConfig(config);
    logSuccess('Logged out. Switched to public demo mode.');
    log(`${colors.dim}You can still use search and read tools on the public knowledge base.${colors.reset}`);
  } else {
    // Fully remove
    delete config.mcpServers.quoth;
    writeConfig(config);
    logSuccess('Quoth MCP removed from configuration.');
  }

  log(`${colors.dim}Restart Claude Code to apply changes.${colors.reset}`);
}

// Status command
function status() {
  logHeader();

  const config = readConfig();
  const quothConfig = config.mcpServers?.quoth;

  if (!quothConfig) {
    log(`${colors.yellow}Status:${colors.reset} Not configured`);
    log('');
    log(`Run ${colors.cyan}quoth login${colors.reset} to authenticate, or`);
    log(`Run ${colors.cyan}claude mcp add quoth${colors.reset} for public demo access.`);
    return;
  }

  const isAuthenticated = !!quothConfig.headers?.Authorization;
  const url = quothConfig.url || 'unknown';

  log(`${colors.violet}Status:${colors.reset} ${isAuthenticated ? `${colors.green}Authenticated${colors.reset}` : `${colors.yellow}Public Demo${colors.reset}`}`);
  log(`${colors.violet}URL:${colors.reset} ${url}`);
  log('');

  if (isAuthenticated) {
    log(`${colors.green}✓${colors.reset} Full access to private projects`);
    log(`${colors.green}✓${colors.reset} Can propose documentation updates`);
  } else {
    log(`${colors.yellow}!${colors.reset} Read-only access to public demo`);
    log(`${colors.dim}Run ${colors.cyan}quoth login${colors.reset}${colors.dim} for full access${colors.reset}`);
  }
}

// Help command
function help() {
  logHeader();
  log(`${colors.bold}Usage:${colors.reset} quoth <command>`);
  log('');
  log(`${colors.bold}Commands:${colors.reset}`);
  log(`  ${colors.cyan}login${colors.reset}    Authenticate and configure Claude Code`);
  log(`  ${colors.cyan}logout${colors.reset}   Remove authentication (keeps public access)`);
  log(`  ${colors.cyan}status${colors.reset}   Show current configuration`);
  log(`  ${colors.cyan}help${colors.reset}     Show this help message`);
  log('');
  log(`${colors.bold}Quick Start:${colors.reset}`);
  log(`  ${colors.dim}# Install public demo (no auth required)${colors.reset}`);
  log(`  claude mcp add quoth`);
  log('');
  log(`  ${colors.dim}# Upgrade to private access${colors.reset}`);
  log(`  quoth login`);
  log('');
  log(`${colors.bold}Documentation:${colors.reset}`);
  log(`  ${colors.cyan}${QUOTH_URL}${colors.reset}`);
}

// Main
async function main() {
  const command = process.argv[2];

  switch (command) {
    case 'login':
      await login();
      break;
    case 'logout':
      await logout();
      break;
    case 'status':
      status();
      break;
    case 'help':
    case '--help':
    case '-h':
      help();
      break;
    case undefined:
      help();
      break;
    default:
      logError(`Unknown command: ${command}`);
      log(`Run ${colors.cyan}quoth help${colors.reset} for available commands.`);
      process.exit(1);
  }
}

main().catch((err) => {
  logError(err.message);
  process.exit(1);
});
