/**
 * Work-item ID extraction + format validation (PoC scope: no tracker APIs).
 * Jira keys: PROJ-123 · Azure DevOps refs: AB#456
 * Sources: PR title and branch name (scanned fully), commit messages
 * ("Work-Items:" footer lines only, to avoid picking up incidental tokens).
 */
export const JIRA_PATTERN = /\b[A-Z][A-Z0-9]+-\d+\b/g;
export const ADO_PATTERN = /\bAB#\d+\b/g;

export function extractIdsFromText(text) {
  if (!text) return [];
  return [...(text.match(JIRA_PATTERN) ?? []), ...(text.match(ADO_PATTERN) ?? [])];
}

function footerLines(message) {
  return (message ?? "")
    .split("\n")
    .filter((l) => /^\s*Work-Items?\s*:/i.test(l));
}

export function classify(id) {
  return id.startsWith("AB#") ? "ado" : "jira";
}

/**
 * @param {{title?: string, branch?: string, commitMessages?: string[]}} sources
 * @returns {{id: string, tracker: "jira"|"ado"}[]} deduped, in discovery order
 */
export function extractWorkItems({ title, branch, commitMessages = [] }) {
  const found = [
    ...extractIdsFromText(title),
    ...extractIdsFromText(branch),
    ...commitMessages.flatMap((m) => footerLines(m).flatMap(extractIdsFromText)),
  ];
  const seen = new Set();
  const items = [];
  for (const id of found) {
    if (seen.has(id)) continue;
    seen.add(id);
    items.push({ id, tracker: classify(id) });
  }
  return items;
}

export const NO_WORK_ITEM_MESSAGE = [
  "No work item is attached to this change.",
  "",
  "Add a work-item ID to the PR title, branch name, or a commit footer, e.g.:",
  "  - PR title:      Add discount field (PROJ-123)",
  "  - Branch:        feature/PROJ-123-discount-field",
  "  - Commit footer: Work-Items: PROJ-123, AB#456",
  "",
  "Every change must be traceable to a work item before it can be promoted.",
].join("\n");
