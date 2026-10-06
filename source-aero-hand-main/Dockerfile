FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /workspace

RUN apt-get update \
    && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements-docker.txt /tmp/requirements-docker.txt
RUN python -m pip install --no-cache-dir -r /tmp/requirements-docker.txt

COPY . .

EXPOSE 3245 8765 8888
