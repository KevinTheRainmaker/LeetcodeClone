#!/bin/sh
set -e

# Railway volumes mount as root:root. Fix ownership so the non-root
# runner user can write logs, then drop privileges before exec'ing uvicorn.
chown -R 10001:10001 /app/judge-server/client_logs

exec gosu runner uvicorn main:app --host 0.0.0.0 --port "${PORT:-8000}"
