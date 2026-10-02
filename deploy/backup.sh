#!/bin/bash
# Backup diario de la base de Vigía (cron 03:30, después del backup de CoreDLS de las 03:00).
# Carpeta propia: no se mezcla con /opt/backups/db (que la PC descarga) ni modifica backup_all.sh.
set -euo pipefail
umask 077

DIR=/opt/backups/vigia
RETENTION_DAYS=7
DATE=$(date +%Y%m%d_%H%M%S)
LOG=/var/log/vigia_backup.log
log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG"; }

mkdir -p "$DIR"
chmod 700 "$DIR"
OUT="$DIR/vigia_$DATE.dump"

log "inicio backup $DATE"
# Formato custom de pg_dump: comprimido y restaurable por tabla con pg_restore.
docker exec vigia-db pg_dump -U vigia -Fc -Z 6 vigia > "$OUT"
chmod 600 "$OUT"

size=$(stat -c%s "$OUT")
if [ "$size" -lt 100000 ]; then
  log "ALERTA: $OUT pesa solo $size bytes — posible backup fallido"
  exit 1
fi
# Verificación: el índice del dump tiene que poder leerse.
docker exec -i vigia-db pg_restore --list < "$OUT" > /dev/null
log "ok $OUT ($((size / 1024 / 1024)) MB)"

find "$DIR" -name 'vigia_*.dump' -mtime +"$RETENTION_DAYS" -delete
log "retención aplicada (${RETENTION_DAYS} días)"
