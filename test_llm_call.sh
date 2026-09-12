#!/bin/bash

# ==============================================================================
# Script to test LLM connectivity (Ollama direct & Golem /ask endpoint)
# Usage:
#   ./test_llm_call.sh [question]
#   ./test_llm_call.sh --direct [question]    # Test only Ollama direct API
#   ./test_llm_call.sh --ask [question]       # Test only Golem /api/knowledge/ask
# ==============================================================================

set -e

# Load environment variables if .env exists
if [ -f .env ]; then
  # export non-commented lines from .env
  set -a
  source .env 2>/dev/null || true
  set +a
fi

# Configuration defaults
LLM_API_BASE="${LLM_API_BASE:-http://localhost:11434/v1}"
LLM_MODEL="${LLM_MODEL:-qwen2.5:1.5b}"
LLM_API_KEY="${LLM_API_KEY:-ollama}"
GOLEM_API_URL="${GOLEM_API_URL:-http://localhost:9006}"

MODE="all"
if [ "$1" = "--direct" ]; then
  MODE="direct"
  shift
elif [ "$1" = "--ask" ]; then
  MODE="ask"
  shift
fi

QUESTION="${1:-What is Golem Cloud and how does it achieve durable execution?}"

# Helper for JSON pretty-printing
format_json() {
  if command -v jq &>/dev/null; then
    jq .
  elif command -v python3 &>/dev/null; then
    python3 -m json.tool
  else
    cat
  fi
}

echo "================================================================="
echo " LLM & Ask Endpoint Test Suite"
echo "================================================================="
echo "Model:       $LLM_MODEL"
echo "Ollama API:  $LLM_API_BASE"
echo "Golem API:   $GOLEM_API_URL"
echo "Question:    \"$QUESTION\""
echo "================================================================="
echo

# ------------------------------------------------------------------------------
# Test 1: Direct Ollama Chat Completion (/v1/chat/completions)
# ------------------------------------------------------------------------------
if [ "$MODE" = "all" ] || [ "$MODE" = "direct" ]; then
  echo ">>> [1/2] Testing Direct LLM Call to Ollama ($LLM_API_BASE/chat/completions)..."
  echo "    Sending request (generating on CPU, please wait a few seconds)..."
  
  OLLAMA_PAYLOAD=$(cat <<EOF
{
  "model": "$LLM_MODEL",
  "messages": [
    {
      "role": "system",
      "content": "You are a concise assistant. Answer directly in 1-2 sentences."
    },
    {
      "role": "user",
      "content": "$QUESTION"
    }
  ],
  "stream": false
}
EOF
)

  START_TIME=$(date +%s)
  OLLAMA_RESPONSE=$(curl --connect-timeout 5 -s -w "\n%{http_code}" -X POST "${LLM_API_BASE}/chat/completions" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${LLM_API_KEY}" \
    -d "$OLLAMA_PAYLOAD" 2>&1 || true)
  END_TIME=$(date +%s)
  DURATION=$((END_TIME - START_TIME))

  HTTP_STATUS=$(echo "$OLLAMA_RESPONSE" | tail -n1)
  BODY=$(echo "$OLLAMA_RESPONSE" | sed '$d')

  if [ "$HTTP_STATUS" = "200" ]; then
    echo "✔ Ollama responded successfully in ${DURATION}s (HTTP 200)!"
    echo
    echo "--- Ollama Synthesized Answer ---"
    if command -v jq &>/dev/null; then
      echo "$BODY" | jq -r '.choices[0].message.content // .choices[0].text // .'
    else
      echo "$BODY"
    fi
    echo "---------------------------------"
  else
    echo "✘ Direct Ollama call failed (HTTP status: $HTTP_STATUS)."
    echo "Response: $BODY"
    echo
    echo "Troubleshooting Tips:"
    echo "  1. Is Ollama running? Run: docker compose up -d ollama"
    echo "  2. Is model pulled?   Run: docker exec -it golem-kg-ollama ollama pull $LLM_MODEL"
    echo "  3. Local Ollama?      Run: ollama pull $LLM_MODEL && ollama serve"
  fi
  echo
fi

# ------------------------------------------------------------------------------
# Test 2: Golem KnowledgeAccessAgent /api/knowledge/ask
# ------------------------------------------------------------------------------
if [ "$MODE" = "all" ] || [ "$MODE" = "ask" ]; then
  echo ">>> [2/2] Testing Golem GraphRAG Ask Endpoint ($GOLEM_API_URL/api/knowledge/ask)..."
  echo "    Retrieving GraphRAG bundle and synthesizing answer..."

  ASK_PAYLOAD=$(cat <<EOF
{
  "query": "$QUESTION",
  "topK": 5,
  "maxHops": 2,
  "generateAnswer": true
}
EOF
)

  START_TIME=$(date +%s)
  ASK_RESPONSE=$(curl --connect-timeout 5 -s -w "\n%{http_code}" -X POST "${GOLEM_API_URL}/api/knowledge/ask" \
    -H "Content-Type: application/json" \
    -d "$ASK_PAYLOAD" 2>&1 || true)
  END_TIME=$(date +%s)
  DURATION=$((END_TIME - START_TIME))

  HTTP_STATUS=$(echo "$ASK_RESPONSE" | tail -n1)
  BODY=$(echo "$ASK_RESPONSE" | sed '$d')

  if [ "$HTTP_STATUS" = "200" ]; then
    echo "✔ Golem Ask endpoint responded successfully in ${DURATION}s (HTTP 200)!"
    echo
    echo "--- Synthesized Markdown Answer ---"
    if command -v jq &>/dev/null; then
      echo "$BODY" | jq -r '.answer'
      echo
      echo "--- Citations & Grounding Stats ---"
      echo "$BODY" | jq '{
        citationsCount: (.citations | length),
        groundedEntitiesCount: (.groundedEntities | length),
        groundedRelationshipsCount: (.groundedRelationships | length),
        confidenceScore: .confidenceScore
      }'
    else
      echo "$BODY"
    fi
    echo "-----------------------------------"
  else
    echo "✘ Golem ask endpoint call failed (HTTP status: $HTTP_STATUS)."
    echo "Response: $BODY"
    echo
    echo "Troubleshooting Tips:"
    echo "  1. Is Golem deployed? Run: ./deploy.sh"
    echo "  2. Is Golem server running? Run: golem server status"
  fi
  echo
fi

echo "Test complete."
