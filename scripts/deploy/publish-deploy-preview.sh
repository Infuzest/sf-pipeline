#!/usr/bin/env bash
# Publish the pre-gate deploy preview to the orbitops-meta branch so the UI can
# show approvers exactly what Salesforce will receive. Mirrors the rollback
# preview publisher (scripts/rollback/preview.sh).
#
# Usage: publish-deploy-preview.sh <delta-dir> <env> <mode>
#   Requires: GITHUB_RUN_ID, GITHUB_SHA; run from the workspace checkout with
#   the pipeline scripts available at .pipeline/ (or adjust SCRIPTS).
set -euo pipefail

DELTA_DIR="${1:-}"
ENV_NAME="${2:-}"
MODE="${3:-delta}"
SCRIPTS="${SCRIPTS_DIR:-.pipeline/scripts}"

node "${SCRIPTS}/deploy/deploy-preview.mjs" \
  --delta-dir "$DELTA_DIR" \
  --env "$ENV_NAME" \
  --run-id "${GITHUB_RUN_ID:-0}" \
  --sha "${GITHUB_SHA:-}" \
  --mode "$MODE" \
  --out deploy-preview.json

git config user.name "orbitops-bot"
git config user.email "orbitops-bot@users.noreply.github.com"

# Retry: parallel stage deploys can race on the meta branch.
for attempt in 1 2 3; do
  git fetch -q origin orbitops-meta 2>/dev/null || true
  if git show-ref -q refs/remotes/origin/orbitops-meta; then
    git worktree add -q .meta origin/orbitops-meta
  else
    git worktree add -q --detach .meta
    git -C .meta checkout -q --orphan orbitops-meta
    git -C .meta rm -rfq . 2>/dev/null || true
  fi
  mkdir -p ".meta/deploy-previews"
  cp deploy-preview.json ".meta/deploy-previews/${GITHUB_RUN_ID}.json"
  git -C .meta add -A
  git -C .meta commit -q -m "Deploy preview ${GITHUB_RUN_ID} (${ENV_NAME})"
  if git -C .meta push -q origin HEAD:orbitops-meta; then
    git worktree remove -f .meta
    echo "Published deploy-previews/${GITHUB_RUN_ID}.json"
    exit 0
  fi
  git worktree remove -f .meta
  echo "meta race, retry $attempt"
done
# Never fail the deploy just because the preview couldn't be published.
echo "Could not publish the deploy preview after 3 attempts — continuing."
