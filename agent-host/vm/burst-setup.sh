#!/bin/bash
# Make (or update) the Cloud Run job that runs adapter checks beyond the
# agent host VM's CPUs (src/burst.js). Run from a machine with gcloud as a
# project owner; then set the VM's metadata agent-burst-job=ai4a11y-check
# and rerun its startup script.
#
#   agent-host/vm/burst-setup.sh <burst image>
#
# The image is the check image with the recorded site copies baked in
# (vm/burst-image.sh, on the VM). What the job can reach:
#   - as the service account agent-burst, which has no roles: its token from
#     the metadata server opens nothing;
#   - its traffic all goes into the VPC with the tag ai4a11y-burst, and the
#     firewall lets that tag reach the VM's API port and nothing else (no
#     internet, no Google APIs, no other address).
set -euo pipefail
IMAGE=${1:?the burst image}
P=${PROJECT:-agentic-a11y}
R=${REGION:-us-central1}
JOB=${JOB:-ai4a11y-check}
VM_IP=${VM_IP:-10.128.0.44}
VM_SA=agent-host@$P.iam.gserviceaccount.com
SA=agent-burst@$P.iam.gserviceaccount.com

gcloud iam service-accounts describe "$SA" --project "$P" >/dev/null 2>&1 \
  || gcloud iam service-accounts create agent-burst --project "$P" --display-name "Adapter checks on Cloud Run (no roles)"

# Egress: the API port of the VM, nothing else.
gcloud compute firewall-rules describe ai4a11y-burst-to-host --project "$P" >/dev/null 2>&1 \
  || gcloud compute firewall-rules create ai4a11y-burst-to-host --project "$P" --network default --direction EGRESS \
       --priority 900 --action ALLOW --rules tcp:8791 --destination-ranges "$VM_IP/32" --target-tags ai4a11y-burst
gcloud compute firewall-rules describe ai4a11y-burst-deny --project "$P" >/dev/null 2>&1 \
  || gcloud compute firewall-rules create ai4a11y-burst-deny --project "$P" --network default --direction EGRESS \
       --priority 1000 --action DENY --rules all --destination-ranges 0.0.0.0/0 --target-tags ai4a11y-burst

# One execution is one check: 8 CPUs, no retries, never more than the host asks for.
gcloud run jobs deploy "$JOB" --project "$P" --region "$R" --image "$IMAGE" \
  --service-account "$SA" --cpu 8 --memory 16Gi --max-retries 0 --task-timeout 25m \
  --network default --subnet default --vpc-egress all-traffic --network-tags ai4a11y-burst \
  --command node --args scripts/verify-adapters/burst.mjs \
  --execution-environment gen2

# The VM's host may start executions with its own settings, and see and cancel them.
gcloud run jobs add-iam-policy-binding "$JOB" --project "$P" --region "$R" \
  --member "serviceAccount:$VM_SA" --role roles/run.jobsExecutorWithOverrides >/dev/null
gcloud iam service-accounts add-iam-policy-binding "$SA" --project "$P" \
  --member "serviceAccount:$VM_SA" --role roles/iam.serviceAccountUser >/dev/null
echo "Job $JOB ready. Now: gcloud compute instances add-metadata agent-host --metadata agent-burst-job=$JOB, then the startup script."
