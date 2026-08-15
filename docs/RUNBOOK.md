# Salesforce DevOps Operator Runbook

For the platform owner. Citizen-facing help lives in `CITIZEN_GUIDE.md`;
first-time setup in `SETUP.md`.

Read [DEVOPS_CICD.md](DEVOPS_CICD.md) for the authoritative current repository,
account, GCP resource, authentication and customer/runtime inventory.

## Workflow × permissions map (security review)

All actions pinned by commit SHA; CLI/plugins pinned by version in
`.github/actions/sf-auth`. `pr-validate.yml` and `deploy.yml` are thin callers
into the reusable `_pr-validate.yml` / `_deploy.yml` on **main** (single source
of truth — see README "Single source of truth"); permissions are declared in
the callers and bound the called jobs. `GITHUB_TOKEN` scopes per workflow:

| Workflow | contents | pull-requests | deployments | security-events | issues |
|---|---|---|---|---|---|
| pr-validate.yml | read | write (comments) | – | write (scan job only) | – |
| deploy.yml | write (tags, meta branch) | write (back-promotion) | write | – | – |
| rollback.yml | write (revert PR, tags, meta) | write | write | – | – |
| retrieve.yml | write (work branches) | – | – | – | – |
| full-scan.yml | read | – | – | write | write (burn-down) |
| snapshot.yml | read | – | – | – | write (drift) |

UI-connected orgs use the shared organisation secrets
`ORBITOPS_JWT_CLIENT_ID` / `ORBITOPS_JWT_KEY`; every Salesforce workflow reads
the org-specific username and login service from `connected-orgs.json` on
`orbitops-meta` (see SETUP.md §5). Environment and org-prefixed secrets remain
legacy fallbacks. The UI's GitHub App writes the non-secret registry; its
private key lives only in the hosted service.

## Notifications

Set a repo secret `NOTIFY_WEBHOOK_URL` (Slack/Teams incoming webhook) and
deploy failures post a message with a link to the run. No secret → the step
logs "skipping" and stays green. Drift findings arrive as GitHub issues
("Drift report: <env>"), not webhooks.

## Handled failure modes (by design)

- **Empty delta on deploy** → deploy + tag skipped cleanly.
- **Quick-deploy ineligible/stale** (tree mismatch, missing artifact) → falls
  back to full validate+deploy.
- **`sf project deploy validate` rejects NoTestRun** → test-free stages use
  dry-run instead (identical check-only semantics, no quick-deploy id).
- **Tag/meta-branch races** (parallel envs) → 3× fetch-retry on
  `orbitops-meta` pushes. OrbitOps deliberately does not lock Salesforce
  deployments; Salesforce may queue overlapping requests.
- **Protected env branches** → rollback/back-promotion land via bot PRs
  (run-unique branch names survive retries); never force-push.
- **No-op rollback** (nothing to restore or delete) → reports and exits, no
  tag/commit minted.
- **Untracked source org** on retrieve → wildcard-by-type manifest; git diff
  filters to real changes.
- **Missing tracker credentials** → work-item postbacks log and never block.
- **Failed rollback validation** → preview publishes the verdict; execute
  refuses independently via its own validate-first deploy.
- **Updates after the latest deployment tag** → workflow/docs changes are
  ignored because they never reach Salesforce; files inside any declared
  `sfdx-project.json` package directory stop rollback until the UI's governed
  **Deploy and record** action succeeds.

## Residual risks (accepted for the PoC)

- **Org state vs git after a failed execute step**: if the org deploy succeeds
  but the revert PR fails to land (e.g. new repo rule), org and git diverge
  until re-run. Symptom: rollback run red after "Deploying rollback…" went
  green. Fix: resolve the block, re-run — the org deploy is idempotent.
- **Quick-deploy validates against a moving org**: between validate and merge
  someone could change the org; Salesforce rejects the quick deploy and we fall
  back, costing time not safety.
- **Shared-org retrieves** surface everyone's edits (curate via checkboxes).
- **Rollback preview files accumulate** on `orbitops-meta` (one JSON per
  preview run) — harmless; prune occasionally if it bothers you.

## Procedures

### Sandbox refreshed or recreated
1. Confirm the packaged Salesforce DevOps CI application exists in the refreshed
   sandbox and that the deployment user still has its packaged permission set.
2. Keep the same deployment username naming convention. Update the
   `connected-orgs.json` entry only if the username was deliberately changed.
3. Retry JWT auth. The instance host is learned during authentication; update
   the last-known host in the registry when the connection is refreshed.

### Rotating the shared JWT certificate
1. Create and protect the replacement keypair; update the managed CI/CD app's
   certificate through the approved Salesforce packaging process.
2. Update `ORBITOPS_JWT_KEY` in every authorised customer repository (or the
   future central organisation/environment secret). The consumer key is
   unchanged unless the application itself changes.
3. Verify one non-production org with `sf org login jwt`, then run a governed
   validation before using the new key for a production release.

### Stuck job or deploy
If the run says **Waiting for a runner**, compare its requested labels with the
repo variable `ORBITOPS_TOOLBOX_RUNNER_LABELS`; the current PoC value is
`["ubuntu-latest"]`. A non-existent self-hosted label will wait forever. Once a
job starts, it may be waiting for a GitHub environment review or Salesforce may
be queuing simultaneous deployments. Approve/reject the gate or inspect the
Salesforce deployment status; do not add an OrbitOps org lock for the PoC.

### orbitops-meta corrupted/deleted
It's derived state. Recreate empty: the next deploy re-creates the branch and
its manifest; deploy history before that point lives on in tags and the
GitHub Deployments API (the UI reads manifests only, so old entries disappear
from the UI unless you replay them from tag messages).

### Revoking an org
Remove the deployment user's access to the packaged Salesforce DevOps CI app
and delete the org entry from `connected-orgs.json` on `orbitops-meta`. The UI's
short-lived OrbitOps Connect OAuth token was never retained, so there is no
stored refresh token to revoke in GitHub.
