#!/usr/bin/env bash
# Daily backup:  DATABASE_URL=... bash scripts/backup.sh   (schedule with cron, keep copies off the server)
set -euo pipefail
: "${DATABASE_URL:?Set DATABASE_URL}"
DIR="${BACKUP_DIR:-./backups}"; mkdir -p "$DIR"
FILE="$DIR/techhub_$(date +%Y%m%d_%H%M%S).dump"
pg_dump --format=custom --no-owner "$DATABASE_URL" -f "$FILE"
echo "Backup written: $FILE"
# keep the newest 14
ls -1t "$DIR"/techhub_*.dump | tail -n +15 | xargs -r rm --
