#!/usr/bin/env bash
#
# Inlines each Edge Function's one local module into its index.ts, producing a
# self-contained bundled.ts that can be pasted into the Supabase dashboard's
# Edge Function editor:
#
#   send-notifications/  message.ts → bundled.ts
#   review-sign-in/      review.ts  → bundled.ts
#
# The dashboard editor is the only way to deploy without installing the CLI,
# and pasting one file is far less to get wrong than recreating a directory.
# Same idea as build-setup-sql.sh, for the same reason.
#
# Run this after changing anything in supabase/functions/.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# bundle <function> <local module> <title> <test that covers the module>
bundle() {
  local name="$1" module="$2" title="$3" test="$4"
  local dir="$root/supabase/functions/$name"
  local out="$dir/bundled.ts"

  {
    cat <<HEADER
// Saloni — $title, as one file.
//
// GENERATED FILE. Do not edit directly: it is built from index.ts and
// $module by scripts/build-function-bundle.sh. Edit those and regenerate.
//
// This exists for one reason: the Supabase dashboard's function editor is the
// only way to deploy without installing the CLI, and one file is much less to
// get wrong than recreating a directory. Paste the whole thing in and deploy.
//
// If you use the CLI instead, deploy the directory rather than this file —
// index.ts and $module are the originals, and $module is what
// $test actually tests.

HEADER

    # The external imports first. ES modules hoist them wherever they appear,
    # but a file whose imports turn up two hundred lines down reads like a
    # mistake.
    grep -E "^import .*from '(jsr|npm):" "$dir/index.ts"
    printf '\n'

    # Then the local module, which imports nothing.
    cat "$dir/$module"
    printf '\n'

    # Then index.ts, minus every import: the external ones are hoisted above
    # and the local one is satisfied by the module now sitting in this file.
    grep -vE "^import " "$dir/index.ts"
  } > "$out"

  echo "Wrote $out ($(wc -l < "$out") lines)"
}

bundle send-notifications message.ts 'the notification worker' scripts/test-notification-text.mjs
bundle review-sign-in review.ts "the app-store reviewers' sign-in" scripts/test-review-sign-in.mjs
