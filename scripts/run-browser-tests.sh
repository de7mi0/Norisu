#!/usr/bin/env bash
#
# Builds the app and runs the browser checks against it — all of them, or one
# share of them when the work is split across machines.
#
#   ./scripts/run-browser-tests.sh          # every file, one after another
#   ./scripts/run-browser-tests.sh 2 4      # the 2nd quarter (CI runs 1..4 at once)
#
# Two builds, because two files test features that are off in the ordinary one:
# 25-review-sign-in.mjs needs VITE_REVIEW_EMAIL set. (05-push.mjs needs a VAPID
# key, which the committed .env already has.) Each build is served by
# `vite preview` on its own port, and both are stopped on exit.
#
# Playwright is not a dependency (scripts/browser-tests/README.md): install it
# first with `npm install --no-save playwright`. CHROMIUM points the checks at
# a browser; it defaults to the copy this project's sandbox ships with.
#
# Exits non-zero if any file fails, after running all of its share, so one
# failure does not hide the next.
set -uo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

shard="${1:-1}"
shards="${2:-1}"
tmp="$(mktemp -d)"
pids=()

cleanup() {
  for pid in "${pids[@]}"; do kill "$pid" 2>/dev/null || true; done
  rm -rf "$tmp"
}
trap cleanup EXIT

serve() {
  local dir="$1" port="$2"
  npx vite preview --outDir "$dir" --port "$port" --strictPort > "$tmp/preview-$port.log" 2>&1 &
  pids+=("$!")
  for _ in $(seq 1 60); do
    curl -s -o /dev/null "http://localhost:$port/" && return 0
    sleep 0.5
  done
  echo "vite preview on port $port did not start:" >&2
  cat "$tmp/preview-$port.log" >&2
  return 1
}

echo "Building…"
npx vite build --outDir "$tmp/app" --emptyOutDir > "$tmp/build.log" 2>&1 \
  || { cat "$tmp/build.log"; exit 1; }
VITE_REVIEW_EMAIL=review@example.test \
  npx vite build --outDir "$tmp/review" --emptyOutDir > "$tmp/build-review.log" 2>&1 \
  || { cat "$tmp/build-review.log"; exit 1; }

serve "$tmp/app" 4173 || exit 1
serve "$tmp/review" 4174 || exit 1

files=(scripts/browser-tests/[0-9][0-9]-*.mjs)
failed=()
index=0
for file in "${files[@]}"; do
  index=$((index + 1))
  # Round-robin, so the slow files (16, 17, 07) do not all land in one share.
  if [ $(( (index - 1) % shards + 1 )) -ne "$shard" ]; then continue; fi

  name="$(basename "$file")"
  base="http://localhost:4173/"
  [ "$name" = 25-review-sign-in.mjs ] && base="http://localhost:4174/"

  echo
  echo "── $name"
  if ! BASE="$base" node "$file"; then
    failed+=("$name")
  fi
done

echo
if [ ${#failed[@]} -gt 0 ]; then
  echo "FAILED: ${failed[*]}"
  exit 1
fi
echo "All browser checks in share $shard of $shards passed."
