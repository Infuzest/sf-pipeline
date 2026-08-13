FROM node:22-bookworm-slim@sha256:d649c27dae7ba0137b3cef5dd75baa422c08dc3d9e3fc0c23dfb172dc3cc6436

ARG SF_CLI_VERSION=2.142.7
ARG SGD_VERSION=6.45.1
ARG CODE_ANALYZER_VERSION=5.14.0

LABEL org.opencontainers.image.title="OrbitOps Salesforce CI toolbox" \
      org.opencontainers.image.description="Version-pinned Salesforce CLI, delta and code-analysis tools for OrbitOps pipelines" \
      org.opencontainers.image.source="https://github.com/Xyraxel/sf-pipeline" \
      org.opencontainers.image.licenses="MIT"

ENV DEBIAN_FRONTEND=noninteractive \
    SF_CONTAINER_MODE=true \
    SFDX_CONTAINER_MODE=true \
    SF_AUTOUPDATE_DISABLE=true \
    SF_DISABLE_TELEMETRY=true \
    SF_USE_GENERIC_UNIX_KEYCHAIN=true \
    XDG_DATA_HOME=/opt/orbitops/share \
    SHELL=/bin/bash

# The workflow scripts also use GitHub CLI, Java-backed PMD rules, Python-backed
# Flow Scanner rules, Git over SSH, and common archive/network utilities.
RUN apt-get update \
    && apt-get install --yes --no-install-recommends \
        bash \
        ca-certificates \
        curl \
        gh \
        git \
        git-lfs \
        jq \
        openjdk-17-jdk-headless \
        openssh-client \
        openssl \
        python3 \
        unzip \
        zip \
    && rm -rf /var/lib/apt/lists/*

RUN npm install --global "@salesforce/cli@${SF_CLI_VERSION}" \
    && echo y | sf plugins install "sfdx-git-delta@${SGD_VERSION}" \
    && echo y | sf plugins install "@salesforce/plugin-code-analyzer@${CODE_ANALYZER_VERSION}" \
    && test "$(sf version --json | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).cliVersion')" = "@salesforce/cli/${SF_CLI_VERSION}" \
    && sf sgd --help >/dev/null \
    && sf code-analyzer --help >/dev/null \
    && HOME=/github/home sf sgd --help >/dev/null \
    && npm cache clean --force

ENV DEBIAN_FRONTEND=dialog

CMD ["bash"]
