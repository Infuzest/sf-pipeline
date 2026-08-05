# Porting OrbitOps to an Enterprise GitHub (Bupa EMU)

This runbook moves both repos — `sf-pipeline` and `orbitops-ui` — from the
public `SalikPOC` account to a **GitHub Enterprise Cloud** organization that
uses **Enterprise Managed Users (EMU)** (target: enterprise `bupa-emu`, managed
domain `bupasdlc`). It is written for the constraint that **AI tooling is not
available on the machine that can reach the enterprise GitHub** — so the code
prep is mechanical (a script) and the enterprise setup is a plain checklist.

> Good news: the target is **Cloud**, not Server, so `api.github.com` stays and
> **no base-URL code changes are needed**. The work is EMU logistics — moving
> the code across the wall, getting the App approved, allowlisting actions, and
> recreating secrets/environments.

---

## 0. Two facts that shape everything

1. **EMU accounts are walled off from public github.com.** Your managed user
   (`salik-bhatti_bupasdlc`) **cannot clone the personal `SalikPOC` repos** or
   collaborate outside the enterprise. So you cannot "just clone from github.com"
   on the work machine — move the code as a **file** (§2).
2. **EMU restricts Apps and Actions to an approved/allowlisted set.** The GitHub
   App and every third-party action must be approved by an enterprise admin
   (§4, §5). Start these approvals early — they are the long pole, not the code.

## 1. Line up the people first (do this before touching code)

| You need | From whom | For |
|---|---|---|
| A GitHub org in `bupa-emu` (or use an existing one) | GitHub enterprise admin | Home for both repos |
| GitHub App creation + install approval | Enterprise/org owner | The UI's server-side access (§4) |
| Actions allowlist entries | Enterprise/org owner | The 5 public actions in §5 |
| Runner egress to npm (or an internal mirror) | Platform/network team | CLI + package installs on runners (§5) |
| Security review of the App's permissions | InfoSec | Contents + Secrets write on a health-data org |
| Salesforce connected app / JWT cert per stage org | Salesforce admin | Org auth (§6) |
| Team slugs for reviewers/roles | Org admin | Replace username-based roles (§3) |

## 2. Move the code across the wall

The two machines share **no network path**: the personal machine reaches public
github.com but not the Bupa org; the work machine reaches the Bupa org but
**both the EMU account and the corporate network block public/non-corporate
github.com**. So there is no clone-through — the code moves as a **file**, or
GitHub moves it **server-side**. Two routes:

### Route A — git bundle (guaranteed; depends on no GitHub feature)

On **this (personal) machine**, bundle each repo — one small file each (no
`node_modules` in git, so these are only a few MB), full history, all branches:

```bash
cd sf-pipeline   && git bundle create ../sf-pipeline.bundle --all && cd ..
cd orbitops-ui   && git bundle create ../orbitops-ui.bundle --all && cd ..
```

Move the two `.bundle` files to the work machine via a **Bupa-sanctioned
channel** — confirm which with your team; common ones:

- **Corporate cloud storage** (OneDrive / SharePoint / Box) reachable from both
  machines — usually the sanctioned path; upload from personal, download on work.
- **Corporate email** to your work address — small enough to attach, but DLP/AV
  may quarantine a `.bundle`; if so, `zip` it or rename to `.txt` and rename back.
- **An approved managed-file-transfer (MFT) portal**, if Bupa provides one.
- Physical media is usually DLP-blocked on managed machines — don't rely on it.

On the **work machine**:

```bash
git clone sf-pipeline.bundle sf-pipeline && cd sf-pipeline
git remote set-url origin https://github.com/<BUPA_ORG>/sf-pipeline.git
# repeat for orbitops-ui
```

(Do NOT push yet — rebrand first, §3.)

### Route B — GitHub Enterprise Importer (server-side; no file to move)

GEI (`gh gei`) migrates repos **GitHub-to-GitHub on GitHub's own
infrastructure**, so the block on the *work machine* reaching public github.com
doesn't apply — the CLI only calls the github.com API (which the work machine
can), and GitHub fetches the source itself. Worth raising with your GitHub admin
because it also brings history/PRs/issues cleanly. Caveats to check first:

