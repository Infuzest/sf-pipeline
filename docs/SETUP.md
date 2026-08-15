# Salesforce DevOps Platform Setup (platform owner)

For the current repositories, accounts, hosted services and complete operating
model, read [DEVOPS_CICD.md](DEVOPS_CICD.md) first. This file is the reusable
setup procedure; `DEVOPS_CICD.md` records the live PoC inventory.

One-time setup for a new pipeline repo. Everything here is clickable/one-liner;
nothing requires local Salesforce tooling except the certificate step.

## 1. Branches

From the repo's default branch (`main`), create the two lower environment branches
at the same commit:

```bash
git branch integration && git branch uat
git push origin main integration uat
```

## 2. Branch protection

For **each** of `main`, `uat`, `integration` (Settings → Branches → Add rule):

- Require a pull request before merging (no direct pushes)
- Require status checks to pass; select the `Salesforce DevOps /*` checks once they exist
- Require conversation resolution
- Do NOT allow force pushes or deletions

## 3. GitHub Environments (stage gates)

Settings → Environments → New environment. Create exactly these names (they must
match `environment:` values in `.orbitops/pipeline.yml`):

| Environment | Required reviewers | Notes |
|---|---|---|
| `integration` | none | fast lane for citizen devs |
| `uat` | release-managers team | |
| `production` | release-managers team | consider also a wait timer |

Release managers can **approve or reject gated releases from inside the
Salesforce DevOps UI**: the review is made with the signed-in reviewer's own GitHub
identity (user-to-server token), so whoever approves must be listed as a
required reviewer here — no extra reviewer entries needed. (GitHub Apps can't
be required reviewers on personal-account repos, which is why the app itself
isn't in the list.) One prerequisite: the UI's GitHub App needs its
**Deployments** permission set to *Read and write* (see the UI repo's
`docs/GITHUB_APP.md`) and the permission update accepted on the installation.
Approving directly on GitHub keeps working either way.

## 4. Org authentication

The current PoC deliberately separates interactive connection from automation:

- **OrbitOps Connect** is a self-authorizing Salesforce app used only for the
  human OAuth Authorization Code + PKCE journey. It returns the authenticated
  username and instance host. OrbitOps does not retain the access or refresh
  token.
- **Salesforce DevOps CI / OrbitOps CI/CD** is the managed, pre-authorized JWT
  app used by GitHub Actions. Install it in production so sandbox copies inherit
  the same consumer key and certificate after refresh. Assign its packaged
  permission set to the integration/deployment user in every target.

JWT is the standard workflow method. The reusable action combines the shared
`ORBITOPS_JWT_CLIENT_ID` and `ORBITOPS_JWT_KEY` secrets with the username and
org type from `connected-orgs.json`. `sfdx-url` remains a migration fallback,
not the scalable design.

To verify a target without exposing values in logs:

```bash
sf org login jwt --client-id <consumer-key> --username <deployment-user> \
  --jwt-key-file <private-key-file> --instance-url https://test.salesforce.com
```

Never commit the private key, an SFDX auth URL, or a secret value.

## 5. Secrets

JWT authentication is centralised for every org registered through OrbitOps:

| Secret | Recommended level | Value |
|---|---|---|
| `ORBITOPS_JWT_CLIENT_ID` | Customer repo for the PoC; organisation/environment in production | Shared OrbitOps CI/CD consumer key |
| `ORBITOPS_JWT_KEY` | Customer repo for the PoC; organisation/environment in production | Full private-key PEM for that connected app |

The per-org deployment username and org type are stored as non-secret metadata
in `connected-orgs.json` on `orbitops-meta`. Validation, release, deployment,
backout, retrieval, and drift checks all resolve the same record. GitHub
Environments still control approvals, but do not need duplicate JWT credentials.

Legacy or manually configured stages can still use environment/repository
fallback secrets. For an `sfdx-url` stage:

| Secret | Value |
|---|---|
| `SF_AUTH_URL` | `sf org display -o <alias> --verbose --json` → `result.sfdxAuthUrl` |

For a legacy JWT stage not present in `connected-orgs.json`, the existing
`SF_CLIENT_ID`, `SF_USERNAME`, `SF_JWT_KEY`, and `SF_INSTANCE_URL` environment
secrets remain supported as a migration fallback.

### Optional secrets

| Secret | Level | Purpose |
|---|---|---|
| `NOTIFY_WEBHOOK_URL` | repo | Slack/Teams incoming-webhook URL; deploy failures post a message. Absent → silently skipped. |
| `DEV_*_SF_AUTH_URL` | repo | Legacy v1 connection only; new UI connections use the central JWT credentials. |

## 6. Org ↔ stage mapping

`.orbitops/pipeline.yml` maps branches to logical org keys and environments.
The file is authoritative. The mapping verified on 15 August 2026 is:

| Branch | Org key | Backing org | Login URL |
|---|---|---|---|
| `integration` | `DEV_DEV2` | Dev2 sandbox | test.salesforce.com |
| `main` | `DEV_INTEGRATION` | Integration sandbox | test.salesforce.com |

After a sandbox refresh, the org ID and host may change. The deployment username
and packaged CI/CD app should survive when production is configured correctly.
If either was deliberately removed or renamed, reconnect the org and repair the
permission-set assignment.

## 7. Registering dev orgs ("Pull my changes" sources)

Builders can pull changes from any sandbox, scratch org, or dev org. There are
two ways to register one:

### Self-service: "Connect an org" in the UI (preferred)

Settings → **Connect an org** in the Salesforce DevOps UI. The builder signs in on
Salesforce's own login page (OAuth authorization-code + PKCE against the
`OrbitOps Connect` application). The UI stores **no tokens at all** — it records
only the username and instance host in `connected-orgs.json` on the
`orbitops-meta` branch. CI then authenticates to the org via the **JWT Bearer
flow** with the shared OrbitOps CI certificate, acting as that username.
(Why not stored refresh tokens: Salesforce force-rotates them in all new orgs,
so a sealed token dies on first use. JWT mints access tokens on demand — there
is nothing to expire, rotate, or refresh.)

