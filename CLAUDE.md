# 项目约定

- 每次提交都要升级版本号：同时修改 `package.json`、`apps/server/package.json`、`apps/admin/package.json` 与 `package-lock.json` 中的 version，并在 `CHANGELOG.md` 顶部新增该版本条目。修复升 patch，新功能 / 部署变化升 minor。**正式版发布前版本号保持 0.x，不得升到 1.0**（由用户决定何时发布 1.0）。
- 提交前运行 `npm run typecheck` 与全部单元测试，并检查 `scripts/smoke.mjs` 中是否有受改动影响的断言；镜像通过 GitHub Actions 构建并推送到 Docker Hub `sunqz/shop-cashback`。
- 部署为单容器（内置 PostgreSQL，数据在 `/app/data` 卷）；不要提交真实密钥或 `.env`。
- 出站代理只用环境变量 `PROXY_HOST`（如 `http://192.168.5.199:7890`），仅 Docker Hub 版本查询 / 一键更新镜像下载（`registry-pull.ts`）与 Telegram 等境外服务走代理（见 `apps/server/src/proxy.ts` 的 PROXIED），国内接口一律直连，不做界面配置。
