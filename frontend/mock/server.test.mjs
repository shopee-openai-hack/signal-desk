import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { afterEach } from "node:test";
import { createMockServer } from "./server.mjs";

const running = [];
const CASE_ID = "case_zhonglian_oil";
const products = ["prod_001", "prod_002", "prod_003", "prod_004", "prod_005", "prod_006", "prod_007", "prod_008", "prod_009"];

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

const jsonPost = (key, value = {}) => ({ method: "POST", headers: { "Idempotency-Key": key }, body: JSON.stringify(value) });
const resetPost = (value) => ({ method: "POST", body: JSON.stringify(value) });

async function readCase(url) {
  return (await request(url, `/api/v1/cases/${CASE_ID}`)).body;
}

async function readProducts(url) {
  return (await request(url, "/api/v1/products")).body.items;
}

async function resetToStage(url, stage, scenario = "main") {
  const result = await request(url, "/api/v1/mock/reset", resetPost({ stage, scenario }));
  assert.equal(result.response.status, 200);
  return result;
}

test("default checkpoint serves the approved primary fixture parity", async () => {
  const { url } = await fixtureServer();
  const status = await request(url, "/api/v1/mock/status");
  const cases = await request(url, "/api/v1/cases");
  const signals = await request(url, "/api/v1/signals");
  const productsResponse = await request(url, "/api/v1/products");
  assert.equal(status.body.stage, 3);
  assert.equal(status.body.provenance.replay_window, "2026-06-30 至 2026-07-23");
  assert.match(status.body.provenance.warning, /demo 前需逐字核對/);
  assert.equal(cases.body.items.length, 1);
  assert.equal(cases.body.items[0].case_id, CASE_ID);
  assert.equal("candidate_products" in cases.body.items[0], false);
  assert.deepEqual([cases.body.items[0].business_impact, cases.body.items[0].priority, cases.body.items[0].status], ["risk", "high", "investigating"]);
  assert.equal(signals.body.items.length, 3);
  assert.deepEqual(signals.body.items.map((item) => item.source.source_id), ["post_001", "post_002", "post_003"]);
  assert.match(signals.body.items[0].source.raw_text, /泰山某批沙拉油/);
  assert.equal(productsResponse.body.items.length, 9);
  assert.deepEqual(productsResponse.body.items.map((item) => item.product_id), products);
  assert.equal(productsResponse.body.items.every((item) => item.status === "active" && item.is_simulated === true), true);
  const approvals = await request(url, `/api/v1/cases/${CASE_ID}/approvals`);
  assert.deepEqual(approvals.body.items, []);
});

test("saved primary trace has six stages, historical snapshots and source boundaries", async () => {
  const { url } = await fixtureServer();
  const traces = await request(url, "/api/v1/traces");
  assert.deepEqual(traces.body.items.map((item) => item.scenario), ["main", "failure_retry"]);
  assert.equal("steps" in traces.body.items[0], false);
  const main = await request(url, "/api/v1/traces/trace_oil_main");
  assert.equal(main.body.phase_count, 6);
  assert.equal(main.body.phases.length, 6);
  assert.equal(main.body.phases[3].status, "waiting_human");
  assert.equal(main.body.phases[3].next_activity.id, "main.stage4.approval.wait");
  assert.equal(main.body.phases[3].next_phase.id, "main.stage5");
  assert.equal(main.body.phases[3].case_after.status, "awaiting_approval");
  assert.equal(main.body.phases[3].case_after.candidate_products.find((item) => item.product_id === "prod_001").product_status, "active");
  assert.equal(main.body.phases[4].case_before.candidate_products.find((item) => item.product_id === "prod_001").product_status, "delisted");
  assert.equal(main.body.phases[5].case_after.candidate_products.find((item) => item.product_id === "prod_009").relation, "excluded");
  const s6Evidence = main.body.phases[5].evidence[0];
  assert.equal(s6Evidence.stance, "refutes");
  assert.match(s6Evidence.label, /demo 前需逐字核對/);
  for (const phase of main.body.phases) {
    assert.ok(phase.case_before.claims);
    assert.ok(phase.case_after.candidate_products);
    assert.equal(phase.progress.total_activities, phase.activities.length);
    for (const activity of phase.activities) {
      assert.ok(activity.activity_id);
      assert.ok("started_at" in activity && "completed_at" in activity);
      assert.ok("input" in activity && "output" in activity);
      assert.ok("evidence" in activity && "error" in activity);
    }
  }
});

