#!/usr/bin/env node
/**
 * Locates a quick-deployable validation for a pushed merge commit (E4.2).
 * Finds the PR for the sha, its head's latest successful Salesforce DevOps run, and the
 * validation-output artifact. Downloads quickdeploy.json to --dir.
 * Job outputs: found (true/false), validation_id, validated_sha.
 * Never fails the job — quick-deploy is an optimization; callers fall back.
 * Env: GH_TOKEN, GITHUB_REPOSITORY
 */
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { setOutputs } from "../lib/output.mjs";

const sha = process.argv[2];
const dirIdx = process.argv.indexOf("--dir");
const dir = dirIdx > -1 ? process.argv[dirIdx + 1] : ".";
const repo = process.env.GITHUB_REPOSITORY;
const expectedTestLevel = process.env.ORBITOPS_EXPECTED_TEST_LEVEL;
const expectedTestClasses = process.env.ORBITOPS_EXPECTED_TEST_CLASSES ?? "[]";

const gh = (args) => execFileSync("gh", args, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
const notFound = (why) => {
  console.log(`No quick-deploy candidate: ${why}`);
  setOutputs({ found: false, validation_id: "", validated_sha: "" });
  process.exit(0);
};

try {
  const prs = JSON.parse(gh(["api", `repos/${repo}/commits/${sha}/pulls`]));
  const pr = prs.find((p) => p.merge_commit_sha === sha) ?? prs[0];
  if (!pr) notFound("no associated PR");

  const runs = JSON.parse(
    gh(["run", "list", "--repo", repo, "--commit", pr.head.sha, "--workflow", "pr-validate.yml",
        "--status", "success", "--json", "databaseId", "--limit", "1"])
  );
  if (!runs.length) notFound(`no successful validation run for PR head ${pr.head.sha.slice(0, 7)}`);

  gh(["run", "download", String(runs[0].databaseId), "--repo", repo, "-n", "validation-output", "-D", dir]);
  const qd = `${dir}/quickdeploy.json`;
  if (!existsSync(qd)) notFound("validation run had no quickdeploy artifact (dry-run stage or failed validate)");

  const { validationId, sha: validatedSha, testLevel, testClasses } = JSON.parse(readFileSync(qd, "utf8"));
  if (!validationId || !validatedSha) notFound("quickdeploy.json incomplete");
  if (!expectedTestLevel || testLevel !== expectedTestLevel || JSON.stringify(testClasses ?? []) !== expectedTestClasses) {
    notFound("validation used a different test policy");
  }

  console.log(`Quick-deploy candidate: validation ${validationId} (validated sha ${validatedSha.slice(0, 7)})`);
  setOutputs({ found: true, validation_id: validationId, validated_sha: validatedSha });
} catch (err) {
  notFound(`lookup error: ${err.message.split("\n")[0]}`);
}
