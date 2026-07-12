# syntax=docker/dockerfile:1.7

ARG WHISPER_CPP_IMAGE=ghcr.io/ggml-org/whisper.cpp:main-27101c01dcac1676e2b6422256233cd0f1f9ae28@sha256:ba17fe734cb923e8c4d93cf3031cb9e5121a1b1dfacc1f80f1b453e30c735b33
ARG NODE_IMAGE=node:24.18.0-bookworm-slim@sha256:cb4e8f7c443347358b7875e717c29e27bf9befc8f5a26cf18af3c3dec80e58c5

FROM ${NODE_IMAGE} AS node-runtime

FROM alpine:3.22 AS model-downloader

ARG MODEL_REPOSITORY=ggerganov/whisper.cpp
ARG MODEL_REVISION=5359861c739e955e79d9a303bcbc70fb988958b1
ARG MODEL_FILE=ggml-small.bin
ARG MODEL_SIZE=487601967
ARG MODEL_SHA256=1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b

RUN apk add --no-cache ca-certificates curl \
    && mkdir -p /model \
    && curl --fail --location --show-error --silent \
      --retry 5 --retry-delay 5 --retry-all-errors --connect-timeout 30 \
      --output "/model/${MODEL_FILE}" \
      "https://huggingface.co/${MODEL_REPOSITORY}/resolve/${MODEL_REVISION}/${MODEL_FILE}?download=true" \
    && actual_size="$(wc -c < "/model/${MODEL_FILE}" | tr -d '[:space:]')" \
    && test "${actual_size}" = "${MODEL_SIZE}" \
    && echo "${MODEL_SHA256}  /model/${MODEL_FILE}" | sha256sum -c -

FROM ${WHISPER_CPP_IMAGE}

LABEL org.opencontainers.image.title="Telegram Guardian Local ASR" \
      org.opencontainers.image.description="Authenticated CPU whisper.cpp transcription service with multilingual Whisper small" \
      org.opencontainers.image.source="https://github.com/SivasliPatron/telegram-guardian" \
      org.opencontainers.image.licenses="MIT" \
      ai.model.repository="ggerganov/whisper.cpp" \
      ai.model.revision="5359861c739e955e79d9a303bcbc70fb988958b1" \
      ai.model.file="ggml-small.bin" \
      ai.model.sha256="1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b"

RUN apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/* \
    && rm -f /app/models/ggml-base.en.bin \
    && groupadd --system --gid 10001 asr \
    && useradd --system --uid 10001 --gid 10001 --no-create-home \
      --home-dir /nonexistent --shell /usr/sbin/nologin asr \
    && mkdir -p /models \
    && chown -R asr:asr /models

COPY --from=model-downloader --chown=asr:asr \
  /model/ggml-small.bin /models/ggml-small.bin
COPY --from=node-runtime /usr/local/bin/node /usr/local/bin/node
COPY --chown=asr:asr proxy.cjs /app/asr-auth-proxy.cjs

RUN node --version

USER asr

ENV ASR_HOST=0.0.0.0 \
    ASR_PORT=8080 \
    ASR_MAX_UPLOAD_BYTES=4000000 \
    ASR_MAX_RESPONSE_BYTES=1048576 \
    ASR_UPLOAD_TIMEOUT_MS=30000 \
    ASR_INFERENCE_TIMEOUT_MS=180000 \
    WHISPER_THREADS=5 \
    WHISPER_MAX_DURATION_MS=120000

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=180s --retries=5 \
  CMD ["curl", "--fail", "--silent", "--show-error", "http://127.0.0.1:8080/health"]

ENTRYPOINT ["node", "/app/asr-auth-proxy.cjs"]
