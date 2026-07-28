# BUPA Salesforce DevOps — Salesforce CI/CD for citizen developers

A DevOps-Center-like release platform built on **GitHub Actions + Salesforce CLI**,
with a companion web UI ([orbitops-ui](https://github.com/SalikPOC/orbitops-ui)).
Citizen developers build with clicks in their org, pull changes into a work-item
branch, promote through integration → UAT → production behind quality gates, and
can back out any release with a previewed, validate-first rollback.

- **Spec**: [REQUIREMENTS.md](REQUIREMENTS.md) (epics E1–E9, decisions D1–D9)
- **Platform-owner setup**: [docs/SETUP.md](docs/SETUP.md)
- **Operations**: [docs/RUNBOOK.md](docs/RUNBOOK.md)
- **Release cycle overview (UI ↔ Git, side by side)**: [docs/RELEASE_CYCLE.md](docs/RELEASE_CYCLE.md)
- **Builder walkthrough (UI path)**: [docs/CITIZEN_GUIDE.md](docs/CITIZEN_GUIDE.md)
- **Pro-code walkthrough (plain Git/GitHub path)**: [docs/DEVELOPER_GUIDE.md](docs/DEVELOPER_GUIDE.md)
- **Work-item conventions**: [docs/WORKITEMS.md](docs/WORKITEMS.md)
- **AI assistants / coding agents**: start at [AGENTS.md](AGENTS.md); the dated
  decision log is [CLAUDE.md](CLAUDE.md)

## How a deployment actually works

Everything runs on **GitHub-hosted Actions runners** — ephemeral `ubuntu-latest`
virtual machines that are created for each job and destroyed afterwards. Nothing
is deployed *from* GitHub's own infrastructure in a special sense: each job is a
fresh Linux VM with Node.js preinstalled, and the workflow installs the
Salesforce tooling itself.

The **Salesforce CLI is not preinstalled** on GitHub runners. Every workflow that
touches an org starts with the composite action
[`.github/actions/sf-auth`](.github/actions/sf-auth/action.yml), which:

1. Installs pinned tooling on the runner: `@salesforce/cli` **2.142.7**,
   `sfdx-git-delta` **6.45.1**, `@salesforce/plugin-code-analyzer` **5.14.0**
   (versions pinned so runs are reproducible; ~60–90 s per job).
2. Authenticates to the target org **JWT** (connected app + certificate, used
   for production) or **sfdx-url** (stored CLI auth URL, used for scratch-org
   stages) — credentials come from GitHub secrets, never the repo.

A promotion then flows like this:

```
PR opened (feature/* → integration, or integration → uat, …)
  └─ pr-validate.yml (thin caller) → _pr-validate.yml@main on a fresh runner:
       install CLI → auth to TARGET org → sfdx-git-delta computes the
       changed-components package → sf project deploy validate (check-only
       deploy: Salesforce compiles + runs tests in the org, commits nothing)
       → code scan, coverage gate, work-item check → sticky PR comment
PR merged ("Promote" in the UI, or GitHub's merge button)
  └─ deploy.yml (thin caller) → _deploy.yml@main on a fresh runner (gated by the GitHub Environment):
       quick-deploy the validated package if still eligible (no re-run of
       tests), else full delta deploy → tag deploy/<env>/<seq> → manifest
       committed to the orbitops-meta branch → GitHub Deployment recorded
```

Key properties:

- **Delta, not full deploys** — `sfdx-git-delta` diffs the two branches and
  builds a `package.xml` of only what changed (plus `destructiveChanges.xml`
  for deletions).
- **Validate-first** — the check-only deploy happens against the real target
  org at PR time; merge without green checks is impossible (branch protection).
- **Quick deploy** — Salesforce lets a validated deployment be applied within
  10 days without re-running tests; the pipeline stores the validation id and
  uses it on merge, falling back to a full deploy if anything drifted.
- **Gates** — GitHub Environments hold the deploy job until required reviewers
  approve (UAT/production); in-workflow gates enforce `minCoverage` and
  `scannerMaxSeverity` from [.orbitops/pipeline.yml](.orbitops/pipeline.yml).
- **Auditability** — every state change mints a `deploy/<env>/<seq>` tag and a
  JSON manifest on the `orbitops-meta` branch; the UI renders history, metrics,
  and rollback timelines purely from those manifests.

## Single source of truth: reusable workflows on `main`

Validation and deploy logic are **reusable workflows that live only on main**:

- [`_pr-validate.yml`](.github/workflows/_pr-validate.yml) and
  [`_deploy.yml`](.github/workflows/_deploy.yml) (`workflow_call`) hold every job.
- Each stage branch carries only thin callers (`pr-validate.yml`, `deploy.yml`)
  that pin `...@main` — installed once per branch, never edited again.
- Jobs check out two trees: the workspace (the branch being validated or
  deployed) and `.pipeline/` (scripts, `pipeline.yml`, scanner config, and the
  sf-auth action **from main**).

Consequence: a pipeline fix is **one PR to main** and applies to every stage
immediately — stage branches never drift on tooling. Check runs are named
`checks / <job>` (e.g. `checks / Code scan`).

Stage topology (which branches are stages, in what order, with what gates) lives
only in [.orbitops/pipeline.yml](.orbitops/pipeline.yml) — the workflows trigger
broadly and skip non-stage branches (`resolve-stage --optional`), and
back-promotion pairs are derived from the same file. Adding/removing a stage is
a config PR (the UI's Settings → Pipeline stages automates it).

## Workflow inventory

| Workflow | Trigger | Purpose |
|---|---|---|
| `pr-validate.yml` → `_pr-validate.yml@main` | PRs (non-stage bases skipped) | Delta preview, work-item check, code scan, check-only deploy against the target org, coverage gate (auto-passes when the delta has no Apex) |
| `deploy.yml` → `_deploy.yml@main` | Push to a stage branch (merge) | Quick-deploy or delta deploy, tag + manifest + Deployment, back-promotion PRs after the last stage, optional failure webhook |
| `rollback.yml` | Manual / UI dispatch | Reverse delta between deploy tags; preview mode publishes a safety report, execute mode validates first then applies + revert PR |
| `retrieve.yml` | UI dispatch | "Pull my changes": retrieve a builder's edits from any registered/connected org into their work branch |
| `full-scan.yml` | Schedule + manual | Whole-repo Code Analyzer sweep → SARIF + burn-down issue |
| `snapshot.yml` | Nightly + manual | Drift detection: retrieve each stage org, diff vs its branch, auto-manage a "Drift report" issue |

All workflows follow "thin YAML, fat scripts": logic lives in `scripts/**`
(Node ESM, unit-tested via `node --test`), actions are SHA-pinned, and
`GITHUB_TOKEN` permissions are least-privilege, declared in the callers (see
the map in [docs/RUNBOOK.md](docs/RUNBOOK.md)).

## Repo layout

```
.orbitops/            pipeline.yml (stages, gates, dev orgs) + JSON schema + scanner baseline
.github/workflows/    _pr-validate.yml + _deploy.yml (ALL logic, main-only) · thin callers · rollback/retrieve/scan/snapshot
.github/actions/      sf-auth composite action (CLI install + org auth)
scripts/              context/ deploy/ retrieve/ rollback/ scanner/ workitems/ lib/ — all workflow logic (npm test)
force-app/            SFDX source (sample BUP_* objects, flows, classes)
docs/                 SETUP, RUNBOOK, RELEASE_CYCLE, CITIZEN_GUIDE, DEVELOPER_GUIDE, WORKITEMS
AGENTS.md             brief for AI coding tools · CLAUDE.md — dated decision log
```
