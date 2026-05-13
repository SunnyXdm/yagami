FROM python:3.12-alpine

RUN apk add --no-cache ffmpeg libjpeg-turbo zlib \
    && apk add --no-cache --virtual .build-deps gcc musl-dev python3-dev postgresql-dev jpeg-dev zlib-dev cargo rust
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt \
    && apk del .build-deps
COPY . .
ENTRYPOINT ["python", "-m", "telegram_client"]
