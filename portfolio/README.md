# 个人作品网站（Portfolio）

前后端分离的个人作品展示站点：**访客前台**（文件内嵌预览 + 视频播放）与**管理后台**（登录鉴权 + 上传管理），单管理员账号，JWT 鉴权。

## 技术栈

| 端 | 技术 |
| --- | --- |
| 前端 | React 18 + Vite 4 + TypeScript + Ant Design 5 + React Router 6 + Axios + pdfjs-dist |
| 后端 | Spring Boot 2.7.18（JDK 8）+ MyBatis-Plus 3.5.5 + MySQL 8.0 + JWT（jjwt） |
| 部署 | Docker Compose（mysql + backend + nginx + 前端构建），配置收敛于 `deploy/.env` |

## 目录结构

```
portfolio/
├── backend/            # Spring Boot 后端
│   ├── src/main/java/com/lee/portfolio/
│   │   ├── controller/   # PublicController（前台）/ AdminAuthController / AdminFileController / AdminVideoController
│   │   ├── service/      # AdminService / FileService / VideoService
│   │   ├── mapper/       # MyBatis-Plus Mapper
│   │   ├── entity/       # Admin / PortfolioFile / Video
│   │   ├── config/       # JWT 工具与拦截器、分页插件、静态资源映射
│   │   └── common/       # Result 统一返回 + 全局异常处理
│   ├── src/main/resources/application.yml
│   └── Dockerfile
├── frontend/           # React 单项目（/ 前台，/admin 后台）
│   ├── src/pages/site/   # 首页 / 文件展示 / 视频展示
│   ├── src/pages/admin/  # 登录 / 布局 / 文件管理 / 视频管理 / 修改密码
│   ├── src/components/PdfViewer.tsx  # pdfjs 内嵌渲染
│   └── Dockerfile
└── deploy/             # 部署配置
    ├── docker-compose.yml
    ├── nginx/nginx.conf
    ├── init.sql          # 建库建表 + 初始管理员
    └── .env.example      # 配置模板（复制为 .env）
```

## 功能说明

- **访客前台**（`/`、`/files`、`/videos`）
  - 文件展示：分页列表，点击条目弹窗**页面内嵌预览**（PDF 使用 pdfjs 逐页 canvas 渲染，HTML 用 iframe 渲染，均不触发下载）
  - 视频展示：网格卡片（含缩略图），点击弹窗播放（原生 video 控件）
- **管理后台**（`/admin`）
  - 登录鉴权：单管理员账号，JWT 存 localStorage，`/api/admin/**` 全部需要 token
  - 文件管理：上传（仅 .pdf/.html，后端二次校验后缀）、编辑标题简介、删除（磁盘+数据库）、预览
  - 视频管理：上传（仅 .mp4 + 可选 jpg/png/webp 缩略图）、编辑、删除、播放
  - 修改密码（修改成功后强制重新登录）

## 数据库初始化

执行 `deploy/init.sql`（建库 `portfolio_db`、3 张表、初始管理员）：

```bash
mysql -uroot -p < deploy/init.sql
```

Docker 部署时该脚本会自动挂载到 MySQL 的 `docker-entrypoint-initdb.d`，首次启动自动执行。

**初始管理员：`admin` / `123456`（登录后请立即在后台修改密码）**

## 本地开发启动

### 1. 后端（需 JDK 8 + Maven + MySQL 8.0）

```bash
# 按本地环境修改 backend/src/main/resources/application.yml 中的 MYSQL_* 与 app.upload.path
mvn spring-boot:run
# 后端监听 8080；/uploads/** 静态映射到 app.upload.path
```

### 2. 前端（需 Node 16+）

```bash
cd frontend
npm install --registry=https://registry.npmmirror.com
npm run dev      # http://localhost:5174，/api 与 /uploads 代理到 localhost:8080
```

## 生产部署（Docker Compose）

配置唯一入口为 `deploy/.env`：

```bash
cd deploy
cp .env.example .env        # 修改 MYSQL 密码与 JWT_SECRET
docker compose up -d --build
docker compose ps
```

- 站点端口由 `.env` 的 `HTTP_PORT` 决定（默认 80）
- 上传的文件存于 `upload-data` 命名卷（容器内 `/app/uploads`），数据库在 `mysql-data` 卷，均随卷持久化
- 前端产物由一次性 `frontend-build` 容器写入 `frontend-dist` 卷，nginx 只读挂载

### 替换既有站点的迁移顺序

1. 上传源码到服务器（如 `/opt/portfolio`）
2. 停止旧站点容器：`docker compose -f /opt/cybershow/deploy/docker-compose.yml down`
3. `cd /opt/portfolio/deploy && cp .env.example .env`（填入随机密码）
4. `docker compose up -d --build`
5. 外网验证：`curl -I http://<服务器IP>/`、`/api/public/files`、`/api/public/videos`

## 配置说明（application.yml）

| 配置项 | 环境变量 | 说明 |
| --- | --- | --- |
| `spring.datasource.*` | `MYSQL_HOST/PORT/DB/USER/PASSWORD` | 数据库连接 |
| `spring.servlet.multipart` | — | 单文件 200MB / 请求 210MB 上限 |
| `app.upload.path` | `UPLOAD_PATH` | 上传文件磁盘目录（默认 `./uploads`） |
| `app.jwt.secret` | `JWT_SECRET` | JWT 签名密钥（生产必改） |
| `app.jwt.expire` | `JWT_EXPIRE` | token 有效期（毫秒，默认 24h） |

## 接口一览

| 方法 | 路径 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| GET | `/api/public/files?page&size` | 无 | 文件分页列表 |
| GET | `/api/public/files/{id}` | 无 | 文件详情 |
| GET | `/api/public/videos?page&size` | 无 | 视频分页列表 |
| POST | `/api/admin/auth/login` | 无 | 登录，返回 token |
| POST | `/api/admin/auth/password` | JWT | 修改密码 |
| GET/POST/PUT/DELETE | `/api/admin/files[/{id}]`、`/api/admin/files/upload` | JWT | 文件管理 |
| GET/POST/PUT/DELETE | `/api/admin/videos[/{id}]`、`/api/admin/videos/upload` | JWT | 视频管理 |

统一返回 `{ "code": 0, "message": "ok", "data": ... }`；`code != 0` 为业务错误，401 表示未登录或 token 过期。

## 安全说明

- 上传接口仅限管理员使用（后台所有 `/api/admin/**` 均经 JWT 拦截器校验）
- 后端对上传文件做后缀白名单校验（文件：pdf/html；视频：mp4；缩略图：jpg/png/webp），落盘统一改名 `uuid.后缀`
- HTML 预览使用 `iframe sandbox`（禁用脚本），仅渲染样式与结构
- 生产环境务必：修改 `.env` 中的数据库密码与 `JWT_SECRET`，并修改初始管理员密码
