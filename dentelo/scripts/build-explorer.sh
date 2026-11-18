#!/usr/bin/env bash
# Rebuild the full 3D explorer (Dental Scope) under the clinic's name into ./public/explorer
#   bash scripts/build-explorer.sh
set -euo pipefail
SITE="$(cd "$(dirname "$0")/.." && pwd)"
DS="$SITE/../dental-scope"
NAME="${CLINIC_NAME:-Dr. Ahmed Dental Clinic}"

cd "$DS"
DS_BASE=/explorer/ DS_CLINIC_NAME="$NAME" npm run build

# leftover product name in entry-page fallbacks/meta -> neutral name
# (the licence-required attribution links in page footers are kept)
find dist -name '*.html' -print0 | xargs -0 perl -pi -e 's/Dental Scope(?!<\/a> \(<a href="https:\/\/creativecommons)/3D Teeth Explorer/g'

rm -rf "$SITE/public/explorer"
cp -R dist "$SITE/public/explorer"
cp LICENSE "$SITE/public/explorer/LICENSE.txt"
cp CREDITS.md "$SITE/public/explorer/CREDITS.md"
echo "Explorer built into $SITE/public/explorer"