test("full Stage 0 to 6 path enforces the Stage 4 human gate and never restores listings", async () => {
  const { url } = await fixtureServer();
  await resetToStage(url, 0);
  assert.deepEqual((await request(url, "/api/v1/cases")).body.items, []);
  assert.deepEqual((await request(url, "/api/v1/signals")).body.items, []);
  assert.equal((await readProducts(url)).length, 9);
  let stageOne;
  for (const stage of [1, 2, 3]) {
    const advanced = await request(url, `/api/v1/cases/${CASE_ID}/advance`, jsonPost(`advance-${stage}`));
    assert.equal(advanced.response.status, 200);
    assert.equal(advanced.body.stage, stage);
    if (stage === 1) stageOne = advanced.body.case;
    if (stage === 2) {
      assert.equal(advanced.body.case.version, 1);
      assert.equal(advanced.body.case.updated_at, stageOne.updated_at);
      assert.deepEqual(advanced.body.case.claim_ids, stageOne.claim_ids);
      const timeline = (await request(url, `/api/v1/cases/${CASE_ID}/timeline`)).body.items;
      assert.equal(timeline[1].kind, "signal_added");
      assert.equal(timeline[1].case_version, 1);
      assert.equal((await request(url, "/api/v1/cases")).body.items[0].updated_at, timeline[1].occurred_at);
    }
  }
  assert.deepEqual([ (await readCase(url)).business_impact, (await readCase(url)).priority, (await readCase(url)).status ], ["risk", "high", "investigating"]);

  const stage4 = await request(url, `/api/v1/cases/${CASE_ID}/advance`, jsonPost("advance-4"));
  assert.equal(stage4.body.case.status, "awaiting_approval");
  assert.equal((await readProducts(url)).every((item) => item.status === "active"), true);
  assert.deepEqual(stage4.body.case.candidate_products.filter((item) => item.relation === "confirmed").map((item) => item.product_id), ["prod_001", "prod_003", "prod_005"]);

  const unknown = await request(url, `/api/v1/cases/${CASE_ID}/approvals`, jsonPost("approval-unknown", { case_version: 3, product_ids: ["prod_002"] }));
  assert.equal(unknown.response.status, 422);
  assert.equal(unknown.body.error.code, "invalid_selection");
  const approval = await request(url, `/api/v1/cases/${CASE_ID}/approvals`, jsonPost("approval-stage4", { case_version: 3, product_ids: ["prod_001", "prod_003", "prod_005"] }));
  assert.equal(approval.response.status, 201);
  assert.equal((await readProducts(url)).every((item) => item.status === "active"), true);
  const execution = await request(url, `/api/v1/approvals/${approval.body.approval.approval_id}/execute`, jsonPost("execute-stage4"));
  assert.equal(execution.response.status, 200);
  assert.deepEqual(execution.body.summary, { succeeded: 3, failed: 0, total: 3 });
  assert.deepEqual((await readProducts(url)).filter((item) => item.status === "delisted").map((item) => item.product_id), ["prod_001", "prod_003", "prod_005"]);
  assert.equal((await readCase(url)).candidate_products.every((item) => !("product_status" in item)), true);

  const stage5 = await request(url, `/api/v1/cases/${CASE_ID}/advance`, jsonPost("advance-5"));
  assert.equal(stage5.body.case.status, "awaiting_approval");
  assert.deepEqual(stage5.body.case.candidate_products.filter((item) => ["prod_007", "prod_009"].includes(item.product_id)).map((item) => item.relation), ["candidate", "candidate"]);
  assert.deepEqual((await readProducts(url)).filter((item) => item.status === "delisted").map((item) => item.product_id), ["prod_001", "prod_003", "prod_005"]);
  const stage6 = await request(url, `/api/v1/cases/${CASE_ID}/advance`, jsonPost("advance-6"));
  assert.equal(stage6.body.case.status, "investigating");
  assert.equal(stage6.body.case.priority, "high");
  assert.equal(stage6.body.case.candidate_products.find((item) => item.product_id === "prod_007").relation, "candidate");
  assert.equal(stage6.body.case.candidate_products.find((item) => item.product_id === "prod_009").relation, "excluded");
  assert.deepEqual((await readProducts(url)).filter((item) => item.status === "delisted").map((item) => item.product_id), ["prod_001", "prod_003", "prod_005"]);
});

