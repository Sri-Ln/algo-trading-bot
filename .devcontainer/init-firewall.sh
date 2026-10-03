#!/bin/bash
# Default-deny egress firewall for the dev container.
# Adapted from github.com/anthropics/claude-code/.devcontainer/init-firewall.sh
# Changes: no blanket outbound SSH, project-specific allowlist, non-fatal
# resolution of optional domains.
set -euo pipefail
IFS=$'\n\t'

ALLOWED_DOMAINS=(
    # Claude Code
    "api.anthropic.com"
    "claude.ai"
    "platform.claude.com"
    "console.anthropic.com"
    "sentry.io"
    # Package registries
    "registry.npmjs.org"
    "pypi.org"
    "files.pythonhosted.org"
    # Market data (yfinance)
    "query1.finance.yahoo.com"
    "query2.finance.yahoo.com"
    "fc.yahoo.com"
    # Broker (Alpaca paper trading)
    "paper-api.alpaca.markets"
    "data.alpaca.markets"
    "stream.data.alpaca.markets"
    # VS Code server and extensions
    "marketplace.visualstudio.com"
    "vscode.blob.core.windows.net"
    "update.code.visualstudio.com"
)

# Preserve Docker's embedded DNS NAT rules before flushing.
DOCKER_DNS_RULES=$(iptables-save -t nat | grep "127\.0\.0\.11" || true)

iptables -F
iptables -X
iptables -t nat -F
iptables -t nat -X
iptables -t mangle -F
iptables -t mangle -X
ipset destroy allowed-domains 2>/dev/null || true

if [ -n "$DOCKER_DNS_RULES" ]; then
    iptables -t nat -N DOCKER_OUTPUT 2>/dev/null || true
    iptables -t nat -N DOCKER_POSTROUTING 2>/dev/null || true
    echo "$DOCKER_DNS_RULES" | xargs -L 1 iptables -t nat
fi

iptables -A OUTPUT -p udp --dport 53 -j ACCEPT
iptables -A INPUT -p udp --sport 53 -j ACCEPT
iptables -A INPUT -i lo -j ACCEPT
iptables -A OUTPUT -o lo -j ACCEPT

ipset create allowed-domains hash:net

echo "Fetching GitHub IP ranges..."
gh_ranges=$(curl -s https://api.github.com/meta)
if ! echo "$gh_ranges" | jq -e '.web and .api and .git' >/dev/null; then
    echo "ERROR: could not fetch GitHub IP ranges"
    exit 1
fi
while read -r cidr; do
    if [[ ! "$cidr" =~ ^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}/[0-9]{1,2}$ ]]; then
        echo "ERROR: invalid CIDR from GitHub meta: $cidr"
        exit 1
    fi
    ipset add allowed-domains "$cidr"
done < <(echo "$gh_ranges" | jq -r '(.web + .api + .git)[]' | aggregate -q)

for domain in "${ALLOWED_DOMAINS[@]}"; do
    ips=$(dig +noall +answer A "$domain" | awk '$4 == "A" {print $5}')
    if [ -z "$ips" ]; then
        echo "WARN: could not resolve $domain, skipping"
        continue
    fi
    while read -r ip; do
        if [[ ! "$ip" =~ ^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$ ]]; then
            echo "ERROR: invalid IP for $domain: $ip"
            exit 1
        fi
        ipset add -exist allowed-domains "$ip"
    done < <(echo "$ips")
    echo "Allowed $domain"
done

# The Docker bridge network (needed for the VS Code server connection).
HOST_IP=$(ip route | grep default | cut -d" " -f3)
if [ -z "$HOST_IP" ]; then
    echo "ERROR: could not detect host IP"
    exit 1
fi
HOST_NETWORK=$(echo "$HOST_IP" | sed "s/\.[0-9]*$/.0\/24/")
iptables -A INPUT -s "$HOST_NETWORK" -j ACCEPT
iptables -A OUTPUT -d "$HOST_NETWORK" -j ACCEPT

iptables -P INPUT DROP
iptables -P FORWARD DROP
iptables -P OUTPUT DROP

iptables -A INPUT -m state --state ESTABLISHED,RELATED -j ACCEPT
iptables -A OUTPUT -m state --state ESTABLISHED,RELATED -j ACCEPT
iptables -A OUTPUT -m set --match-set allowed-domains dst -j ACCEPT
iptables -A OUTPUT -j REJECT --reject-with icmp-admin-prohibited

echo "Verifying firewall..."
if curl --connect-timeout 5 -s https://example.com >/dev/null 2>&1; then
    echo "ERROR: reached https://example.com, firewall is not blocking"
    exit 1
fi
for url in https://api.github.com/zen https://api.anthropic.com; do
    if ! curl --connect-timeout 5 -s -o /dev/null "$url"; then
        echo "ERROR: cannot reach $url"
        exit 1
    fi
done
echo "Firewall active: example.com blocked, GitHub and Anthropic reachable"
