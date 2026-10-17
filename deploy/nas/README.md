# Docker / NAS 部署

与 tg-vault 一样使用 Compose、数据卷、自动重启和日志轮转。此项目分为前端、API、PostgreSQL 三个容器，只有前端端口对宿主机开放。默认使用 8081，避免与 tg-vault 的 8080 冲突。

## 构建并传输镜像

在项目根目录执行（先按根目录 README 初始化 `.env`）：

```sh
docker compose build
docker save -o shop-cashback-images.tar shop-cashback-server:local shop-cashback-admin:local
```

把镜像包及本目录的 `compose.yaml`、`.env.example` 复制到 NAS 的独立项目目录。构建机与 NAS 的 CPU 架构需一致；跨架构构建需指定对应平台并另行验证。

## NAS 启动

```sh
docker load -i shop-cashback-images.tar
cp .env.example .env
```

填写 `.env` 中三个基础密钥：数据库密码可使用 `openssl rand -hex 24`，JWT 密钥可使用 `openssl rand -hex 48`，加密密钥使用 `openssl rand -hex 32`。不要在更新时重新生成。也可将镜像上传到自己的仓库，修改 `SERVER_IMAGE` / `ADMIN_IMAGE` 为版本标签后拉取。

```sh
docker compose up -d --wait
docker compose ps
docker compose logs --tail=100 server
```

打开 `http://NAS地址:8081`，首次创建用户名和密码，然后在后台填写联盟与企业微信配置。无需在 NAS 安装 Node.js。企业微信回调需要在现有反向代理配置公网 HTTPS 域名，转发到此端口。

## 数据、更新和备份

账户、订单、平台配置和审计保存在 PostgreSQL 卷中。普通重建容器和 `docker compose down` 保留数据，**不要使用 `down -v`**。本地开发数据库不会自动迁移到 NAS。

更新前备份数据库和 `.env`，然后加载或拉取新版本镜像，执行 `docker compose up -d --wait`。API 启动自动执行数据库迁移；涉及结构变化时不要只回滚镜像，需配合兼容的数据库备份。

在 NAS 的 Linux shell 中备份：

```sh
docker compose exec -T postgres pg_dump -U rebate -d rebate -Fc > rebate.dump
```

将备份文件及 `.env` 保存在安全位置。加密密钥丢失后，数据库中的平台凭证无法解密。迁移现有数据需同时迁移数据库与原加密密钥。
