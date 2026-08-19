# 架构说明

> 本文档供长期维护使用。任何维护会话应先阅读本文档与 changelog.md 恢复上下文。

## 总体架构

```
用户浏览器
    │
    ▼
Nginx (80/443)
    ├── 静态资源：frontend/dist（React 构建产物）
    └── /api/* 反向代理 ──► Spring Boot 容器 (8080)
                                │
                                ▼
                          MySQL 8.0 (cyber_show 库)
```

## 前端（frontend/）

- 技术：React 18 + Vite 4 + TypeScript + TailwindCSS 3
- 3D：three + @react-three/fiber（首屏粒子星群 + 线框几何体）
- 动画：GSAP ScrollTrigger（滚动触发/数字滚动）、Framer Motion（页面过渡）
- 路由（react-router-dom）：
  - `/` 首页：3D 首屏 Hero + Glitch 标题 + 打字机副标题 + 能力卡片 + 终端模拟器
  - `/playground` 交互彩蛋：矩阵代码雨 + 鼠标粒子拖尾 + 隐藏指令（键入 `cyber` 触发全屏故障特效）
  - `/ai-lab` AI 实验室：AI 工具入口卡片 + 对话骨架（调用后端 mock 接口）
  - `/stats` 数据看板：访问量统计 + 近 7 日柱状图
- 低端设备降级：`src/utils/device.ts` 检测 CPU 核心数/内存，不足时 Hero 切换为 CSS 背景
- API 封装：`src/api/client.ts`，baseURL 为 `/api`（开发由 Vite 代理，生产由 Nginx 反代）

## 后端（backend/）

- 技术：Spring Boot 2.7.18 + JDK 8 + MyBatis + Flyway 8
- 包结构：`com.cybershow.{config, controller, domain, dto, mapper, service}`
- 接口清单：

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/visitor/track | 记录访客（IP + 页面 + UA） |
| GET | /api/visitor/stats | 总访问量 / 今日 / 独立访客 / 近 7 日 |
| POST | /api/ai/chat | AI 对话骨架，当前返回 mock 回复 |
| GET | /actuator/health | 健康检查 |

- 数据库表（Flyway 管理，`src/main/resources/db/migration/`）：
  - `visitor_log`：访客明细
  - `ai_mock_config`：AI 预留配置（后续接入真实模型时扩展 api_key/provider）

## AI 接入预留（重要）

`AiController` 当前返回 mock 数据。后续接入真实大模型只需：
1. 在 `ai_mock_config` 表或环境变量中配置 provider 与 api_key
2. 改造 `AiService`，按 provider 调用对应模型 API
3. 前端无需任何改动

## 部署（deploy/）

- `docker-compose.yml`：mysql + backend + nginx 三服务
- `nginx/nginx.conf`：静态资源 + /api 反代 + gzip
- `scripts/backup.sh`：mysqldump 每日备份，保留 7 天（crontab 调度）
- HTTPS：备案完成后用 certbot 申请 Let's Encrypt 证书，详见 deployment.md

## 关键决策记录

| 决策 | 原因 |
|------|------|
| Spring Boot 2.7 + JDK 8 | 适配用户本机已有 JDK 8 |
| MyBatis 注解版（非 MyBatis-Plus） | 减少依赖，本地 Java 8 环境安装更快 |
| Vite 4（非 5） | 兼容用户本机 Node 16 |
| AI 能力走 mock | 用户决定暂不接入真实 API，保留接入点 |
