#!/usr/bin/env bash

# =============================================================================
# Golem KGS - End-to-End (E2E) Test Runner
# =============================================================================
# Orchestrates a 100% clean, containerized test environment:
# 1. Loads .env.e2e
# 2. Spins up isolated Postgres, RustFS, and Golem server via docker-compose.e2e.yml
# 3. Builds WASM component (golem build)
# 4. Deploys to test server (golem -E test deploy)
# 5. Executes automated E2E test suite (npm run test:e2e)
# 6. Cleans up all test containers, servers, and volumes on exit
# =============================================================================

set -euo pipefail

# ANSI color codes
BOLD="\033[1m"
GREEN="\033[0;32m"
BLUE="\033[0;34m"
YELLOW="\033[0;33m"
RED="\033[0;31m"
RESET="\033[0m"

log_info()  { echo -e "${BLUE}${BOLD}[INFO]${RESET} $*"; }
log_succ()  { echo -e "${GREEN}${BOLD}[SUCCESS]${RESET} $*"; }
log_warn()  { echo -e "${YELLOW}${BOLD}[WARNING]${RESET} $*"; }
log_err()   { echo -e "${RED}${BOLD}[ERROR]${RESET} $*"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

ENV_FILE=".env.e2e"
COMPOSE_FILE="docker-compose.e2e.yml"

# Check .env.e2e
if [ ! -f "$ENV_FILE" ]; then
  if [ -f ".env.e2e.example" ]; then
    log_warn "$ENV_FILE not found. Copying from .env.e2e.example..."
    cp .env.e2e.example "$ENV_FILE"
  else
    log_err "Neither $ENV_FILE nor .env.e2e.example found!"
    exit 1
  fi
fi

log_info "Loading test configuration from $ENV_FILE..."
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

# Define defaults
POSTGRES_PORT="${POSTGRES_PORT:-5432}"
S3_PORT="${S3_PORT:-9010}"
OLLAMA_PORT="${OLLAMA_PORT:-11434}"
GOLEM_TEST_ROUTER_PORT="${GOLEM_TEST_ROUTER_PORT:-9881}"
GOLEM_TEST_CUSTOM_PORT="${GOLEM_TEST_CUSTOM_PORT:-9006}"
GOLEM_API_URL="http://localhost:${GOLEM_TEST_CUSTOM_PORT}"
export GOLEM_API_URL

log_info "E2E Configuration:"
echo "  - Golem Version:   ${GOLEM_VERSION:-1.5.10}"
echo "  - Golem Router:    http://localhost:${GOLEM_TEST_ROUTER_PORT}"
echo "  - Golem HTTP API:  ${GOLEM_API_URL}"
echo "  - PostgreSQL:      ${POSTGRES_HOST:-postgres-e2e}:${POSTGRES_PORT} (${POSTGRES_DB:-golem_kg_e2e})"
echo "  - RustFS S3:       http://localhost:${S3_HOST_PORT:-9010}"
echo "  - Ollama Port:     ${OLLAMA_PORT}"

# Cleanup function on script exit
cleanup() {
  local exit_code=$?
  if [ $exit_code -ne 0 ]; then
    log_warn "Dumping Postgres error logs on failure..."
    docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" logs --tail 40 postgres-e2e || true
    log_warn "Dumping Golem server logs on failure..."
    docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" logs --tail 40 golem-server-e2e || true
  fi
  log_info "Tearing down E2E test environment..."
  docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" down -v >/dev/null 2>&1 || true
  if [ $exit_code -eq 0 ]; then
    log_succ "E2E Test Run Completed Successfully!"
  else
    log_err "E2E Test Run Failed (exit code: $exit_code)."
  fi
  exit $exit_code
}

trap cleanup EXIT INT TERM

# Step 1: Pre-flight checks
log_info "Checking Docker daemon..."
if ! docker info >/dev/null 2>&1; then
  log_err "Docker is not running. Please start Docker."
  exit 1
fi

log_info "Checking host Ollama connectivity on port $OLLAMA_PORT..."
if ! curl -sf "http://localhost:${OLLAMA_PORT}/api/tags" >/dev/null 2>&1; then
  log_warn "Host Ollama on port $OLLAMA_PORT not responding. Starting Ollama from docker-compose.yml..."
  docker compose up -d ollama ollama-setup
fi

log_info "Verifying Ollama embedding model '${EMBEDDING_MODEL:-nomic-embed-text}'..."
for i in {1..30}; do
  if curl -sf "http://localhost:${OLLAMA_PORT}/api/tags" 2>/dev/null | grep -q "${EMBEDDING_MODEL:-nomic-embed-text}"; then
    log_succ "Ollama embedding model '${EMBEDDING_MODEL:-nomic-embed-text}' is ready!"
    break
  fi
  if [ "$i" -eq 15 ]; then
    log_warn "Ensuring model '${EMBEDDING_MODEL:-nomic-embed-text}' is pulled in Ollama container..."
    docker exec golem-kg-ollama ollama pull "${EMBEDDING_MODEL:-nomic-embed-text}" || true
  fi
  sleep 2
done

# Step 2: Spin up clean E2E container infrastructure
log_info "Starting clean E2E stack (PostgreSQL, RustFS, Fixtures, Golem Server)..."
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" down -v >/dev/null 2>&1 || true
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d --build --wait

log_info "Waiting for containerized Golem server on http://localhost:${GOLEM_TEST_ROUTER_PORT}/healthcheck..."
for i in {1..30}; do
  if curl -sf "http://localhost:${GOLEM_TEST_ROUTER_PORT}/healthcheck" >/dev/null 2>&1; then
    log_succ "Golem server container is healthy and ready!"
    break
  fi
  if [ "$i" -eq 30 ]; then
    log_err "Timeout waiting for Golem server container to become healthy."
    docker compose -f "$COMPOSE_FILE" logs golem-server-e2e
    exit 1
  fi
  sleep 1
done

# Step 3: Build WASM component
log_info "Building Golem WASM component (golem build)..."
golem build --yes

# Step 4: Deploy application to test environment
log_info "Deploying application to containerized Golem test server..."
# Deploy using the test environment defined in golem.yaml
golem -E test deploy

# Step 5: Wait for HTTP Gateway endpoints
log_info "Verifying HTTP Gateway readiness on $GOLEM_API_URL/api/knowledge/overview..."
for i in {1..20}; do
  if curl -sf "$GOLEM_API_URL/api/knowledge/overview" >/dev/null 2>&1; then
    log_succ "HTTP Gateway is responsive!"
    break
  fi
  if [ "$i" -eq 20 ]; then
    log_err "HTTP Gateway not responding at $GOLEM_API_URL/api/knowledge/overview."
    exit 1
  fi
  sleep 1
done

# Step 6: Execute test suite
log_info "Executing E2E test suite..."
npm run test:e2e

log_succ "All E2E test suites passed!"
