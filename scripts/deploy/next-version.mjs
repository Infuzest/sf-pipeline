/**
 * Human-facing Production version tags are separate from immutable deployment
 * checkpoints (`deploy/<environment>/<sequence>`). Only stable vX.Y.Z tags
 * participate in the next-version calculation.
 */
const RELEASE_TYPES = new Set(["bugfix", "feature", "breaking"]);

export function parseVersion(tag) {
  const match = /^v(\d+)\.(\d+)\.(\d+)$/.exec(tag);
  return match
    ? { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) }
    : null;
}

function newer(left, right) {
  return (
    left.major > right.major ||
    (left.major === right.major && left.minor > right.minor) ||
    (left.major === right.major && left.minor === right.minor && left.patch > right.patch)
  );
}

export function latestVersion(tags) {
  return tags.map(parseVersion).filter(Boolean).reduce((latest, version) => (!latest || newer(version, latest) ? version : latest), null);
}

export function nextVersion(tags, releaseType) {
  if (!RELEASE_TYPES.has(releaseType)) {
    throw new Error(`Release type must be one of: ${[...RELEASE_TYPES].join(", ")}.`);
  }
  const current = latestVersion(tags) ?? { major: 0, minor: 0, patch: 0 };
  const next =
    releaseType === "breaking"
      ? { major: current.major + 1, minor: 0, patch: 0 }
      : releaseType === "feature"
        ? { major: current.major, minor: current.minor + 1, patch: 0 }
        : { major: current.major, minor: current.minor, patch: current.patch + 1 };
  return `v${next.major}.${next.minor}.${next.patch}`;
}

// CLI: `git tag -l 'v*' | node next-version.mjs <bugfix|feature|breaking>`
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const { readFileSync } = await import("node:fs");
  console.log(nextVersion(readFileSync(0, "utf8").split("\n").filter(Boolean), process.argv[2]));
}
