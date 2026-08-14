# Salesforce DevOps sf-pipeline — AI assistant brief

Read this before changing anything. It is the condensed, always-current map of
the repo for AI coding tools (Copilot, Cursor, Claude, GPT, …). The human docs
it summarizes: [README.md](README.md) (architecture),
[REQUIREMENTS.md](REQUIREMENTS.md) (spec, epics E1–E9),
[CLAUDE.md](CLAUDE.md) (dated decision log — append, never rewrite),
[docs/](docs/) (SETUP, RUNBOOK, DEVELOPER_GUIDE, CITIZEN_GUIDE, WORKITEMS).

## What this repo is

Salesforce CI/CD platform ("Salesforce DevOps") built on GitHub Actions + `sf` CLI v2.
GitHub is the source of truth for org metadata (SFDX source format,
`force-app/`). Two personas, one pipeline:

- **Citizen developers** use the companion web UI (separate repo
  `orbitops-ui`) — no Git exposure.
- **Pro-code developers** use plain Git/GitHub — branch, PR, merge
  (docs/DEVELOPER_GUIDE.md). The UI is a wrapper, never a gatekeeper.

## Core architecture (invariants — do not break these)

1. **Branch-per-environment promotion.** Long-lived stage branches map to orgs
   via `.orbitops/pipeline.yml` — the ONLY place topology lives. Order in that
   file = promotion order (currently integration → uat → main/production).
   Every promotion is a PR. A release candidate is built from that PR, then
   deployed to the stage org; only a successful real deployment merges the PR.
   Therefore a stage branch records what is already live in its org — never a
   merely validated or failed release.
2. **Reusable workflows: pipeline logic is single-source on `main`.**
   `.github/workflows/_pr-validate.yml`, `_deploy.yml`, and
   `_release-candidate.yml` (`workflow_call`) hold ALL jobs. Stage branches
   carry only thin callers (`pr-validate.yml`, `deploy.yml`) that pin
   `...@main` — installed once,
   never edited again. Jobs dual-checkout: workspace = the branch under
   validation/deploy; `.pipeline/` = scripts + config + sf-auth **from main**.
   ⇒ To change pipeline behaviour, edit `_*.yml` and `scripts/**` on main
   ONLY. Never fatten the callers; never edit workflows on stage branches.
3. **Thin YAML, fat scripts.** Workflow logic lives in `scripts/**` (Node ESM,
   unit-tested with `node --test`; run `npm test`). Workflows call scripts.
4. **Candidate deploys** use an exact, freshly-built PR merge tree. PR
   validation is a practice run; the serialized release workflow validates the
   current candidate again, deploys it for real, and then merges that exact
   tree. It uses quick-deploy when Salesforce provides a valid ID.
5. **History is append-only.** Every deploy mints tag `deploy/<env>/<seq>` + a
   JSON manifest under `deployments/<env>/` on the `orbitops-meta` branch, plus
   a GitHub Deployment. The UI renders everything from these. Never force-push,
   never rewrite tags/manifests. Rollback = reverse delta, validate-first,
   forward revert commit.
6. **Gates.** GitHub Environments (required reviewers on uat/production) +
   in-workflow gates from pipeline.yml (`minCoverage`, `scannerMaxSeverity`).
   Coverage gate is not-applicable (passes) when the delta contains no Apex
   (`check-coverage.mjs --has-apex false`).
7. **Work-item traceability.** Every promotion PR must reference `PROJ-123`
   (Jira) or `AB#456` (ADO) in branch name, PR title, or `Work-Items:` commit
   footer (docs/WORKITEMS.md). Live tracker APIs are stubbed
   (`scripts/workitems/adapter.mjs`); the UI reads status via its own adapter.

## Where things live

```
.orbitops/pipeline.yml        stages, gates, dev orgs (schema: .orbitops/schema/)
.github/workflows/_*.yml      ALL pipeline logic (edit HERE, on main)
.github/workflows/{pr-validate,deploy}.yml   thin @main callers — do not edit
.github/workflows/{rollback,retrieve,full-scan,snapshot}.yml  dispatch/scheduled, run from main
.github/actions/sf-auth/      CLI install (pinned versions) + org auth (jwt | sfdx-url)
scripts/context/              resolve-stage (--optional → is_stage/is_last_stage), back-promotion-pairs
scripts/deploy/               next-seq, manifest, check-coverage (+ tests), find-quickdeploy, parse-validate-result
scripts/delta|scanner|comments|workitems|rollback|retrieve/   per-domain logic
scripts/validate-pipeline-config.mjs   CI validator for pipeline.yml
force-app/                    the Salesforce metadata being shipped
```

## Conventions (enforced by review; follow them)

- `sf` CLI v2 only (never legacy `sfdx`); parse `--json` output.
- Pin GitHub Actions by commit SHA; pin CLI/plugin versions. Exception: the
  callers' `@main` reference is a deliberately moving ref — that IS the
  single-source mechanism.
- Sticky PR comments update in place via hidden HTML markers — never spam.
- Least-privilege `permissions:` blocks (declared in the callers).
- Never commit secrets. UI-connected orgs resolve their username and login
  service from `connected-orgs.json` and share organisation secrets
  `ORBITOPS_JWT_CLIENT_ID` / `ORBITOPS_JWT_KEY` across every Salesforce
  workflow. Legacy repo-level org-prefixed and gated environment secrets remain
  migration fallbacks only (see SETUP.md §5).
- Profiles are excluded via `.forceignore` — use permission sets.
- Citizen-facing text avoids Git jargon ("Promote", not "merge PR").
- Config changes (pipeline.yml) go via PR to main — never direct push. The UI's
  gate/topology editors generate such PRs; keep `serialize`-compatibility
  (canonical key order) if you touch the file shape.

## Testing & verification

- `npm test` — unit tests for scripts (must stay green).
- `node scripts/validate-pipeline-config.mjs` — after any pipeline.yml change.
- Workflow YAML can only be truly validated by a run on GitHub — after merging
  workflow changes to main, watch the next PR validation and deploy end-to-end.
- Check runs are named `checks / <job>` (reusable-workflow nesting); the UI
  normalizes the prefix. If branch protection requires named checks, use the
  new names.

## Known sharp edges (from the decision log — details in CLAUDE.md)

- Re-running a failed run re-executes the SAME workflow snapshot; to pick up
  workflow-definition changes a PR needs a fresh event (close/reopen or push).
- Spring '26 blocks creating/deploying NEW connected apps in any org — deploy the
  External Client App instead (scripts/setup/external-client-app/, JWT cert via
  ExtlClntAppGlobalOauthSettings.certificate; consumer key is org-minted, retrieve
  it after deploy). sfdx-url remains the quick fallback for throwaway orgs.
- `git checkout <ref> -- <path>` never deletes files absent from `<ref>` —
  rollback logic must `git rm` the tree first.
- Retrieve falls back to a wildcard-by-type manifest when the source org lacks
  source tracking.
- Empty-delta pushes must skip the gated deploy job (precheck) or they queue
  forever at the approval gate.
