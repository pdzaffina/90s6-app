#!/usr/bin/env bash
# Usage: ./configure.sh <project-ref> <anon-public-key>
# Fills in your Supabase project in config.js and the CSP of every page.
set -euo pipefail
[ $# -eq 2 ] || { echo "usage: ./configure.sh <project-ref> <anon-public-key>"; exit 1; }
ref="$1"; key="$2"
grep -rlE "YOUR-PROJECT-REF|YOUR-ANON-PUBLIC-KEY" --include='*.html' --include='*.js' . | while read -r f; do
  sed -i.bak -e "s|YOUR-PROJECT-REF|$ref|g" -e "s|YOUR-ANON-PUBLIC-KEY|$key|g" "$f" && rm -f "$f.bak"
  echo "configured $f"
done
