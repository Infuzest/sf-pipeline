#!/usr/bin/env node
/** Exposes optional external reporting integrations as workflow outputs. */
import { loadConfig } from "../lib/pipeline.mjs";
import { setOutputs } from "../lib/output.mjs";

const config = loadConfig();
setOutputs({ publish_sarif: String(config.codeScanning.publishSarif === true) });
