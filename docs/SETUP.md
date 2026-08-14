# Salesforce DevOps Platform Setup (platform owner)

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

Two methods, chosen per stage via the `auth-method` input of the
`.github/actions/sf-auth` composite action:

- **`jwt`** (ANY org, including scratch orgs): a certificate-bearing app +
  the JWT bearer flow. On legacy orgs this is the connected app below; on orgs
  created after Salesforce's Spring '26 change (which blocks *creating/deploying
  new connected apps*), deploy the **External Client App** instead — it is fully
  metadata-deployable, including the PEM certificate that enables the JWT
  Bearer flow (`ExtlClntAppGlobalOauthSettings.certificate`, API 60.0+). The
  ready-to-deploy bundle lives at `scripts/setup/external-client-app/`:
  1. `sf project deploy start --metadata-dir scripts/setup/external-client-app -o <alias>`
  2. `sf org assign permset -n Salesforce DevOps_CI -o <alias>` (pre-authorizes the user)
  3. Retrieve the org-generated consumer key:
     `sf project retrieve start --metadata "ExtlClntAppGlobalOauthSettings:Salesforce_DevOps_CI_Global" -o <alias> --target-metadata-dir /tmp/eca --unzip`
     → `<consumerKey>` in the retrieved `.ecaGlblOauth`. Note: unlike connected
     apps, the consumer key is minted per org — capture it per org into
     `<ORG>_SF_CLIENT_ID`.
  4. Verify: `sf org login jwt --client-id <key> --username <user> --jwt-key-file
     scripts/setup/connected-app/server.key --instance-url https://test.salesforce.com`
  (Verified end-to-end against a scratch org on 2026-08.)
- **`sfdx-url`** (fallback / quickest path): store the CLI's auth URL:
  `sf org display -o <alias> --verbose --json` → `result.sfdxAuthUrl` → secret
  `SF_AUTH_URL` on that stage's environment. Refresh it whenever the scratch org
  is recreated. Historical note: the PoC's scratch stages used this because an
  earlier version of this doc wrongly believed the ECA JWT flow wasn't
  scriptable — it is (see above).

### Connected app + JWT certificate (per persistent org)

1. Generate a keypair (or run `scripts/setup/provision-connected-app.mjs` when
   available, which automates steps 1–3):
   ```bash
   openssl req -x509 -sha256 -nodes -days 730 -newkey rsa:2048 \
     -keyout server.key -out server.crt -subj "/CN=orbitops-ci"
   ```
2. Deploy the connected app: the metadata lives at
   `force-app/main/default/connectedApps/` (certificate embedded, consumer key
   pre-set) together with the `Salesforce DevOps_CI` permission set. Deploy both to each org
   and assign the permission set to the integration user.
3. Wait 2–10 minutes (connected app propagation), then test locally:
   ```bash
   sf org login jwt --client-id <consumer-key> --username <user> \
     --jwt-key-file server.key --instance-url <login-url>
   ```
4. **Never commit `server.key`.** `.gitignore` blocks `*.key`/`*.pem` as a backstop.

## 5. Secrets

JWT authentication is centralised for every org registered through OrbitOps:

| Secret | Recommended level | Value |
|---|---|---|
| `ORBITOPS_JWT_CLIENT_ID` | GitHub organisation (selected repositories) | Shared OrbitOps CI/CD consumer key |
| `ORBITOPS_JWT_KEY` | GitHub organisation (selected repositories) | Full private-key PEM for that connected app |

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
Current PoC mapping:

| Branch | Org key | Backing org | Login URL |
|---|---|---|---|
| `integration` | INT | scratch org (alias `devopsDev1`) | test.salesforce.com |
| `uat` | UAT | scratch org (alias `stagingscratch`) | test.salesforce.com |
| `main` | PROD | Developer org (alias `DevOpsCenterDevHub`) | login.salesforce.com |

> Scratch orgs expire. When recreating (`sf org create scratch -f
> config/scratch-def-int.json -a devopsDev1 -v DevOpsCenterDevHub
> --duration-days 30`), redeploy the connected app and update `SF_USERNAME` in the
> matching environment.

