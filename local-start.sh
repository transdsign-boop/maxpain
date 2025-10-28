#!/bin/bash

# MPI Liquidation Hunter - Local Docker Setup Script
# This script helps you get started running the bot locally

echo "================================================"
echo "MPI™ Liquidation Hunter - Local Setup"
echo "================================================"
echo ""

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed!"
    echo ""
    echo "Please install Docker Desktop first:"
    echo "https://www.docker.com/products/docker-desktop/"
    echo ""
    exit 1
fi

# Check if Docker is running
if ! docker info &> /dev/null; then
    echo "❌ Docker is not running!"
    echo ""
    echo "Please start Docker Desktop and try again."
    echo ""
    exit 1
fi

echo "✅ Docker is installed and running"
echo ""

# Check if .env file exists
if [ ! -f .env ]; then
    echo "⚠️  No .env file found!"
    echo ""
    echo "Creating .env from template..."
    cp .env.example .env
    echo ""
    echo "✅ Created .env file"
    echo ""
    echo "📝 IMPORTANT: You need to edit .env with your actual values:"
    echo "   - NEON_DATABASE_URL"
    echo "   - ASTER_API_KEY"
    echo "   - ASTER_SECRET_KEY"
    echo "   - SESSION_SECRET"
    echo ""
    echo "You can find these values in your Replit 'Secrets' tab."
    echo ""
    read -p "Press Enter after you've updated .env..."
    echo ""
fi

# Check if .env has been configured
if grep -q "your_aster_api_key_here" .env || grep -q "postgresql://user:password@host" .env; then
    echo "⚠️  Warning: .env file still contains placeholder values!"
    echo ""
    echo "Make sure to update your .env file with real values before continuing."
    echo ""
    read -p "Continue anyway? (y/N): " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

echo "🚀 Starting MPI Liquidation Hunter Bot..."
echo ""

# Build and start containers
docker-compose up -d --build

if [ $? -eq 0 ]; then
    echo ""
    echo "================================================"
    echo "✅ Bot is now running!"
    echo "================================================"
    echo ""
    echo "🌐 Dashboard: http://localhost:5000"
    echo ""
    echo "📊 View logs:"
    echo "   docker-compose logs -f"
    echo ""
    echo "🛑 Stop the bot:"
    echo "   docker-compose down"
    echo ""
    echo "📖 For more info, see LOCAL_SETUP.md"
    echo ""
else
    echo ""
    echo "❌ Failed to start the bot!"
    echo ""
    echo "Check the errors above and:"
    echo "  1. Make sure .env has correct values"
    echo "  2. Try: docker-compose logs"
    echo ""
    exit 1
fi
