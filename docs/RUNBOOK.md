# Salesforce DevOps Operator Runbook

For the platform owner. Citizen-facing help lives in `CITIZEN_GUIDE.md`;
first-time setup in `SETUP.md`.

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

Org credentials: environment-level unprefixed secrets gate **deploys** behind
required reviewers; repo-level org-prefixed secrets serve validation/retrieve/
preview (see SETUP.md §5). The UI's GitHub App additionally holds Secrets
write (for Connect-an-org) — its private key lives only in `.env.local`.

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
- **Tag/meta-branch races** (parallel envs) → per-env concurrency groups +
  3× fetch-retry on `orbitops-meta` pushes.
- **Protected env branches** → rollback/back-promotion land via bot PRs
  (run-unique branch names survive retries); never force-push.
- **No-op rollback** (nothing to restore or delete) → reports and exits, no
  tag/commit minted.
- **Untracked source org** on retrieve → wildcard-by-type manifest; git diff
  filters to real changes.
- **Missing tracker credentials** → work-item postbacks log and never block.
- **Failed rollback validation** → preview publishes the verdict; execute
  refuses independently via its own validate-first deploy.

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

### Scratch org expired / recreating a stage org
1. `sf org create scratch -f config/scratch-def-int.json -a <alias> -v PROD --duration-days 30`
2. Baseline it: `sf project deploy start --source-dir force-app --ignore-conflicts -o <alias>`
   (run from a checkout of that stage's branch).
3. Refresh secrets: `sf org display -o <alias> --verbose --json` →
   `result.sfdxAuthUrl` → BOTH the environment secret `SF_AUTH_URL` and the
   repo secret `<ORG>_SF_AUTH_URL`.

### Rotating the PROD JWT certificate
1. Generate a new keypair (SETUP.md §4), update `<certificate>` in the
   connected-app metadata, redeploy it to PROD.
2. Update `SF_JWT_KEY` (environment) — consumer key is unchanged.
3. Verify: re-run any gated deploy, or `sf org login jwt` locally.

### Stuck deploy (queued forever)
Another run of the same env holds the `deploy-<env>` concurrency lock, or the
environment gate awaits review. Cancel stale waiting runs from the Actions tab
(keep the newest per branch), approve or reject the gate.

### orbitops-meta corrupted/deleted
It's derived state. Recreate empty: the next deploy re-creates the branch and
its manifest; deploy history before that point lives on in tags and the
GitHub Deployments API (the UI reads manifests only, so old entries disappear
from the UI unless you replay them from tag messages).

### Revoking the UI's org access
In any connected org: Setup → Connected Apps OAuth Usage → OrbitOps CI →
Block/Revoke. Then delete the org's `DEV_*_SF_AUTH_URL` repo secret and its
entry in `connected-orgs.json` (orbitops-meta branch).
