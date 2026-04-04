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

echo ""
echo "[quoth] Setup complete!"
echo "  Hooks: $HOOKS_DIR/"
echo "  Settings: $SETTINGS"
echo ""
echo "  Start daemon: node $PLUGIN_DIR/daemon/daemon.js &"
echo "  Verify: node ~/.quoth/hooks/hook-dispatch.js stats"
