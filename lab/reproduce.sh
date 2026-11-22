#!/usr/bin/env bash
# Full pipeline: data -> model -> tuning -> benchmark -> live check -> tests.
#   ./reproduce.sh          everything (about 15 min of CPU + ~20 min throttled live api)
#   ./reproduce.sh bench    only the offline benchmark with the weights already in public/clicks-model
set -euo pipefail
cd "$(dirname "$0")"
PY=.venv/bin/python
[ -x "$PY" ] || python3 -m venv --system-site-packages .venv
if [ "${1:-}" != "bench" ]; then
  if [ ! -d data/raw/wikispeedia_paths-and-graph ]; then
    mkdir -p data/raw
    curl -sSL -A "wiki-game-research-bench/0.1 (offline benchmark script)" -o data/raw/wikispeedia_paths-and-graph.tar.gz https://snap.stanford.edu/data/wikispeedia/wikispeedia_paths-and-graph.tar.gz
    tar xzf data/raw/wikispeedia_paths-and-graph.tar.gz -C data/raw
  fi
  $PY prep.py
  $PY train.py
  node bench/tune.mjs
fi
node bench/run.mjs
[ "${1:-}" = "bench" ] || node bench/live.mjs
node --test test/
