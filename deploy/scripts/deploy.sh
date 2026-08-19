#!/bin/bash
# CYBERSHOW 服务器一键部署脚本
# 使用方法（服务器上执行）：
#   1. 代码已上传至 /opt/cybershow
#   2. 如需自定义密码：cp .env.example .env 并修改
#   3. sudo bash deploy.sh
set -e

APP_DIR="/opt/cybershow"
cd "$APP_DIR/deploy"

# 1. 安装 Docker（如已安装则跳过）
if ! command -v docker &> /dev/null; then
    echo ">>> installing docker..."
    curl -fsSL https://get.docker.com | sh
    systemctl enable --now docker
fi
docker compose version &> /dev/null || { echo "docker compose 插件缺失，请安装 docker-compose-plugin"; exit 1; }

# 2. 生成 .env（首次部署时随机生成强密码）
if [ ! -f .env ]; then
    echo ">>> generating .env with random passwords..."
    {
        echo "MYSQL_ROOT_PASSWORD=$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-24)"
        echo "MYSQL_DB=cyber_show"
        echo "MYSQL_USER=cyber"
        echo "MYSQL_PASSWORD=$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-24)"
    } > .env
    chmod 600 .env
    echo ">>> .env generated (密码已随机生成并保存在 deploy/.env，请妥善保存)"
fi

# 3. 构建并启动
echo ">>> building and starting services..."
docker compose up -d --build

# 4. 等待健康检查
echo ">>> waiting for services..."
sleep 15
for i in $(seq 1 12); do
    if curl -sf http://localhost/actuator/health | grep -q UP; then
        echo ">>> backend UP"
        break
    fi
    [ "$i" = 12 ] && { echo "!!! backend 未在预期时间内就绪，请查看: docker compose logs backend"; exit 1; }
    sleep 5
done

# 5. 冒烟测试
echo ">>> smoke test..."
curl -sf http://localhost/api/visitor/stats > /dev/null && echo ">>> /api/visitor/stats OK"
curl -sf -X POST http://localhost/api/ai/chat -H 'Content-Type: application/json' -d '{"message":"ping"}' > /dev/null && echo ">>> /api/ai/chat OK"
curl -sf http://localhost/ | grep -qi cybershow && echo ">>> frontend OK"

# 6. 注册定时任务：每日备份 + 每 30 分钟健康巡检
if ! crontab -l 2>/dev/null | grep -q backup.sh; then
    (crontab -l 2>/dev/null; echo "0 3 * * * $APP_DIR/deploy/scripts/backup.sh >> /var/log/cybershow-backup.log 2>&1") | crontab -
    echo ">>> crontab backup registered (daily 03:00)"
fi
if ! crontab -l 2>/dev/null | grep -q healthcheck.sh; then
    (crontab -l 2>/dev/null; echo "*/30 * * * * $APP_DIR/deploy/scripts/healthcheck.sh >> /var/log/cybershow-health.log 2>&1") | crontab -
    echo ">>> crontab healthcheck registered (every 30 min)"
fi

echo ""
echo "==================== 部署完成 ===================="
echo "访问地址: http://$(hostname -I | awk '{print $1}')"
echo "查看状态: cd $APP_DIR/deploy && docker compose ps"
echo "=================================================="
