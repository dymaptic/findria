#!/bin/bash
# Azure App Service startup script for Findria

set -e

echo "=========================================="
echo "Findria Startup Script"
echo "=========================================="
echo "Node version: $(node --version)"
echo "NPM version: $(npm --version)"
echo "Working directory: $(pwd)"
echo "=========================================="

# Azure App Service sets PORT environment variable
export PORT="${PORT:-3000}"
export HOSTNAME="0.0.0.0"

echo "Starting server on port $PORT..."

# Start the Next.js standalone server
node server.js
