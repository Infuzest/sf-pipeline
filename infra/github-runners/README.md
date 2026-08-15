# OrbitOps GitHub runner pool

> **Optional future design, not the current PoC runtime.** The active customer
> repository uses `ORBITOPS_TOOLBOX_RUNNER_LABELS=["ubuntu-latest"]`; no shared
> ARC/self-hosted pool is currently available. See
> [../../docs/DEVOPS_CICD.md](../../docs/DEVOPS_CICD.md) for the verified state.

This directory preserves the proposed GitHub Actions Runner Controller (ARC)
configuration for a private GKE cluster. If it is provisioned, one runner can
remain warm and the pool can grow to four ephemeral runners.

There is intentionally no OrbitOps concurrency lock for Salesforce targets.
If several jobs deploy to the same org, Salesforce controls its own deployment
queue.

## Proposed runtime configuration

| Setting | Value |
| --- | --- |
| GCP project | `sfdc-devops-dev` |
| Cluster | `orbitops-actions` in `europe-west2-b` |
| ARC controller namespace | `arc-systems` |
| Runner namespace | `arc-runners` |
| Runner scale-set name | `orbitops-toolbox-pool` |
| Warm / maximum runners | 1 / 4 |
| System node pool | `default-pool`, fixed at one node |
| Runner node pool | `orbitops-runner-pool-v2`, autoscaling from 1 to 4 `e2-standard-4` nodes with 30GB standard disks |

Only after the scale set is online and shared with the customer repository,
change `ORBITOPS_TOOLBOX_RUNNER_LABELS` to:

```json
["orbitops-toolbox-pool"]
```

Until then, keep `["ubuntu-latest"]`; using the proposed label makes jobs wait
indefinitely for a runner. The Kubernetes secret `orbitops-github-app` would be
created out of band in the
`arc-runners` namespace. It contains the existing OrbitOps GitHub App ID,
installation ID, and private key. Never commit those values.

## Update the pool

Authenticate to GCP, fetch the cluster credentials, and then apply the pinned
chart and this values file:

```bash
gcloud container clusters get-credentials orbitops-actions \
  --project=sfdc-devops-dev --zone=europe-west2-b

helm upgrade --install orbitops-arc \
  --namespace=arc-systems --create-namespace \
  --version=0.14.2 \
  oci://ghcr.io/actions/actions-runner-controller-charts/gha-runner-scale-set-controller

helm upgrade --install orbitops-toolbox-pool \
  --namespace=arc-runners --create-namespace \
  --version=0.14.2 \
  --values=infra/github-runners/arc-values.yaml \
  oci://ghcr.io/actions/actions-runner-controller-charts/gha-runner-scale-set
```

## Handover checks

```bash
kubectl get autoscalingrunnersets -n arc-runners
kubectl get pods -n arc-systems
kubectl get pods -n arc-runners
gcloud container clusters describe orbitops-actions \
  --project=sfdc-devops-dev --zone=europe-west2-b \
  --format='yaml(nodePools.autoscaling)'
```

Four simultaneous jobs should create four runner pods. Their resource requests,
node selector, and dedicated-node taint force one runner onto each runner node,
allowing the GKE node pool to scale up rather than packing competing deployments
onto the system node or the same worker machine.
