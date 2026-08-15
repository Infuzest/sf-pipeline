#!/usr/bin/env bash
# Rollback preview: resolve refs, compute reverse delta, safety analysis, validate.
# Env: ROLLBACK_ENV, TARGET_SEQ, INCLUDE_DESTRUCTIVE. Writes rollback-refs.env
# (sourceable) and reverse-delta/ for execute.sh to reuse.
set -euo pipefail

RUNTIME_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)

ORBITOPS_RUNTIME="$RUNTIME_ROOT" node --input-type=module -e "
  const {resolveRollbackRefs}=await import(process.env.ORBITOPS_RUNTIME + '/scripts/rollback/refs.mjs');
  const {execSync}=await import('node:child_process');
  const {writeFileSync}=await import('node:fs');
  const tags=execSync('git tag -l \"deploy/${ROLLBACK_ENV}/*\"').toString().split('\n').filter(Boolean);
  const r=resolveRollbackRefs(tags,'${ROLLBACK_ENV}','${TARGET_SEQ}');
  const lines=[
    'CURRENT_TAG='+r.currentTag, 'TARGET_TAG='+r.targetTag,
    'CURRENT_SEQ='+r.current, 'NEW_SEQ='+r.newSeq, 'NEW_TAG='+r.newTag,
  ].join('\n')+'\n';
  writeFileSync('rollback-refs.env', lines);
  console.log('Rolling back '+r.currentTag+' -> '+r.targetTag+' (new '+r.newTag+')');
"
# shellcheck disable=SC1091
source rollback-refs.env

# Sequence 0 is a virtual baseline derived from the first release commit. A
# first release must therefore retain its first parent; fail with a clear audit
# message if a repository imported an incompatible tag instead of guessing.
if [ "$TARGET_SEQ" = "0" ] && ! git rev-parse --verify -q "${TARGET_TAG}^{commit}" >/dev/null; then
  echo "::error title=Initial release baseline is unavailable::The deploy/${ROLLBACK_ENV}/1 tag does not point to a release commit with a previous stage state." >&2
  exit 1
fi

# A stage branch can legitimately move after a release when only pipeline
# machinery or documentation changes. Those files never reach Salesforce and
# therefore cannot make a rollback unsafe. Salesforce package files are
# different: deploy and record them through the UI before calculating a
# rollback, otherwise the reverse delta could overwrite unrecorded work.
: "${BRANCH:?stage branch required for rollback safety check}"
git fetch -q origin "$BRANCH"
git diff --name-only "$CURRENT_TAG..origin/$BRANCH" > unrecorded-files.txt
git show "origin/$BRANCH:sfdx-project.json" > stage-sfdx-project.json 2>/dev/null || cp sfdx-project.json stage-sfdx-project.json
UNRECORDED_SALESFORCE=$(node "$RUNTIME_ROOT/scripts/rollback/unrecorded.mjs" unrecorded-files.txt stage-sfdx-project.json)
if [ -n "$UNRECORDED_SALESFORCE" ]; then
  {
    echo "::error title=Salesforce changes must be reconciled before rollback::Deploy and record the waiting Salesforce files from the OrbitOps rollback screen, then start a fresh preview."
    echo "$UNRECORDED_SALESFORCE"
  } >&2
  exit 1
fi

rm -rf reverse-delta && mkdir -p reverse-delta
SRC=$(node "$RUNTIME_ROOT/scripts/context/package-dirs.mjs")
# shellcheck disable=SC2086
sf sgd source delta --from "$CURRENT_TAG" --to "$TARGET_TAG" $SRC --output-dir reverse-delta

node "$RUNTIME_ROOT/scripts/rollback/analyze.mjs" reverse-delta \
  --env "$ROLLBACK_ENV" --from "$CURRENT_SEQ" --to "$TARGET_SEQ" \
  --include-destructive "$INCLUDE_DESTRUCTIVE" \
  --out-md preview.md --out-json safety.json
cat preview.md >> "${GITHUB_STEP_SUMMARY:-/dev/stdout}"

# Validate against the org (dry-run has check-only semantics and accepts NoTestRun).
DESTRUCTIVE_ARGS=()
if [ "$INCLUDE_DESTRUCTIVE" = "true" ] && \
   [ -f reverse-delta/destructiveChanges/destructiveChanges.xml ] && \
   grep -q "<members>" reverse-delta/destructiveChanges/destructiveChanges.xml; then
  DESTRUCTIVE_ARGS=(--post-destructive-changes reverse-delta/destructiveChanges/destructiveChanges.xml)
