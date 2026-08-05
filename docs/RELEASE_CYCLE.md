# Salesforce DevOps — The Release Cycle (both doors, one pipeline)

Two kinds of people ship Salesforce changes through Salesforce DevOps, and they use
different front doors onto the **same** pipeline:

- **Citizen developers** use the web UI (`http://localhost:3000`). No Git, no
  CLI. → depth: [CITIZEN_GUIDE.md](CITIZEN_GUIDE.md).
- **Professional developers** use plain Git + GitHub — branch, commit, PR,
  merge. → depth: [DEVELOPER_GUIDE.md](DEVELOPER_GUIDE.md).

This page is the **map, not the territory**: it shows how the two doors line up
step-for-step so anyone can follow a change regardless of who started it. Every
UI action is a wrapper over the same Git operations, so a change begun in the UI
can be finished from the terminal and vice versa — the pipeline can't tell which
door was used.

## The pipeline in one breath

GitHub is the source of truth (SFDX source format, `force-app/`). Each **stage**
is a long-lived branch mapped to an org, and the stage order lives in
[`.orbitops/pipeline.yml`](../.orbitops/pipeline.yml) — that file's order *is*
promotion order (`<first stage>` → … → production). **A promotion is a PR into
the next stage branch; merging it deploys to that stage's org**, gated by the
stage's GitHub Environment (required reviewers on the later stages). Nothing is
ever deployed by hand.

## Same cycle, both doors

| Step | In the UI (citizen developer) | In Git / GitHub (pro-code developer) |
|---|---|---|
| **1. Start a change** | *Start a change* → enter work item (`PROJ-123`/`AB#456`) + a description | `git switch -c feature/PROJ-123-slug` from the first stage branch |
| **2. Build** | Do the work in Salesforce Setup (fields, flows, layouts) | Edit `force-app/` directly, or `sf project retrieve start` from your sandbox |
| **3. Bring the work in** | *Pull my changes* — runs the retrieve workflow, shows edits in plain language, untick what isn't yours | `git commit` (you already have the files locally) |
| **4. Submit for review** | *Submit for promotion* — opens the PR, starts the checks | `git push` + `gh pr create --base <first stage>` |
| **5. Checks** | Friendly check panel on the change page; failures explain themselves | The same status checks on the PR (see table below) |
| **6. Promote** | *Promote to <stage>* button when green | Merge the PR — the merge **is** the promotion |
| **7. Approve** (later stages) | Approval card on the pipeline board | Actions → the queued run → *Review deployments* |
| **8. Onward** | Promote again to the next stage | Open a PR from the lower stage branch into the next |
| **9. Roll back** | *Back out a release* → preview → confirm | Actions → *Salesforce DevOps Rollback* → `preview`, then `execute` |

Work-item tagging is required either way (the UI adds it for you; pro devs put
`PROJ-123` in the branch name, PR title, or a `Work-Items:` commit footer). Full
rules: [WORKITEMS.md](WORKITEMS.md).

## What runs on a promotion (identical for both doors)

| Check | What it does | Blocking? |
|---|---|---|
| **Resolve stage** | Maps the PR's base branch → its stage, org, gates | Skips everything if the base isn't a stage |
| **What will deploy** | `sfdx-git-delta` package preview, posted as a sticky comment | No (informational) |
| **Work items** | A valid work item is referenced | Yes |
| **Code scan** | Code Analyzer v5; blocks on *new* findings at/above the stage's severity | Yes |
| **Validate against target org** | Check-only deploy against the real stage org (compiles, runs tests, deploys nothing) | Yes |
| **Coverage gate** | Apex coverage vs the stage's threshold; not-applicable when the delta has no Apex | Yes |

On merge, the deploy reuses the validation as a **quick deploy** (no re-run of
tests) when eligible, tags `deploy/<env>/<seq>`, and writes a manifest to the
`orbitops-meta` branch — the whole history the UI and rollback read from.

Full workflow inventory and the "how a deployment actually works" mechanics are
in the [main README](../README.md).

## Where to go next

- **Clicking through it (citizen):** [CITIZEN_GUIDE.md](CITIZEN_GUIDE.md)
- **Doing it from the terminal (pro dev):** [DEVELOPER_GUIDE.md](DEVELOPER_GUIDE.md)
- **Setting up the platform:** [SETUP.md](SETUP.md)
- **Operating it (drift, rotation, recovery):** [RUNBOOK.md](RUNBOOK.md)