test("trace reads are read-only and primary state migration preserves mutable records", async () => {
  const service = await fixtureServer();
  const before = await readFile(service.statePath, "utf8");
  await request(service.url, "/api/v1/traces");
  await request(service.url, "/api/v1/traces/trace_oil_main");
  assert.equal(await readFile(service.statePath, "utf8"), before);
  await new Promise((resolve) => service.server.close(resolve));
  const legacy = JSON.parse(before);
  legacy.schema_version = 1;
  legacy.products[0].status = "delisted";
  legacy.approvals = [{ approval_id: "apr_legacy", case_id: CASE_ID, case_version: 3, product_ids: ["prod_001"], status: "approved", approved_by: "employee_legacy", approved_at: "2026-09-12T02:10:00.000Z" }];
  legacy.executions = [{ execution_id: "exec_legacy", approval_id: "apr_legacy", product_id: "prod_001", status: "failed", error: "保留的舊執行錯誤", executed_at: "2026-09-12T02:11:00.000Z", attempts: 1 }];
  legacy.traces.forEach((trace) => { delete trace.replay; delete trace.phases; delete trace.trace_status; delete trace.scenario; delete trace.phase_count; delete trace.activity_count; delete trace.contains_human_pause; delete trace.recorded_at; });
  await writeFile(service.statePath, `${JSON.stringify(legacy, null, 2)}\n`, "utf8");
  const migrated = await createMockServer({ statePath: service.statePath });
  running.push({ ...migrated, dir: service.dir });
  assert.equal((await request(migrated.url, "/api/v1/traces/trace_oil_main")).body.phases.length, 6);
  assert.equal((await readProducts(migrated.url)).find((item) => item.product_id === "prod_001").status, "delisted");
  assert.equal((await request(migrated.url, `/api/v1/cases/${CASE_ID}/approvals`)).body.items[0].approval_id, "apr_legacy");
  assert.equal(JSON.parse(await readFile(service.statePath, "utf8")).schema_version, 3);
});

test("v2 mock state migrates repost and approval versions without losing execution history", async () => {
  const service = await fixtureServer();
  await resetToStage(service.url, 4);
  const approved = await request(service.url, `/api/v1/cases/${CASE_ID}/approvals`, jsonPost("old-approval", { case_version: 3, product_ids: ["prod_001"] }));
  await request(service.url, `/api/v1/approvals/${approved.body.approval.approval_id}/execute`, jsonPost("old-execution"));
  await new Promise((resolve) => service.server.close(resolve));
  const legacy = JSON.parse(await readFile(service.statePath, "utf8"));
  legacy.schema_version = 2;
  legacy.cases[0].version = 4;
  legacy.approvals[0].case_version = 4;
  for (const item of legacy.timelines[CASE_ID]) {
    if (item.timeline_id === "tl_stage_2") {
      item.case_version = 2;
      item.kind = "verification_updated";
    } else if (item.case_version > 1) item.case_version += 1;
  }
  await writeFile(service.statePath, `${JSON.stringify(legacy, null, 2)}\n`, "utf8");
  const migrated = await createMockServer({ statePath: service.statePath });
  running.push({ ...migrated, dir: service.dir });
  assert.equal((await readCase(migrated.url)).version, 3);
  const timeline = (await request(migrated.url, `/api/v1/cases/${CASE_ID}/timeline`)).body.items;
  assert.deepEqual([timeline[1].kind, timeline[1].case_version], ["signal_added", 1]);
  const approvals = (await request(migrated.url, `/api/v1/cases/${CASE_ID}/approvals`)).body.items;
  assert.equal(approvals[0].case_version, 3);
  assert.equal(approvals[0].executions[0].status, "succeeded");
  assert.equal((await readProducts(migrated.url)).find((item) => item.product_id === "prod_001").status, "delisted");
});

