import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { afterEach } from "node:test";
import { createMockServer } from "./server.mjs";

const running = [];

afterEach(async () => {
  await Promise.all(running.splice(0).map(async ({ server, dir }) => {
    await new Promise((resolve) => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }));
});

async function fixtureServer() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "signal-desk-mock-"));
  const service = await createMockServer({ statePath: path.join(dir, "state.json") });
  const fixture = { ...service, dir };
  running.push(fixture);
  return fixture;
}

async function request(url, pathname, options = {}) {
  const response = await fetch(`${url}${pathname}`, {
    headers: { "content-type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const body = await response.json();
  return { response, body };
}

const jsonPost = (key, value = {}) => ({
  method: "POST",
  headers: { "Idempotency-Key": key },
  body: JSON.stringify(value),
});

test("serves canonical case, product and mock-only trace reads", async () => {
  const { url } = await fixtureServer();
  const cases = await request(url, "/api/v1/cases");
  const products = await request(url, "/api/v1/products");
  const traces = await request(url, "/api/v1/traces");
  assert.equal(cases.response.status, 200);
  assert.equal(cases.body.items[0].case_id, "case_oil_safety");
  assert.equal(products.body.items.length, 3);
  assert.equal(traces.body.items[0].mode, "saved_mock");
  assert.equal("steps" in traces.body.items[0], false, "trace list should keep steps in detail endpoint only");
  const trace = await request(url, `/api/v1/traces/${traces.body.items[0].trace_id}`);
  assert.ok(trace.body.steps.length > 2);
});

test("persists approval and execution, and idempotency prevents duplicate writes", async () => {
  const service = await fixtureServer();
  const approvalOptions = jsonPost("approval-stable-key", { case_version: 3, product_ids: ["prod_oil_001"] });
  const firstApproval = await request(service.url, "/api/v1/cases/case_oil_safety/approvals", approvalOptions);
  const secondApproval = await request(service.url, "/api/v1/cases/case_oil_safety/approvals", approvalOptions);
  assert.equal(firstApproval.response.status, 201);
  assert.equal(secondApproval.response.status, 201);
  assert.deepEqual(secondApproval.body, firstApproval.body);
  const approvalId = firstApproval.body.approval.approval_id;
  const executionOptions = jsonPost("execution-stable-key");
  const firstExecution = await request(service.url, `/api/v1/approvals/${approvalId}/execute`, executionOptions);
  const replayExecution = await request(service.url, `/api/v1/approvals/${approvalId}/execute`, executionOptions);
  assert.equal(firstExecution.response.status, 200);
  assert.equal(firstExecution.body.summary.succeeded, 1);
  assert.deepEqual(replayExecution.body, firstExecution.body);
  const timeline = await request(service.url, "/api/v1/cases/case_oil_safety/timeline");
  assert.equal(timeline.body.items.filter((item) => item.kind === "approval_recorded").length, 1);
  assert.equal(timeline.body.items.filter((item) => item.kind === "action_executed").length, 1);

  await new Promise((resolve) => service.server.close(resolve));
  const restarted = await createMockServer({ statePath: service.statePath });
  running.push({ ...restarted, dir: service.dir });
  const persistedProducts = await request(restarted.url, "/api/v1/products");
  assert.equal(persistedProducts.body.items.find((item) => item.product_id === "prod_oil_001").status, "delisted");
});

test("rejects stale approval after a case revision", async () => {
  const { url } = await fixtureServer();
  const approved = await request(url, "/api/v1/cases/case_oil_safety/approvals", jsonPost("approval-stale-key", { case_version: 3, product_ids: ["prod_oil_001"] }));
  const approvalId = approved.body.approval.approval_id;
  const advanced = await request(url, "/api/v1/cases/case_oil_safety/advance", jsonPost("advance-stale-key", { reason: "測試新證據造成版本變更" }));
  assert.equal(advanced.body.case.version, 4);
  const execution = await request(url, `/api/v1/approvals/${approvalId}/execute`, jsonPost("execute-stale-key"));
  assert.equal(execution.response.status, 409);
  assert.equal(execution.body.error.code, "version_conflict");
});

test("exposes a failed attempt and retries the same execution record", async () => {
  const { url } = await fixtureServer();
  const approved = await request(url, "/api/v1/cases/case_oil_safety/approvals", jsonPost("approval-retry-key", { case_version: 3, product_ids: ["prod_oil_002"] }));
  const approvalId = approved.body.approval.approval_id;
  const failed = await request(url, `/api/v1/approvals/${approvalId}/execute`, jsonPost("execute-fail-key"));
  assert.equal(failed.body.executions[0].status, "failed");
  assert.equal(failed.body.executions[0].attempts, 1);
  const retried = await request(url, `/api/v1/approvals/${approvalId}/execute`, jsonPost("execute-retry-key"));
  assert.equal(retried.body.executions[0].status, "succeeded");
  assert.equal(retried.body.executions[0].attempts, 2);
  assert.equal(retried.body.executions[0].execution_id, failed.body.executions[0].execution_id);
  const products = await request(url, "/api/v1/products");
  assert.equal(products.body.items.find((item) => item.product_id === "prod_oil_002").status, "delisted");
});
