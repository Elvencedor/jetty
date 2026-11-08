#!/bin/sh
# Nightly logical backup of PostgreSQL. Add to cron on the VPS, e.g.:
#   15 2 * * * /opt/jetty/deploy/backup.sh >> /var/log/jetty-backup.log 2>&1
# Copy the files off the VPS too (Hostinger snapshots, or rclone to R2); a backup on the same disk is not enough.
set -eu
cd "$(dirname "$0")"
DIR="${BACKUP_DIR:-/var/backups/jetty}"
KEEP_DAYS="${KEEP_DAYS:-14}"
mkdir -p "$DIR"
FILE="$DIR/jetty-$(date +%Y%m%d-%H%M%S).sql.gz"
docker compose exec -T postgres pg_dump -U jetty -d jetty --no-owner | gzip > "$FILE"
find "$DIR" -name 'jetty-*.sql.gz' -mtime +"$KEEP_DAYS" -delete
echo "wrote $FILE"
