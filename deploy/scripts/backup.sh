#!/bin/bash
# MySQL 每日备份脚本：导出 cyber_show 库，保留最近 7 天
# crontab 示例：0 3 * * * /opt/cybershow/deploy/scripts/backup.sh >> /var/log/cybershow-backup.log 2>&1

set -e

BACKUP_DIR="/opt/cybershow/backups"
DB_NAME="${MYSQL_DB:-cyber_show}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

mkdir -p "$BACKUP_DIR"

docker compose -f /opt/cybershow/deploy/docker-compose.yml \
  exec -T mysql mysqldump -uroot -p"${MYSQL_ROOT_PASSWORD:-cyber_show_root_2026}" \
  --single-transaction --routines --triggers "$DB_NAME" \
  | gzip > "$BACKUP_DIR/${DB_NAME}_${TIMESTAMP}.sql.gz"

echo "[$(date '+%F %T')] backup ok: ${DB_NAME}_${TIMESTAMP}.sql.gz"

# 清理 7 天前的备份
find "$BACKUP_DIR" -name "*.sql.gz" -mtime +7 -delete
