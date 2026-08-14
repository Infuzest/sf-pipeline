# Salesforce DevOps — sf-pipeline

Salesforce CI/CD platform giving citizen developers a DevOps-Center-like experience
on GitHub Actions + Salesforce CLI, with UI-driven rollback, diff visibility,
configurable stage gates, static code analysis, and work-item traceability.
Full spec: `REQUIREMENTS.md` (epics E1–E9). This repo is the SFDX project +
pipeline machinery; the web UI lives in the separate `orbitops-ui` repo.

## Architecture summary

- GitHub is the source of truth; SFDX **source format**, single package dir `force-app`.
- **Branch-per-environment promotion**: `feature/*` → `integration` → `uat` → `main`.
  Every promotion is a PR. Stage config lives in `.orbitops/pipeline.yml`
  (schema: `.orbitops/schema/pipeline.schema.json`).
- **Delta deploys** via sfdx-git-delta; PR validation is check-only deploy
  (`sf project deploy validate`) with quick-deploy on merge when eligible.
- **Deploy history**: tag `deploy/<env>/<seq>` + GitHub Deployment + manifest JSON
  committed to the `orbitops-meta` branch.
- **Rollback** = reverse delta between deploy tags, validate-first, destructive
  changes opt-in, forward revert commit (never force-push).
- **Stage gates** = GitHub Environments (required reviewers) + in-workflow gates
  (minCoverage, scannerMaxSeverity) from pipeline.yml.
