#!/bin/bash
set -e

echo "ClipForge Setup"

sudo apt-get update -qq
sudo apt-get install -y ffmpeg python3-pip nodejs npm curl

echo "Installing Ollama..."
curl -fsSL https://ollama.com/install.sh | sh

ollama serve &>/dev/null &
sleep 3

echo "Pulling llama3.1:8b model..."
ollama pull llama3.1:8b

echo "Installing Python dependencies..."
pip3 install -r backend/requirements.txt
pip3 install yt-dlp

echo "Building frontend..."
cd frontend
npm install
npm run build
cd ..

echo "Setup complete! Run: bash start.sh"