## 7. Registering dev orgs ("Pull my changes" sources)

Builders can pull changes from any sandbox, scratch org, or dev org. There are
two ways to register one:

### Self-service: "Connect an org" in the UI (preferred)

Settings → **Connect an org** in the Salesforce DevOps UI. The builder signs in on
Salesforce's own login page (OAuth authorization-code + PKCE against the
`OrbitOps CI` connected app). The UI stores **no tokens at all** — it records
only the username and instance host in `connected-orgs.json` on the
`orbitops-meta` branch. CI then authenticates to the org via the **JWT Bearer
flow** with the shared OrbitOps CI certificate, acting as that username.
(Why not stored refresh tokens: Salesforce force-rotates them in all new orgs,
so a sealed token dies on first use. JWT mints access tokens on demand — there
is nothing to expire, rotate, or refresh.)

**One-time setup per connected org (admin):** Setup → Connected Apps OAuth
Usage → `OrbitOps CI` → **Install** → **Manage** → Edit Policies → Permitted
Users = *Admin approved users are pre-authorized* → save → add the builder's
profile (e.g. System Administrator) or a permission set. Revocable any time
from the same page.

**Repo secrets (shared, one-time):** `ORBITOPS_JWT_CLIENT_ID` (the app's
consumer key) and `ORBITOPS_JWT_KEY` (the certificate's private key — same
value as `PROD_SF_JWT_KEY`). The UI needs `SF_OAUTH_CLIENT_ID` in `.env.local`.

> Productionization path (decision log 2026-07-15): package the connected app
> in a **managed package** installed in production — sandboxes inherit it on
> refresh, scratch orgs install it post-creation, and pre-authorization ships
> via the package's permission set: fully self-service.

### Manual: config + secrets

1. Pick an org key, e.g. `DEV_JANE` (uppercase, prefixes the secrets).
2. Authenticate to it locally, then store its credentials as **repo-level**
   secrets: for scratch orgs/sandboxes,
   `sf org display -o <alias> --verbose --json` → `result.sfdxAuthUrl` →
   secret `DEV_JANE_SF_AUTH_URL`; for persistent orgs use the JWT secret set
   (`DEV_JANE_SF_CLIENT_ID`, `_SF_USERNAME`, `_SF_JWT_KEY`, `_SF_INSTANCE_URL`).
3. Add it to `.orbitops/pipeline.yml`:
   ```yaml
   devOrgs:
     - name: "Jane's dev sandbox"
       org: DEV_JANE
       authMethod: sfdx-url
   ```
4. It appears in the UI's "Pull my changes" org picker on the next refresh.

Orgs with **source tracking** (scratch orgs, Developer/Developer Pro sandboxes)
give precise pulls — only what the builder changed. Orgs without it (Developer
Edition, larger sandboxes) still work: the retrieve falls back to a
wildcard-by-type manifest of citizen-safe metadata and the git diff filters out
everything unchanged. Tracked orgs are strongly preferred for shared orgs, where
wildcard pulls surface everyone's edits.

## 8. Roles (PoC: username lists)

The repo owner `SalikPOC` is a personal account, so GitHub teams are unavailable.
For the PoC, role mapping is by username:

- CODEOWNERS lists usernames directly (see `.github/CODEOWNERS`)
- Environment required reviewers: add users directly on the `uat`/`production`
  environments
- The UI maps roles from env vars (`ROLE_RELEASE_MANAGERS`, `ROLE_ADMINS`,
  comma-separated usernames; everyone else authenticated = citizen dev)

When moving to an org: create `citizen-devs`, `release-managers`,
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

For concurrent deployments, use the managed ARC pool described in
[`infra/github-runners/README.md`](../infra/github-runners/README.md) and set the
variable to `["orbitops-toolbox-pool"]`. The PoC pool keeps one clean runner
ready and can scale to four independent runners. OrbitOps does not serialize
jobs by Salesforce environment; Salesforce manages any target-org queue.
