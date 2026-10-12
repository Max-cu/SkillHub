#!/usr/bin/env bash
# Daily host-side backup of the dedicated SkillHub PostgreSQL container.
# SkillHub only: never dumps SkillGo databases or containers.
#
# Install (as root on 10.2.14.138):
#   install -m 0700 scripts/backup-pg.sh /opt/skillhub/scripts/backup-pg.sh
#   # crontab -e  (daily 03:17)
#   17 3 * * * /opt/skillhub/scripts/backup-pg.sh >> /opt/skillhub/backups/auto/cron.log 2>&1
set -euo pipefail

PG_CONTAINER="${SKILLHUB_PG_CONTAINER:-skillhub-skillhub-postgres-1}"
PG_USER="${SKILLHUB_PG_ADMIN_USER:-skillhub_admin}"
PG_DB="${SKILLHUB_PG_DB:-skillhub}"
BACKUP_DIR="${SKILLHUB_BACKUP_DIR:-/opt/skillhub/backups/auto}"
RETENTION_DAYS="${SKILLHUB_BACKUP_RETENTION_DAYS:-14}"
DOCKER_BIN="${DOCKER_BIN:-/usr/bin/docker}"

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR" 2>/dev/null || true
LOG="$BACKUP_DIR/backup.log"
ts="$(date '+%Y-%m-%d %H:%M:%S')"

if ! "$DOCKER_BIN" ps --format '{{.Names}}' | grep -Fxq "$PG_CONTAINER"; then
  echo "[$ts] backup FAILED: container $PG_CONTAINER is not running" | tee -a "$LOG"
  exit 1
fi

stamp="$(date '+%Y%m%d-%H%M%S')"
out="$BACKUP_DIR/skillhub-$stamp.dump"
tmp="$out.tmp"
trap 'rm -f "$tmp"' EXIT

# Custom format via stdin redirect; -T keeps docker exec quiet for cron.
if "$DOCKER_BIN" exec -T "$PG_CONTAINER" pg_dump -U "$PG_USER" -d "$PG_DB" -Fc > "$tmp"; then
  size=$(stat -c '%s' "$tmp")
  if [ "$size" -lt 1024 ]; then
    echo "[$ts] backup FAILED: dump too small ($size bytes)" | tee -a "$LOG"
    exit 1
  fi
  # Custom-format dumps start with the PGDMP magic; verify before promoting.
  if ! head -c 5 "$tmp" | grep -q 'PGDMP'; then
    echo "[$ts] backup FAILED: not a valid pg_dump custom format" | tee -a "$LOG"
    exit 1
  fi
  mv "$tmp" "$out"
  chmod 600 "$out"
  echo "[$ts] backup OK: $(basename "$out") ($size bytes)" >> "$LOG"
else
  echo "[$ts] backup FAILED: pg_dump exited $?" | tee -a "$LOG"
  exit 1
fi

# Retention: remove dumps older than RETENTION_DAYS days; keep the log and cron output.
find "$BACKUP_DIR" -maxdepth 1 -type f -name 'skillhub-*.dump' -mtime "+$RETENTION_DAYS" -print -delete >> "$LOG" 2>&1 || true
