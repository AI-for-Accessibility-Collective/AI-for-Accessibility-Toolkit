#!/bin/bash
# On the VM: the image Cloud Run runs checks in (src/burst.js): the check
# image with the recorded site copies baked in at /sites, so a job needs
# nothing from outside but its own files from the host. Pushing needs an
# access token that may write to the registry, read from stdin (the VM's own
# service account only reads):
#
#   gcloud auth print-access-token | gcloud compute ssh agent-host … \
#     --command 'sudo bash /path/to/burst-image.sh <check image> <burst image>'
set -euo pipefail
CHECK_IMAGE=${1:?the check image}
BURST_IMAGE=${2:?the burst image to make}
SITES=${SITES:-/srv/agent-host/verify-sites}
CTX=$(mktemp -d)
CFG=$(mktemp -d)
trap 'rm -rf "$CTX" "$CFG"' EXIT
cp -r "$SITES" "$CTX/sites"
printf 'FROM %s\nCOPY sites /sites\nENV VERIFY_SITES=offline VERIFY_SITE_CACHE=/sites\n' "$CHECK_IMAGE" > "$CTX/Dockerfile"
docker build -q -t "$BURST_IMAGE" "$CTX"
DOCKER_CONFIG=$CFG docker login -u oauth2accesstoken --password-stdin "https://${BURST_IMAGE%%/*}" >/dev/null
DOCKER_CONFIG=$CFG docker push -q "$BURST_IMAGE"
