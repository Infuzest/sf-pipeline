# OrbitOps — The Full Release Cycle (both doors, one pipeline)

Two kinds of people ship Salesforce changes through OrbitOps, and they use
different front doors onto the **same** pipeline:

- **Citizen developers** use the web UI (`http://localhost:3000`). No Git, no
  CLI. → quick version: [CITIZEN_GUIDE.md](CITIZEN_GUIDE.md).
- **Professional developers** use plain Git + GitHub — branch, commit, PR,
  merge. → quick version: [DEVELOPER_GUIDE.md](DEVELOPER_GUIDE.md).

Every UI action is a wrapper over the same Git operations, so a change begun in
the UI can be finished from the terminal and vice versa — the pipeline can't
tell which door was used. This page walks the **entire cycle end to end, both
doors side by side at every phase**.

## The pipeline in one breath

GitHub is the source of truth (SFDX source format, `force-app/`). Each **stage**
is a long-lived branch mapped to an org, and the stage order lives in
[`.orbitops/pipeline.yml`](../.orbitops/pipeline.yml) — that file's order *is*
promotion order (`integration` → `uat` → `main`/production today). **A promotion
is a PR into the next stage branch; merging it deploys to that stage's org**,
gated by the stage's GitHub Environment (required reviewers on the later
stages). Nothing is ever deployed by hand.

## The cycle at a glance

| Step | In the UI (citizen developer) | In Git / GitHub (pro-code developer) |
|---|---|---|
| **1. Start a change** | *Start a change* → enter work item (`PROJ-123`/`AB#456`) + a description | `git switch -c feature/PROJ-123-slug` from the first stage branch |
| **2. Build** | Do the work in Salesforce Setup (fields, flows, layouts) | Edit `force-app/` directly, or `sf project retrieve start` from your sandbox |
| **3. Bring the work in** | *Pull my changes* — runs the retrieve workflow, shows edits in plain language, untick what isn't yours | `git commit` (you already have the files locally) |
| **4. Submit for review** | *Submit for promotion* — opens the PR, starts the checks | `git push` + `gh pr create --base integration` |
| **5. Checks** | Friendly check panel; failures explain themselves | The same status checks on the PR (see table below) |
| **6. Promote** | *Promote to <stage>* button when green | Merge the PR — the merge **is** the promotion |
| **7. Approve** (later stages) | Approval card on the pipeline board | Actions → the queued run → *Review deployments* |
| **8. Onward** | Promote again to the next stage | Open a PR from the lower stage branch into the next |
| **9. Verify** | *Release history* / *My changes* badges | `git tag -l 'deploy/*'`, Deployments API, `orbitops-meta` manifests |
| **10. Roll back** | *Back out a release* → preview → confirm | Actions → *OrbitOps Rollback* → `preview`, then `execute` |

The rest of this page is the same cycle in detail.

---

## Phase 0 — Prerequisites

**Both personas**: a work item (Jira `PROJ-123` or Azure DevOps `AB#456`) —
nothing moves through the pipeline untagged ([WORKITEMS.md](WORKITEMS.md)).

