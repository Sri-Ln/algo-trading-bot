FROM node:22-bookworm

ARG TZ=America/New_York
ENV TZ="$TZ"
ARG CLAUDE_CODE_VERSION=latest
ARG PYTHON_VERSION=3.12

RUN apt-get update && apt-get install -y --no-install-recommends \
    less \
    git \
    procps \
    sudo \
    man-db \
    unzip \
    gnupg2 \
    gh \
    iptables \
    ipset \
    iproute2 \
    dnsutils \
    aggregate \
    jq \
    nano \
    vim \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /usr/local/bin/

RUN mkdir -p /usr/local/share/npm-global /commandhistory /workspace \
        /home/node/.claude /home/node/.config/gh \
    && touch /commandhistory/.bash_history \
    && chown -R node:node /usr/local/share /commandhistory /workspace /home/node

ENV DEVCONTAINER=true
ENV NPM_CONFIG_PREFIX=/usr/local/share/npm-global
ENV PATH=$PATH:/usr/local/share/npm-global/bin:/home/node/.local/bin
ENV SHELL=/bin/bash
ENV EDITOR=nano
ENV VISUAL=nano
ENV UV_PYTHON=$PYTHON_VERSION
ENV UV_LINK_MODE=copy
ENV DISABLE_AUTOUPDATER=1

WORKDIR /workspace
USER node

RUN echo "export PROMPT_COMMAND='history -a' HISTFILE=/commandhistory/.bash_history" >> /home/node/.bashrc

# Python is installed at build time: the runtime firewall does not allow
# the GitHub release CDN that uv downloads interpreters from.
RUN uv python install "$PYTHON_VERSION"
RUN npm install -g @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}

COPY init-firewall.sh /usr/local/bin/
USER root
RUN chmod +x /usr/local/bin/init-firewall.sh \
    && echo "node ALL=(root) NOPASSWD: /usr/local/bin/init-firewall.sh" > /etc/sudoers.d/node-firewall \
    && chmod 0440 /etc/sudoers.d/node-firewall
USER node
