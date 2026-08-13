# Salesforce CI/CD Platform for Citizen Developers — Requirements Specification

> **Status (2026-07-15): implemented.** All epics landed in the PoC (E2 as the
> stub adapter per its PoC-scope note), plus three additions beyond spec:
> self-service org connection (OAuth + PKCE), a Flow-Builder-style visual flow
> diff, and per-run live progress in the UI. See [README.md](README.md) for the
> architecture as built and [docs/RUNBOOK.md](docs/RUNBOOK.md) for operations.

> Working name: **Salesforce DevOps** (rename freely). A DevOps-Center-like experience built on
> GitHub Actions + Salesforce CLI (`sf`), with work-item traceability (Jira + Azure DevOps),
> UI-driven rollback, diff/merge visibility, configurable stage gates, and static code analysis.

---

## 1. Vision

Give Salesforce admins and citizen developers a **point-and-click release experience**
(similar to Salesforce DevOps Center) while pro-code developers and the platform itself
run on industry-standard tooling: Git, GitHub Actions, and the Salesforce CLI.

The critical differentiators over DevOps Center:

1. **One-click rollback from the UI** (DevOps Center has none).
2. **Visible diffs, merge conflicts, and deploy previews** before anything ships.
3. **Configurable stage gates** (approvals, test coverage, scanner severity thresholds).
4. **Static code analysis** wired into every pull request and promotion.
5. **Work-item tagging** — every commit/promotion traceable to a Jira issue or ADO work item.

## 2. Personas

| Persona | Skills | What they do in the tool |
|---|---|---|
| **Citizen developer / admin** | Clicks, no Git knowledge | Creates a "work item workspace", pulls their changes from a sandbox, promotes through stages, views diffs in plain language, triggers rollback |
| **Pro-code developer** | Git, VS Code, SFDX | Works directly in Git; the UI is optional visibility |
| **Release manager** | Process owner | Configures pipelines and stage gates, approves promotions, executes rollbacks |
| **Platform owner (you)** | DevOps engineer | Owns the GitHub App, workflows, org auth, scanner config |

## 3. Architecture Overview

```
┌────────────────────────────────────────────────────────────────┐
│  Web UI  (Next.js + GitHub App auth)                           │
│  Pipeline board · Diff viewer · Deploy preview · Rollback ·    │
│  Gate config · Work-item panel · Audit log                     │
└──────────────┬─────────────────────────────────────────────────┘
               │ GitHub REST/GraphQL (as GitHub App installation)
┌──────────────▼─────────────────────────────────────────────────┐
│  GitHub                                                        │
│  · Repo (SFDX source format, source of truth)                  │
│  · Branch-per-environment promotion model                      │
│  · Actions workflows (validate, promote, deploy, rollback)     │
│  · Environments w/ required reviewers = stage gates            │
│  · Deployments API = deploy history & rollback targets         │
└──────┬──────────────────────┬──────────────────────────────────┘
       │ sf CLI (JWT auth)    │ REST
┌──────▼───────────┐   ┌──────▼──────────────┐
│ Salesforce orgs  │   │ Jira Cloud / ADO    │
│ INT → UAT → PROD │   │ work-item linking,  │
│ (sandboxes)      │   │ deployment status   │
└──────────────────┘   └─────────────────────┘
```

**Key mechanics**

- **Delta deployments** via `sfdx-git-delta` (SGD): every deploy computes `package.xml`
  + `destructiveChanges.xml` from the git diff between two refs.
- **Deploy history as git tags + GitHub Deployments**: every successful deploy to an
  environment writes an immutable tag `deploy/<env>/<seq>` and a GitHub Deployment
  record with a JSON manifest (components, work items, run URL, actor).
- **Rollback = reverse delta**: diff `deploy/<env>/current` → `deploy/<env>/target`
  with SGD in reverse, producing "redeploy old versions" + optional destructive
  changes for components added since. Always validated + previewed before execution.
