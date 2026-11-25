#!/usr/bin/env bash
# ============================================================
# VIPLIKE RADIANT - STOP EVERY SYSTEM PROCESS
# ============================================================

echo "🛑 Checking and stopping VIPLIKE RADIANT processes..."

# 1. Stop the Backend on port 3100
PID_BACKEND=$(lsof -tiTCP:3100 -sTCP:LISTEN 2>/dev/null)
if [ -n "$PID_BACKEND" ]; then
    kill -9 $PID_BACKEND 2>/dev/null || true
    echo "✅ Stopped the Backend (PID: $PID_BACKEND, Port: 3100)"
else
    echo "ℹ️ Backend (Port 3100) is not running."
fi

# 2. Stop the Frontend on port 5188
PID_FRONTEND=$(lsof -tiTCP:5188 -sTCP:LISTEN 2>/dev/null)
if [ -n "$PID_FRONTEND" ]; then
    kill -9 $PID_FRONTEND 2>/dev/null || true
    echo "✅ Stopped the Frontend (PID: $PID_FRONTEND, Port: 5188)"
else
    echo "ℹ️ Frontend (Port 5188) is not running."
fi

echo "🎉 The whole VIPLIKE RADIANT system was stopped safely."
