#!/usr/bin/env bash
#
# Inlines message.ts into index.ts to produce one self-contained file that can
# be pasted into the Supabase dashboard's Edge Function editor.
#
# The dashboard editor is the only way to deploy without installing the CLI,
# and pasting one file is far less to get wrong than recreating a directory.
# Same idea as build-setup-sql.sh, for the same reason.
#
# Run this after changing anything in supabase/functions/send-notifications/.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
dir="$root/supabase/functions/send-notifications"
out="$dir/bundled.ts"

{
  cat <<'HEADER'
// Saloni — the notification worker, as one file.
//
// GENERATED FILE. Do not edit directly: it is built from index.ts and
// message.ts by scripts/build-function-bundle.sh. Edit those and regenerate.
//
// This exists for one reason: the Supabase dashboard's function editor is the
// only way to deploy without installing the CLI, and one file is much less to
// get wrong than recreating a directory. Paste the whole thing in and deploy.
//
// If you use the CLI instead, deploy the directory rather than this file —
// index.ts and message.ts are the originals, and message.ts is what
// scripts/test-notification-text.mjs actually tests.

HEADER

  # The external imports first. ES modules hoist them wherever they appear, but
  # a file whose imports turn up two hundred lines down reads like a mistake.
  grep -E "^import .*from '(jsr|npm):" "$dir/index.ts"
  printf '\n'

  # Then message.ts, which imports nothing.
  cat "$dir/message.ts"
  printf '\n'

  # Then index.ts, minus every import: the external ones are hoisted above and
  # the local one is satisfied by message.ts now sitting in the same file.
  grep -vE "^import " "$dir/index.ts"
} > "$out"

echo "Wrote $out ($(wc -l < "$out") lines)"
