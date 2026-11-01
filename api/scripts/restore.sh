#!/usr/bin/env bash
# Restore:  DATABASE_URL=... bash scripts/restore.sh backups/techhub_XXXX.dump   (WARNING: replaces existing data)
set -euo pipefail
: "${DATABASE_URL:?Set DATABASE_URL}"
FILE="${1:?Usage: restore.sh <backup.dump>}"
pg_restore --clean --if-exists --no-owner -d "$DATABASE_URL" "$FILE"
echo "Restore complete."
