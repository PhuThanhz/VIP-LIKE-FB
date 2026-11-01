#!/usr/bin/env bash
# ============================================================
# VIPLIKE RADIANT - DỪNG TOÀN BỘ TIẾN TRÌNH HỆ THỐNG
# ============================================================

echo "🛑 Đang kiểm tra và dừng các tiến trình VIPLIKE RADIANT..."

# 1. Dừng Backend port 3100
PID_BACKEND=$(lsof -tiTCP:3100 -sTCP:LISTEN 2>/dev/null)
if [ -n "$PID_BACKEND" ]; then
    kill -9 $PID_BACKEND 2>/dev/null || true
    echo "✅ Đã dừng Backend (PID: $PID_BACKEND, Port: 3100)"
else
    echo "ℹ️ Backend (Port 3100) không chạy."
fi

# 2. Dừng Frontend port 5188
PID_FRONTEND=$(lsof -tiTCP:5188 -sTCP:LISTEN 2>/dev/null)
if [ -n "$PID_FRONTEND" ]; then
    kill -9 $PID_FRONTEND 2>/dev/null || true
    echo "✅ Đã dừng Frontend (PID: $PID_FRONTEND, Port: 5188)"
else
    echo "ℹ️ Frontend (Port 5188) không chạy."
fi

echo "🎉 Toàn bộ hệ thống VIPLIKE RADIANT đã được dừng an toàn."
