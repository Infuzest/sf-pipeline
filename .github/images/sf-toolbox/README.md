# OrbitOps Salesforce CI toolbox

This image contains the version-pinned tools used by OrbitOps Salesforce jobs:

- Salesforce CLI `2.142.7`
- `sfdx-git-delta` `6.45.1`
- Salesforce Code Analyzer `5.14.0`
- Node.js 22, Java 17, Python 3, Git, GitHub CLI, `jq`, OpenSSL and SSH

The publish workflow builds and tests the image on pull requests. After a
change reaches `main`, it publishes these GHCR tags:

- `ghcr.io/xyraxel/orbitops-sf-toolbox:2.142.7-sgd6.45.1-ca5.14.0-r2`
- `ghcr.io/xyraxel/orbitops-sf-toolbox:latest`

No credentials or Salesforce authorization data are stored in the image.
Workflows authenticate after the job container starts.

Plugins are stored under `/opt/orbitops/share`, rather than a user's home
directory, because GitHub Actions assigns job containers its own temporary
`HOME` value.
