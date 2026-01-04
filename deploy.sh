#!/bin/bash
# Deployment script for mrdj-pokemon-mcp to VPS

set -e

VPS_USER="deployer"
VPS_HOST="DavidJGrimsley.com"
DEPLOY_PATH="/home/deployer/mrdj-pokemon-mcp"
APP_NAME="mrdj-pokemon-mcp"
PORT=4027

echo "=== Deploying mrdj-pokemon-mcp to VPS ==="

# Build locally
echo "Building application..."
npm run build

# Create deployment package
echo "Creating deployment package..."
tar \
  --exclude='resources/pokeapi-data/v2' \
  --exclude='resources/pokeapi-cache' \
  -czf deploy.tar.gz build/ guides/ scripts/ resources/ package.json package-lock.json

# Copy to VPS
echo "Copying files to VPS..."
scp deploy.tar.gz ${VPS_USER}@${VPS_HOST}:/tmp/

# Deploy on VPS
echo "Deploying on VPS..."
ssh ${VPS_USER}@${VPS_HOST} << EOF
  set -e
  
  # Create directory if it doesn't exist
  mkdir -p ${DEPLOY_PATH}
  cd ${DEPLOY_PATH}
  
  # Extract files
  tar -xzf /tmp/deploy.tar.gz
  rm /tmp/deploy.tar.gz
  
  # Install dependencies (production only)
  npm ci --production

  # Sync PokeAPI dataset locally on the VPS if missing
  if [ ! -f resources/pokeapi-data/v2/pokemon/index.json ]; then
    echo "PokeAPI data missing on VPS; running npm run sync..."
    npm run sync
  else
    echo "PokeAPI data already present; skipping sync."
  fi
  
  # Restart with PM2
  if pm2 describe ${APP_NAME} > /dev/null 2>&1; then
    echo "Restarting existing PM2 process..."
    pm2 restart ${APP_NAME}
  else
    echo "Starting new PM2 process..."
    pm2 start build/index.js --name ${APP_NAME} -- --http-port ${PORT}
    pm2 save
  fi
  
  # Show status
  pm2 info ${APP_NAME}
EOF

# Cleanup
rm deploy.tar.gz

echo "=== Deployment complete ==="
echo "Health check: https://DavidJGrimsley.com/mcp/mrdj-pokemon-mcp/health"