- **Work items**: Jira keys (PROJ-123) / ADO refs (AB#456) in branch names, PR
  titles, `Work-Items:` commit footers. PoC = format validation + stub adapter
  only; live Jira/ADO APIs are post-PoC (see E2 PoC-scope note).

## Key design decisions (D1–D9, see REQUIREMENTS.md §4)

D1 branch-per-env promotion · D2 source format, one package dir · D3 JWT org auth,
secrets in GitHub Environments · D4 standalone Next.js UI + GitHub App (runs on
localhost for PoC) · D5 work-item IDs in branch/PR conventions · D6 tracker adapter
interface (stub for PoC) · D7 Salesforce Code Analyzer v5 · D8 rollback is
metadata-only, validate-first with preview · D9 test level per stage
(RunLocalTests for uat/main).

## PoC environment

| Branch | Org key | Backing org | Notes |
|---|---|---|---|
| integration | INT | scratch `devopsDev1` | test.salesforce.com |
| uat | UAT | scratch `stagingscratch` | test.salesforce.com |
| main | PROD | dev org `DevOpsCenterDevHub` | also the Dev Hub |

## Stack

`sf` CLI v2 (pinned 2.142.7) · sfdx-git-delta 6.45.1 ·
@salesforce/plugin-code-analyzer 5.14.0 · GitHub Actions (reusable workflows) ·
Node ESM scripts with `node --test` units · composite action
`.github/actions/sf-auth` for CLI install + JWT auth.

## Conventions

- Use the `sf` CLI v2 only — never legacy `sfdx` commands. Parse `--json` output.
- Thin YAML, fat scripts: workflow logic lives in `scripts/**` (ESM, unit-tested
  with `node --test`); workflows call the scripts.
- Every workflow uploads a structured `orbitops-summary.json` artifact; the UI
  depends on it.
- Pin GitHub Action versions by commit SHA; pin CLI/plugin versions explicitly.
- Sticky PR comments: update in place via hidden marker, never spam new comments.
- Never force-push. Never bypass branch protection. Bot commits clearly attributed.
- Never commit secrets; `*.key`/`*.pem` are gitignored as a backstop.
- `GITHUB_TOKEN` permissions blocks: least privilege per workflow.
- Citizen-facing copy avoids Git jargon ("Promote", not "merge PR").
- Profiles are guardrailed metadata: excluded via `.forceignore`; prefer permission sets.

## Decisions

(append project decisions made during build sessions here)

- 2026-07-14: Jira/ADO live integration cut from PoC scope; keep ID conventions +
  stub adapter (REQUIREMENTS.md E2 PoC-scope note).
- 2026-07-14: UI runs on localhost for the PoC; GitHub App with webhooks disabled,
  polling only.
- 2026-07-14: `force-app` seeded with sample objects (BUP_Clinic__c, BUP_Policies__c)
  retrieved from the original scratch orgs, so the pipeline has real metadata to move.
- 2026-07-14: Repos live under the personal account `SalikPOC` (public, so branch
  protection + required-reviewer environments work on the free plan). No teams on
  personal accounts → PoC role mapping is username-list based (env vars in the UI,
  usernames in CODEOWNERS); swap to team slugs when moving to an org.
- 2026-07-14: Auth is split per stage (amends D3): PROD uses JWT via connected app
  "OrbitOps CI" (deployed, verified). Scratch orgs can't create connected apps
  (Spring '26 restriction) and ECA JWT setup isn't metadata-deployable, so
  integration/uat use `sf org login sfdx-url` with an SF_AUTH_URL environment
  secret, refreshed on scratch-org recreation. sf-auth action supports both.
- 2026-07-14: Secrets exist at two levels: repo-level org-prefixed (INT_/UAT_/PROD_)
  for PR validation jobs, environment-level unprefixed for deploy jobs — because
  environment secrets would trigger required-reviewer approval on every PR
  validation (docs/SETUP.md §5).
- 2026-07-14: Rollback design (Phase 6), learned the hard way:
  (a) pipeline scripts ALWAYS run from the workflow ref (main), never from env-branch
  checkouts — env branches diverge via merged rollback PRs and silently pin old code;
  (b) `git checkout <ref> -- <path>` never deletes files absent from <ref> — `git rm`
  the tree first or deletions vanish from revert commits;
  (c) revert commits land via a merged PR (run-unique branch name) when branch
  protection declines direct push — requires repo setting "Allow GitHub Actions to
  create and approve pull requests" (user enabled);
  (d) no-op rollbacks (nothing to restore or delete) exit cleanly without tag/commit;
  (e) rollback shares the deploy-<env> concurrency group so it can't interleave with
  deploys.
- 2026-07-14: Scanner findings surface as a sticky PR comment table + SARIF to
  GitHub code scanning, NOT inline review comments (deviation from BUILD_PROMPTS
  Phase 3 — diff-position mapping wasn't worth PoC complexity). Gate blocks on
  NEW findings (vs .orbitops/scanner-baseline.json, rule+file ±5 lines) with
  severity ≤ the stage's scannerMaxSeverity. SARIF uploads are skipped when the
  scan produces zero runs (code scanning API rejects empty SARIF).
- 2026-07-15: Phases 7–12 complete; UI feature set final for PoC (board, promote,
  pull-my-changes, rollback UI, gate editor via config PRs, audit + DORA-lite
  tiles, drift snapshots, runbook + citizen guide). Companion UI decisions in
  orbitops-ui/CLAUDE.md.
- 2026-07-15: Retrieve falls back to a wildcard-by-type manifest when the source
  org lacks source tracking (SourceMember unsupported → citizen-safe types with
  `*` members; git diff filters real changes). `--wildcard` forces it — the
  nightly drift snapshot uses that for org-vs-branch truth.
- 2026-07-15: Connect-an-org = OAuth authorization-code + PKCE against the one
  "OrbitOps CI" connected app (consumer key is public; isConsumerSecretOptional).
  `prompt=login` is kept deliberately: silent session reuse connected the *wrong*
  org during testing. My Domain input is a fallback only — the generic
  test/login.salesforce.com endpoints work for most orgs. Tokens are sealed as
  repo secrets (`DEV_*_SF_AUTH_URL`) via libsodium; registry lives in
  connected-orgs.json on orbitops-meta. Requires the GitHub App to hold
  Secrets: write.
- 2026-07-15: Rollback preview publishes a combined safety + validation JSON to
  orbitops-meta/rollback-previews/<runId>.json — the UI polls the run, then
  renders the verdict from that file (job stays green; the JSON carries pass/fail).
- 2026-07-15: Flow visual diff learnings: auto-layout flows (Builder default)
  store locationX/Y = 0 for every element, so the viewer computes a layered BFS
  layout and caps it with a synthetic End card; Tailwind utility classes on SVG
  shapes proved unreliable across build modes (unstyled rect renders black) —
  the diagram uses explicit fill/stroke attributes only.
- 2026-07-15: Connect-an-org v2 = JWT via pre-auth (user's design). Root cause of
  v1 failures: new orgs FORCE refresh-token rotation (Support-locked setting) —
  any stored refresh token dies on first use, so sealed-secret auth can never
  work. v2 stores only {username, instanceHost} in the registry; CI does JWT
  Bearer with the shared OrbitOps CI cert (repo secrets ORBITOPS_JWT_CLIENT_ID +
  ORBITOPS_JWT_KEY). Per-org one-time admin step: OAuth Usage → Install →
  admin-approve + profile. Legacy sfdx-url registry entries still resolve.
  Long-term (user): managed-package connected app → prod install inherits into
  refreshed sandboxes, scratch orgs install post-creation → pure self-service.
  Note: ConnectedApp metadata deploys silently ignore isRefreshTokenRotationEnabled.
- 2026-07-17: Topology fully de-hardcoded — stage branches live ONLY in
  pipeline.yml. deploy.yml/pr-validate.yml trigger broadly (branches-ignore
  feature/**, orbitops-meta, orbitops/**) and `resolve-stage.mjs --optional`
  skips non-stage branches (is_stage/is_last_stage outputs gate all jobs);
  back-promotion pairs derive from config (scripts/context/back-promotion-pairs.mjs);
  back-promote runs on the LAST stage, whatever it's called. Stages are now
  added/removed from the Salesforce DevOps Settings UI via config PRs (orbitops-ui
  TopologyEditor → addStage/removeStage actions; best-effort automates stage
  branch + GitHub Environment creation, remaining admin steps land as a PR
  checklist). New stage branches start from their downstream neighbour.
- 2026-07-17: Reusable-workflow refactor — pipeline logic is now single-source
  on main. `_pr-validate.yml`/`_deploy.yml` are `workflow_call` workflows
  holding ALL jobs; `pr-validate.yml`/`deploy.yml` are thin callers pinning
  `@main` (installed once per stage branch, never edited again). Jobs do a
  dual checkout: workspace = the branch under validation/deploy, `.pipeline/` =
  scripts + config + sf-auth from main (config-only scripts run with
  working-directory .pipeline). Consequence: fixes merged to main apply to
  every stage immediately — no more per-branch workflow syncing. Check runs
  are now named "checks / <job>"; the UI strips the prefix (toCheckChips).
  Rollout order matters: main PR first (creates the `_*.yml`), then the caller
  stubs onto uat/integration. Pro-code path documented in
  docs/DEVELOPER_GUIDE.md — the whole process works from plain Git/GitHub;
  the UI is optional.
- 2026-07-17: Coverage-gate bug fix — a metadata-only change (no Apex) was
  wrongly blocked by "No Apex tests ran, but this stage requires ≥ 75%".
  check-coverage.mjs now takes `--has-apex`; when false, coverage is
  not-applicable and the gate passes. Apex-present-but-no-coverage still fails.
  Gate logic extracted to `evaluateCoverage()` with unit tests. pr-validate.yml
  passes `needs.delta.outputs.has_apex` (same signal that already sets
  NoTestRun in the validate step).
- 2026-08-05: CORRECTION — scratch orgs CAN use certificate/JWT auth; the
  earlier "ECA JWT isn't scriptable" claim was wrong (user challenged it,
  official docs + live test confirmed). Facts: Spring '26 blocks
  creating/deploying NEW connected apps everywhere ("You can't create a
  connected app" on metadata deploy too — reproduced); External Client Apps
  are fully metadata-deployable incl. the JWT cert
  (ExtlClntAppGlobalOauthSettings.certificate, API 60+), scratch support
  landed Spring '26. Deployed scripts/setup/external-client-app/ (ECA
  "OrbitOps CI" + reused Salesforce DevOps_CI permset + server.crt) to
  stagingscratch, retrieved the ORG-MINTED consumer key (per-org, unlike
  connected apps' pinned key!), sf org login jwt succeeded. Implication:
  per-org SF_CLIENT_ID capture step; the shared ORBITOPS_JWT_CLIENT_ID
  pattern only holds for orgs sharing the legacy connected app.
- 2026-08-05: sfdx-git-delta scans the WHOLE repo by default, so any file that
  merely looks like Salesforce metadata joins the delta even outside a package
  directory. `scripts/setup/external-client-app/**` (one-off ECA admin bundle)
  was swept in, producing a package.xml with 5 components and no source behind
  them; validation then failed with "No source-backed components present in the
  package" and *0 component errors, 0 test failures* — undiagnosable from the
  UI, and it blocks promotion because promote() refuses on any failing check.
  Fix: every sgd call passes `--source-dir` from
  `scripts/context/package-dirs.mjs` (reads sfdx-project.json packageDirectories
  rather than hardcoding force-app). Four call sites: _pr-validate delta,
  _deploy precheck, _deploy delta, rollback/preview.sh. Same failure class as
  the coverage-gate bug: a gate that fails on a not-applicable case.
- 2026-08-06: Repair deploys — the delta model's blind spot. The package is
  computed from `git diff <last deploy tag>..HEAD`, so it describes what
  changed IN GIT and can never describe what's missing from the ORG. Any
  divergence (a merge while the pipeline is down, a deploy cancelled in the
  concurrency queue, a hand-edited or refreshed org, a partially-applied
  deploy) leaves the org behind with nothing in the diff to say so, and every
  later delta deploy fails on the gap — as PROD did with "Entity
  'Bank_Transactions__c' not found", because the object was in main but the
  deploy that would have created it had been cancelled while queued. Two levers
  now: `mode: full` re-deploys every package dir (never deletes), and
  `include: Type:Member,…` merges named components into the delta via
  `scripts/deploy/merge-manifest.mjs`. Both bypass the precheck's empty-delta
  veto — a repair run has work to do by definition — and both still go through
  the environment approval gate.
- 2026-08-07: Validation errors are an app contract, not a console detail.
  Salesforce CLI v2 returned five real failures under `result.files` (four
  Account layouts referencing the unavailable `FeedItem.RypplePost` action and
  a `DataCaptureFlow` unsupported by the target org), while
  `details.componentFailures` was empty. The parser therefore claimed “0
  component errors” and the citizen UI had no rows to render.
  `parse-validate-result.mjs` now normalizes the Metadata API, CLI files, and
  message-only shapes; preserves type/line/column; decodes encoded component
  names; writes a five-column sticky-comment table; and prints every failure in
  the job log. Reusable workflow callers still require no project-repo update.
- 2026-08-07: Stage branches are now an assertion of deployed state, not an
  optimistic release queue. `release-candidate.yml` serializes every target
  stage (sharing the manual-repair concurrency group), builds the exact PR
  merge tree from the latest stage revision, revalidates it after the GitHub
  Environment approval, then performs the real Salesforce deployment. The PR
  merges only if that succeeds and its resulting branch tree exactly matches
  the deployed candidate; failures leave the PR and stage branch unchanged.
  `deploy.yml` is now repair-only, preventing a second deploy after the
  post-success merge. The UI dispatches the candidate workflow, exposes its
  approval/progress alongside repair runs, and reports its Salesforce errors
  back on the original change.
- 2026-08-09: Quick Deploy remains the production release path. A successful
  `sf project deploy validate` in the UAT scratch org returned a genuine
  `checkOnly` deployment ID, but Salesforce correctly rejected that ID for
  Quick Deploy because the target is sandbox-like. The reusable candidate
  workflow is now stage-aware: the final Production stage uses
  validate → Quick Deploy, while UAT and other earlier stages use dry-run →
  one real atomic deployment after approval. In both cases, the promotion PR
  merges only after Salesforce succeeds, so a stage branch still means live.
  The workflow also records GitHub Deployments against the PR head (the
  temporary candidate merge SHA does not exist on GitHub) and never lets a
  deployment-record error mask the Salesforce result.
- 2026-08-14: Central JWT authentication is a workflow-wide contract, not only
  a validation/release feature. Rollback and drift snapshot were still reading
  obsolete `<ORG>_SF_*` secrets, so a newly registered pipeline resolved its
  stage but passed five empty values to `sf-auth`. Every Salesforce operation
  now reads the org identity from `connected-orgs.json`, uses the shared
  `ORBITOPS_JWT_CLIENT_ID` / `ORBITOPS_JWT_KEY`, and keeps legacy secrets only
  as a migration fallback. The workflow contract test enumerates all six paths
  so a new operation cannot silently reintroduce per-org credentials.
