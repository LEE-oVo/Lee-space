#!/bin/bash
# CYBERSHOW 服务健康巡检脚本：检查容器状态与接口可达性，异常时自动重启并记录日志
# crontab 示例：*/30 * * * * /opt/cybershow/deploy/scripts/healthcheck.sh >> /var/log/cybershow-health.log 2>&1

COMPOSE_DIR="/opt/cybershow/deploy"
TS() { date '+%F %T'; }

cd "$COMPOSE_DIR" || exit 1

# 1. 容器存活检查：有容器退出则拉起
if ! docker compose ps --format json 2>/dev/null | grep -q '"Running"\|"running"'; then
    echo "[$(TS)] WARN: no running containers, restarting..."
    docker compose up -d
fi

# 2. 后端健康检查：失败则重启 backend
if ! curl -sf --max-time 10 http://localhost/actuator/health | grep -q UP; then
    echo "[$(TS)] WARN: backend health check failed, restarting backend..."
    docker compose restart backend
    sleep 20
    if curl -sf --max-time 10 http://localhost/actuator/health | grep -q UP; then
        echo "[$(TS)] OK: backend recovered"
    else
        echo "[$(TS)] ERROR: backend still down after restart, manual intervention needed"
    fi
else
    echo "[$(TS)] OK: backend UP"
fi

# 3. 前端页面检查
if curl -sf --max-time 10 http://localhost/ | grep -qi cybershow; then
    echo "[$(TS)] OK: frontend served"
else
    echo "[$(TS)] WARN: frontend not responding, restarting nginx..."
    docker compose restart nginx
fi

# 4. 磁盘空间预警（低于 2G 告警）
FREE_KB=$(df /var/lib/docker | awk 'NR==2 {print $4}')
if [ "$FREE_KB" -lt 2097152 ]; then
    echo "[$(TS)] WARN: disk free below 2GB ($((FREE_KB/1024)) MB), consider cleanup"
fi
