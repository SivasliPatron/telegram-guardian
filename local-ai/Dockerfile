# syntax=docker/dockerfile:1.7

ARG LLAMA_CPP_IMAGE=ghcr.io/ggml-org/llama.cpp:server-b9445@sha256:8dd148c53936b6e8b0e75309841e66eab13adc50b004a5e86ab1fec477c17d8e
ARG NODE_IMAGE=node:24.18.0-bookworm-slim@sha256:cb4e8f7c443347358b7875e717c29e27bf9befc8f5a26cf18af3c3dec80e58c5

FROM ${NODE_IMAGE} AS node-runtime

FROM alpine:3.22 AS model-downloader

ARG MODEL_REPOSITORY=bartowski/Qwen_Qwen3.5-2B-GGUF
ARG MODEL_REVISION=6521bcb22761828aa55639d1c814a207234c3e70
ARG MODEL_FILE=Qwen_Qwen3.5-2B-Q4_K_M.gguf
ARG MODEL_SIZE=1329766560
ARG MODEL_SHA256=84aeb7fe40e7b833d71303d7f1b9f9c1991b931b5dbd214e0aa48d56a0af1f85

RUN apk add --no-cache ca-certificates curl \
    && mkdir -p /model \
    && curl --fail --location --show-error --silent \
      --retry 5 --retry-delay 5 --retry-all-errors --connect-timeout 30 \
      --output "/model/${MODEL_FILE}" \
      "https://huggingface.co/${MODEL_REPOSITORY}/resolve/${MODEL_REVISION}/${MODEL_FILE}?download=true" \
    && actual_size="$(wc -c < "/model/${MODEL_FILE}" | tr -d '[:space:]')" \
    && test "${actual_size}" = "${MODEL_SIZE}" \
    && echo "${MODEL_SHA256}  /model/${MODEL_FILE}" | sha256sum -c -

FROM ${LLAMA_CPP_IMAGE}

LABEL org.opencontainers.image.title="Telegram Guardian Local AI" \
      org.opencontainers.image.description="Authenticated CPU llama.cpp service with Qwen 3.5 2B Q4_K_M" \
      org.opencontainers.image.source="https://github.com/SivasliPatron/telegram-guardian" \
      org.opencontainers.image.licenses="Apache-2.0" \
      ai.model.repository="bartowski/Qwen_Qwen3.5-2B-GGUF" \
      ai.model.revision="6521bcb22761828aa55639d1c814a207234c3e70" \
      ai.model.file="Qwen_Qwen3.5-2B-Q4_K_M.gguf" \
      ai.model.sha256="84aeb7fe40e7b833d71303d7f1b9f9c1991b931b5dbd214e0aa48d56a0af1f85"

RUN groupadd --system --gid 10001 ai \
    && useradd --system --uid 10001 --gid 10001 --no-create-home \
      --home-dir /nonexistent --shell /usr/sbin/nologin ai \
    && mkdir -p /models /tmp/guardian-ai \
    && chown -R ai:ai /models /tmp/guardian-ai

COPY --from=model-downloader --chown=ai:ai \
  /model/Qwen_Qwen3.5-2B-Q4_K_M.gguf /models/Qwen_Qwen3.5-2B-Q4_K_M.gguf
COPY --from=node-runtime /usr/local/bin/node /usr/local/bin/node
COPY --chown=ai:ai proxy.cjs /app/ai-auth-proxy.cjs

RUN node --version

USER ai

ENV AI_PROXY_HOST=0.0.0.0 \
    AI_PROXY_PORT=8080 \
    AI_PROXY_MAX_REQUEST_BYTES=65536 \
    AI_PROXY_MAX_RESPONSE_BYTES=131072 \
    AI_PROXY_UPLOAD_TIMEOUT_MS=10000 \
    AI_PROXY_INFERENCE_TIMEOUT_MS=120000 \
    AI_PROXY_MAX_CONCURRENCY=2 \
    HOME=/tmp/guardian-ai

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=180s --retries=5 \
  CMD ["curl", "--fail", "--silent", "--show-error", "http://127.0.0.1:8080/health"]

ENTRYPOINT ["node", "/app/ai-auth-proxy.cjs"]

CMD ["--model", "/models/Qwen_Qwen3.5-2B-Q4_K_M.gguf", \
     "--alias", "guardian-qwen-3.5-2b", \
     "--ctx-size", "8192", \
     "--parallel", "2", \
     "--threads", "5", \
     "--threads-batch", "5", \
     "--n-predict", "512", \
     "--cont-batching", \
     "--cache-prompt", \
     "--chat-template-kwargs", "{\"enable_thinking\":false}", \
     "--no-webui", \
     "--no-slots"]
