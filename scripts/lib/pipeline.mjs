import { readFileSync } from "node:fs";
import yaml from "js-yaml";

export function loadConfig(path = ".orbitops/pipeline.yml") {
  const cfg = yaml.load(readFileSync(path, "utf8"));
  if (!cfg || !Array.isArray(cfg.pipeline)) {
    throw new Error(`${path} has no "pipeline" array — run npm run config:validate`);
  }
  return { pipeline: cfg.pipeline, devOrgs: cfg.devOrgs ?? [] };
}

export function loadPipeline(path = ".orbitops/pipeline.yml") {
  return loadConfig(path).pipeline;
}

/**
 * Resolve any org key to its auth method + display name. Sources, in order:
 * devOrgs (pipeline.yml), UI-connected orgs (registry from the orbitops-meta
 * branch, passed in), pipeline stage orgs.
 */
export function resolveOrg(config, orgKey, connectedOrgs = []) {
  const dev = config.devOrgs.find((d) => d.org === orgKey);
  if (dev) return { org: dev.org, authMethod: dev.authMethod, name: dev.name };
  const connected = connectedOrgs.find((d) => d.org === orgKey);
  if (connected) {
    // jwt entries (Connect-an-org v2) carry the identity for the shared-cert
    // JWT login; sfdx-url entries are legacy sealed-secret connections.
    return {
      org: connected.org,
      authMethod: connected.authMethod ?? "sfdx-url",
      name: connected.name,
      username: connected.username,
      instanceHost: connected.instanceHost,
    };
  }
  const stage = config.pipeline.find((s) => s.org === orgKey);
  if (stage) return { org: stage.org, authMethod: stage.authMethod, name: `${stage.environment} org` };
  const known = [
    ...config.devOrgs.map((d) => d.org),
    ...connectedOrgs.map((d) => d.org),
    ...config.pipeline.map((s) => s.org),
  ].join(", ");
  throw new Error(`Unknown org key "${orgKey}" (known: ${known})`);
}

export function resolveStage(stages, branch) {
  const stage = stages.find((s) => s.branch === branch);
  if (!stage) {
    const known = stages.map((s) => s.branch).join(", ");
    throw new Error(`No pipeline stage maps to branch "${branch}" (known: ${known})`);
  }
  return { testLevel: "RunLocalTests", ...stage };
}