test("approval and execution idempotency persist across restart", async () => {
  const service = await fixtureServer();
  await resetToStage(service.url, 4);
  const options = { case_version: 3, product_ids: ["prod_001"] };
  const firstApproval = await request(service.url, `/api/v1/cases/${CASE_ID}/approvals`, jsonPost("approval-stable-key", options));
  const secondApproval = await request(service.url, `/api/v1/cases/${CASE_ID}/approvals`, jsonPost("approval-stable-key", options));
  assert.equal(firstApproval.response.status, 201);
  assert.deepEqual(secondApproval.body, firstApproval.body);
  const firstExecution = await request(service.url, `/api/v1/approvals/${firstApproval.body.approval.approval_id}/execute`, jsonPost("execution-stable-key"));
  const replayExecution = await request(service.url, `/api/v1/approvals/${firstApproval.body.approval.approval_id}/execute`, jsonPost("execution-stable-key"));
  assert.equal(firstExecution.body.summary.succeeded, 1);
  assert.equal((await readProducts(service.url)).find((item) => item.product_id === "prod_003").status, "active");
  const blockedAdvance = await request(service.url, `/api/v1/cases/${CASE_ID}/advance`, jsonPost("advance-partial-stage4"));
  assert.equal(blockedAdvance.response.status, 409);
  assert.deepEqual(blockedAdvance.body.error.details.missing_product_ids, ["prod_003", "prod_005"]);
  assert.deepEqual(replayExecution.body, firstExecution.body);
  await new Promise((resolve) => service.server.close(resolve));
  const restarted = await createMockServer({ statePath: service.statePath });
  running.push({ ...restarted, dir: service.dir });
  assert.equal((await readProducts(restarted.url)).find((item) => item.product_id === "prod_001").status, "delisted");
});

test("stale Stage 4 approval is rejected after advancing to Stage 5", async () => {
  const { url } = await fixtureServer();
  await resetToStage(url, 4);
  const approved = await request(url, `/api/v1/cases/${CASE_ID}/approvals`, jsonPost("approval-stale-key", { case_version: 3, product_ids: ["prod_001", "prod_003", "prod_005"] }));
  const approvalId = approved.body.approval.approval_id;
  await request(url, `/api/v1/approvals/${approvalId}/execute`, jsonPost("execute-stale-key"));
  const advanced = await request(url, `/api/v1/cases/${CASE_ID}/advance`, jsonPost("advance-stale-key"));
  assert.equal(advanced.body.case.version, 4);
  const execution = await request(url, `/api/v1/approvals/${approvalId}/execute`, jsonPost("execute-stale-again-key"));
  assert.equal(execution.response.status, 409);
  assert.equal(execution.body.error.code, "version_conflict");
});

test("isolated failure scenario retries the same execution record", async () => {
  const { url } = await fixtureServer();
  await resetToStage(url, 5, "failure_retry");
  const approved = await request(url, `/api/v1/cases/${CASE_ID}/approvals`, jsonPost("approval-retry-key", { case_version: 4, product_ids: ["prod_007"] }));
  assert.equal(approved.response.status, 201);
  const approvalId = approved.body.approval.approval_id;
  const failed = await request(url, `/api/v1/approvals/${approvalId}/execute`, jsonPost("execute-fail-key"));
  assert.equal(failed.body.executions[0].status, "failed");
  assert.equal(failed.body.executions[0].attempts, 1);
  const retried = await request(url, `/api/v1/approvals/${approvalId}/execute`, jsonPost("execute-retry-key"));
  assert.equal(retried.body.executions[0].status, "succeeded");
  assert.equal(retried.body.executions[0].attempts, 2);
  assert.equal(retried.body.executions[0].execution_id, failed.body.executions[0].execution_id);
  assert.equal((await readProducts(url)).find((item) => item.product_id === "prod_007").status, "delisted");
});
