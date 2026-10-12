# Lee's 工作台

个人自用的 Web 工作台。左侧菜单、右侧功能，内置 DeepSeek Harness 入口，支持多主题切换与基于角色的访问控制。

线上地址：`http://47.119.128.59`（阿里云 ECS，华南 1 深圳）

## 架构

```
浏览器
  │
  ├─ /                → Nginx → 工作台后端(127.0.0.1:3001) → 前端静态资源
  ├─ /wb-api/*        → Nginx → 工作台后端（登录鉴权 + RBAC）
  ├─ /dsh/*           → Nginx → auth_request 校验登录态 → DSH(127.0.0.1:3080)  ← 页面
  └─ /api/*           → Nginx → auth_request 校验登录态 → DSH(127.0.0.1:3080)  ← 数据通道
```

> **为什么 `/api` 归 DSH？**
> DSH 前端的页面资源用相对路径（`./assets/…`），但**数据请求写死为绝对路径 `/api/…`**，
> 其中 `/api/remote.mux` 是 WebSocket 主通道，设置镜像（settings mirror）就跑在上面。
> 若把 DSH 放在子路径下，`/api/*` 会被送进工作台后端返回 404，导致数据通道断开，
> 表现为「设置 → 模型」报 `settings are unavailable in this browser`。
> 因此工作台自身接口统一改为 `/wb-api`，把 `/api` 整段让给 DSH。

DSH 只监听 `127.0.0.1:3080`，安全组不放行该端口，因此**唯一入口就是工作台**：

1. 未登录访问 `/dsh/` 或 `/api/*` → `302 /harness?denied=1`
2. 已登录但无 `dsh:access` 权限 → `403` → 同样被拦截
3. 已登录有权限，但 DSH 未启动 → 页面 `302 /harness?dsh=down`；数据接口 `503 {"error":"DeepSeek Harness 未启动"}`
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

## 配置 DeepSeek Harness 的模型 API Key

DSH 按需启停，**在 GUI 里保存的设置可能因远程浏览器的 memory 作用域而在重启后丢失**。
推荐把 Key 写进环境变量文件，持久生效：

```bash
sudo vi /opt/workbench/dsh.env     # 或 sudo nano

# 去掉对应行的注释，填入 Key，例如：
#   DEEPSEEK_API_KEY=sk-xxxxxxxxxxxx
#   QWEN_TOKEN_PLAN_CN_API_KEY=sk-xxxxxxxxxxxx   # 阿里云百炼 / 通义千问
#   OPENAI_API_KEY=sk-xxxxxxxxxxxx
```

该文件由 `dsh.service` 通过 `EnvironmentFile` 注入，权限 `600`、属主 `dsh`，**不入库**。改完后在工作台「DeepSeek Harness」页点「停止」再「启动」即可生效。

也可以通过 GUI 配置（设置 → 模型），但重启 DSH 后建议核对是否保留。

## 游客免登录

登录页有「以游客身份进入」按钮，无需密码即可进入。游客由数据库里的 `guest` 账号 + `guest` 角色承载：

| 能力 | 游客 |
|---|---|
| 浏览首页（时钟 / 日历 / 天气） | ✅ |
| DSH 已启动时进入使用 | ✅（工作台下发一次性 token） |
| 启停 DSH | ❌ |
| 查看系统资源看板 | ❌ |
| 用户/角色/审计等管理功能 | ❌ |
| 修改密码 | ❌（游客无密码） |

实现要点：

- `guest` 账号在数据库初始化时自动创建，**密码是一次性随机串**，任何人都无法用密码登录，只能走 `POST /wb-api/auth/guest`
- 游客会话 TTL 默认 12 小时（正式登录是 7 天），按 IP 限流：默认 5 分钟内最多 30 个
- 接口侧除 RBAC 外另有一层 `denyGuest` 护栏，用于「登录即可访问」但不该给游客的端点（角色列表、DSH 日志、启停记录）
- 关闭入口：`.env` 里设 `GUEST_ENABLED=false` 并重启 workbench

