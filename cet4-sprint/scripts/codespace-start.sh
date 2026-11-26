#!/usr/bin/env bash
set -e
cd "$(dirname "$0")/.."

if [ ! -d node_modules ]; then
  npm ci
fi

npm run build

if curl -fsS --max-time 2 http://127.0.0.1:5174/api/health >/dev/null 2>&1; then
  echo "[CET4] 服务已在运行：端口 5174"
  exit 0
fi

nohup node server/index.js > /tmp/cet4-server.log 2>&1 &
echo $! > /tmp/cet4-server.pid
sleep 2
curl -fsS --max-time 5 http://127.0.0.1:5174/api/health >/dev/null
echo "[CET4] 服务已启动：端口 5174（日志 /tmp/cet4-server.log）"
