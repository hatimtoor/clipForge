#!/bin/bash
set -e

echo "ClipForge Setup"

sudo apt-get update -qq
sudo apt-get install -y ffmpeg python3-pip nodejs npm curl

echo "Installing Python dependencies..."
pip3 install -r backend/requirements.txt
pip3 install yt-dlp

echo "Building frontend..."
cd frontend
npm install
npm run build
cd ..

echo "Setup complete! Run: bash start.sh"
