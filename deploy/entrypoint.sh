#!/bin/sh
# 单容器启动：未提供 DATABASE_URL 时使用镜像内置 PostgreSQL（数据在 $DATA_DIR/postgres，仅容器内 127.0.0.1 可访问）。
set -e
echo "拾惠返利 v${APP_VERSION:-$(node -p "require('./package.json').version")}（提交 $(echo "${GIT_SHA:-dev}" | cut -c1-7)${BUILD_TIME:+，构建于 $BUILD_TIME}）"
DATA_DIR="${DATA_DIR:-/app/data}"

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