后续要限制游客的 token 用量，改点在两处：`routes/dsh.js` 的 `present()`（控制 token 是否下发）与 `routes/auth.js` 的游客会话创建处（可增加配额记录）。

## 首页（默认落地页）

登录成功或游客进入后统一跳转 `/`，首页对所有登录角色开放（不挂权限码），包含三块日常组件：

- **时钟**：大号时间 + 秒、公历日期、星期、农历（用浏览器内置 `Intl` 中文日历，不支持时自动省略），以及「今日已过 / 今年已过」两条进度条
- **日历**：周一为起点的月历，今天高亮，每格附农历；可翻月、点选日期、一键回到今天
- **天气**：当前温度、天气描述、体感 / 湿度 / 风速，外加未来三天预报；可输入城市名切换，选择记在 localStorage

天气数据来自 Open-Meteo（免费、无需 API Key），由后端代理 `GET /wb-api/weather?q=城市名`：

- 不写 `q` 时用 `.env` 的 `WEATHER_CITY / WEATHER_LAT / WEATHER_LON` 默认城市（默认深圳）
- 进程内缓存：预报 10 分钟、地理编码 24 小时，同 key 并发请求合并，上游 8 秒超时
- 由后端代理而非浏览器直连：出网更稳、多用户共享缓存、换服务商不用改前端
- 城市找不到时返回 502 + 友好文案，前端显示提示卡片而不是报错

## 系统状态页（原实时看板）

实时看板已迁到 `/system`（侧边栏「系统状态」），需 `system:view` 权限，游客与无权限角色只能看到说明卡片。

- 指标：CPU 使用率、内存、磁盘、SWAP 四个环形仪表，外加 CPU / 内存趋势曲线、网络上下行、负载、进程数、运行时长
- 刷新频率可选 1s / 3s / 5s / 10s（默认 3s，选择记在 localStorage），可随时暂停
- CPU 使用率与网络速率需要「两个时间点之差」，由 `server/src/services/metrics.js` 后台每 2 秒采样一次（读 `/proc/stat` 与 `/proc/net/dev`），接口只返回最近一次结果，因此前端高频轮询几乎没有额外开销

## 移动端适配

≤820px 时侧边栏变为**抽屉**：默认移出屏幕，顶部出现菜单按钮，点按钮滑出、点遮罩或切换页面自动收起。内容区始终占满全宽，不再被侧边栏遮挡。

其他适配点：

- 宽表格（用户、审计）包在 `.table-wrap.wide` 里，窄屏下横向滚动而不是撑破卡片
- 首页时钟、天气元信息、年度进度条在小屏下收窄为单列
- 用 `100dvh` 替代 `100%`，避免手机浏览器地址栏伸缩导致底部被裁掉
- 主题下拉、登录卡片在小屏下限宽

验证方式：`mobile-check.mjs`（工作区根目录，不入库）用本机 Edge headless + CDP 模拟 390×844 视口，逐页检查横向溢出、抽屉开合与桌面回归，并截图。

## 基金行情分析

分工：**工作台只做存储与展示，行情抓取和买卖判断全部由 WorkBuddy 定时任务里的大模型完成。**

```
WorkBuddy 定时任务（工作日 14:30）
  ├─ GET  /wb-api/funds/holdings   读取持仓清单（令牌鉴权）
  ├─ 抓行情：天天基金估值接口 / 联网搜索消息面
  ├─ 大模型综合判断 → 结构化建议
  └─ POST /wb-api/funds/ingest     写回工作台（令牌鉴权）
                                        │
                                   SQLite 存储
                                        │
                              GET /wb-api/funds → 网页展示
```

新增基金只需在页面「持仓管理」里加一行，定时任务会自动读取，**不用改任务配置**。

数据落三张表：`fund_holdings`（持仓）、`fund_advice`（每日建议，`UNIQUE(code, trade_date)` 覆盖式写入）、`fund_daily`（当日整体结论）。

