# Copilot instructions — BUPA Salesforce DevOps sf-pipeline

Read [AGENTS.md](../AGENTS.md) first — it is the canonical AI brief for this
repo (architecture invariants, file map, conventions, sharp edges). The dated
decision log lives in [CLAUDE.md](../CLAUDE.md); append to it, never rewrite.

Non-negotiables in short form:

- Pipeline logic is single-source on `main`: edit
  `.github/workflows/_pr-validate.yml` / `_deploy.yml` and `scripts/**` only.
  `pr-validate.yml` / `deploy.yml` are thin `@main` callers — never add logic
  to them, never edit workflows on stage branches.
- Stage topology lives ONLY in `.orbitops/pipeline.yml` (order = promotion
  order). Validate with `node scripts/validate-pipeline-config.mjs`.
- Thin YAML, fat scripts: logic goes in `scripts/**` (Node ESM) with
  `node --test` unit tests; `npm test` must stay green.
- `sf` CLI v2 only; SHA-pin actions; never force-push; never commit secrets;
  history (deploy tags + orbitops-meta manifests) is append-only.
- Every promotion PR needs a work item (PROJ-123 / AB#456) in the branch name,
  PR title, or `Work-Items:` commit footer.
