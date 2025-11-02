#!/bin/bash
# Auto-restart wrapper for trading bot
# Automatically restarts the server if it crashes

echo "🔄 Auto-restart wrapper initialized"

while true; do
  echo ""
  echo "🚀 Starting trading bot server..."
  echo "   Time: $(date)"

  # Run the development server
  npm run dev
  EXIT_CODE=$?

  # Check if server stopped cleanly (exit code 0) or crashed
  if [ $EXIT_CODE -eq 0 ]; then
    echo "✅ Server stopped cleanly (exit code 0)"
    echo "   Not restarting."
    break
  else
    echo ""
    echo "💥 Server crashed with exit code $EXIT_CODE"
    echo "⏰ Waiting 5 seconds before restart..."
    sleep 5
    echo "🔄 Restarting now..."
  fi
done
