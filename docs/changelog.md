# 变更记录

> 倒序记录，每次功能变更 / Bug 修复 / 部署调整都需追加一条。

## [0.1.3] - 2026-08-19

### 上线
- 阿里云安全组入方向放行 TCP 80/443（0.0.0.0/0），外网访问正式打通
- 外网验证全部通过：首页 200（标题匹配）、`/api/visitor/stats` 返回真实统计数据、`POST /api/ai/chat` 返回 mock 回复
- 正式交付访问地址：http://47.119.128.59
- 待办：域名备案完成后配置 HTTPS（deploy/nginx/nginx-ssl.conf 模板已备）

## [0.1.2] - 2026-08-18

### 部署
- 首次上线至阿里云 ECS（47.119.128.59，Ubuntu 22.04，2 核 1.6G）
- Docker 采用阿里云 apt 镜像源安装（get.docker.com 国内不可达），registry 加速器 1ms.run + daocloud
- 低内存调优：MySQL buffer-pool 128M / performance-schema OFF；JVM -Xmx384m
- 后端容器内 Maven 走 .mvn/settings.xml 阿里云镜像；前端 npm 走 npmmirror
- 前端构建容器改为运行时显式同步产物到共享卷（修复命名卷不更新问题）
- 注册 crontab：每日备份 + 每 30 分钟健康巡检
- 待办：安全组放行 80/443（用户控制台操作）；域名备案后配置 HTTPS

## [0.1.1] - 2026-08-17

### 优化
- 前端构建分包：three.js 与 gsap/framer-motion 拆为独立 chunk，主包从 1250KB 降至 269KB
- 新增服务器一键部署脚本 deploy/scripts/deploy.sh（装 Docker、随机强密码、冒烟测试、注册备份任务）
- 新增健康巡检脚本 deploy/scripts/healthcheck.sh（每 30 分钟巡检容器/接口/磁盘，异常自动重启）
- docker-compose：nginx 依赖 frontend-build 确保静态资源先就绪；新增 .env.example 模板

## [0.1.0] - 2026-08-17

### 新增
- 项目初始化：React 18 + Vite 4 + TS 前端，Spring Boot 2.7 + MyBatis + Flyway 后端
- 首页：Three.js 3D 首屏、Glitch 标题、打字机副标题、霓虹能力卡片、终端模拟器
- 交互彩蛋页：矩阵代码雨、粒子拖尾、隐藏指令特效
- AI 实验室：工具入口卡片 + `/api/ai/chat` mock 骨架
- 访客统计：`/api/visitor/track`、`/api/visitor/stats` + 数据看板页
- Docker Compose 部署方案（mysql + backend + nginx）、备份脚本
- docs 文档体系（架构 / 部署 / 变更记录）
