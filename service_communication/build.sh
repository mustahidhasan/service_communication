#!/bin/bash
# Usage: ./build.sh dev OR ./build.sh prod

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

COMPOSE_BIN=(docker-compose)
if ! command -v "${COMPOSE_BIN[0]}" >/dev/null 2>&1; then
  if docker compose version >/dev/null 2>&1; then
    COMPOSE_BIN=(docker compose)
  else
    echo "Neither docker-compose nor docker compose is available. Please install Docker Compose."
    exit 1
  fi
fi

ENV=${1:-dev}

if [ "$ENV" = "prod" ]; then
  echo "Building Production Environment..."
  ENV_FILE_BE=".env.prod.be"
  ENV_FILE_FE=".env.prod.fe"
  HOST_IP="18.212.236.236"
  COMPOSE_FILE="docker-compose.prod.yml"
  CERT_TARGET_DIR="$(cd "$SCRIPT_DIR/.." && pwd)/certs"
  CERT_TARGET_CRT="$CERT_TARGET_DIR/server.crt"
  CERT_TARGET_KEY="$CERT_TARGET_DIR/server.key"

  mkdir -p "$CERT_TARGET_DIR"
  if [ ! -f "$CERT_TARGET_CRT" ] || [ ! -f "$CERT_TARGET_KEY" ]; then
    echo "Generating self-signed SSL certificates in $CERT_TARGET_DIR..."
    openssl req -x509 -nodes -days 365 \
      -newkey rsa:2048 \
      -keyout "$CERT_TARGET_KEY" \
      -out "$CERT_TARGET_CRT" \
      -subj "/CN=$HOST_IP"
  else
    echo "Reusing existing certificates in $CERT_TARGET_DIR"
  fi

  if [ -w /etc/ssl ]; then
    echo "Copying certificates into /etc/ssl for host-level usage..."
    sudo cp "$CERT_TARGET_CRT" /etc/ssl/server.crt
    sudo cp "$CERT_TARGET_KEY" /etc/ssl/server.key
  else
    echo "Warning: unable to write to /etc/ssl; ensure nginx host has access to $CERT_TARGET_DIR"
  fi
else
  echo "Building Development Environment..."
  ENV_FILE_BE=".env.dev.be"
  ENV_FILE_FE=".env.dev.fe"
  HOST_IP="localhost"
  COMPOSE_FILE="docker-compose.dev.yml"
fi

for required_file in "$ENV_FILE_BE" "./frontend/$ENV_FILE_FE" "$COMPOSE_FILE"; do
  if [ ! -f "$required_file" ]; then
    echo "Required file '$required_file' not found."
    exit 1
  fi
done

export HOST_IP

echo "Building backend container with $ENV_FILE_BE..."
"${COMPOSE_BIN[@]}" -f "$COMPOSE_FILE" build backend \
  --build-arg ENV_FILE="$ENV_FILE_BE"

echo "Building frontend container with $ENV_FILE_FE..."
"${COMPOSE_BIN[@]}" -f "$COMPOSE_FILE" build frontend \
  --build-arg ENV_FILE="$ENV_FILE_FE"

# Reset the schema, run migrations from scratch, and create the default admin user.
echo "Resetting database schema and bootstrapping admin credentials..."
"${COMPOSE_BIN[@]}" -f "$COMPOSE_FILE" run --rm backend python manage.py reset_and_bootstrap

echo "Starting all containers..."
"${COMPOSE_BIN[@]}" -f "$COMPOSE_FILE" up -d

echo "$ENV environment is up!"
