#!/bin/bash
# install-local.sh
# Builds agents-kit and installs it globally on your machine.
# Run this once from the repo root after cloning.
#
# Usage: bash install-local.sh

set -e

TEAL='\033[0;36m'
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'
BOLD='\033[1m'

echo ""
echo -e "${TEAL}${BOLD}  agents-kit — local install${NC}"
echo ""

# Check Node version
NODE_MAJOR=$(node -e "process.stdout.write(process.versions.node.split('.')[0])")
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo -e "${RED}  ✗  Node.js 18+ required (found v$(node -v))${NC}"
  exit 1
fi
echo -e "${GREEN}  ✓${NC}  Node.js v$(node -v)"

# Install monorepo deps
echo -e "     Installing dependencies…"
npm install --workspaces --ignore-scripts 2>/dev/null | tail -1

# Build standalone package
echo -e "     Building agents-kit package…"
cd packages/agents-kit
npm run build 2>/dev/null
cd ../..

echo -e "${GREEN}  ✓${NC}  Build complete"

# Link globally
echo -e "     Linking globally…"
cd packages/agents-kit
npm link 2>/dev/null
cd ../..

echo -e "${GREEN}  ✓${NC}  Linked globally"
echo ""
echo -e "  ${BOLD}agents-kit is ready.${NC}"
echo ""
echo -e "  Start the server:   ${TEAL}agents-kit start${NC}"
echo -e "  Add to a repo:      ${TEAL}cd your-project && agents-kit init${NC}"
echo ""
