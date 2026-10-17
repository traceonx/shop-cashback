# 项目约定

- 每次提交都要升级版本号：同时修改 `package.json`、`apps/server/package.json`、`apps/admin/package.json` 与 `package-lock.json` 中的 version，并在 `CHANGELOG.md` 顶部新增该版本条目。修复升 patch，新功能 / 部署变化升 minor。
- 提交前运行 `npm run typecheck`；镜像通过 GitHub Actions 构建并推送到 Docker Hub `sunqz/shop-cashback`。
- 部署为单容器（内置 PostgreSQL，数据在 `/app/data` 卷）；不要提交真实密钥或 `.env`。