接口：

| 接口 | 鉴权 | 用途 |
|---|---|---|
| `GET /wb-api/funds` | `fund:view` | 页面数据（按权限裁剪，见下） |
| `GET /wb-api/funds/series?code=` | `fund:view` | 净值走势序列 |
| `GET /wb-api/funds/history?code=` | `fund:detail` | 单只基金的建议历史 |
| `POST/PATCH/DELETE /wb-api/funds/holdings` | `fund:manage` | 持仓维护 |
| `GET /wb-api/funds/holdings` | 写入令牌 | 供定时任务读取持仓 |
| `POST /wb-api/funds/ingest` | 写入令牌 | 写入建议，强校验 |

### 权限分层（信息是否敏感由服务端裁剪）

| 权限 | 默认角色 | 能看到什么 |
|---|---|---|
| `fund:view` | admin / operator / **guest** | 净值、估值、涨跌、操作建议结论、净值走势图 |
| `fund:detail` | admin / operator | 详细分析正文、风险、来源、成本价、份额、投入金额、盈亏 |
| `fund:manage` | admin / operator | 持仓配置页（`/funds/settings`）的增删改 |

**裁剪必须发生在服务端**：无 `fund:detail` 时，`GET /funds` 返回的持仓不含
cost/shares/amount，建议不含 reason/risks/sources，响应里带 `scope: "public"` 标记。
前端隐藏没有意义——数据照样在 HTTP 响应里。

页面结构刻意做薄：列表页每只基金只有一行结论 + 迷你走势，
详细分析、持仓明细、建议历史全部收进「查看详情」弹窗（移动端为底部抽屉）。

### 净值走势图

- 数据表 `fund_nav`（`PRIMARY KEY(code, nav_date)`），覆盖式写入
- 定时任务在 payload 的 `items[].navSeries` 里带历史序列（可选）；
  即使不带，服务端也会把当天的 nav/navDate 自动累积成一个点，图随时间变长
- 前端 `NavChart` 为纯 SVG 手写（`viewBox` + `preserveAspectRatio=none` +
  `vector-effect=non-scaling-stroke`），不引入图表库

### 写入令牌与会话体系完全隔离：

```bash
cd /opt/workbench/server && sudo node src/scripts/rotate-fund-token.js   # 生成/轮换
sudo systemctl restart workbench
```

- 令牌存 `.env` 的 `FUND_INGEST_TOKEN`（600，**不入库**），留空则接口直接 503 关闭
- 只授予「写建议 + 读持仓」，即使泄露也无法操作服务器或访问其他接口
- 用 `timingSafeEqual` 做常量时间比较，避免时序侧信道
- 轮换后需同步更新定时任务里的 Authorization 头

写入侧强校验：日期、代码、action（只能是 `buy/add/hold/reduce/sell`）、confidence 任一不合法就**整批拒绝并返回明细**，脏数据不会入库污染展示。

页面（`fund:view`，默认 admin + operator，游客与只读角色无此权限）：当日整体结论、每只基金的净值/估值/持仓盈亏/建议徽章/理由/风险/来源、建议历史回看、持仓管理表格。数据缺失时展示空态提示而非报错，页面底部常驻免责声明。

## 安全注意事项

- `.env`、`dsh.env` 与 `data/*.db` 已加入 `.gitignore`，不会入库
- DSH 具备命令执行与文件读写能力，以无 sudo 权限的 `dsh` 用户运行，工作目录隔离在 `/home/dsh/workspace`
- 当前为 HTTP 访问；绑定域名后建议配置 HTTPS，并将 `.env` 中的 `SECURE_COOKIE` 改为 `true`
- 服务器位于中国内地，通过域名对外提供服务需完成 ICP 备案
- 绑定域名后需在 `deploy/dsh.service` 的 `--trusted-host` 中追加域名，否则 DSH 的主机校验会拦截访问
