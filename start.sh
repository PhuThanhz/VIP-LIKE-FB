#!/usr/bin/env bash
# ============================================================
# VIPLIKE RADIANT - START THE PROFESSIONAL ENGAGEMENT BUFF SYSTEM
# ============================================================

set -e

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd "$DIR"

# Make sure PATH includes /opt/homebrew/bin and /usr/local/bin on macOS
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

echo "=================================================="
echo "   ✨ VIPLIKE RADIANT - FACEBOOK BUFF SOFTWARE SUITE   "
echo "=================================================="

# Check Node.js
if ! command -v node >/dev/null 2>&1; then
    echo "❌ Node.js not found! Please install Node.js v18 or later."
    exit 1
fi

# 1. Start MySQL if it isn't running
if ! lsof -iTCP:3306 -sTCP:LISTEN -P -n >/dev/null 2>&1; then
    echo "🗄️ Starting MySQL..."
    brew services start mysql >/dev/null 2>&1 || true
    sleep 1
fi

echo "📦 Checking dependencies..."
if [ ! -d "node_modules" ] || [ ! -d "backend/node_modules" ] || [ ! -d "frontend/node_modules" ]; then
    echo "⏳ Installing the required dependencies for the first time..."
    npm run setup
fi

echo "🚀 Launching VIPLIKE RADIANT (Backend :3100 & Frontend :5188)..."

# Open the browser after 3 seconds
(sleep 3 && open "http://localhost:5188" 2>/dev/null || xdg-open "http://localhost:5188" 2>/dev/null || true) &

npm run dev