- **Stage gates** = GitHub Environments (required reviewers, wait timers) **plus**
  pipeline-level quality gates evaluated in-workflow (coverage %, scanner severity,
  work-item state checks).

## 4. Key Design Decisions & Assumptions

| # | Decision | Rationale |
|---|---|---|
| D1 | Branch-per-environment promotion model: `feature/*` → `integration` → `uat` → `main` (prod) | Mirrors DevOps Center's mental model of "stages"; each promotion is a PR, giving free diff/conflict/review UX |
| D2 | SFDX **source format**, single package dir (`force-app`) to start; org-dependent unpackaged metadata allowed | Citizen-dev friendly; 2GP packaging can come later |
| D3 | Org auth via **JWT bearer flow** (connected app + cert per org), secrets in GitHub Environments | Non-interactive, per-environment scoping, no password rot |
| D4 | UI is a **standalone Next.js app** backed by a **GitHub App** | DevOps-Center-like UX without rebuilding inside Salesforce; GitHub App gives fine-grained, auditable, installation-scoped tokens |
| D5 | Work-item IDs carried in **branch names and PR titles**, enforced by CI | Citizen devs never write commit messages — the UI does it for them |
| D6 | Jira and ADO supported via a common **work-item adapter interface** | "JIRO"/Jira + ADO both required; adapter keeps the pipeline vendor-neutral |
| D7 | Static analysis via **Salesforce Code Analyzer v5** (PMD, ESLint, RetireJS, Flow scanner, Graph Engine) | Official, covers Apex + LWC + Flows; SonarQube optional add-on |
| D8 | Rollback is **metadata-only** and always **validate-first with preview** | Salesforce cannot roll back data or all metadata types safely; the UI must be honest about this |
| D9 | Test policy per stage: `Conditional`, `RunLocalTests`, `RunSpecifiedTests`, or `RunRelevantTests`; specified tests use a reviewed class allow-list and Quick Deploy reuses only an identical test policy | Speed for developers, explicit evidence for reviewers, safety for governed stages |

**Assumptions:** GitHub Cloud (not GHES); Salesforce sandboxes per stage (not scratch
orgs) since citizen developers work in persistent sandboxes; Jira Cloud and/or Azure
DevOps Services; single production org per pipeline (multi-org support is a later epic).

## 5. Functional Requirements

### Epic E1 — Repository & Branching Model

- **E1.1** SFDX project scaffold: `force-app/`, `sfdx-project.json`, `.forceignore`,
  scanner config, CODEOWNERS, PR/issue templates.
- **E1.2** Long-lived branches `integration`, `uat`, `main`, each mapped to an org and a
  GitHub Environment. Mapping lives in a committed config file `.orbitops/pipeline.yml`:
  ```yaml
  pipeline:
    - branch: integration
      org: INT
      environment: integration
      gates: { scannerMaxSeverity: 3, minCoverage: 0 }
    - branch: uat
      org: UAT
      environment: uat
      gates: { scannerMaxSeverity: 2, minCoverage: 75, requiredReviewers: true }
    - branch: main
      org: PROD
      environment: production
      gates: { scannerMaxSeverity: 2, minCoverage: 80, requiredReviewers: true }
      # workItemStatus: ["Ready for Release"]   # post-PoC gate — requires live tracker connection (E2.5)
  ```
- **E1.3** Branch protection: no direct pushes to environment branches; merges only via
  PR with green checks.
- **E1.4** Feature branches created **by the UI** with the pattern
  `feature/<WORKITEM-ID>-<slug>` (e.g. `feature/PROJ-123-discount-field`,
  `feature/AB#456-case-routing`).

### Epic E2 — Work-Item Traceability (Jira + Azure DevOps)

> **PoC scope:** live tracker integration (Jira/ADO APIs) is **out of scope** for the
> PoC. The PoC keeps the *structural* traceability — ID conventions, extraction, and
> format validation (E2.1 format-only, E2.2) — so every commit/promotion is tagged
> and the tracker APIs can be added later without reworking the pipeline. E2.3–E2.5
> are post-PoC; E2.6 is implemented as an interface with a no-op stub adapter.

