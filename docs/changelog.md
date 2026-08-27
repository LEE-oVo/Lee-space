# 变更记录

> 倒序记录，每次功能变更 / Bug 修复 / 部署调整都需追加一条。

## [0.2.0] - 2026-08-27

### 新站点：个人作品网站（替换赛博技术秀场）
- 新增 `portfolio/` 前后端分离项目，替换 47.119.128.59 上的原赛博站点（80 端口）
- 后端：Spring Boot 2.7.18（JDK 8）+ MyBatis-Plus 3.5.5 + JWT；/api/public/** 公开、/api/admin/** 全鉴权；上传后缀白名单（pdf/html、mp4、jpg/png/webp）
- 前端：React 18 + Vite + AntD 5 + pdfjs-dist；前台文件内嵌预览（pdfjs/iframe，不下载）+ 视频弹窗播放；后台登录/文件管理/视频管理/修改密码（懒加载）
- 部署：沿用 playbook.md 流程，compose 四容器（mysql+backend+nginx+前端构建），配置中心 `portfolio/deploy/.env`（随机密码 + JWT 密钥），上传文件持久化到 upload-data 卷
- 初始管理员 admin/123456（部署文档已提示首次登录后修改）
- 外网六项验证全通过：首页 200、公开文件/视频接口、登录签发 token、无 token 401、SPA 路由回退
- 本地自测发现并修复：init.sql 初始 BCrypt hash 与 123456 不匹配，已替换为实测验证的 hash

## [0.1.6] - 2026-08-27

### 文档
- 新增 docs/playbook.md：全栈项目上线手册（环境/开发/容器化/云部署/安全组/验证/GitHub 入库/迭代发布/踩坑速查），供新项目复用

## [0.1.5] - 2026-08-27

### 配置中心重构
- 所有可调参数收敛到唯一配置入口 `deploy/.env`（模板 .env.example 含分组注释）：端口、数据库账号/密码、MySQL 调优、JVM 内存、时区
- docker-compose.yml 硬编码全部改为 ${VAR:默认值} 引用；deploy.sh 改为基于模板生成 .env 仅随机替换密码
- 服务器 /opt/cybershow/deploy/.env 已同步合并新变量（真实密码保留），冒烟验证通过
- docs/deployment.md 配置章节重写为完整变量清单

## [0.1.4] - 2026-08-19

### 仓库
- 代码首次推送至 GitHub：https://github.com/LEE-oVo/Lee-space（main 分支）
- 推送通道：SSH over ssh.github.com:443（本机网络无法直连 github.com HTTPS，已配 ~/.ssh/config）
- 敏感文件均未入库：.deploy-tmp/（含服务器凭据）、deploy/.env（生产密码）已 gitignore
- 验证截图归入 docs/screenshots/

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
