#!/bin/bash
ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"

echo "Starting ClipForge..."
echo "Open http://localhost:8000 in your browser"
echo ""
echo "Press Ctrl+C to stop."

cd "$BACKEND_DIR"
python3 -m uvicorn main:app --host 0.0.0.0 --port 8000