- **E2.1** A promotion/PR cannot be created without at least one valid work-item ID
  (Jira key `[A-Z][A-Z0-9]+-\d+` or ADO `AB#\d+`). CI check validates the ID **exists**
  via the adapter API and fails otherwise. *(PoC: format validation only — no API
  existence check.)*
- **E2.2** UI-generated commits embed work-item IDs in the commit message footer
  (`Work-Items: PROJ-123, AB#456`); pro-code devs get the same via a documented convention
  checked in CI (warning on feature branches, blocking on promotion PRs).
- **E2.3** *(Post-PoC.)* On each deploy, the pipeline posts back to the tracker:
  - **Jira**: Deployments API (`deployment` info shows on the issue's "Releases" panel)
    or fallback comment with env, status, run link, components count.
  - **ADO**: `AB#` in the merge commit auto-links; additionally attach a
    build/deployment status via ADO REST.
- **E2.4** UI work-item panel: for any pending promotion, list the work items in the
  commit range, with title/status/assignee fetched live from Jira/ADO. *(PoC: list
  the extracted IDs only, no live tracker data.)*
- **E2.5** Optional gate: promotion to a stage requires all attached work items to be in
  a configured status (e.g. "Ready for UAT"). *(Post-PoC.)*
- **E2.6** Adapter interface (single TypeScript interface, two implementations):
  `validateId`, `getWorkItem`, `postDeploymentStatus`, `extractIdsFromText`.
  *(PoC: interface + `StubAdapter` only; Jira/ADO implementations post-PoC.)*

### Epic E3 — CI Validation (Pull Request Checks)

Runs on every PR into any environment branch:

- **E3.1** **Delta build**: SGD computes `package.xml` / `destructiveChanges.xml` from
  the merge base; artifact uploaded and rendered in the PR as a "What will deploy"
  comment (component list grouped by metadata type, with adds/changes/deletes).
- **E3.2** **Check-only deploy** (`sf project deploy validate`) against the target
  stage's org with the stage's configured test level. Validation ID saved for
  quick-deploy.
- **E3.3** **Static analysis**: Salesforce Code Analyzer runs on changed files;
  SARIF uploaded to GitHub code scanning; findings above the stage's severity
  threshold fail the check. Delta-aware: only new/changed findings block.
- **E3.4** **Apex test results**: coverage % (org-wide and per-class for changed
  classes) posted as a PR comment; below-threshold fails.
- **E3.5** **Work-item check** (E2.1).
- **E3.6** **Metadata guardrails** (configurable deny-list): block profiles, named
  credentials with secrets, connected app consumer secrets, community/site configs
  from citizen-dev promotions unless a release manager label is applied.
- **E3.7** All checks report as distinct GitHub check runs so the UI can show
  per-gate pass/fail chips.

### Epic E4 — Promotion & Deployment

- **E4.1** Merging a PR into an environment branch triggers deployment to that
  stage's org, guarded by the GitHub Environment (required reviewers/wait timer).
- **E4.2** Deploy uses **quick-deploy** of the PR's validation when the validated
  commit == merge commit content; otherwise re-validates then deploys.
- **E4.3** On success: create tag `deploy/<env>/<seq>`, create GitHub Deployment with
  manifest JSON `{sha, packageXml, destructive, workItems, coverage, scanner, runUrl,
  actor, timestamp}`, notify trackers (E2.3), optionally notify Slack/Teams.
- **E4.4** On failure: GitHub Deployment marked failed; component-level errors parsed
  from `sf` JSON output and rendered readably in the UI and as a PR comment.
- **E4.5** Concurrency: one deploy per environment at a time
  (`concurrency: deploy-<env>`), queued not cancelled.
- **E4.6** Manual "deploy this branch to this org" is release-manager-only,
  via `workflow_dispatch` with an audit reason field.
- **E4.7** Back-promotion guard: after a prod deploy, open automated PRs to sync
  `main` → `uat` → `integration` so lower stages never drift behind prod.

### Epic E5 — Rollback (UI-driven)

- **E5.1** UI shows deploy history per environment (from tags + Deployments API):
  seq, date, actor, work items, component count, status; current state highlighted.
- **E5.2** User picks a target deployment → system computes **reverse delta**
  (SGD `--from deploy/<env>/current --to deploy/<env>/<target>`):
  - components changed since target → redeploy at target's versions,
  - components **added** since target → listed as destructive candidates, **excluded
    by default**, opt-in via checkbox with explicit warning.
- **E5.3** Rollback preview screen: full component list (redeploy vs delete), work
  items being backed out, and **rollback safety warnings** for known-risky types
  (field deletions lose data; active Flow versions; picklist values in use; profile
  or permission-set regressions; anything in the deny-list).
- **E5.4** Rollback always runs **validate first**; the user sees validation results
  before confirming execution. Prod rollback additionally passes through the
  production Environment gate (required reviewer).
- **E5.5** Executed rollback creates a **new** deployment record and a
  **revert commit/PR on the environment branch** so Git history and org state stay
  in sync (no force pushes, ever).
- **E5.6** Rollback of a rollback works the same way (it's just another target).
- **E5.7** Out of scope, stated in UI: data changes, metadata not in the repo,
  org-side manual changes. Recommend a nightly org snapshot (`sf project retrieve`)
  job to a `snapshots/<env>` branch as a drift record (E9.4).

### Epic E6 — Citizen Developer UI

- **E6.1** **Pipeline board**: columns per stage; cards = work items / open promotions;
  per-stage chips for gate status; "Promote" button opens the promotion flow.
- **E6.2** **Workspace flow** (citizen dev "get my changes into Git" — the DevOps
  Center "pull changes" equivalent): user selects their work item + source sandbox;
  the platform runs `sf project retrieve` (workflow) against a per-work-item feature
  branch, shows retrieved components as checkboxes, commits selected ones with the
  work-item-tagged message. No local tooling required.
- **E6.3** **Diff viewer**: file-level diffs from the GitHub compare API, plus a
  **metadata-aware summary** ("Field `Discount__c` added to `Opportunity`; Flow
  `Case_Routing` modified") generated from the SGD manifest + simple XML introspection.
- **E6.4** **Merge conflict surfacing**: promotion PRs show mergeability from the
  GitHub API; conflicted files listed with plain-language guidance and an "assign to a
  developer" handoff button (citizen devs don't resolve conflicts themselves).
- **E6.5** **Deploy preview**: "What will deploy" list (from E3.1 artifact) with
  adds/changes/deletes, tests to run, and gate checklist — visible before approving.
- **E6.6** **Gate configuration** (release manager role): edit `.orbitops/pipeline.yml`
  via the UI (writes a config PR), manage GitHub Environment reviewers via API.
- **E6.7** **Audit log**: every promote/approve/rollback/config change with actor,
  timestamp, and link to the Actions run.
- **E6.8** AuthN: GitHub OAuth login; roles (citizen dev / release manager / admin)
  mapped from GitHub team membership.
- **E6.9** Accessibility & language: no Git jargon on citizen-dev screens
  ("Promote to UAT", not "merge PR"; "Back out release", not "revert").

### Epic E7 — Static Analysis & Quality Gates

- **E7.1** Salesforce Code Analyzer v5 with committed config (`code-analyzer.yml`):
  PMD + ESLint + RetireJS + Flow scanner; Graph Engine (data-flow) weekly on full
  codebase, delta on PRs.
- **E7.2** Severity gate per stage (D1 config). Findings posted as PR review comments
  on the offending lines + SARIF to GitHub code scanning.
- **E7.3** Baseline handling: existing violations recorded in a baseline file so only
  **new** violations block; a burn-down report page in the UI.
- **E7.4** Optional integrations behind the same gate interface: SonarQube, Checkmarx.

### Epic E8 — Security & Auth

- **E8.1** Connected app per org, JWT cert auth; private keys only in GitHub
  Environment secrets; least-privilege integration user per org.
- **E8.2** GitHub App permissions: contents RW, pull requests RW, checks RW,
  deployments RW, environments R, actions RW — nothing more.
- **E8.3** No secrets ever in the repo; secret scanning + push protection enabled;
  workflows pin action versions by SHA.
- **E8.4** UI backend validates role on every mutating call (server-side, not
  UI-hidden buttons).

### Epic E9 — Observability & Operations

- **E9.1** Every workflow emits a structured JSON summary artifact consumed by the UI.
- **E9.2** Deploy duration / failure-rate / rollback-count metrics page (DORA-lite).
- **E9.3** Failure notifications to Slack/Teams webhook with human-readable cause.
- **E9.4** Nightly org-drift snapshot job (retrieve → diff vs branch → report).

## 6. Non-Functional Requirements

- **NFR1** PR validation feedback ≤ 15 min for typical deltas (delta deploys + delta scans mandatory).
- **NFR2** UI actions acknowledge within 2 s (fire workflow, poll status async).
- **NFR3** Everything as code: workflows, pipeline config, scanner config, gate config all committed and PR-reviewed.
- **NFR4** Zero standing credentials on developer machines for citizen devs (all org access via workflows).
- **NFR5** Complete auditability: every org mutation traceable to actor + work item + run.
- **NFR6** The pipeline (Actions + CLI) must work without the UI (UI is a convenience layer, not a dependency).

## 7. Salesforce-Specific Constraints & Risks (acknowledge in design)

1. **No true rollback exists** — metadata redeploy is the best approximation; data and
   some metadata types (e.g., deleting a field ≠ restoring its data later) are one-way doors.
2. **Profiles/permission sets** diff noisily and deploy destructively-by-merge; prefer
   permission sets, guardrail profiles (E3.6).
3. **Flows**: deploying an old version adds a new version; active-version handling must
   be explicit in rollback preview.
4. **Metadata API coverage gaps**: some settings aren't retrievable/deployable; the
   drift snapshot (E9.4) makes gaps visible.
5. **Validation ≠ deployment** under concurrent change: quick-deploy only when the org
   hasn't drifted between validate and deploy; otherwise re-validate.
6. **API/limits**: long deploys, test-run limits in busy orgs; queue per env (E4.5).

## 8. Recommended Stack

| Concern | Choice |
|---|---|
| CLI | `sf` (Salesforce CLI v2) — never legacy `sfdx` binary |
| Delta engine | `sfdx-git-delta` plugin |
| Scanner | `code-analyzer` plugin (Code Analyzer v5) |
| CI | GitHub Actions, reusable workflows in `.github/workflows/` |
| UI | Next.js (App Router) + Octokit + GitHub App; PoC runs locally (`npm run dev`), hosting (Vercel/Fly/internal) deferred to post-PoC |
| Work items | Jira Cloud REST v3 + ADO REST 7.x behind one adapter |
| Diff rendering | GitHub compare API + `diff2html`; metadata summary from SGD output |

## 9. Build Phases (maps 1:1 to BUILD_PROMPTS.md)

1. Repo scaffold + pipeline config schema
2. PR validation workflow (delta, validate, tests)
3. Static analysis + quality gates
4. Promotion/deploy workflows + environments + tags/manifests
5. Work-item tagging: extraction, format validation, stub adapter (Jira/ADO API adapters post-PoC)
6. Rollback workflow (reverse delta, validate-first)
7. UI foundation (GitHub App, auth, roles)
8. UI pipeline board + promotion flow + deploy preview
9. UI diff viewer + conflict surfacing + workspace (retrieve) flow
10. UI rollback experience
11. Gate configuration UI + audit log
12. Hardening: back-promotion, drift snapshots, metrics, docs
