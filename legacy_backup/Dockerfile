FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    SMART_PANEL_DATA_DIR=/data \
    SMART_PANEL_API_PORT=5000

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY android_tv_power.py manage_users.py pair_android_tv.py servidor.py ./

VOLUME ["/data"]

EXPOSE 5000

CMD ["python", "servidor.py"]
