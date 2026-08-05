import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateCoverage } from "./check-coverage.mjs";

test("min 0 always passes", () => {
  assert.equal(evaluateCoverage({ overall: null, min: 0 }).ok, true);
});

test("metadata-only change (no Apex) passes even when the stage requires coverage", () => {
  const { ok, lines } = evaluateCoverage({ overall: null, min: 75, hasApex: false });
  assert.equal(ok, true);
  assert.match(lines.join("\n"), /nothing to cover/);
});

test("Apex present but no coverage produced fails", () => {
  const { ok, lines } = evaluateCoverage({ overall: null, min: 75, hasApex: true });
  assert.equal(ok, false);
  assert.match(lines.join("\n"), /contains Apex but produced no coverage/);
});

test("coverage below threshold fails", () => {
  assert.equal(evaluateCoverage({ overall: 60, min: 75, hasApex: true }).ok, false);
});

test("coverage at or above threshold passes", () => {
  assert.equal(evaluateCoverage({ overall: 80, min: 75, hasApex: true }).ok, true);
});

test("weak classes are listed when below threshold", () => {
  const { lines } = evaluateCoverage({
    overall: 60,
    perClass: [{ name: "CaseRouter", percent: 40 }],
    min: 75,
    hasApex: true,
  });
  assert.match(lines.join("\n"), /CaseRouter \| 40%/);
});

test("without hasApex, keeps strict legacy behaviour (null fails)", () => {
  assert.equal(evaluateCoverage({ overall: null, min: 75 }).ok, false);
});
