#!/bin/bash
# Set up (or update) the agent host VM. Runs as the VM's startup script, so it
# is safe to run again: on every boot it reapplies the firewall and starts the
# host with the image tags in the VM's metadata.
#
# Metadata (gcloud compute instances add-metadata):
#   agent-host-image     us-central1-docker.pkg.dev/<project>/toolkit/agent-host:<tag>
#   agent-sandbox-image  us-central1-docker.pkg.dev/<project>/toolkit/agent-sandbox:<tag>
# Secrets (Secret Manager, read by the VM's service account):
#   agent-host-secret    shared with the toolkit service
#   agent-gemini-key     the model key; it stays in the host, never a sandbox
set -euo pipefail

meta() { curl -fsS -H 'Metadata-Flavor: Google' "http://metadata.google.internal/computeMetadata/v1/$1"; }
HOST_IMAGE=$(meta instance/attributes/agent-host-image)
SANDBOX_IMAGE=$(meta instance/attributes/agent-sandbox-image)
PROJECT=$(meta project/project-id)
DATA=/srv/agent-host
SBX_NET=ai4a11y-sbx
SBX_BRIDGE=sbx0
SBX_GATEWAY=172.30.0.1

# ── docker and gVisor ─────────────────────────────────────────────────────────
if ! command -v runsc >/dev/null; then
  apt-get update
  apt-get install -y --no-install-recommends docker.io ca-certificates curl gnupg
  curl -fsSL https://gvisor.dev/archive.key | gpg --dearmor -o /usr/share/keyrings/gvisor-archive-keyring.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/gvisor-archive-keyring.gpg] https://storage.googleapis.com/gvisor/releases release main" > /etc/apt/sources.list.d/gvisor.list
  apt-get update && apt-get install -y runsc
  runsc install
  systemctl restart docker
fi
gcloud auth configure-docker us-central1-docker.pkg.dev --quiet

# ── the sandboxes' network: no traffic between sandboxes, none forwarded out
#    (no internet, no metadata server), and only the host's sandbox port in.
docker network inspect "$SBX_NET" >/dev/null 2>&1 || docker network create --driver bridge \
  --subnet 172.30.0.0/16 --gateway "$SBX_GATEWAY" \
  -o com.docker.network.bridge.name="$SBX_BRIDGE" -o com.docker.network.bridge.enable_icc=false "$SBX_NET"
cat > /usr/local/sbin/ai4a11y-sandbox-firewall <<EOF
#!/bin/sh
# Forwarded from a sandbox: dropped (internet, metadata server, other networks).
iptables -C DOCKER-USER -i $SBX_BRIDGE -j DROP 2>/dev/null || iptables -I DOCKER-USER 1 -i $SBX_BRIDGE -j DROP
# To the host itself: only the sandbox port.
iptables -C INPUT -i $SBX_BRIDGE -j DROP 2>/dev/null || {
  iptables -I INPUT 1 -i $SBX_BRIDGE -j DROP
  iptables -I INPUT 1 -i $SBX_BRIDGE -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
  iptables -I INPUT 1 -i $SBX_BRIDGE -p tcp -d $SBX_GATEWAY --dport 8790 -j ACCEPT
}
EOF
chmod 0755 /usr/local/sbin/ai4a11y-sandbox-firewall
/usr/local/sbin/ai4a11y-sandbox-firewall

# ── the host ──────────────────────────────────────────────────────────────────
mkdir -p "$DATA" && chmod 0700 "$DATA"
docker pull "$HOST_IMAGE"
docker pull "$SANDBOX_IMAGE"
cat > /usr/local/sbin/ai4a11y-agent-host-env <<EOF
#!/bin/sh
# The secrets, into a file on tmpfs that only root reads.
umask 077
{
  echo "AGENT_HOST_SECRET=\$(gcloud secrets versions access latest --secret agent-host-secret --project $PROJECT)"
  echo "AGENT_GEMINI_KEY=\$(gcloud secrets versions access latest --secret agent-gemini-key --project $PROJECT)"
} > /run/ai4a11y-agent-host.env
EOF
chmod 0700 /usr/local/sbin/ai4a11y-agent-host-env
cat > /etc/systemd/system/ai4a11y-agent-host.service <<EOF
[Unit]
Description=AI for Accessibility agent host
After=docker.service network-online.target
Requires=docker.service

[Service]
ExecStartPre=/usr/local/sbin/ai4a11y-sandbox-firewall
ExecStartPre=/usr/local/sbin/ai4a11y-agent-host-env
ExecStartPre=-/usr/bin/docker rm -f ai4a11y-agent-host
ExecStart=/usr/bin/docker run --rm --name ai4a11y-agent-host --network host \\
  --env-file /run/ai4a11y-agent-host.env \\
  -e AGENT_SANDBOX_IMAGE=$SANDBOX_IMAGE -e AGENT_SANDBOX_NETWORK=$SBX_NET \\
  -e AGENT_SANDBOX_LISTEN=$SBX_GATEWAY:8790 -e AGENT_API_LISTEN=0.0.0.0:8791 \\
  -v /var/run/docker.sock:/var/run/docker.sock -v $DATA:$DATA \\
  $HOST_IMAGE
ExecStop=/usr/bin/docker stop ai4a11y-agent-host
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable ai4a11y-agent-host
systemctl restart ai4a11y-agent-host
