#!/usr/bin/env node
/**
 * Emits the back-promotion sync pairs for the current pipeline, right to left:
 * for stages [integration, uat, main] prints "main:uat uat:integration".
 * Derived from .orbitops/pipeline.yml so topology changes never require
 * editing the deploy workflow.
 */
import { loadPipeline } from "../lib/pipeline.mjs";

const stages = loadPipeline();
const pairs = [];
for (let i = stages.length - 1; i > 0; i--) {
  pairs.push(`${stages[i].branch}:${stages[i - 1].branch}`);
}
console.log(pairs.join(" "));
