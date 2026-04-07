#!/usr/bin/env bash
set -euo pipefail

# Quoth Setup — installs hooks + symlinks automatically
# Usage: bash quoth-plugin/scripts/setup.sh

QUOTH_HOME="${QUOTH_HOME:-$HOME/.quoth}"
HOOKS_DIR="$QUOTH_HOME/hooks"
SETTINGS="$HOME/.claude/settings.json"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
HOOKS_SRC="$PLUGIN_DIR/hooks"

echo "[quoth] Setting up from $PLUGIN_DIR"

# 1. Create ~/.quoth structure
mkdir -p "$HOOKS_DIR" "$QUOTH_HOME/intelligence" "$QUOTH_HOME/trajectories"

# 2. Symlink hook files
for f in hook-dispatch.js trajectory-capture.js; do
  src="$HOOKS_SRC/$f"
  dst="$HOOKS_DIR/$f"
  if [ ! -f "$src" ]; then
    echo "[quoth] WARN: $src not found, skipping"
    continue
  fi
  if [ -L "$dst" ] && [ "$(readlink -f "$dst")" = "$(readlink -f "$src")" ]; then
    echo "[quoth] $f already linked"
  else
    ln -sf "$src" "$dst"
    echo "[quoth] Linked $f"
  fi
done

# 3. Inject hooks into ~/.claude/settings.json
if [ ! -f "$SETTINGS" ]; then
  mkdir -p "$(dirname "$SETTINGS")"
  echo '{}' > "$SETTINGS"
  echo "[quoth] Created $SETTINGS"
fi

# Check if quoth hooks already present
if grep -q 'hook-dispatch.js' "$SETTINGS" 2>/dev/null; then
  echo "[quoth] Hooks already in settings.json — skipping injection"
else
  echo "[quoth] Injecting hooks into settings.json..."

  # Use node for reliable JSON manipulation
  node -e "
    const fs = require('fs');
    const settings = JSON.parse(fs.readFileSync('$SETTINGS', 'utf8'));

    if (!settings.hooks) settings.hooks = {};

    const quothHooks = {
      PreToolUse: [{
        matcher: 'Bash',
        hooks: [{
          type: 'command',
          command: \"sh -c 'exec node \\\"\\\$HOME/.quoth/hooks/hook-dispatch.js\\\" pre-bash'\",
          timeout: 5000
        }]
      }],
      PostToolUse: [
        {
          matcher: 'Write|Edit|MultiEdit',
          hooks: [{
            type: 'command',
            command: \"sh -c 'exec node \\\"\\\$HOME/.quoth/hooks/hook-dispatch.js\\\" post-edit'\",
            timeout: 10000
          }]
        },
        {
          matcher: 'Bash|Write|Edit|MultiEdit|Agent',
          hooks: [{
            type: 'command',
            command: \"sh -c 'exec node \\\"\\\$HOME/.quoth/hooks/trajectory-capture.js\\\"'\",
            timeout: 3000
          }]
        }
      ],
      UserPromptSubmit: [{
        hooks: [{
          type: 'command',
          command: \"sh -c 'exec node \\\"\\\$HOME/.quoth/hooks/hook-dispatch.js\\\" route'\",
          timeout: 10000
        }]
      }],
      SessionStart: [{
        hooks: [{
          type: 'command',
          command: \"sh -c 'exec node \\\"\\\$HOME/.quoth/hooks/hook-dispatch.js\\\" session-restore'\",
          timeout: 15000
        }]
      }],
      SessionEnd: [{
        hooks: [{
          type: 'command',
          command: \"sh -c 'exec node \\\"\\\$HOME/.quoth/hooks/hook-dispatch.js\\\" session-end'\",
          timeout: 10000
        }]
      }],
      PreCompact: [{
        hooks: [{
          type: 'command',
          command: \"sh -c 'exec node \\\"\\\$HOME/.quoth/hooks/hook-dispatch.js\\\" session-end'\",
          timeout: 6000
        }]
      }],
      SubagentStart: [{
        hooks: [{
          type: 'command',
          command: \"sh -c 'exec node \\\"\\\$HOME/.quoth/hooks/hook-dispatch.js\\\" subagent-start'\",
          timeout: 3000
        }]
      }],
      SubagentStop: [{
        hooks: [{
          type: 'command',
          command: \"sh -c 'exec node \\\"\\\$HOME/.quoth/hooks/hook-dispatch.js\\\" post-task'\",
          timeout: 5000
        }]
      }]
    };

    // Merge: append quoth hooks to existing arrays, don't overwrite
    for (const [event, entries] of Object.entries(quothHooks)) {
      if (!settings.hooks[event]) {
        settings.hooks[event] = entries;
      } else {
        // Check if quoth hook already exists in this event
        const existing = JSON.stringify(settings.hooks[event]);
        if (!existing.includes('hook-dispatch.js') && !existing.includes('trajectory-capture.js')) {
          settings.hooks[event] = settings.hooks[event].concat(entries);
        }
      }
    }

    fs.writeFileSync('$SETTINGS', JSON.stringify(settings, null, 2) + '\n');
    console.log('[quoth] Hooks injected successfully');
  "
