# OrbitOps private pipeline runtime — AI assistant brief

This repository is the centrally maintained execution engine for customer
Salesforce repositories. It contains no customer Salesforce metadata or stage
topology.

## Architecture invariants

1. Customer repositories contain `force-app`, Salesforce project files,
   `.orbitops/pipeline.yml`, a scanner baseline, and thin workflow callers only.
2. All implementation lives here: reusable `_*.yml` workflows, private
   composite actions, scripts, tests, scanner defaults, and toolbox images.
3. Reusable workflows run in the caller's GitHub context. `actions/checkout`
   therefore checks out the customer repository. The private
   `.github/actions/runtime` action exposes this repository as
   `ORBITOPS_RUNTIME`; never reintroduce a `.pipeline` checkout from the caller.
4. Customer callers deliberately use `@main` during the PoC so a centrally
   merged runtime fix applies without a customer-repository PR.
5. Runtime and customer repositories must both be private and owned by the
   `Infuzest` organization. Private Actions access is an explicit repository
   administration decision.
6. Never add customer `force-app`, stage configuration, scratch definitions,
   deployment branches, or credentials here.

## Where things live

```text
.github/workflows/_*.yml       reusable validation/deploy/retrieve/rollback jobs
.github/actions/runtime/       exposes this private source to called workflows
.github/actions/sf-auth/       Salesforce CLI verification and org auth
.github/images/sf-toolbox/     prebuilt runner image
.orbitops/schema/              customer pipeline configuration schema
scripts/                       unit-tested runtime implementation
scripts/__fixtures__/          runtime-only test data
docs/ and REQUIREMENTS.md      platform design and operations
```

## Conventions

- `sf` CLI v2 only; parse JSON output.
- GitHub actions are SHA-pinned. The private OrbitOps workflow/action `@main`
  references are the deliberate PoC exception.
- Workflows read `.orbitops/pipeline.yml`, `sfdx-project.json`, and `force-app`
  from the caller workspace.
- Runtime scripts are invoked through `$ORBITOPS_RUNTIME/scripts/...`.
- Do not add Salesforce deployment concurrency locks; Salesforce queues
  concurrent metadata deployments for this PoC.
- Never commit credentials.

## Verification

- `npm test`
- `npm run config:validate`
- Parse every workflow/action YAML after structural changes.
- After merge, validate through a private customer repository caller because
  GitHub is authoritative for cross-repository workflow resolution.

Append architectural decisions to [CLAUDE.md](CLAUDE.md); never rewrite its
dated history.
