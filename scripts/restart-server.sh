#!/bin/bash

echo "🛑 Stopping all server processes..."

# Kill all tsx and node server processes
pkill -9 -f "tsx server" 2>/dev/null
pkill -9 -f "node.*server/index" 2>/dev/null

# Wait for processes to fully terminate
sleep 2

# Double-check and kill any remaining processes on port 5000
if command -v lsof >/dev/null 2>&1; then
  PORT_PID=$(lsof -ti:5000 2>/dev/null)
  if [ ! -z "$PORT_PID" ]; then
    echo "Found process $PORT_PID on port 5000, killing..."
    kill -9 $PORT_PID 2>/dev/null
    sleep 1
  fi
fi

# Verify port is free
if timeout 2 curl -s http://localhost:5000 >/dev/null 2>&1; then
  echo "❌ ERROR: Port 5000 is still in use!"
  echo "Please manually kill the process using the port"
  exit 1
fi

echo "✅ Port 5000 is free"
echo ""
echo "🚀 Starting development server..."

# Start the server
npm run dev
