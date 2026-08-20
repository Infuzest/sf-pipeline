/**
 * Safely emit configured Apex test classes one per line for Bash arrays.
 * Values travel through an environment variable rather than being interpolated
 * into a shell command.
 */
export const APEX_TEST_RE = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)?$/;

export function parseConfiguredTestClasses(raw) {
  let values;
  try {
    values = JSON.parse(raw || "[]");
  } catch {
    throw new Error("Configured test classes are not valid JSON.");
  }
  if (!Array.isArray(values) || values.length === 0 || values.length > 500) {
    throw new Error("RunSpecifiedTests needs between 1 and 500 resolved test classes.");
  }
  if (new Set(values).size !== values.length || values.some((value) => typeof value !== "string" || !APEX_TEST_RE.test(value))) {
    throw new Error("Configured test classes must be unique Apex class names (or Class.testMethod entries).");
  }
  return values;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    for (const testClass of parseConfiguredTestClasses(process.env.ORBITOPS_TEST_CLASSES)) console.log(testClass);
  } catch (error) {
    console.error(`✖ ${error.message}`);
    process.exit(1);
  }
}