**Citizen (UI)**: sign in with GitHub in the sidebar. Your role (Builder /
Release manager) is assigned by the platform owner. If your sandbox isn't in the
"Pull my changes" picker yet: Settings → *Connect an org* (you sign in on
Salesforce's own page; OrbitOps never sees your password).

**Pro dev (Git)**:

```bash
git clone https://github.com/SalikPOC/sf-pipeline && cd sf-pipeline
gh auth login                      # once
sf org login web -a my-sandbox     # if you'll retrieve from a sandbox
```

You need write access to the repo. Direct pushes to stage branches are blocked
by branch protection — everything lands via PR, including yours.

## Phase 1 — Start a change

**UI**: *Start a change* → work item ID + one-line description → **Create my
change**. You land in the change workspace; the 5-step journey stepper
(Build → Pull → Review & submit → Checks → Promote) tracks where you are.
Under the hood this creates `feature/<WORKITEM>-<slug>` off the first stage
branch.

**Git**:

```bash
git switch integration && git pull
git switch -c feature/PROJ-123-discount-field
```

The work item **must** appear in the branch name, the PR title, or a
`Work-Items: PROJ-123` commit footer — the "Work items" check enforces it.

## Phase 2 — Build

**UI**: build with clicks in your sandbox (Setup: fields, flows, validation
rules, layouts…). Nothing to do in OrbitOps while you build.

**Git**: your choice of workflow —

```bash
# Option A: source-first — edit force-app/ directly in your editor
# Option B: org-first — build in a sandbox, then pull the metadata down:
sf project retrieve start -o my-sandbox -m "CustomField:Account.Discount__c"
git add force-app && git commit -m "Add discount field to Account"
```

Profiles are excluded by `.forceignore` — use permission sets.

## Phase 3 — Bring the work in

**UI**: change workspace → pick your org → **Pull my changes**. A workflow
retrieves your edits into the branch (progress banner, ~1–2 min). The list
shows every component in plain language ("Field 'Discount' on Clinic — added");
flows get a visual Flow-Builder-style diff. **Ticked = part of your change** —
untick anything that isn't yours (shared sandboxes surface everyone's edits)
and *Remove the unticked items*.

**Git**: you already committed in Phase 2. If a citizen teammate pulled into
this branch too, `git pull` and review — UI pulls are ordinary commits by the
retrieve workflow.

## Phase 4 — Submit for review

**UI**: **Submit for promotion** (title prefilled). This opens the promotion —
checks start immediately; the stepper moves to *Checks*.

**Git**:

```bash
git push -u origin feature/PROJ-123-discount-field
gh pr create --base integration --title "Add discount field (PROJ-123)"
```

## Phase 5 — Checks (identical for both doors)

| Check | What it does | Blocking? |
|---|---|---|
| **Resolve stage** | Maps the PR's base branch → its stage, org, gates | Skips everything if the base isn't a stage |
| **What will deploy** | `sfdx-git-delta` package preview, posted as a sticky comment | No (informational) |
| **Work items** | A valid work item is referenced | Yes |
| **Code scan** | Code Analyzer v5; blocks on *new* findings at/above the stage's severity | Yes |
| **Validate against target org** | Check-only deploy against the real stage org (compiles, runs tests, deploys nothing) | Yes |
| **Coverage gate** | Apex coverage vs the stage's threshold; not-applicable when the delta has no Apex | Yes |

Check runs appear as `checks / <name>` on the PR. A green validation with tests
mints a **quick-deploy ID** the merge can reuse (no test re-run).

**When a check fails —**

- **UI**: the *What needs attention* panel explains each failure in plain
  language with what to do, plus **Try the checks again** (re-runs failed
  jobs), *Open the full report*, and *Ask a developer for help* (posts a
  comment on the PR tagging the failing check).
- **Git**: read the sticky PR comments (deploy preview, scan table, validation
  errors), fix, push — a new push always triggers a fresh validation. GitHub's
  *Re-run failed jobs* works for transient failures only: **re-runs execute the
  original run's workflow snapshot**, so they never pick up pipeline-definition
  changes; those need a new event (push, or close/reopen the PR).

## Phase 6 — Promote to the first stage

**UI**: when everything is green, **Promote to Integration**. A result banner
appears at the top of the page; the board shows *Releasing…*.

**Git**: merge the PR (merge commit — it preserves `Work-Items:` footers):

```bash
gh pr merge <number> --merge --delete-branch
```

The merge triggers the deploy: delta (or quick-deploy) to the stage org, then
tag `deploy/integration/<seq>` + a JSON manifest on `orbitops-meta` + a GitHub
Deployment record. Merges with an empty deployable delta (docs-only, pipeline
config) skip the deploy cleanly.

## Phase 7 — Promote onward, with approvals

Promotion up the pipeline is a PR **from the lower stage branch into the next**
(`integration` → `uat`, `uat` → `main`). Promotions past the first stage are
release-manager territory.

