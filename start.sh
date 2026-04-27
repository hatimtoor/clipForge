#!/bin/bash
ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"

echo "Starting ClipForge..."

if ! pgrep -x "ollama" > /dev/null; then
  echo "Starting Ollama..."
  ollama serve &>/dev/null &
  sleep 3
fi

echo "Starting backend on http://0.0.0.0:8000"
cd "$BACKEND_DIR"
python3 -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload
