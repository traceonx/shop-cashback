#!/bin/sh
# 单容器启动：未提供 DATABASE_URL 时使用镜像内置 PostgreSQL（数据在 $DATA_DIR/postgres，仅容器内 127.0.0.1 可访问）。
set -e
DATA_DIR="${DATA_DIR:-/app/data}"

# 以 root 启动时：修正数据目录权限；若挂载了 docker.sock（一键更新），把 node 加入其所属组；然后降权为 node 运行
if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA_DIR" && chown node:node "$DATA_DIR"
  if [ -z "$DATABASE_URL" ]; then
    # PostgreSQL 要求数据目录权限为 0700/0750。NAS 共享目录常带继承 ACL（新目录自动 777），先清除再收紧权限
    pg="$DATA_DIR/postgres"
    mkdir -p "$pg"
    setfacl -k -b "$DATA_DIR" 2>/dev/null || true
    setfacl -R -k -b "$pg" 2>/dev/null || true
    chown -R node:node "$pg"
    chmod 700 "$pg"
    mode=$(stat -c %a "$pg")
    if [ "$mode" != "700" ] && [ "$mode" != "750" ]; then
      echo "错误：$pg 权限为 $mode，所在文件系统不允许设置为 700，内置 PostgreSQL 无法启动。"
      echo "解决：把 compose 中的 ./data 换成本地磁盘目录，或单独为数据库使用 Docker 卷："
      echo "  volumes:"
      echo "    - ./data:/app/data"
      echo "    - pgdata:/app/data/postgres"
      sleep 30
      exit 1
    fi
  fi
  sock="${UPDATE_DOCKER_SOCKET:-/var/run/docker.sock}"
  if [ -S "$sock" ]; then
    gid=$(stat -c %g "$sock")
    group=$(getent group "$gid" | cut -d: -f1)
    if [ -z "$group" ]; then group=dockerhost; addgroup -g "$gid" "$group"; fi
    addgroup node "$group" 2>/dev/null || true
  fi
  exec su-exec node "$0" "$@"
fi
echo "拾惠返利 v${APP_VERSION:-$(node -p "require('./package.json').version")}（提交 $(echo "${GIT_SHA:-dev}" | cut -c1-7)${BUILD_TIME:+，构建于 $BUILD_TIME}）"

if [ -n "$DATABASE_URL" ]; then
  node node_modules/prisma/build/index.js migrate deploy
  exec node dist/main.js
fi

PGDATA="$DATA_DIR/postgres"
export PGHOST=127.0.0.1 PGPORT=5432 PGUSER=rebate
if [ ! -s "$PGDATA/PG_VERSION" ]; then
  echo "初始化内置数据库：$PGDATA"
  initdb -D "$PGDATA" -U rebate --auth=trust -E UTF8 --locale=C >/dev/null
  printf "listen_addresses = '127.0.0.1'\nunix_socket_directories = '/tmp'\n" >> "$PGDATA/postgresql.conf"
fi
# 容器重启后不会有残留的 PostgreSQL 进程，旧 pid 文件直接清理
rm -f "$PGDATA/postmaster.pid"
pg_ctl -D "$PGDATA" -w -t 60 -l "$DATA_DIR/postgres.log" start >/dev/null
psql -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = 'rebate'" | grep -q 1 || createdb rebate
export DATABASE_URL="postgresql://rebate@127.0.0.1:5432/rebate"

stop() {
  [ -n "$child" ] && kill -TERM "$child" 2>/dev/null && wait "$child" 2>/dev/null
  pg_ctl -D "$PGDATA" -m fast -w stop >/dev/null
  exit 0
}
trap stop TERM INT

node node_modules/prisma/build/index.js migrate deploy
node dist/main.js &
child=$!
set +e
wait "$child"
code=$?
pg_ctl -D "$PGDATA" -m fast -w stop >/dev/null
exit $code
