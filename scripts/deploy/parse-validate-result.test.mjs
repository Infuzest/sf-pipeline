import { test } from "node:test";
import assert from "node:assert/strict";
import { parseValidation, renderErrorsMarkdown } from "./parse-validate-result.mjs";

const SUCCESS = {
  status: 0,
  result: {
    success: true,
    id: "0AfKa00000TESTID",
    details: {
      runTestResult: {
        numTestsRun: "12",
        numFailures: "0",
        codeCoverage: [
          { name: "DiscountService", numLocations: "100", numLocationsNotCovered: "10" },
          { name: "CaseRouter", numLocations: "50", numLocationsNotCovered: "25" },
        ],
        failures: [],
      },
    },
  },
};

const FAILURE = {
  status: 1,
  result: {
    success: false,
    id: "0AfKa00000FAILID",
    details: {
      componentFailures: [
        {
          fullName: "DiscountService",
          componentType: "ApexClass",
          problem: "Method does not exist: applyDiscnt",
          lineNumber: 42,
        },
      ],
      runTestResult: {
        numTestsRun: "12",
        numFailures: "1",
        failures: [{ name: "DiscountServiceTest", methodName: "testApply", message: "Assertion failed" }],
      },
    },
  },
};

test("parses successful validation with coverage", () => {
  const p = parseValidation(SUCCESS);
  assert.equal(p.succeeded, true);
  assert.equal(p.validationId, "0AfKa00000TESTID");
  assert.equal(p.overallCoverage, 76.7); // 150 locations, 35 uncovered
  assert.equal(p.coverage.find((c) => c.name === "CaseRouter").percent, 50);
});

test("parses failure with component errors and test failures", () => {
  const p = parseValidation(FAILURE);
  assert.equal(p.succeeded, false);
  assert.equal(p.failures.length, 1);
  assert.equal(p.failures[0].column, "");
  assert.equal(p.testsFailed, 1);
  const md = renderErrorsMarkdown(p);
  assert.match(md, /Method does not exist: applyDiscnt/);
  assert.match(md, /DiscountServiceTest\.testApply/);
});

test("no tests → overall coverage null", () => {
  const p = parseValidation({ status: 0, result: { success: true, id: "x", details: {} } });
  assert.equal(p.overallCoverage, null);
  assert.equal(p.testsRan, 0);
});

test("CLI-level error (no result body) surfaces the message", () => {
  const p = parseValidation({ status: 1, name: "Error", message: "Expected --test-level=NoTestRun to be one of: ..." });
  assert.equal(p.succeeded, false);
  assert.match(renderErrorsMarkdown(p), /Expected --test-level=NoTestRun/);
});

const REPORTED_COMPONENT_FAILURES = {
  status: 1,
  message: "Failed to validate the deployment",
  result: {
    success: false,
    files: [
      {
        fullName: "Account-Account %28Marketing%29 Layout",
        type: "Page Layout",
        state: "Failed",
        lineNumber: 0,
        columnNumber: 0,
        error: "In field: QuickAction - no QuickAction named FeedItem.RypplePost found",
      },
      {
        fullName: "Account-Account %28Sales%29 Layout",
        type: "Page Layout",
        state: "Failed",
        lineNumber: 0,
        columnNumber: 0,
        error: "In field: QuickAction - no QuickAction named FeedItem.RypplePost found",
      },
      {
        fullName: "Account-Account %28Support%29 Layout",
        type: "Page Layout",
        state: "Failed",
        lineNumber: 0,
        columnNumber: 0,
        error: "In field: QuickAction - no QuickAction named FeedItem.RypplePost found",
      },
      {
        fullName: "Account-Account Layout",
        type: "Page Layout",
        state: "Failed",
        lineNumber: 0,
        columnNumber: 0,
        error: "In field: QuickAction - no QuickAction named FeedItem.RypplePost found",
      },
      {
        fullName: "data_capture_2",
        type: "Flow Version",
        state: "Failed",
        lineNumber: 0,
        columnNumber: 0,
        error: "Your organization doesn't have permission to create flows of processType \"DataCaptureFlow\".",
      },
    ],
  },
};

test("reads and preserves the Salesforce CLI files failure shape", () => {
  const parsed = parseValidation(REPORTED_COMPONENT_FAILURES);
  assert.equal(parsed.failures.length, 5);
  assert.deepEqual(parsed.failures[0], {
    fullName: "Account-Account (Marketing) Layout",
    type: "Page Layout",
    problem: "In field: QuickAction - no QuickAction named FeedItem.RypplePost found",
    line: 0,
    column: 0,
  });
  assert.equal(parsed.failures[4].type, "Flow Version");
  assert.match(parsed.failures[4].problem, /DataCaptureFlow/);
});

test("renders every reported field in the citizen-facing error table", () => {
  const markdown = renderErrorsMarkdown(parseValidation(REPORTED_COMPONENT_FAILURES));
  assert.match(markdown, /\| API Name \| Type \| Line \| Column \| Error Message \|/);
  assert.match(markdown, /Account-Account \(Marketing\) Layout/);
  assert.match(markdown, /\| Page Layout \| 0 \| 0 \|/);
  assert.match(markdown, /data_capture_2/);
  assert.match(markdown, /DataCaptureFlow/);
});

test("recovers message-only errors and their line and column", () => {
  const parsed = parseValidation({
    status: 1,
    message:
      "Failed to validate\n" +
      "Error in Bank_Transactions__c.Amount__c - Entity 'Bank_Transactions__c' not found. (167:13)\n" +
      "Error in Bank_Transactions__c-Bank Transactions Layout - Parent entity failed to deploy",
    result: { success: false, details: {} },
  });
  assert.equal(parsed.failures.length, 2);
  assert.equal(parsed.failures[0].line, "167");
  assert.equal(parsed.failures[0].column, "13");
  assert.equal(parsed.failures[0].problem, "Entity 'Bank_Transactions__c' not found.");
  assert.equal(parsed.failures[1].line, "");
});
