FROM python:3.11-slim

RUN apt-get update && apt-get install -y \
    default-jdk \
    g++ \
    --no-install-recommends && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY judge-server/requirements.txt ./judge-server/requirements.txt
RUN pip install --no-cache-dir -r judge-server/requirements.txt

COPY judge-server/ ./judge-server/

EXPOSE 8000

CMD ["uvicorn", "judge-server.main:app", "--host", "0.0.0.0", "--port", "8000"]