fi
HAS_RESTORE=false
grep -q "<members>" reverse-delta/package/package.xml 2>/dev/null && HAS_RESTORE=true
HAS_DELETE=false
[ "${#DESTRUCTIVE_ARGS[@]}" -gt 0 ] && HAS_DELETE=true

# No-op rollback: nothing to restore and nothing to delete (e.g. rolling back a
# purely-additive change with destructive disabled). Report and stop cleanly.
if [ "$HAS_RESTORE" = false ] && [ "$HAS_DELETE" = false ]; then
  echo "ROLLBACK_NOOP=true" >> rollback-refs.env
  {
    echo "## ⏮ Rollback preview — no changes needed"
    echo ""
    if [ "$TARGET_SEQ" = "0" ]; then
      echo "Rolling back **${ROLLBACK_ENV}** to before the first OrbitOps release would change nothing:"
    else
      echo "Rolling back **${ROLLBACK_ENV}** to seq ${TARGET_SEQ} would change nothing:"
    fi
    echo "no components need restoring, and components added since the target are kept"
    echo "(destructive rollback is disabled). Enable destructive rollback to remove them."
  } >> "${GITHUB_STEP_SUMMARY:-/dev/stdout}"
  echo "No-op rollback — nothing to validate or deploy."
  exit 0
fi
echo "ROLLBACK_NOOP=false" >> rollback-refs.env

if [ "$HAS_RESTORE" = true ]; then
  MANIFEST_ARGS=(--manifest reverse-delta/package/package.xml)
else
  # Pure-destructive rollback: empty package, deletions carry the operation.
  mkdir -p reverse-delta/package
  printf '<?xml version="1.0" encoding="UTF-8"?>\n<Package xmlns="http://soap.sforce.com/2006/04/metadata"><version>64.0</version></Package>\n' \
    > reverse-delta/package/package.xml
  MANIFEST_ARGS=(--manifest reverse-delta/package/package.xml)
fi

echo "Validating rollback against the org (dry-run)…"
sf project deploy start --dry-run --ignore-conflicts \
  "${MANIFEST_ARGS[@]}" "${DESTRUCTIVE_ARGS[@]}" \
  --test-level NoTestRun --target-org target-org --wait 60 --json > validate.json || true
VAL_OK=true
node "$RUNTIME_ROOT/scripts/deploy/parse-validate-result.mjs" validate.json --errors verrors.md || VAL_OK=false
echo "Preview complete." >> "${GITHUB_STEP_SUMMARY:-/dev/stdout}"

# Publish the combined preview for the UI (job stays green — the JSON carries the
# verdict; a failed validation is a *result* of a preview, not a failed preview).
if [ -n "${GITHUB_RUN_ID:-}" ]; then
  CURRENT_SEQ_PUB="$CURRENT_SEQ" VAL_OK_PUB="$VAL_OK" node --input-type=module -e "
    import { readFileSync, writeFileSync, existsSync } from 'node:fs';
    const safety = JSON.parse(readFileSync('safety.json','utf8'));
    const out = {
      env: process.env.ROLLBACK_ENV,
      targetSeq: Number(process.env.TARGET_SEQ),
      currentSeq: Number(process.env.CURRENT_SEQ_PUB),
      includeDestructive: process.env.INCLUDE_DESTRUCTIVE === 'true',
      safety,
      validation: {
        succeeded: process.env.VAL_OK_PUB === 'true',
        errors: existsSync('verrors.md') ? readFileSync('verrors.md','utf8') : null,
      },
      runId: process.env.GITHUB_RUN_ID,
      timestamp: new Date().toISOString(),
    };
    writeFileSync('preview-full.json', JSON.stringify(out, null, 2) + '\n');
  "
  git config user.name "orbitops-bot"
  git config user.email "orbitops-bot@users.noreply.github.com"
  for attempt in 1 2 3; do
    git fetch -q origin orbitops-meta 2>/dev/null || true
    if git show-ref -q refs/remotes/origin/orbitops-meta; then
      git worktree add -q .meta origin/orbitops-meta
    else
      git worktree add -q --detach .meta
      git -C .meta checkout -q --orphan orbitops-meta
      git -C .meta rm -rfq . 2>/dev/null || true
    fi
    mkdir -p .meta/rollback-previews
    cp preview-full.json ".meta/rollback-previews/${GITHUB_RUN_ID}.json"
    git -C .meta add -A
    git -C .meta commit -q -m "Rollback preview ${GITHUB_RUN_ID} (${ROLLBACK_ENV} -> seq ${TARGET_SEQ})"
    if git -C .meta push -q origin HEAD:orbitops-meta; then git worktree remove -f .meta; break; fi
    git worktree remove -f .meta; echo "meta race, retry $attempt"
  done
fi