**UI (release manager)**: promote from the change/board as before. When the
deploy hits a gated stage, an **approval card** appears at the top of the
pipeline board: what will deploy (component list), Approve & release / Reject,
optional audit note.

**Git**:

```bash
gh pr create --base uat --head integration --title "Promote to UAT (PROJ-123)"
# after checks: gh pr merge --merge
```

The deploy then **waits at the GitHub Environment gate**: Actions → the queued
run → *Review deployments* → approve. Same gate the UI card drives — approvals
are recorded as the person who clicked, either way.

## Phase 8 — Verify what shipped

**UI**: *Release history* (per-stage releases with work items, contents,
back-out links) · *My changes* (✓ INT ✓ UAT ○ PROD badges per work item) ·
*Audit & reporting* (DORA-lite tiles, CSV export).

**Git**:

```bash
git tag -l 'deploy/uat/*'                      # every release, sequenced
git show deploy/uat/3                          # what the tag points at
gh api repos/SalikPOC/sf-pipeline/deployments  # GitHub Deployments records
# full manifests (components, work items, actor, run URL):
git fetch origin orbitops-meta && git show origin/orbitops-meta:deployments/uat/3.json
```

## Phase 9 — Back-promotion (keeping stages in sync)

After every **production** deploy, the pipeline automatically opens sync PRs
down the chain (prod → uat → integration) labeled `back-promotion`, so lower
stages don't drift. Review and merge them like any PR (UI board shows them as
incoming changes; Git: `gh pr list --label back-promotion`).

## Phase 10 — Rolling back

Rollback is **metadata-only**, validate-first, and never rewrites history (a
forward revert commit via bot PR).

**UI**: *Back out a release* → pick the stage → *Back out to here* on the
target release → preview report (what's restored, what would be deleted,
data-loss warnings, Salesforce validation verdict) → optionally include
destructive changes → type the stage name to confirm → execute
(release-manager only, reason required, audit-logged).

**Git**: Actions → *OrbitOps Rollback* → Run workflow → `env` +
`target_seq` + `mode: preview` first; read the safety report
(`rollback-previews/<runId>.json` on `orbitops-meta`), then re-run with
`mode: execute` and a reason.

## Mixed-mode: handing off between doors

- A citizen's change is a normal branch + PR — a pro dev can `git switch` to
  it, fix a conflict or a scan finding, push, and the citizen promotes in the UI.
- A pro dev's PR shows up on the UI board like any other — a release manager
  can promote/approve it without touching Git.
- Conflicts ("overlaps with another change") are deliberately routed to
  developers: the UI's *Ask a developer for help* posts the handoff comment;
  resolve with an ordinary merge/rebase-free conflict fix on the feature branch.

## Troubleshooting quick reference

| Symptom | Likely cause | Fix |
|---|---|---|
| Coverage gate fails on a no-code change | Old pipeline (pre has-apex fix) ran | New runs auto-pass; trigger a fresh run (push or close/reopen) |
| Re-run didn't pick up a pipeline fix | Re-runs use the original workflow snapshot | New event: push, or close/reopen the PR |
| Deploy queued forever | Environment gate awaiting review, or another run holds the per-stage concurrency lock | Approve/reject the gate; cancel stale waiting runs |
| "Overlaps with another change" | Real merge conflict with another promotion | Developer resolves on the feature branch |
| Promote button disabled | A check failing/running, or conflict | The reason is printed under the button; see Phase 5 |
| Nothing deployed after merge | Empty deployable delta (docs/config only) | Expected — precheck skips the gated deploy |

## Where to go next

- **Clicking through it (citizen):** [CITIZEN_GUIDE.md](CITIZEN_GUIDE.md)
- **Terminal-first reference (pro dev):** [DEVELOPER_GUIDE.md](DEVELOPER_GUIDE.md)
- **Setting up the platform:** [SETUP.md](SETUP.md)
- **Operating it (drift, rotation, recovery):** [RUNBOOK.md](RUNBOOK.md)
- **Pipeline mechanics & architecture:** [../README.md](../README.md)
