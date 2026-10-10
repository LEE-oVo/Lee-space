#!/usr/bin/env bash
# 工作台一键部署脚本（在服务器上以 deploy 用户执行）
set -euo pipefail

APP_DIR=/opt/workbench
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "==> 1/6 创建目录"
sudo mkdir -p "$APP_DIR"/{server,web,data}
sudo chown -R deploy:deploy "$APP_DIR"

echo "==> 2/6 同步后端"
sudo rm -rf "$APP_DIR/server/src"
cp -r "$REPO_DIR/server/src" "$APP_DIR/server/src"
cp "$REPO_DIR/server/package.json" "$APP_DIR/server/package.json"

echo "==> 3/6 同步前端产物"
if [ ! -d "$REPO_DIR/web/dist" ]; then
  echo "    未发现构建产物，尝试本地构建…"
  (cd "$REPO_DIR/web" && npm install --registry=https://registry.npmmirror.com && npm run build)
fi
sudo rm -rf "$APP_DIR/web/dist"
cp -r "$REPO_DIR/web/dist" "$APP_DIR/web/dist"

echo "==> 4/6 安装依赖"
if [ ! -f "$APP_DIR/server/.env" ]; then
  cp "$REPO_DIR/server/.env.example" "$APP_DIR/server/.env"
  echo "    已生成 .env，请按需修改"
fi
cd "$APP_DIR/server"
npm install --omit=dev --registry=https://registry.npmmirror.com

echo "==> 5/6 初始化数据库（无管理员时创建）"
node src/scripts/reset-admin.js admin || true

echo "==> 6/6 安装服务并重启"
sudo cp "$REPO_DIR/deploy/workbench.service" /etc/systemd/system/workbench.service
sudo cp "$REPO_DIR/deploy/nginx-workbench.conf" /etc/nginx/sites-available/workbench
sudo ln -sf /etc/nginx/sites-available/workbench /etc/nginx/sites-enabled/workbench
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl daemon-reload
sudo systemctl enable workbench
sudo systemctl restart workbench
sudo systemctl reload nginx

echo
echo "部署完成：http://$(curl -sS -m 5 ifconfig.me 2>/dev/null || echo '<服务器公网IP>')"
