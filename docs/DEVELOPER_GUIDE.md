# Salesforce DevOps — Pro-Code Developer Guide

The Salesforce DevOps web UI exists for citizen developers. **You don't need it.** The
entire release process is plain Git + GitHub: branch, commit, open a PR, merge.
Everything the UI does is a convenience wrapper around the operations below —
both paths are first-class and interoperate (a change started in the UI can be
finished from the terminal, and vice versa).

## The model in one paragraph

GitHub is the source of truth, in SFDX source format (`force-app/`). Each
pipeline stage is a long-lived branch mapped to an org in
[.orbitops/pipeline.yml](../.orbitops/pipeline.yml) — order in that file is
promotion order (currently `integration` → `uat` → `main`). Every promotion is
a PR. A release candidate is built from that PR and deployed to the destination
org first; only a successful real deployment merges the PR. Each stage branch
therefore represents what is already live in its mapped org. The deployment is
gated by the stage's GitHub Environment (required reviewers on uat/production).

## Day-to-day flow

```bash
# 1. Start from the first stage branch
git switch integration && git pull

# 2. Branch with your work item in the name (this is how traceability works)
git switch -c feature/PROJ-123-discount-field

# 3. Build. Work in your sandbox and `sf project retrieve start`, or edit
#    source directly — your call. Commit as usual.
git commit -am "Add discount field to Clinic"

# 4. Push and open the promotion PR into the first stage
git push -u origin feature/PROJ-123-discount-field
gh pr create --base integration --title "Add discount field (PROJ-123)"
```

Checks run automatically (see below). When they are green, **request the
release candidate — do not merge the PR yourself**:

```bash
gh workflow run release-candidate.yml --ref main \
  -f pr_number=<number> \
  -f target_branch=<stage-branch>
```

The release workflow queues candidates for that stage, rebuilds this PR from
the current stage revision, validates and deploys it to Salesforce, then merges
the PR only after the real deployment succeeds. A failed deployment leaves the
PR and stage branch unchanged.

Promoting onward works the same way: open a PR from the lower stage branch to
the next one (`integration` → `uat`, `uat` → `main`). Releases to uat and
production additionally wait at the GitHub Environment gate for a release
manager's approval (Actions → the queued run → Review deployments).

## Work-item tagging (enforced by the "Work items" check)

Every promotion PR must reference a Jira issue (`PROJ-123`) or Azure DevOps
work item (`AB#456`) in **any** of:

| Where | Example |
|---|---|
| Branch name | `feature/PROJ-123-discount-field` |
| PR title | `Add discount field (PROJ-123)` |
| Commit message footer | `Work-Items: PROJ-123, AB#456` |

Commit *bodies* are not scanned — only footers, branch names, and PR titles.

## What runs on your PR

| Check | What it does | Blocking? |
|---|---|---|
| Resolve stage | Maps the base branch to its stage + gates via pipeline.yml | Skips everything if the base isn't a stage |
| What will deploy | sfdx-git-delta package preview, posted as a sticky PR comment | No (informational) |
| Work items | Tagging conventions above | Yes |
| Code scan | Salesforce Code Analyzer v5 on changed files; blocks on NEW findings at/above the stage's `scannerMaxSeverity` (vs the committed baseline) | Yes |
| Validate against target org | Check-only deploy (`sf project deploy validate`) against the stage org; errors posted as a sticky comment | Yes |
| Coverage gate | Apex coverage from the validation vs the stage's `minCoverage`. Not applicable (passes) when the delta contains no Apex | Yes |

A successful PR validation is a useful practice run. The release candidate is
validated again from the latest stage state; when that fresh validation permits
it, its quick-deploy ID completes the actual deployment without a second test
run.

## Useful operations without the UI

- **Release a promotion**: Actions → "Release candidate" → Run workflow → enter
  the open promotion number and its target stage. The workflow merges only
  after Salesforce succeeds; the environment gate still applies.
- **Repair a drifted org**: Actions → "Salesforce DevOps Deploy" → Run workflow →
  pick the stage branch and give a reason (audit-logged). This is not the
  normal release path; it brings the org back to the branch's recorded state.
- **Rollback**: Actions → "Salesforce DevOps Rollback" → env + target release sequence +
  mode (`preview` first — it validates and publishes a safety report; then
  `execute`). Rollback is metadata-only, forward-revert (no force-push).
- **Release history**: git tags `deploy/<env>/<seq>`, plus JSON manifests under
  `deployments/<env>/` on the `orbitops-meta` branch (components, work items,
  actor, run URL).
- **Re-run failed checks**: GitHub's "Re-run failed jobs" on the run (the UI's
  "Try the checks again" button does exactly this).
- **Back-promotion**: after every production deploy, sync PRs (prod → uat →
  integration) open automatically so lower stages don't drift. Just review and
  merge them.

## Changing the pipeline itself

All pipeline behaviour lives on **main** — change it once, it applies everywhere:

- **Stages, orgs, gates**: `.orbitops/pipeline.yml` (PR to main; CODEOWNERS
  review). Stage order in the file is promotion order. Adding a stage also
  needs its branch, GitHub Environment, and org secrets — the UI's Settings →
  Pipeline stages automates most of that, or see SETUP.md.
- **Workflow logic**: `.github/workflows/_pr-validate.yml`, `_deploy.yml`, and
  `_release-candidate.yml` are reusable workflows (the single source of
  truth) invoked from thin callers that pin `@main`.
  **Never edit the callers on stage branches** — change the `_*.yml` files on
  main. Scripts live in `scripts/**` (Node ESM, unit-tested: `npm test`); jobs
  check them out from main at run time, so script fixes also land once.
- **Scanner rules/baseline**: `code-analyzer.yml` +
  `.orbitops/scanner-baseline.json` on main.

## Rules the platform enforces (don't fight them)

- No direct pushes to stage branches — merges only via PR with green checks.
- Never force-push; history (release tags, manifests) is append-only.
- Profiles are excluded via `.forceignore` — use permission sets.
- Secrets are never committed. UI-connected orgs share the central OrbitOps
  JWT credentials while their username and org type come from the
  `orbitops-meta` registry; legacy repo/environment secrets remain supported
  during migration (see SETUP.md).
