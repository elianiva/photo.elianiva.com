FROM node:26-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        git \
        openssl \
        sudo \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 1000 ubuntu \
    && useradd --uid 1000 --gid ubuntu --create-home --shell /bin/bash ubuntu \
    && echo 'ubuntu ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/ubuntu

USER ubuntu
