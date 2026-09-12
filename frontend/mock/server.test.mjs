import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

test("serves the richer phase contract for both saved scenario branches", async () => {
  const service = await fixtureServer();
  const traces = await request(service.url, "/api/v1/traces");
  assert.equal(traces.response.status, 200);
  assert.deepEqual(traces.body.items.map((item) => item.scenario), ["main", "failure_retry"]);
  assert.equal("phases" in traces.body.items[0], false, "list response should remain a compact summary");
  assert.equal(traces.body.items.every((item) => item.mode === "saved_mock" && item.trace_status === "saved"), true);

  const main = await request(service.url, "/api/v1/traces/trace_oil_main");
  assert.equal(main.response.status, 200);
  assert.equal(main.body.replay.read_only, true);
  assert.equal(main.body.replay.cursor_semantics, "client_revealed");
  assert.equal(main.body.phases.length, main.body.phase_count);
  assert.equal(main.body.phases.some((phase) => phase.status === "waiting_human"), true);
  assert.equal(main.body.phases.some((phase) => phase.status === "ready"), true);
  for (const phase of main.body.phases) {
    assert.ok(phase.case_before.claims, "before snapshot carries verification outcomes");
    assert.ok(phase.case_after.candidate_products, "after snapshot carries candidate reasons and relation");
    assert.equal(phase.progress.total_activities, phase.activities.length);
    for (const activity of phase.activities) {
      assert.ok(activity.activity_id);
      assert.ok("started_at" in activity);
      assert.ok("completed_at" in activity);
      assert.ok("input" in activity && "output" in activity);
      assert.ok("evidence" in activity && "error" in activity);
    }
  }
  assert.equal(main.body.phases[3].next_activity.id, "main.approval.wait");
  assert.equal(main.body.phases[3].next_phase.id, "main.phase.execution");

  const retry = await request(service.url, "/api/v1/traces/trace_failure_retry");
  assert.equal(retry.response.status, 200);
  const failed = retry.body.phases.find((phase) => phase.status === "failed");
  const succeeded = retry.body.phases.find((phase) => phase.status === "succeeded");
  assert.ok(failed);
  assert.ok(succeeded);
  assert.equal(failed.activities[0].status, "failed");
  assert.equal(succeeded.activities[0].retry_of_activity_id, failed.activities[0].activity_id);
  assert.equal(succeeded.activities[0].attempt, 2);
  assert.equal(succeeded.case_after.candidate_products[0].product_status, "delisted");
});

test("GET trace playback is read-only and migration preserves prior mutable state", async () => {
  const service = await fixtureServer();
  const before = await readFile(service.statePath, "utf8");
  await request(service.url, "/api/v1/traces");
  await request(service.url, "/api/v1/traces/trace_oil_main");
  const afterReads = await readFile(service.statePath, "utf8");
  assert.equal(afterReads, before, "GET trace endpoints must not write mock state");

  await new Promise((resolve) => service.server.close(resolve));
  const legacy = JSON.parse(before);
  legacy.schema_version = 1;
  legacy.products[0].status = "delisted";
  legacy.approvals = [{
    approval_id: "apr_legacy",
    case_id: "case_oil_safety",
    case_version: 3,
    product_ids: ["prod_oil_001"],
    status: "approved",
    approved_by: "employee_legacy",
    approved_at: "2026-09-12T02:10:00.000Z",
  }];
  legacy.executions = [{
    execution_id: "exec_legacy",
    approval_id: "apr_legacy",
    product_id: "prod_oil_001",
    status: "failed",
    error: "保留的舊執行錯誤",
    executed_at: "2026-09-12T02:11:00.000Z",
    attempts: 1,
  }];
  legacy.traces.forEach((trace) => {
    delete trace.replay;
    delete trace.phases;
    delete trace.trace_status;
    delete trace.scenario;
    delete trace.phase_count;
    delete trace.activity_count;
    delete trace.contains_human_pause;
    delete trace.recorded_at;
  });
  await writeFile(service.statePath, `${JSON.stringify(legacy, null, 2)}\n`, "utf8");

  const migrated = await createMockServer({ statePath: service.statePath });
  running.push({ ...migrated, dir: service.dir });
  const migratedTrace = await request(migrated.url, "/api/v1/traces/trace_oil_main");
  const migratedProducts = await request(migrated.url, "/api/v1/products");
  const migratedApprovals = await request(migrated.url, "/api/v1/cases/case_oil_safety/approvals");
  assert.equal(migratedTrace.body.phases.length, 5);
  assert.equal(migratedProducts.body.items.find((item) => item.product_id === "prod_oil_001").status, "delisted");
  assert.equal(migratedApprovals.body.items[0].approval_id, "apr_legacy");
  assert.equal(JSON.parse(await readFile(service.statePath, "utf8")).schema_version, 2);
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
