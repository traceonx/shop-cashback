# 更新日志

版本号唯一来源为根目录 `package.json`。每次提交同步修改版本号并在此记录；镜像同时发布 `latest`、版本号（如 `0.3.0`）与 `sha-xxxxxxx` 标签。
容器启动日志第一行、`GET /api/v1/health` 和后台左下角都会显示当前版本与提交号，可用于核对实际运行的是哪个版本。

规则：修复 / 小调整升 patch（0.3.0 → 0.3.1）；新功能或部署方式变化升 minor（0.3.x → 0.4.0）。

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
