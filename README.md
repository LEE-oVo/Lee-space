# CYBERSHOW · 赛博技术秀场

暗色赛博 / 科技风的纯技术秀场网站：3D 首屏、霓虹卡片、终端模拟器、矩阵代码雨、粒子彩蛋，以及预留的 AI 实验室。

## 技术栈

| 层 | 技术 |
|----|------|
| 前端 | React 18 + Vite 4 + TypeScript + TailwindCSS + Three.js(@react-three/fiber) + GSAP + Framer Motion |
| 后端 | Spring Boot 2.7 + JDK 8 + MyBatis + Flyway |
| 数据库 | MySQL 8.0 |
| 部署 | Docker Compose（MySQL + Backend + Nginx） |

## 目录结构

```
├── frontend/    React 前端
├── backend/     Spring Boot 后端
├── deploy/      Docker Compose、Nginx 配置、备份脚本
└── docs/        架构说明、部署手册、变更记录（长期维护必读）
```

## 本地开发

```bash
# 后端（需本地 MySQL，库名 cyber_show，账号见 application.yml）
cd backend && mvn spring-boot:run

# 前端（/api 自动代理到 localhost:8080）
cd frontend && npm install && npm run dev
```

## 快速文档

- [架构说明](docs/architecture.md)
- [部署手册](docs/deployment.md)
- [变更记录](docs/changelog.md)
