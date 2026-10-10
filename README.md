# Lee's 工作台

个人自用的 Web 工作台。左侧菜单、右侧功能，内置 DeepSeek Harness 入口，支持多主题切换与基于角色的访问控制。

线上地址：`http://47.119.128.59`（阿里云 ECS，华南 1 深圳）

## 架构

```
浏览器
  │
  ├─ /                → Nginx → 工作台后端(127.0.0.1:3001) → 前端静态资源
  ├─ /api/*           → Nginx → 工作台后端（登录鉴权 + RBAC）
  └─ /dsh/*           → Nginx → auth_request 校验登录态 → DSH(127.0.0.1:3080)
```

DSH 只监听 `127.0.0.1:3080`，安全组不放行该端口，因此**唯一入口就是工作台**：

1. 未登录访问 `/dsh/` → `302 /harness?denied=1`
2. 已登录但无 `dsh:access` 权限 → `403` → 同样被拦截
3. 已登录有权限，但 DSH 未启动 → 反代连接被拒 → `302 /harness?dsh=down`
4. 正常情况 → 打开 DSH 官方原生界面（新标签页）

## 技术栈

| 层 | 选型 | 说明 |
| --- | --- | --- |
| 前端 | React 18 + Vite 5 + TypeScript | 本地构建，产物上传服务器 |
| 后端 | Node.js 22 + Express 4 | 原生 ESM，无需编译步骤 |
| 数据库 | SQLite（better-sqlite3） | 单文件、零常驻内存开销 |
| 反向代理 | Nginx 1.18 | 含 `auth_request` 鉴权子请求 |
| 进程管理 | systemd | `workbench`（常驻）、`dsh`（按需） |

## 目录结构

```
server/            后端
  src/
    config.js        配置（读取 .env）
    db/
      schema.sql     建表 SQL
      index.js       连接 + 迁移 + 基础数据
      repo.js        数据访问层
    lib/            密码哈希(scrypt) / 会话令牌
    middleware/     鉴权中间件
    routes/         auth / dsh / admin / system
    services/dsh.js DSH 启停与状态
    scripts/        初始化与重置管理员
  .env.example      配置模板（.env 不入库）

web/               前端
  src/
    themes/         主题（一个主题 = 一个文件）
    components/     Sidebar / ThemePicker / Icon
    pages/          Login / Overview / Dsh / System / Users / Audit / Settings
    styles/         全局样式与动画

deploy/
  nginx-workbench.conf   Nginx 配置
  workbench.service      systemd 单元
  dsh.service            DSH systemd 单元
  setup.sh               一键部署脚本
```

## 权限模型（RBAC）

表结构见 `server/src/db/schema.sql`，共 9 张表：

`users` · `roles` · `permissions` · `user_roles` · `role_permissions` · `sessions` · `login_attempts` · `audit_logs` · `dsh_runs`

预置角色：

| 角色 | 权限 |
| --- | --- |
| `admin` | 全部 |
| `operator` | `overview:view` `dsh:access` `dsh:start` `dsh:stop` `system:view` |
| `viewer` | `overview:view` |

新增功能时在 `permissions` 插一行权限码，再分配给角色即可；菜单和按钮按权限码渲染，无需改组件。

安全基线：scrypt 密码哈希、会话只存令牌哈希、Cookie `HttpOnly + SameSite=Lax`、连续 5 次失败锁定 15 分钟、全部敏感操作写审计日志。

## 主题系统

「一个主题 = 一个文件」。新增主题只需两步，业务组件无需改动：

1. 在 `web/src/themes/` 复制 `aurora.ts` 改名，调整 `vars` 里的 CSS 变量
2. 在 `web/src/themes/index.ts` 的 `THEMES` 数组中加一行

切换主题时修改 `document.documentElement.dataset.theme`，全站配色通过 CSS transition 平滑过渡，选择保存在 localStorage。动效统一尊重系统的「减少动效」设置。

内置：极光（冷调深色）、暖砂（暖色浅色）、深空（深底高饱和）。

## 部署

```bash
# 1. 本地构建前端
cd web && npm install && npm run build

# 2. 服务器执行（需先安装 Node 22 与 Nginx）
cd Lee-space && bash deploy/setup.sh
```

`setup.sh` 会同步代码、安装依赖、初始化数据库、安装 systemd 单元与 Nginx 配置。首次运行会打印管理员初始密码。

重置管理员密码：

```bash
cd /opt/workbench/server && node src/scripts/reset-admin.js admin --force
```

## 安全注意事项

- `.env` 与 `data/*.db` 已加入 `.gitignore`，不会入库
- DSH 具备命令执行与文件读写能力，以无 sudo 权限的 `dsh` 用户运行，工作目录隔离在 `/home/dsh/workspace`
- 当前为 HTTP 访问；绑定域名后建议配置 HTTPS，并将 `.env` 中的 `SECURE_COOKIE` 改为 `true`
- 服务器位于中国内地，通过域名对外提供服务需完成 ICP 备案
- 绑定域名后需在 `deploy/dsh.service` 的 `--trusted-host` 中追加域名，否则 DSH 的主机校验会拦截访问
