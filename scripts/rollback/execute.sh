#!/usr/bin/env bash
# Rollback execute: deploy the reverse delta, write a forward revert commit on the
# env branch (direct push, or a merged PR when the branch is protected), tag
# deploy/<env>/<newSeq>, and record a rollback manifest. Never force-pushes.
# Assumes preview.sh already ran in this job (reverse-delta/ + rollback-refs.env exist).
# Env: ROLLBACK_ENV, TARGET_SEQ, INCLUDE_DESTRUCTIVE, REASON, BRANCH.
set -euo pipefail
RUNTIME_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
# shellcheck disable=SC1091
source rollback-refs.env

if [ "${ROLLBACK_NOOP:-false}" = "true" ]; then
  echo "No-op rollback — nothing to execute (no tag or commit created)." \
    >> "${GITHUB_STEP_SUMMARY:-/dev/stdout}"
  exit 0
fi

# 1. Deploy reverse delta to the org.
DESTRUCTIVE_ARGS=()
if [ "$INCLUDE_DESTRUCTIVE" = "true" ] && \
   [ -f reverse-delta/destructiveChanges/destructiveChanges.xml ] && \
   grep -q "<members>" reverse-delta/destructiveChanges/destructiveChanges.xml; then
  DESTRUCTIVE_ARGS=(--post-destructive-changes reverse-delta/destructiveChanges/destructiveChanges.xml)
fi
echo "Deploying rollback to the org…"
sf project deploy start --ignore-conflicts \
  --manifest reverse-delta/package/package.xml "${DESTRUCTIVE_ARGS[@]}" \
  --test-level NoTestRun --target-org target-org --wait 60 --json > deploy.json || true
node "$RUNTIME_ROOT/scripts/deploy/parse-validate-result.mjs" deploy.json --errors derrors.md

# 2. Forward revert commit: env branch's force-app -> target state, keeping
#    added-after-target components unless destructive was requested (so git
#    matches org state). Based on the env branch tip; scripts keep running from
#    the workflow ref.
git config user.name "orbitops-bot"
git config user.email "orbitops-bot@users.noreply.github.com"
git fetch -q origin "$BRANCH"
git checkout -q -B orbitops-rollback-work "origin/$BRANCH"
# `git checkout <ref> -- <path>` never DELETES files absent from <ref>; remove the
# tree first so components added after the target are actually dropped from git.
git rm -rq --ignore-unmatch force-app
if git cat-file -e "$TARGET_TAG:force-app" 2>/dev/null; then
  git checkout "$TARGET_TAG" -- force-app
fi
if [ "$INCLUDE_DESTRUCTIVE" != "true" ]; then
  git diff --name-only --diff-filter=A "$TARGET_TAG" "$CURRENT_TAG" -- force-app | while read -r f; do
    [ -n "$f" ] && git checkout "$CURRENT_TAG" -- "$f"
  done
fi
git add -A force-app
TARGET_DESCRIPTION="seq ${TARGET_SEQ}"
[ "$TARGET_SEQ" = "0" ] && TARGET_DESCRIPTION="before the first OrbitOps release"
COMMIT_ARGS=(-m "Roll back $ROLLBACK_ENV to ${TARGET_DESCRIPTION}"
             -m "Reason: ${REASON}"
             -m "Rolled back from ${CURRENT_TAG} to ${TARGET_TAG}."
             -m "Work-Items: POC-0")
if git diff --cached --quiet; then
  git commit -q --allow-empty "${COMMIT_ARGS[@]}"
else
  git commit -q "${COMMIT_ARGS[@]}"
fi

# 3. Land the revert on the env branch: direct push, else a merged rollback PR
#    (branch protection may require PRs; never force-push).
if git push origin "HEAD:$BRANCH" 2>push.err; then
  echo "Pushed revert commit directly to $BRANCH"
else
  echo "Direct push declined (protected branch) — opening a rollback PR:"; cat push.err
  # Run-unique branch avoids collisions with a leftover branch from a prior attempt.
  RB_BRANCH="orbitops/rollback-${ROLLBACK_ENV}-${NEW_SEQ}-${GITHUB_RUN_ID}"
  git push -q origin "HEAD:$RB_BRANCH"
  gh pr create --repo "$GITHUB_REPOSITORY" --base "$BRANCH" --head "$RB_BRANCH" \
    --title "Roll back $ROLLBACK_ENV to ${TARGET_DESCRIPTION}" \
    --body "$(printf 'Automated rollback executed against the %s org.\n\nReason: %s\n\nWork-Items: POC-0' "$ROLLBACK_ENV" "$REASON")"
  gh pr merge "$RB_BRANCH" --repo "$GITHUB_REPOSITORY" --merge --delete-branch
fi

# 4. Tag the resulting branch tip (works whether push was direct or via merged PR).
git fetch -q origin "$BRANCH"
TIP=$(git rev-parse "origin/$BRANCH")
git tag -a "$NEW_TAG" "$TIP" -m "OrbitOps rollback: ${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}"
git push -q origin "$NEW_TAG"

# 5. Rollback manifest on the orbitops-meta branch.
node "$RUNTIME_ROOT/scripts/deploy/manifest.mjs" --env "$ROLLBACK_ENV" --seq "$NEW_SEQ" \
  --sha "$TIP" --delta-dir reverse-delta --type rollback \
  --run-url "${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}" \
  --actor "$GITHUB_ACTOR" --timestamp "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --extra "{\"rolledBackFrom\": ${CURRENT_SEQ}, \"rolledBackTo\": ${TARGET_SEQ}, \"reason\": \"${REASON//\"/\\\"}\", \"includeDestructive\": ${INCLUDE_DESTRUCTIVE}}" \
  --out manifest.json

for attempt in 1 2 3; do
  git fetch -q origin orbitops-meta 2>/dev/null || true
  if git show-ref -q refs/remotes/origin/orbitops-meta; then
    git worktree add -q .meta origin/orbitops-meta
  else
    git worktree add -q --detach .meta
    git -C .meta checkout -q --orphan orbitops-meta
    git -C .meta rm -rfq . 2>/dev/null || true
  fi
  mkdir -p ".meta/deployments/${ROLLBACK_ENV}"
  cp manifest.json ".meta/deployments/${ROLLBACK_ENV}/${NEW_SEQ}.json"
  git -C .meta add -A
  git -C .meta commit -q -m "Record rollback $NEW_TAG"
  if git -C .meta push -q origin HEAD:orbitops-meta; then git worktree remove -f .meta; break; fi
  git worktree remove -f .meta; echo "meta race, retry $attempt"
done

node "$RUNTIME_ROOT/scripts/workitems/post-deployment.mjs" manifest.json --status rolled-back || true
echo "✅ Rolled back $ROLLBACK_ENV to ${TARGET_DESCRIPTION} — new state $NEW_TAG" >> "${GITHUB_STEP_SUMMARY:-/dev/stdout}"
