# 单镜像：NestJS API + 管理后台静态页面，同一端口对外提供服务。
FROM node:22-alpine AS build
RUN apk add --no-cache openssl
WORKDIR /app
COPY package*.json ./
COPY apps/admin/package.json apps/admin/package.json
COPY apps/server/package.json apps/server/package.json
RUN npm ci
COPY apps ./apps
ARG GIT_SHA=dev
ENV GIT_SHA=$GIT_SHA
COPY prisma ./prisma
RUN npx prisma generate
RUN npm run build

FROM node:22-alpine AS app
# 内置 PostgreSQL：未设置 DATABASE_URL 时单容器运行；设置后连接外部数据库。
RUN apk add --no-cache openssl postgresql16 postgresql16-client su-exec
ARG APP_VERSION= GIT_SHA=dev BUILD_TIME=
ENV APP_VERSION=$APP_VERSION GIT_SHA=$GIT_SHA BUILD_TIME=$BUILD_TIME
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3001 ADMIN_DIST=/app/public DATA_DIR=/app/data \
    PATH=/usr/libexec/postgresql16:$PATH
WORKDIR /app
RUN mkdir -p /app/data && chown node:node /app/data
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/server/dist ./dist
COPY --from=build /app/apps/admin/dist ./public
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/package.json ./package.json
COPY --chmod=755 deploy/entrypoint.sh /entrypoint.sh
# 入口以 root 启动，完成权限处理后通过 su-exec 降权为 node
VOLUME /app/data
EXPOSE 3001
HEALTHCHECK --interval=10s --start-period=60s --timeout=5s CMD node -e "fetch('http://127.0.0.1:3001/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/entrypoint.sh"]
