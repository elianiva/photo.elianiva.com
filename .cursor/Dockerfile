FROM node:26-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        git \
        openssl \
        sudo \
    && rm -rf /var/lib/apt/lists/* \
    && corepack enable

USER ubuntu