**One-time automation setup (admin):** install the managed Salesforce DevOps CI
package in production, allow its sandbox copies to inherit on refresh, and
assign the packaged permission set to the deployment user. OrbitOps Connect is
self-authorized separately by the human performing the connection.

**Repo secrets (shared, one-time):** `ORBITOPS_JWT_CLIENT_ID` (the app's
consumer key) and `ORBITOPS_JWT_KEY` (the certificate's private key). The UI
uses the separate OrbitOps Connect consumer key through `SF_OAUTH_CLIENT_ID`.

The managed CI/CD application is required even when the UI connection succeeds:
the OAuth connection registers the org; the JWT application performs unattended
retrieve, validate, deploy, snapshot and rollback operations.

### Manual registry fallback

Use this only if the UI connection journey is unavailable:

1. Pick an org key, e.g. `DEV_JANE`.
2. Verify the packaged CI/CD app and permission set for the deployment username.
3. Add a non-secret entry for the key, display name, username, org type and
   last-known host to `connected-orgs.json` on `orbitops-meta`. Do not add a
   client ID, key, access token, refresh token or SFDX auth URL.
4. Add it to `.orbitops/pipeline.yml` when it is a selectable development org:
   ```yaml
   devOrgs:
     - name: "Jane's dev sandbox"
       org: DEV_JANE
       authMethod: jwt
   ```
5. It appears in the UI's "Pull my changes" org picker on the next refresh.

Orgs with **source tracking** (scratch orgs, Developer/Developer Pro sandboxes)
give precise pulls — only what the builder changed. Orgs without it (Developer
Edition, larger sandboxes) still work: the retrieve falls back to a
wildcard-by-type manifest of citizen-safe metadata and the git diff filters out
everything unchanged. Tracked orgs are strongly preferred for shared orgs, where
wildcard pulls surface everyone's edits.

## 8. Roles (PoC: username lists)

The active repositories are owned by the `Infuzest` organisation. The current
human operator is `Xyraxel`; the hosted GitHub App acts as
`orbitops-poc-sfdcdevops[bot]`. `SalikPOC` is a legacy inactive identity.
The UI can still use explicit username lists for PoC role mapping:

- CODEOWNERS lists usernames directly (see `.github/CODEOWNERS`)
- Environment required reviewers: add users directly on the `uat`/`production`
  environments
- The UI maps roles from env vars (`ROLE_RELEASE_MANAGERS`, `ROLE_ADMINS`,
  comma-separated usernames; everyone else authenticated = citizen dev)

For production, create `citizen-devs`, `release-managers`, and
`orbitops-admins` teams and switch CODEOWNERS + UI role mapping to team slugs.

## 9. Repo settings checklist

- Enable secret scanning + push protection (Settings → Code security)
- Disallow merge types other than **merge commit** (preserves Work-Items footers)
- Default branch: `main`

### Faster toolbox jobs on an organisation runner

Salesforce jobs run inside the pinned OrbitOps toolbox container. By default,
they use an ephemeral `ubuntu-latest` runner, which commonly spends 40–50
seconds downloading and starting that container even though the Salesforce CLI
is already installed inside it.

To use an organisation or self-hosted runner with a persistent Docker cache:

1. Share the runner or runner group with this repository and give it a unique
   label such as `orbitops-toolbox`.
2. Ensure Docker is installed, then pull the current image once:
   `docker pull ghcr.io/infuzest/orbitops-sf-toolbox:2.142.7-sgd6.45.1-ca5.14.0-r2`.
3. In **Settings → Secrets and variables → Actions → Variables**, create
   `ORBITOPS_TOOLBOX_RUNNER_LABELS` with a JSON array value. For example:
   `["self-hosted","linux","x64","orbitops-toolbox"]`.

Only jobs that need the toolbox container move to this runner; quick context and
bookkeeping jobs remain on GitHub-hosted runners so one self-hosted machine does
not unnecessarily serialize the whole pipeline. If the variable is absent,
the workflows safely fall back to `ubuntu-latest`.

The current PoC has **no self-hosted or ARC runner pool**. Its customer repo
variable is `ORBITOPS_TOOLBOX_RUNNER_LABELS=["ubuntu-latest"]`. Only switch to
`["orbitops-toolbox-pool"]` after a matching organisation runner group is
online, shared with the repo, and proven with a real job. OrbitOps does not
serialize jobs by Salesforce environment; Salesforce manages the target-org
deployment queue.
