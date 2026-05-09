FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    default-jdk \
    g++ \
    util-linux \
    && rm -rf /var/lib/apt/lists/*

# Non-root user — submitted code (run as the same user that runs FastAPI)
# never gets root inside the container.
RUN useradd -m -u 10001 -s /usr/sbin/nologin runner

WORKDIR /app

COPY judge-server/requirements.txt ./judge-server/requirements.txt
RUN pip install --no-cache-dir -r judge-server/requirements.txt

COPY judge-server/ ./judge-server/
COPY data/ ./data/

# Only the log directory needs to be writable by the runner.
RUN mkdir -p /app/judge-server/client_logs \
 && chown -R runner:runner /app/judge-server/client_logs

ENV DATA_DIR=/app/data
ENV PYTHONUNBUFFERED=1

WORKDIR /app/judge-server

USER runner

EXPOSE 8000

CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]