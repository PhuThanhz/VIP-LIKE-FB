#!/usr/bin/env bash
# ============================================================
# VIPLIKE RADIANT - KHỞI ĐỘNG HỆ THỐNG BUFF TƯƠNG TÁC CHUYÊN NGHIỆP
# ============================================================

set -e

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd "$DIR"

# Đảm bảo PATH có /opt/homebrew/bin và /usr/local/bin cho macOS
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

echo "=================================================="
echo "   ✨ VIPLIKE RADIANT - BỘ PHẦN MỀM BUFF FACEBOOK   "
echo "=================================================="

# Kiểm tra Node.js
if ! command -v node >/dev/null 2>&1; then
    echo "❌ Không tìm thấy Node.js! Vui lòng cài đặt Node.js v18 trở lên."
    exit 1
fi

echo "📦 Đang kiểm tra thư viện dependencies..."
if [ ! -d "node_modules" ] || [ ! -d "backend/node_modules" ] || [ ! -d "frontend/node_modules" ]; then
    echo "⏳ Đang cài đặt thư viện cần thiết lần đầu..."
    npm run setup
fi

echo "🚀 Đang khởi chạy VIPLIKE RADIANT (Backend :3100 & Frontend :5174)..."

# Mở trình duyệt sau 3 giây
(sleep 3 && open "http://localhost:5174" 2>/dev/null || xdg-open "http://localhost:5174" 2>/dev/null || true) &

npm run dev