- GEI github.com sources must be an **organization**, not a user account — so
  first transfer `SalikPOC/sf-pipeline` and `orbitops-ui` into a free github.com
  **org** on the personal side, then GEI from that org into the Bupa enterprise.
- **EMU import must be permitted** by enterprise policy, and source commit
  authors become **mannequins** you map to EMU users afterward.
- Needs a source PAT (SSO-authorized) + Bupa org-owner rights.

If GEI is allowed, it's the cleaner one-shot; if not, Route A always works.

### Either way, this hop happens **once**

After the initial seed into the Bupa org, everything lives inside the corporate
environment. Future changes never cross the boundary again — they're ordinary
PRs in the Bupa repo, assisted by Copilot (§10). This is a one-time migration,
not an ongoing sync.

## 3. Rebrand the code (one script, machine-independent)

The only hardcoded personal-account references are the two reusable-workflow
`uses:` refs (GitHub forbids expressions in `uses:`, so they must be literal)
plus the UI's default repo. Run the helper, committed at
[`scripts/port/rebrand.mjs`](../scripts/port/rebrand.mjs):

```bash
node scripts/port/rebrand.mjs --org <BUPA_ORG>     # e.g. bupa-salesforce-devops
```

It rewrites, in place:
- `.github/workflows/pr-validate.yml` / `deploy.yml`:
  `SalikPOC/sf-pipeline/...@main` → `<BUPA_ORG>/sf-pipeline/...@main`
- prints the manual follow-ups it can't safely automate (below).

**Apply the same rebrand on all three stage branches** (`main`, `uat`,
`integration`) — the callers live on each. Then:

Manual follow-ups the script lists:
- **`CODEOWNERS`**: replace `@SalikPOC` with the Bupa **team slug(s)**
  (e.g. `@<BUPA_ORG>/salesforce-release-managers`).
