# 全栈项目上线手册（Playbook）

> 沉淀自「赛博技术秀场网站」从 0 到上线的实战流程（2026-08），
> 适用于 React + Spring Boot + MySQL 类项目。新项目按本手册顺序执行即可。

## 〇、流程总览

```
环境检查 → 本地开发跑通 → 容器化封装 → 云服务器部署 → 安全组放行
→ 外网验证 → 定时备份/巡检 → GitHub 入库 → 日常迭代发布
```

人机分工边界：**AI 可执行全部代码/命令类工作；安全组放行、域名备案、
GitHub 页面操作（建仓库/挂公钥）只能由人在控制台完成。**

---

## 一、环境准备（本地）

| 工具 | 检查命令 | 本项目实况与备注 |
|------|----------|------------------|
| Node | `node -v` | 16.x（Vite 4 兼容；Vite 5+ 需 Node 18+） |
| JDK | `javac -version` | 1.8 → 选 Spring Boot 2.7；JDK 17 可选 SB 3 |
| Maven | `mvn -v` | 3.9 |
| MySQL | 服务状态 | 8.0，建库 + 专用应用账号（勿用 root 跑应用） |
| Git | `git --version` | 2.55 |

国内网络必备预配置：
- Maven：项目级 `.mvn/settings.xml` 指向阿里云镜像（老 JDK 证书库过旧时
  只有阿里源的根证书能验证通过）
- npm：`--registry=https://registry.npmmirror.com`
- Docker：apt 用 `mirrors.aliyun.com/docker-ce`；registry 加速器配
  `docker.1ms.run`、`docker.m.daocloud.io`（写入 `/etc/docker/daemon.json`
  后必须 `systemctl restart docker` 才生效）

## 二、本地开发与自测

1. 后端：Flyway 管理表结构；接口用 curl 自测（健康检查 + 业务接口）
2. 前端：`vite build` 通过；单包超 500KB 时用 `manualChunks` 分包
3. 联调：dev server 代理 `/api` → `localhost:8080`，无跨域问题
4. 文档三件套先行：`docs/architecture.md`、`deployment.md`、`changelog.md`
   （长期维护会话靠它恢复上下文）

## 三、容器化封装

标准四件套（见本项目 `deploy/` 目录）：

- `docker-compose.yml`：mysql + backend + nginx + frontend-build；
  **所有可调参数用 `${VAR:默认值}` 引用，收敛到同目录 `.env`（配置中心）**
- `.env.example`：唯一配置入口模板，分组注释（端口/数据库/调优/时区）；
  一键脚本基于模板生成 `.env` 并仅随机替换密码，`chmod 600`
- 后端 `Dockerfile`：多阶段构建；`ENTRYPOINT ["sh","-c","java ${JAVA_OPTS:-...} -jar app.jar"]`
  让内存参数可外注
- 前端 `Dockerfile`：构建阶段产出静态资源；**命名卷不会随构建自动更新**，
  输出阶段改为运行时显式复制（`rm -rf /output/* && cp -r /src-dist/. /output/`）
- `scripts/`：deploy.sh（一键）、backup.sh（每日备份保留 7 天）、
  healthcheck.sh（容器/接口/磁盘巡检，异常自动重启）

低配机器（≤2G）调优清单：
- MySQL：`innodb-buffer-pool-size=128M`、`performance-schema=OFF`、`max-connections=50`
- JVM：`-Xms128m -Xmx384m`

## 四、云服务器部署（AI 远程执行模式）

凭据收集：公网 IP、SSH 账号密码、系统版本。
Windows 本地用 **Posh-SSH** 模块实现非交互 SSH：

```powershell
Install-Module Posh-SSH -Force        # 一次性
Import-Module Posh-SSH
$cred = New-Object PSCredential("root", (ConvertTo-SecureString "密码" -AsPlainText -Force))
$s = New-SSHSession -ComputerName IP -Credential $cred -AcceptKey -Force
Invoke-SSHCommand -SessionId $s.SessionId -Command "..." -TimeOut 120
Set-SCPItem -ComputerName IP -Credential $cred -Path 本地路径 -Destination /opt/项目/
```