fi

# 4. Add bash permission if missing
if ! grep -q 'Bash(node .quoth' "$SETTINGS" 2>/dev/null; then
  node -e "
    const fs = require('fs');
    const settings = JSON.parse(fs.readFileSync('$SETTINGS', 'utf8'));
    if (!settings.permissions) settings.permissions = {};
    if (!settings.permissions.allow) settings.permissions.allow = [];
    if (!settings.permissions.allow.includes('Bash(node .quoth/*)')) {
      settings.permissions.allow.push('Bash(node .quoth/*)');
      fs.writeFileSync('$SETTINGS', JSON.stringify(settings, null, 2) + '\n');
      console.log('[quoth] Added .quoth permission');
    }
  "
fi

# 5. Auto-detect daemon mode (local vs managed)
if command -v claude &>/dev/null; then
  QUOTH_MODE="local"
else
  QUOTH_MODE="managed"
fi

# 6. Write ~/.quoth/.env (only if it doesn't exist)
ENV_FILE="$QUOTH_HOME/.env"
if [ ! -f "$ENV_FILE" ]; then
  cat > "$ENV_FILE" << EOF
# Quoth daemon configuration
# local = uses your own LLM keys (AI_GATEWAY_API_KEY, claude CLI)
# managed = uses Quoth cloud pipeline (only needs QUOTH_API_KEY)
QUOTH_MODE=$QUOTH_MODE

# Required for managed mode (get your key at quoth.triqual.dev)
# QUOTH_API_KEY=qth_your_key_here

# Required for local mode
# AI_GATEWAY_API_KEY=vck_your_key_here
EOF
  echo "  ✓ Created $ENV_FILE (mode: $QUOTH_MODE)"
else
  echo "  ✓ $ENV_FILE already exists (skipped)"
fi

# 7. Auto-start daemon if not already running
DAEMON_SCRIPT="$SCRIPT_DIR/../daemon/daemon.js"
if [ -f "$QUOTH_HOME/daemon.pid" ] && kill -0 "$(cat "$QUOTH_HOME/daemon.pid" 2>/dev/null)" 2>/dev/null; then
  echo "  ✓ Daemon already running (PID $(cat "$QUOTH_HOME/daemon.pid"))"
else
  nohup node "$DAEMON_SCRIPT" > /dev/null 2>&1 &
  sleep 1
  if [ -f "$QUOTH_HOME/daemon.pid" ]; then
    echo "  ✓ Daemon started (PID $(cat "$QUOTH_HOME/daemon.pid"))"
  else
    echo "  ⚠ Daemon failed to start. Check ~/.quoth/daemon.log"
  fi
fi

# 8. Sync skills to skill-registry (if available)
SKILL_REGISTRY="$HOME/projects/skill-registry"
if [ -d "$SKILL_REGISTRY" ] && command -v bun &>/dev/null; then
  echo "[quoth] Syncing skills to skill-registry..."
  (cd "$SKILL_REGISTRY" && QUOTH_SKILLS_DIR="$PLUGIN_DIR/skills" bun run sync:quoth 2>&1) || echo "[quoth] WARN: skill-registry sync failed (non-blocking)"
else
  echo "[quoth] Skill-registry not found or bun not available — skipping skill sync"
  echo "  To sync manually: cd $SKILL_REGISTRY && QUOTH_SKILLS_DIR=$PLUGIN_DIR/skills bun run sync:quoth"
fi

echo ""
echo "[quoth] Setup complete!"
echo "  Hooks: $HOOKS_DIR/"
echo "  Settings: $SETTINGS"
echo "  Config: $ENV_FILE"
echo "  Skills: $PLUGIN_DIR/skills/ ($(ls -d $PLUGIN_DIR/skills/*/SKILL.md 2>/dev/null | wc -l) skills)"
echo ""
if [ "$QUOTH_MODE" = "managed" ]; then
  echo "  Quoth is configured in MANAGED mode (no local LLM keys needed)."
  echo "  Set your QUOTH_API_KEY in ~/.quoth/.env to enable cloud processing."
else
  echo "  Quoth is configured in LOCAL mode (claude CLI detected)."
  echo "  The daemon will use local LLM calls for pattern processing."
fi
echo ""
echo "  Verify: node ~/.quoth/hooks/hook-dispatch.js stats"