- **orbitops-ui `.env` / hosting**: set `PIPELINE_REPO=<BUPA_ORG>/sf-pipeline`
  (it's env-driven; the code default is only a fallback).
- **Roles**: set `ROLE_RELEASE_MANAGERS` / `ROLE_ADMINS` to the EMU usernames
  (they carry the `_bupasdlc` suffix), or migrate to team-slug checks.

## 4. Create the GitHub App (hand this permission list to InfoSec)

Create a **new** GitHub App owned by the Bupa org (the personal App does not
move). Per [docs/GITHUB_APP.md](GITHUB_APP.md), it needs these **repository**
permissions:

| Permission | Access | Why |
|---|---|---|
| Contents | Read & write | Branches, config PRs, deploy tags, `orbitops-meta` manifests |
| Pull requests | Read & write | Promotions, sticky comments, back-promotion |
| Checks | Read | Render check status in the UI |
| Actions | Read & write | Dispatch retrieve/rollback, re-run checks |
| Deployments | Read & write | In-app approval of gated releases |
| Environments | Read | Show which stages gate |
| Secrets | Read & write | Connect-an-org seals `DEV_*_SF_AUTH_URL` |
| Metadata | Read | Mandatory baseline |

Then, in the UI env (`.env.local` or the host's secret store): `GITHUB_APP_ID`,
`GITHUB_APP_INSTALLATION_ID`, `GITHUB_APP_PRIVATE_KEY`, and for OAuth login
`AUTH_GITHUB_ID` / `AUTH_GITHUB_SECRET` / `AUTH_SECRET` /
`AUTH_URL=<hosted-url>`. Update the App's **OAuth callback URL** to the hosted
UI URL. Under EMU, users may need the App/token **SSO-authorized**.

## 5. Actions allowlist + runner egress (EMU specifics)

**Allowlist these exact actions** (SHA-pinned) in the org/enterprise Actions
policy — or vendor them into an internal org and repoint:

```
actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683
actions/setup-node@39370e3970a6d050c480ffad4ff0ed4d3fdee5af
actions/download-artifact@fa0a91b85d4f404e444e00e005971372dc801d16
actions/upload-artifact@b4b15b8c7c6ac21ea08fcf65892d2ee8f75cf882
github/codeql-action/upload-sarif@df409f7d9260372bd5f19e5b04e83cb3c43714ae
```

**Runners**: Cloud gives you GitHub-hosted runners, but each job installs the
`@salesforce/cli`, `sfdx-git-delta`, and `plugin-code-analyzer` from npm (see
`.github/actions/sf-auth`). If Bupa blocks runner egress to npm, either allow
`registry.npmjs.org` or point npm at the **internal mirror** (Artifactory/Nexus)
via an `.npmrc`/registry config in the sf-auth action. `codeql-action/upload-sarif`
needs GitHub Advanced Security enabled on the org (or drop the SARIF-upload step
and keep the sticky-comment scan gate).

## 6. Recreate secrets and environments

Secrets are write-only — they cannot be exported; re-enter them. **Repo-level,
org-prefixed** (used by PR validation / retrieve / preview), per stage org key
`<ORG>` (e.g. `INT`, `UAT`, `PROD`):

```
<ORG>_SF_AUTH_URL          # sfdx-url auth (scratch/sandbox stages)
<ORG>_SF_CLIENT_ID
<ORG>_SF_USERNAME
<ORG>_SF_JWT_KEY           # JWT auth (production)
<ORG>_SF_INSTANCE_URL
```

**Environment-level, unprefixed** (gate deploys behind required reviewers), one
per GitHub Environment (`integration`, `uat`, `production`):

```
SF_AUTH_URL | SF_CLIENT_ID | SF_USERNAME | SF_JWT_KEY | SF_INSTANCE_URL
```

Shared/optional: `ORBITOPS_JWT_CLIENT_ID`, `ORBITOPS_JWT_KEY` (Connect-an-org
shared cert), `NOTIFY_WEBHOOK_URL` (Slack/Teams; absent → step skips green).

**Recreate per stage**: the GitHub **Environment** with required reviewers (a
Bupa team — EMU supports proper teams, so the personal-account reviewer
workaround is no longer needed), and **branch protection** on each stage branch
(require PR + green checks, no direct pushes). Point `.orbitops/pipeline.yml`
stage `org:` keys at the Bupa org keys, and set `pipeline.yml` gates as desired.

## 7. Salesforce side

Bupa's own sandbox/prod orgs replace the PoC scratch orgs. For each stage org:
create the connected app / JWT cert (SETUP.md §4) or capture an `sf org display
--verbose` auth URL, and load the matching secrets from §6. Update
`.orbitops/pipeline.yml` and `devOrgs` to Bupa's org keys and (optionally)
enable the Jira/ADO tracker env vars if Bupa uses them.

## 8. Host the UI inside the network

EMU users can't reach an external Vercel easily, and health data argues for
internal hosting. Run `orbitops-ui` on an **internal Node host or container**
(it's a standard Next.js server — `npm run build && npm start`), reachable over
HTTPS on the corporate network, with the env from §4/§6. No database, no
webhooks (it polls).

## 9. First-run verification (smoke test)

1. Push `main` first, then the two stage branches (rebranded). Confirm the
   reusable workflows resolve (`_pr-validate.yml@main` found).
2. Open a trivial no-Apex PR into `integration`; confirm the `checks / *` runs
   appear and pass (esp. the coverage gate = not-applicable).
3. Merge it; confirm the deploy runs, tags `deploy/integration/1`, and writes a
   manifest to `orbitops-meta`.
4. Open the UI (real mode) and confirm the board, My changes, and the promotion
   page render from live data; test one gated approval.

## 10. Continuity without Claude Code

On the locked-down machine, use **GitHub Copilot** (typically EMU-approved) for
any further code help — the repos ship `AGENTS.md` and
`.github/copilot-instructions.md` specifically so another AI tool starts with
full architectural context. This runbook + those briefs are the complete
handoff.

---

**Summary of what actually changes**: 2 workflow refs (script), `PIPELINE_REPO`
+ roles + CODEOWNERS (config/teams), a new GitHub App, recreated secrets +
environments + branch protection, an actions allowlist, runner npm egress, and
internal UI hosting. No application logic changes — it's a Cloud target.
