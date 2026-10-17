# 更新日志

版本号唯一来源为根目录 `package.json`。每次提交同步修改版本号并在此记录；镜像同时发布 `latest`、版本号（如 `0.3.0`）与 `sha-xxxxxxx` 标签。
容器启动日志第一行、`GET /api/v1/health` 和后台左下角都会显示当前版本与提交号，可用于核对实际运行的是哪个版本。

规则：修复 / 小调整升 patch（0.3.0 → 0.3.1）；新功能或部署方式变化升 minor（0.3.x → 0.4.0）。

## 0.4.1 · 2026-10-17

- 部署 compose 改为把数据放在同级目录 `./data`（替代 Docker 命名卷），便于直接备份和迁移。

## 0.4.0 · 2026-10-17

- 新增一键更新（参考 assast/outlookEmail）：后台「系统设置 → 版本更新」显示当前版本与 Docker Hub 最新版本，点击后通过挂载的 docker.sock 临时启动 watchtower 拉取新镜像并重建容器，数据保留；更新状态持久化，重启后自动判断成功与否。
- 容器以 root 启动后自动加入 docker.sock 所属组，再降权为 node 运行。
- 镜像固定为版本号标签时禁用一键更新并提示原因。

## 0.3.0 · 2026-10-17

- 新增版本号：启动日志、健康检查接口、后台侧边栏显示版本与提交号；镜像增加版本号标签。
- 单容器部署：镜像内置 PostgreSQL，未设置 `DATABASE_URL` 时自动初始化并使用 `/app/data`；设置后连接外部数据库。
- 前后端合并为单镜像 `sunqz/shop-cashback`，由 NestJS 提供后台页面，删除 nginx / Caddy。
- `JWT_SECRET`、`CONFIG_ENCRYPTION_KEY` 可不配置，首次启动自动生成并保存到 `/app/data/secrets.json`。
- 修复通过 `http://IP:端口` 访问后台页面空白（去掉 CSP `upgrade-insecure-requests` 与 HSTS）。
- GitHub Actions 拆分为 verify → build（amd64 / arm64 原生构建）→ push。
- 本地开发 `npm run dev` 一条命令启动数据库、迁移和前后端。

## 0.2.0

- 真实数据版本：移除演示数据，接入 PostgreSQL、京东联盟插件、企业微信回调与人工提现流程（详见 docs/）。
