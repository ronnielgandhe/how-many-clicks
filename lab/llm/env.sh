#!/bin/bash
H="$(cd "$(dirname "$0")" && pwd)"
: "${KEYS_DIR_A:?set KEYS_DIR_A to an infisical project dir with the Anthropic and OpenAI keys}"
: "${KEYS_DIR_B:?set KEYS_DIR_B to an infisical project dir with GOOGLE_API_KEY}"
cd "$KEYS_DIR_A" && env -u LOG_LEVEL infisical run --env=dev --silent --log-level=error -- bash -c "cd \"$KEYS_DIR_B\" && env -u LOG_LEVEL infisical run --env=dev --silent --log-level=error -- bash -c 'cd \"$H\" && env -u LOG_LEVEL .venv/bin/python \"\$@\"' _ \"\$@\"" _ "$@"
