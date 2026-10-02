#!/bin/bash
# Vigilante (cron cada 5 min): si la API no responde 3 veces seguidas, la reinicia.
# Docker ya reinicia contenedores que mueren; esto cubre el caso de un proceso vivo pero colgado.
set -uo pipefail
STATE=/var/tmp/vigia_watchdog_fails
LOG=/var/log/vigia_watchdog.log

if curl -fsS --max-time 10 http://127.0.0.1:3005/health > /dev/null; then
  echo 0 > "$STATE"
  exit 0
fi

fails=$(( $(cat "$STATE" 2>/dev/null || echo 0) + 1 ))
echo "$fails" > "$STATE"
echo "[$(date '+%Y-%m-%d %H:%M:%S')] health falló ($fails)" >> "$LOG"
if [ "$fails" -ge 3 ]; then
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] reiniciando vigia-api" >> "$LOG"
  cd /opt/vigia && docker compose restart vigia-api >> "$LOG" 2>&1
  echo 0 > "$STATE"
fi
