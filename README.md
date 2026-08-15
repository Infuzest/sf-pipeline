# OrbitOps pipeline runtime

> Read [docs/DEVOPS_CICD.md](docs/DEVOPS_CICD.md) before operating or changing
> the PoC. It is the authoritative inventory of repositories, accounts, GCP
> resources, credential boundaries and the end-to-end delivery process.

Private, centrally maintained Salesforce delivery workflows for OrbitOps.
Customer Salesforce repositories call these workflows through small stubs; they
do not contain authentication actions, deployment scripts, scanner logic,
rollback implementation, tests, or runtime documentation.

## Boundary

This repository owns:

- reusable workflows in `.github/workflows/_*.yml`;
- private composite actions in `.github/actions/`;
- retrieval, validation, deployment, rollback, scanner, and reporting scripts;
- the prebuilt Salesforce toolbox image;
- the pipeline configuration schema and runtime tests.

It intentionally does **not** own a customer's `force-app`, stage topology,
scanner baseline, scratch definitions, or Salesforce project configuration.

## Customer repository contract

A connected project contains only:

```text
force-app/                  Salesforce metadata
config/                     Salesforce project definitions
sfdx-project.json           Salesforce package directories
.orbitops/pipeline.yml      Project stages and policies
.orbitops/scanner-baseline.json
.github/workflows/*.yml     Thin callers to this runtime
```

The private repository must allow Actions access from other private
repositories in the `Infuzest` organization. GitHub provides runners a scoped,
short-lived token for the reusable workflow and action; project contributors do
not receive direct access to this repository.

## Runtime flow

1. A customer stub calls a reusable workflow here with `@main`.
2. `actions/checkout` checks out the customer Salesforce repository.
3. `.github/actions/runtime` exposes this private runtime as
   `ORBITOPS_RUNTIME` and installs its Node dependencies.
4. The reusable workflow reads customer policy and metadata from the workspace
   while executing only centrally maintained scripts.

## Verification

```bash
npm ci
npm test
npm run config:validate
```

See [REQUIREMENTS.md](REQUIREMENTS.md),
[docs/DEVOPS_CICD.md](docs/DEVOPS_CICD.md),
[docs/SETUP.md](docs/SETUP.md), and [docs/RUNBOOK.md](docs/RUNBOOK.md) for
product and operating details.
