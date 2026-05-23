#!/usr/bin/env bash
# ╔══════════════════════════════════════════╗
# ║        KANet  —  Install (portable)      ║
# ║  Dependency check + module setup         ║
# ╚══════════════════════════════════════════╝
#
# This script prepares a fresh clone for running KANet.
# It is cross-platform (Linux / macOS / Windows Git Bash / WSL).
#
# Usage:
#   bash install.sh
#
# After install, start KANet:
#   bash kanet-start.sh          # (Windows only for now)
#   node kasia-console/src/index.js  # (Linux/macOS — temporary)

set -euo pipefail

C_RESET='\033[0m'; C_BOLD='\033[1m'; C_DIM='\033[2m'
C_GREEN='\033[32m'; C_YELLOW='\033[33m'; C_CYAN='\033[36m'; C_RED='\033[31m'

ok()   { echo -e "  ${C_GREEN}✓${C_RESET}  $*"; }
warn() { echo -e "  ${C_YELLOW}⚠${C_RESET}  $*"; }
err()  { echo -e "  ${C_RED}✗${C_RESET}  $*"; }
info() { echo -e "  ${C_CYAN}→${C_RESET}  $*"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo ""
echo -e "${C_BOLD}KANet — Install${C_RESET}"
echo ""

# ── 1. Dependency check ────────────────────────────────────────
info "Checking prerequisites..."

MISSING=0

if ! command -v node >/dev/null 2>&1; then
  err "Node.js not found. Install from https://nodejs.org/ (v20 or later)"
  MISSING=1
else
  NODE_VERSION=$(node -v | sed 's/v//')
  NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d. -f1)
  if [ "$NODE_MAJOR" -lt 20 ]; then
    warn "Node.js $NODE_VERSION detected — v20+ recommended"
  else
    ok "Node.js $NODE_VERSION"
  fi
fi

if ! command -v npm >/dev/null 2>&1; then
  err "npm not found (should come with Node.js)"
  MISSING=1
else
  ok "npm $(npm -v)"
fi

if ! command -v git >/dev/null 2>&1; then
  warn "git not found — needed for updates, not for running"
fi

if [ "$MISSING" -eq 1 ]; then
  echo ""
  err "Install prerequisites above and re-run ./install.sh"
  exit 1
fi

# ── 2. Module dependencies ─────────────────────────────────────
echo ""
info "Installing module dependencies (this may take a few minutes)..."

MODULES=(kasia-console kasia-relay kaspa-scout agent-mind agent-adapter)

for mod in "${MODULES[@]}"; do
  if [ ! -d "$mod" ]; then
    warn "$mod/ directory not found — skipping"
    continue
  fi
  if [ ! -f "$mod/package.json" ]; then
    warn "$mod/package.json not found — skipping"
    continue
  fi
  echo ""
  info "→ $mod"
  (cd "$mod" && npm install --silent 2>&1 | tail -5) || {
    err "npm install failed in $mod"
    exit 1
  }
  ok "$mod dependencies installed"
done

# ── 3. Env file scaffolding ────────────────────────────────────
echo ""
info "Preparing env files..."

for mod in kasia-console kaspa-scout; do
  EXAMPLE="$mod/.env.example"
  TARGET="$mod/.env"
  if [ -f "$EXAMPLE" ] && [ ! -f "$TARGET" ]; then
    cp "$EXAMPLE" "$TARGET"
    ok "Created $TARGET from example"
  elif [ -f "$TARGET" ]; then
    ok "$TARGET already exists (kept)"
  fi
done

# Generate root kanet.env if missing (encryption key)
if [ ! -f "kanet.env" ]; then
  KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
  cat > kanet.env <<EOF
# KANet root config — auto-generated on first install
# ⚠ KEEP THIS FILE PRIVATE — losing CONSOLE_ENCRYPTION_KEY means losing all encrypted data
CONSOLE_ENCRYPTION_KEY=$KEY
EOF
  ok "Generated kanet.env with new random CONSOLE_ENCRYPTION_KEY"
  warn "Back up kanet.env to a safe location!"
else
  ok "kanet.env already exists (kept)"
fi

# ── 4. Done ────────────────────────────────────────────────────
echo ""
echo -e "${C_BOLD}${C_GREEN}Install complete.${C_RESET}"
echo ""
echo "Next steps:"
echo ""
echo "  1. (Optional) Run a local Kaspa node, or configure a remote RPC in the Console UI"
echo "  2. Start KANet:"
echo -e "       ${C_CYAN}bash kanet-start.sh${C_RESET}   ${C_DIM}# Windows (Git Bash)${C_RESET}"
echo -e "       ${C_CYAN}node kasia-console/src/index.js${C_RESET}   ${C_DIM}# Linux / macOS (temporary)${C_RESET}"
echo "  3. Open http://localhost:3100"
echo "  4. Create your first Agent: Relays → New Relay Node"
echo "  5. Fund it with a few KAS (the address appears in the UI)"
echo "  6. Connect an AI provider: Adapters → Add Connection"
echo ""
echo "Docs: docs/DEVELOPER-GUIDE.md"
echo ""
