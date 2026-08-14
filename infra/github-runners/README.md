# OrbitOps GitHub runner pool

The PoC runner pool uses GitHub Actions Runner Controller (ARC) on a private GKE
cluster. One runner remains warm and the pool can grow to four runners. Runners
are ephemeral: every job gets a clean runner pod and is removed afterwards.

There is intentionally no OrbitOps concurrency lock for Salesforce targets.
If several jobs deploy to the same org, Salesforce controls its own deployment
queue.

## Runtime configuration

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

The repository Actions variable `ORBITOPS_TOOLBOX_RUNNER_LABELS` must contain:

```json
["orbitops-toolbox-pool"]
```

The Kubernetes secret `orbitops-github-app` is created out of band in the
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