执行要点：
1. 打包上传：`tar` 排除 `node_modules`/`target`/`.git`/凭据目录
2. 装 Docker：`get.docker.com` 国内常不可达 → 阿里云 apt 源
3. 拉镜像：超时风险高 → **长任务一律 `nohup ... & echo LOG >> /tmp/x.log`
   后台执行 + 本地轮询日志**，不要用前台长命令（SSH 超时会中断）
4. `docker compose up -d --build` → 轮询 `compose ps` 等健康
5. 服务器内冒烟：`/actuator/health`、业务接口、页面标题
6. 注册 crontab：每日备份 + 每 30 分钟巡检，并**真实演练一遍**（不是只注册）

## 五、安全组放行（人工，唯一常见卡点）

阿里云控制台 → ECS → 实例 → 安全组 → 入方向 → 手动添加：
- TCP 80/80，授权对象 0.0.0.0/0
- TCP 443/443（HTTPS 预留）

**诊断方法**：`Test-NetConnection IP -Port 80`——22 通而 80 不通、
服务器内 `curl localhost` 正常，即安全组问题，与代码无关。

## 六、外网验证与交付

```
端口连通（Test-NetConnection）→ 首页 200 且标题匹配 → 各业务接口 → 交付访问地址
```

注意：PowerShell 读 UTF-8 响应先 `GetString` 再按**字符数**截断，
不要在字节数组上用 `Substring`（多字节字符会抛异常）。

## 七、GitHub 入库

1. **敏感拦截先于一切**：`.gitignore` 排除凭据目录、`.env`、发布包；
   提交前 `git grep --cached -l -E "密码|令牌"` 扫描兜底
2. 提交身份：`git config user.name / user.email`（可用 GitHub noreply 邮箱
   `ID+用户名@users.noreply.github.com` 保护隐私）
3. 建仓库：细粒度令牌常无 Administration 权限 → **直接手动建最快**
4. 令牌坑：细粒度令牌默认零权限，推送需 Repository permissions →
   **Contents: Read and write**；403 时看响应头 `X-Accepted-GitHub-Permissions`
   即可定位缺什么
5. **国内网络推送通道**（实测）：
   - `api.github.com:443` 通、`github.com:443` 常被阻断、`ssh.github.com:443` 通
   - 方案：SSH over 443 —— 生成密钥 → 挂公钥到账号 → 配 `~/.ssh/config`：
     ```
     Host github.com
       HostName ssh.github.com
       Port 443
       User git
       IdentityFile ~/.ssh/id_ed25519
     ```
   - Windows 注意：`.ssh` 目录需先手动创建；远程地址改
     `git@github.com:用户名/仓库.git`，免令牌永久可用
6. 收尾：令牌用完即撤销；含令牌的临时脚本删除

## 八、日常迭代发布流程

```
本地改码 → 本地自测 → git commit + push
→ 服务器: cd /opt/项目 && git pull && docker compose up -d --build
→ 冒烟验证 → 更新 changelog
```

改配置：只编辑服务器 `deploy/.env` → `docker compose up -d`（配置中心模式，
本项目 v0.1.5 起）。

## 九、后续扩展预留

- **HTTPS**：域名备案完成后，`nginx-ssl.conf` 模板 + certbot standalone 签发
- **真实 AI 接入**：只替换后端 AiService 的 mock 实现 + 注入 API Key
- **升配调优**：内存翻倍后调大 `.env` 中 BUFFER_POOL 与 JVM 上限

## 十、踩坑速查表

| 现象 | 原因 | 解法 |
|------|------|------|
| Maven PKIX 证书错误 | 老 JDK 证书库过旧 | 项目级 settings.xml 用阿里云镜像 |
| maven.config 报错 | 该文件不支持注释行 | 只留参数行 |
| dev server 404 | PowerShell 默认 Accept 头 | 加 `Accept: text/html` 请求头 |
| 镜像拉取超时 | 直连 docker.io 不通 | 加速器 + 多源循环后台拉取 |
| SSH 长命令中断 | 前台命令超上限 | nohup 后台 + 轮询日志 |
| 22 通 80 不通 | 安全组未放行 | 控制台加入方向规则 |
| compose 卷内容不更新 | 命名卷不随构建覆盖 | 运行时显式复制到卷 |
| GitHub API 403 | 细粒度令牌缺权限 | 按响应头补 Contents:write |
| github.com 连接超时 | 443 被网络阻断 | SSH over ssh.github.com:443 |
