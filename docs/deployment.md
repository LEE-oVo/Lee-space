# 部署手册

## 生产环境实况（2026-08-18 首次部署）

- 服务器：阿里云 ECS 47.119.128.59，Ubuntu 22.04，2 核 1.6G 内存，40G 磁盘
- 代码目录：/opt/cybershow
- Docker 29.x（阿里云 apt 镜像源安装），registry 加速器：docker.1ms.run / docker.m.daocloud.io
- 低内存适配：MySQL innodb-buffer-pool-size=128M + performance-schema=OFF；后端 JVM -Xmx384m
- 数据库密码：随机生成，存于 /opt/cybershow/deploy/.env（chmod 600，未入库）
- crontab：每日 03:00 备份，每 30 分钟健康巡检

重要：阿里云安全组必须手动放行 80/443（控制台操作，AI 无法代办）。
首次部署曾因安全组未放行 80 导致外网不通，服务器内部全部正常。

## 一、云服务器要求

- 2 核 4G 以上，Ubuntu 22.04（推荐）
- 安全组开放：22（SSH）、80、443

## 二、首次部署步骤

推荐使用一键脚本（自动装 Docker、随机生成数据库强密码、启动服务、冒烟测试、注册备份定时任务）：

```bash
# 1. 上传项目代码（本地执行）
scp -r . user@<服务器IP>:/opt/cybershow

# 2. 服务器上执行一键部署
ssh user@<服务器IP>
sudo bash /opt/cybershow/deploy/scripts/deploy.sh
```

手动分步执行（脚本失败时的备选）：

```bash
curl -fsSL https://get.docker.com | sh
sudo systemctl enable --now docker
cd /opt/cybershow/deploy
cp .env.example .env   # 并修改其中密码
docker compose up -d --build
curl http://localhost/api/visitor/stats
curl http://localhost/actuator/health
```

默认通过 `http://<服务器IP>` 访问。

注意：deploy/.env 中的数据库密码为随机生成的强密码，请妥善保存；备份恢复依赖它。

## 三、配置项（docker-compose.yml 环境变量）

| 变量 | 默认值 | 说明 |
|------|--------|------|
| MYSQL_ROOT_PASSWORD | cyber_show_root_2026 | 生产部署前必须修改 |
| MYSQL_PASSWORD | cyber123 | 应用账号密码，生产部署前必须修改 |

## 四、域名 + HTTPS（备案完成后）

```bash
# 1. 域名 A 记录指向服务器 IP
# 2. 安装 certbot 并申请证书（需短暂停用 80 端口占用或改用 DNS 验证）
sudo apt install -y certbot
sudo certbot certonly --standalone -d yourdomain.com
# 3. 修改 deploy/nginx/nginx-ssl.conf 中的 server_name，
#    docker-compose.yml 的 nginx 服务挂载该配置并开放 443 端口
# 4. docker compose up -d nginx 重载
```

证书续期：`certbot renew` 加入 crontab，续期后执行 `docker compose exec nginx nginx -s reload`。

## 五、数据备份

```bash
# 服务器 crontab 每日 03:00 备份
0 3 * * * /opt/cybershow/deploy/scripts/backup.sh >> /var/log/cybershow-backup.log 2>&1
```

备份文件位于 `/opt/cybershow/backups/`，保留最近 7 天。

## 六、日常运维命令

```bash
cd /opt/cybershow/deploy
docker compose ps                 # 查看状态
docker compose logs -f backend    # 查看后端日志
docker compose restart backend    # 重启后端

# 更新发布（本地推送代码后在服务器执行）
git pull
docker compose up -d --build frontend backend
```

## 七、回滚

镜像不带版本标签，回滚依赖 git：`git checkout <上次提交的 commit>` 后重新构建。
重要变更前先执行一次 `backup.sh`。
