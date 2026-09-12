import { createServer } from "node:http";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PRIMARY_CASE_ID,
  PRIMARY_DATASET_ID,
  REPLAY_WINDOW,
  STAGE4_REQUIRED_PRODUCT_IDS,
  buildProducts,
  buildSignals,
  claimMapForStage,
  primaryProvenance,
  productsAtStage,
  stageDefinition,
  caseTitle,
} from "./primary-fixtures.mjs";

const DEFAULT_STATE_PATH = path.join(os.tmpdir(), "shopee-openai-hack-demo-state.json");
const PORT = Number(process.env.MOCK_PORT || 4100);
const CURRENT_SCHEMA_VERSION = 2;
const DEFAULT_STAGE = 3;
const here = path.dirname(fileURLToPath(import.meta.url));

const clone = (value) => JSON.parse(JSON.stringify(value));
const now = () => new Date().toISOString();
const id = (prefix) => `${prefix}_${Math.random().toString(36).slice(2, 10)}`;

function errorBody(code, message, details = {}) {
  return { error: { code, message, details } };
}

function safeStage(value, fallback = DEFAULT_STAGE) {
  return Number.isInteger(value) && value >= 0 && value <= 6 ? value : fallback;
}

function stageTimelineItem(stage) {
  const common = { case_id: PRIMARY_CASE_ID, actor: { type: "case_agent", id: "agent_food_safety" } };
  const items = {
    1: { timeline_id: "tl_stage_1", case_version: 1, kind: "signal_added", occurred_at: "2026-06-30T05:20:00Z", summary: "收到 post_001 的弱訊號並建立待查案件。", reason: "來源單一且為二手轉述，保留 potential harm 為 pending，不把味道經驗當成食安證據。", source_refs: ["sig_post_001"] },
    2: { timeline_id: "tl_stage_2", case_version: 2, kind: "verification_updated", occurred_at: "2026-06-30T10:05:00Z", summary: "post_002 辨識為 post_001 的 repost。", reason: "純轉傳沒有新增獨立來源或事實，不重跑查核、不建立新案件。", source_refs: ["sig_post_002", "sig_post_001"] },
    3: { timeline_id: "tl_stage_3", case_version: 3, kind: "assessment_updated", occurred_at: "2026-07-01T01:40:00Z", summary: "獨立回報帶入福壽、中聯與批號，案件升為 high。", reason: "同一時間窗的新作者帶來新品牌、上游與批號，足以改變查核與追蹤計畫。", source_refs: ["sig_post_003", "clm_s3_fact_zhonglian"] },
    4: { timeline_id: "tl_stage_4", case_version: 4, kind: "verification_updated", occurred_at: "2026-07-01T08:00:00Z", summary: "食藥署公告支持中聯批號超標與三個流向品牌。", reason: "官方證據把可處置範圍精確到品牌、品類與批號；三筆 confirmed 仍等待人工核可。", source_refs: ["sig_fda_20260701", "ev_s4_fda_20260701"] },
    5: { timeline_id: "tl_stage_5", case_version: 5, kind: "assessment_updated", occurred_at: "2026-07-07T09:00:00Z", summary: "官方公告擴大到使用受影響原料的加工食品。", reason: "新增候選需要新的人工核可；上一輪已執行的三筆下架維持有效。", source_refs: ["sig_fda_20260707", "ev_s5_fda_20260707"] },
    6: { timeline_id: "tl_stage_6", case_version: 6, kind: "verification_updated", occurred_at: "2026-07-23T09:04:00Z", summary: "部分批次獲放行，回放只排除模擬批號 315-1150411。", reason: "中央社證據反駁所有擴大列管批次仍有問題，但不支持恢復既有下架商品。", source_refs: ["sig_cna_20260723", "ev_s6_cna_20260723", "prod_009"] },
  };
  return { ...common, ...items[stage] };
}

function buildPrimarySteps() {
  const labels = {
    1: ["收到弱訊號", "保留原始貼文並建立待查案件"],
    2: ["辨識純轉傳", "連回 post_001，不增加獨立來源數"],
    3: ["獨立回報升級", "新品牌、上游與批號讓案件升為 high"],
    4: ["官方公告與人工核可", "精確列出三筆 confirmed，等待人員核可"],
    5: ["公告擴大範圍", "新增候選保持 active，不繼承舊核可"],
    6: ["部分批次放行", "排除 prod_009，保留既有下架與未知批號"],
  };
  const refs = { 1: ["sig_post_001"], 2: ["sig_post_002"], 3: ["sig_post_003"], 4: ["sig_fda_20260701"], 5: ["sig_fda_20260707"], 6: ["sig_cna_20260723"] };
  return Object.entries(labels).map(([stage, [title, summary]]) => {
    const stageNumber = Number(stage);
    const current = stageDefinition(stageNumber);
    const previous = stageDefinition(stageNumber - 1);
    return {
      step_id: `stage_${stageNumber}`,
      sequence: stageNumber,
      kind: stageNumber === 2 ? "verification" : stageNumber === 4 ? "approval" : stageNumber === 5 ? "assessment" : "signal_added",
      title,
      summary,
      reason: current.priority_reasons[0],
      actor: { type: stageNumber === 4 ? "employee" : "case_agent", id: stageNumber === 4 ? "employee_ops_listing" : "agent_food_safety" },
      status: stageNumber === 4 ? "waiting_human" : "completed",
      input_refs: refs[stageNumber],
      case_before: { version: previous.version, status: previous.status },
      case_after: { version: current.version, status: current.status },
    };
  });
}

function caseForStage(stage, { stage4Executed = false, productStatuses = null, status = null } = {}) {
  const definition = stageDefinition(stage);
  const statuses = productStatuses || productsAtStage(stage, { stage4Executed });
  return {
    case_id: PRIMARY_CASE_ID,
    version: definition.version,
    title: caseTitle(stage),
    ...definition,
    status: status || definition.status,
    owner: { type: "case_agent", id: "agent_food_safety" },
    demo_stage: stage,
    updated_at: stageTimelineItem(Math.max(stage, 1)).occurred_at,
    candidate_products: definition.candidate_products.map((candidate) => ({ ...candidate, product_status: statuses[candidate.product_id] ?? "active" })),
  };
}

function initialState({ stage = DEFAULT_STAGE, scenario = "main" } = {}) {
  const selectedStage = safeStage(stage);
  const stage4Executed = selectedStage >= 5;
  const statuses = productsAtStage(selectedStage, { stage4Executed });
  const products = buildProducts({ failureScenario: scenario === "failure_retry" });
  products.forEach((product) => {
    product.status = statuses[product.product_id] ?? "active";
    if (product.status === "delisted") product.version = 2;
  });
  const timeline = [];
  for (let index = 1; index <= selectedStage; index += 1) timeline.push(stageTimelineItem(index));
  const definition = stageDefinition(selectedStage);
  const state = {
    schema_version: CURRENT_SCHEMA_VERSION,
    dataset_id: PRIMARY_DATASET_ID,
    demo_stage: selectedStage,
    demo_scenario: scenario === "failure_retry" ? "failure_retry" : "main",
    provenance: primaryProvenance(),
    cases: [{ ...caseForStage(selectedStage, { stage4Executed }), updated_at: selectedStage ? stageTimelineItem(selectedStage).occurred_at : now() }],
    signals: buildSignals(selectedStage),
    products,
    timelines: { [PRIMARY_CASE_ID]: timeline },
    approvals: [],
    executions: [],
    traces: [
      { trace_id: "trace_oil_main", name: "中聯油脂事件｜六段主線", description: "以核准的六段訊號、官方查核、人工核可與部分放行證據回放同一案件。", mode: "saved_mock", case_id: PRIMARY_CASE_ID, steps: buildPrimarySteps() },
      { trace_id: "trace_failure_retry", name: "模擬執行失敗｜隔離重試情境", description: "獨立展示一次性模擬平台失敗與同一 execution record 重試成功；不改變主線狀態。", mode: "saved_mock", case_id: PRIMARY_CASE_ID, steps: [
        { step_id: "failure_01", sequence: 1, kind: "execution", title: "第一次執行失敗", summary: "模擬平台回傳暫時性錯誤，商品維持上架。", reason: "失敗保留在原執行紀錄中。", actor: { type: "simulation", id: "mock_platform" }, status: "failed", input_refs: ["prod_007"], case_before: { version: 5, status: "awaiting_approval" }, case_after: { version: 5, status: "awaiting_approval" } },
        { step_id: "failure_02", sequence: 2, kind: "execution", title: "重試同一執行", summary: "第二次嘗試更新原 execution record，成功後不建立重複紀錄。", reason: "retry_of_activity_id 指回第一次失敗。", actor: { type: "simulation", id: "mock_platform" }, status: "succeeded", input_refs: ["prod_007"], case_before: { version: 5, status: "awaiting_approval" }, case_after: { version: 5, status: "actioned" } },
      ] },
    ],
    agent_status: {
      [PRIMARY_CASE_ID]: {
        case_id: PRIMARY_CASE_ID,
        agent_id: "agent_food_safety",
        state: selectedStage === 4 || selectedStage === 5 ? "waiting_human" : selectedStage === 6 || selectedStage === 3 ? "waiting_follow_up" : "running",
        current_step: selectedStage === 4 ? "等待員工核可三筆 confirmed 商品" : selectedStage === 5 ? "等待新候選的獨立核可" : selectedStage === 6 ? "等待後續公告與商品層級證據" : "保存案件判斷並等待下一段證據",
        latest_result: `已完成 Stage ${selectedStage} 回放狀態`,
        waiting_reason: selectedStage === 4 ? "任何 listing 狀態改變前必須由商品安全營運人員核可" : selectedStage === 5 ? "prod_007、prod_009 是新候選，不繼承 Stage 4 核可" : selectedStage === 6 ? "部分放行不會自動恢復既有下架商品" : null,
        next_action: selectedStage < 6 ? `注入 Stage ${selectedStage + 1} 證據` : "等待官方後續公告或人工決定",
        observed_at: now(),
        source: "saved_mock_observation",
      },
    },
    idempotency: {},
    stage4_executed: stage4Executed,
    stage4_executed_product_ids: stage4Executed ? [...STAGE4_REQUIRED_PRODUCT_IDS] : [],
  };
  return enrichState(state);
}

const traceField = (key, label, value, ref = null) => ({ key, label, value, ref });
const traceEvidence = (evidence_id, label, url = null, excerpt = null, stance = null) => ({ evidence_id, label, url, excerpt, stance });

function traceSnapshot(state, stage, overrides = {}) {
  const definition = stageDefinition(stage);
  const statuses = overrides.product_statuses || productsAtStage(stage, { stage4Executed: stage >= 5 });
  const claims = claimMapForStage(stage);
  const claimIds = overrides.claim_ids || definition.claim_ids;
  return {
    case_id: PRIMARY_CASE_ID,
    title: caseTitle(stage),
    version: overrides.version ?? definition.version,
    status: overrides.status || definition.status,
    business_impact: overrides.business_impact || definition.business_impact,
    priority: overrides.priority || definition.priority,
    owner: { type: "case_agent", id: "agent_food_safety" },
    claim_ids: [...claimIds],
    claims: claimIds.map((claimId) => {
      const sourceClaim = claims.get(claimId);
      return {
        claim_id: claimId,
        verification_status: sourceClaim?.verification_status || "insufficient_evidence",
        statement: sourceClaim?.normalized_statement || "尚未提供查核陳述",
        evidence_refs: (sourceClaim?.evidence || []).map((item) => item.evidence_id),
      };
    }),
    candidate_products: (overrides.candidate_products || definition.candidate_products).map((candidate) => ({
      product_id: candidate.product_id,
      relation: candidate.relation,
      reason: candidate.reason,
      missing_information: [...(candidate.missing_information || [])],
      product_status: candidate.product_status || statuses[candidate.product_id] || "active",
    })),
    unknowns: [...(overrides.unknowns || definition.unknowns)],
    next_steps: [...(overrides.next_steps || definition.next_steps)],
  };
}

function traceActivity({ activity_id, sequence, kind, title, summary, reason, actor, status = "completed", occurred_at, started_at = occurred_at, completed_at = occurred_at, input = [], output = [], source_refs = [], evidence = [], retry_of_activity_id = null, attempt = 1, error = null }) {
  return { activity_id, sequence, kind, title, summary, reason, actor, status, occurred_at, started_at, completed_at, input, output, source_refs, evidence, retry_of_activity_id, attempt, error };
}

function tracePhase({ phase_id, sequence, kind, title, summary, reason, actor, status, occurred_at, started_at, completed_at, input, output, source_refs, evidence, activities, case_before, case_after, pause_reason = null }) {
  return {
    phase_id, sequence, kind, title, summary, reason, actor, status, occurred_at, started_at, completed_at,
    progress: { completed_activities: activities.filter((activity) => ["completed", "succeeded"].includes(activity.status)).length, total_activities: activities.length },
    input, output, source_refs, evidence, activities, case_before, case_after, next_activity: null, next_phase: null, pause_reason,
  };
}

function addPhasePointers(phases) {
  phases.forEach((phase, index) => {
    const waiting = phase.activities.find((activity) => ["waiting", "ready"].includes(activity.status));
    phase.next_activity = waiting ? { id: waiting.activity_id, title: waiting.title, sequence: waiting.sequence } : null;
    const next = phases[index + 1];
    phase.next_phase = next ? { id: next.phase_id, title: next.title, sequence: next.sequence } : null;
  });
  return phases;
}

function traceReplay() {
  return { strategy: "ordered_phases", default_speed: 1, speed_options: [0.5, 1, 1.5, 2], pause_on_human: true, read_only: true, cursor_semantics: "client_revealed" };
}

function richMainTrace(state) {
  const gatherer = { type: "general_gatherer", id: "agent_signal_gatherer" };
  const caseAgent = { type: "case_agent", id: "agent_food_safety" };
  const employee = { type: "employee", id: "employee_ops_listing" };
  const simulation = { type: "simulation", id: "mock_platform" };
  const phaseData = [
    { title: "Stage 1｜弱訊號建案", kind: "intake", actor: gatherer, summary: "保留 post_001 原文，建立 pending／medium 案件。", reason: "來源單一且為二手轉述，個人味道經驗不可升格成食安證據。", source: ["sig_post_001"], status: "completed", activity: traceActivity({ activity_id: "main.stage1.read", sequence: 1, kind: "read", title: "讀取原始貼文", summary: "保存三種陳述：推測、個人經驗與詢問。", reason: "弱訊號仍值得追蹤，但證據不足。", actor: gatherer, occurred_at: "2026-06-30T05:21:00Z", input: [traceField("source_id", "來源", "post_001", "sig_post_001")], output: [traceField("claim_types", "陳述類型", "hypothesis / experience / request")], source_refs: ["sig_post_001"] }) },
    { title: "Stage 2｜純轉傳", kind: "verification", actor: caseAgent, summary: "保存 post_002 並連回 post_001，不重複查核。", reason: "repost 沒有新增獨立來源、新品牌、批號或可查核事實。", source: ["sig_post_002", "sig_post_001"], status: "completed", activity: traceActivity({ activity_id: "main.stage2.repost", sequence: 1, kind: "decision", title: "辨識 repost", summary: "把轉傳連回原始訊號。", reason: "不增加獨立來源數、不建立新案件。", actor: caseAgent, occurred_at: "2026-06-30T10:06:00Z", input: [traceField("source_relation", "來源關係", "repost"), traceField("duplicate_of", "原始來源", "post_001", "sig_post_001")], output: [traceField("action", "處理", "保存但略過重複查核")], source_refs: ["sig_post_002", "sig_post_001"] }) },
    { title: "Stage 3｜獨立回報升級", kind: "assessment", actor: caseAgent, summary: "新作者帶來福壽、中聯與 315-1150404，案件升為 risk／high。", reason: "新實體與批號改變查核與商品比對範圍。", source: ["sig_post_003"], status: "completed", activity: traceActivity({ activity_id: "main.stage3.assess", sequence: 1, kind: "tool", title: "更新案件判讀", summary: "把獨立回報與原始事件歸入同一案件。", reason: "同品類、同時間窗，且帶入新品牌、上游與批號。", actor: caseAgent, occurred_at: "2026-07-01T01:41:00Z", input: [traceField("source_id", "來源", "post_003", "sig_post_003")], output: [traceField("priority", "優先級", "high"), traceField("business_impact", "業務影響", "risk")], source_refs: ["sig_post_003", "clm_s3_fact_zhonglian"] }) },
    { title: "Stage 4｜官方證實與人工核可", kind: "approval", actor: employee, summary: "官方證據將範圍精確到三筆 confirmed，回放在人工核可點停住。", reason: "confirmed 不等於 delisted；改變 listing 前一定要由人核可。", source: ["sig_fda_20260701", "ev_s4_fda_20260701"], status: "waiting_human", activity: traceActivity({ activity_id: "main.stage4.approval.wait", sequence: 1, kind: "wait", title: "等待人工選取三筆商品", summary: "只允許 prod_001、prod_003、prod_005 進入 Stage 4 核可。", reason: "prod_002 缺批號，不能因品牌相同被核可。", actor: employee, status: "waiting", occurred_at: "2026-07-01T08:01:00Z", started_at: "2026-07-01T08:01:00Z", completed_at: null, input: [traceField("case_version", "案件版本", 4, PRIMARY_CASE_ID), traceField("eligible_product_ids", "可核可商品", "prod_001, prod_003, prod_005")], output: [traceField("approval_id", "核可 ID", null)], source_refs: [PRIMARY_CASE_ID, "prod_001", "prod_003", "prod_005"] }), evidence: [traceEvidence("ev_s4_fda_20260701", "中聯油脂原料批號 315-1150404 檢驗與流向公告（demo 前需逐字核對）", "https://www.fda.gov.tw/tc/newsContent.aspx?cid=4&id=t634379", "中聯油脂批號 315-1150404 大豆沙拉油約 1,300 公噸苯駢芘 8.1 μg/kg，超過限量 2.0；流向福懋、福壽、泰山，首波 15 項油品下架。", "supports") ] },
    { title: "Stage 5｜範圍擴大", kind: "assessment", actor: caseAgent, summary: "加工食品成為新候選，prod_007 與 prod_009 保持 active 並等待新的核可。", reason: "Stage 4 核可只綁定當時案件版本與三個商品，不會自動延伸。", source: ["sig_fda_20260707", "ev_s5_fda_20260707"], status: "completed", activity: traceActivity({ activity_id: "main.stage5.expand", sequence: 1, kind: "tool", title: "重排新增候選", summary: "保留三筆既有 delisted，新增兩筆 active candidate。", reason: "新案件版本需要新的人工核可；主線不執行可選核可。", actor: caseAgent, occurred_at: "2026-07-07T09:01:00Z", input: [traceField("evidence_id", "證據", "ev_s5_fda_20260707", "ev_s5_fda_20260707")], output: [traceField("new_candidates", "新候選", "prod_007, prod_009"), traceField("prior_approval", "舊核可", "not inherited")], source_refs: ["sig_fda_20260707", "prod_007", "prod_009"] }), evidence: [traceEvidence("ev_s5_fda_20260707", "使用受影響原料製成食品擴大下架公告（demo 前需逐字核對）", "https://www.fda.gov.tw/tc/newsContent.aspx?cid=4&id=t634443", "下架範圍擴大為所有使用受影響原料製成之食品，不論使用比例；前一日公告已擴為 360 家、18 項產品、30 批號。", "supports") ] },
    { title: "Stage 6｜部分批次放行", kind: "verification", actor: caseAgent, summary: "部分批次獲放行，只把回放映射的 prod_009 改為 excluded。", reason: "反駁證據只縮小部分範圍；不恢復 315-1150404 的商品或既有 delisted 狀態。", source: ["sig_cna_20260723", "ev_s6_cna_20260723"], status: "completed", activity: traceActivity({ activity_id: "main.stage6.release", sequence: 1, kind: "decision", title: "縮小候選範圍", summary: "保留 prod_007 candidate，排除模擬批號 315-1150411 的 prod_009。", reason: "中央社報導反駁所有擴大列管批次仍有問題，但該批號映射是回放資料。", actor: caseAgent, occurred_at: "2026-07-23T09:05:00Z", input: [traceField("evidence_id", "證據", "ev_s6_cna_20260723", "ev_s6_cna_20260723")], output: [traceField("excluded_product", "排除商品", "prod_009"), traceField("priority", "優先級", "high")], source_refs: ["sig_cna_20260723", "prod_009"] }), evidence: [traceEvidence("ev_s6_cna_20260723", "中聯油脂案　食藥署公布可重新上架501項產品清單（demo 前需逐字核對）", "https://www.cna.com.tw/news/ahel/202607230245.aspx", "全面檢驗結案後，除已知 7 批不合格油品外未新增問題批號；19 批合格油品製成的 501 項產品列入可重新上架清單。", "refutes") ] },
  ];
  const phases = phaseData.map((item, index) => {
    const stage = index + 1;
    const beforeStage = Math.max(stage - 1, 0);
    const beforeOptions = stage === 5 ? { status: "actioned", product_statuses: productsAtStage(4, { stage4Executed: true }) } : {};
    const afterOptions = stage === 4 ? {} : {};
    return tracePhase({
      phase_id: `main.stage${stage}`,
      sequence: stage,
      kind: item.kind,
      title: item.title,
      summary: item.summary,
      reason: item.reason,
      actor: item.actor,
      status: item.status,
      occurred_at: `2026-07-${String(Math.min(stage, 23)).padStart(2, "0")}T09:00:00Z`,
      started_at: `2026-07-${String(Math.min(stage, 23)).padStart(2, "0")}T09:00:00Z`,
      completed_at: item.status === "waiting_human" ? null : `2026-07-${String(Math.min(stage, 23)).padStart(2, "0")}T09:02:00Z`,
      input: item.source.map((ref) => traceField("source_ref", "輸入來源", ref, ref)),
      output: [traceField("stage", "回放舞台", stage, `stage_${stage}`)],
      source_refs: item.source,
      evidence: item.evidence || [],
      activities: [item.activity],
      case_before: traceSnapshot(state, beforeStage, beforeOptions),
      case_after: traceSnapshot(state, stage, afterOptions),
      pause_reason: item.status === "waiting_human" ? "任何 listing 狀態改變前需人工核可" : null,
    });
  });
  addPhasePointers(phases);
  const activities = phases.reduce((total, phase) => total + phase.activities.length, 0);
  return { trace_status: "saved", scenario: "main", recorded_at: "2026-07-23T09:05:00Z", phase_count: phases.length, activity_count: activities, contains_human_pause: true, replay: traceReplay(), phases };
}

function richFailureRetryTrace(state) {
  const employee = { type: "employee", id: "employee_ops_listing" };
  const simulation = { type: "simulation", id: "mock_platform" };
  const before = traceSnapshot(state, 5, { candidate_products: [{ product_id: "prod_007", relation: "candidate", reason: "宣告使用受影響原料，但需要商品層級確認", missing_information: ["product_level_confirmation"] }] });
  const after = traceSnapshot(state, 5, { status: "actioned", product_statuses: { ...productsAtStage(5), prod_007: "delisted" }, candidate_products: [{ product_id: "prod_007", relation: "candidate", reason: "隔離失敗情境中的模擬處置", missing_information: ["product_level_confirmation"], product_status: "delisted" }] });
  const failedActivityId = "retry.execute.attempt-1";
  const phases = addPhasePointers([
    tracePhase({ phase_id: "retry.approval", sequence: 1, kind: "approval", title: "讀取隔離情境核可", summary: "重試情境從既有的 Stage 5 模擬核可範圍開始。", reason: "此分支不改變主線的 Stage 4 核可或商品狀態。", actor: employee, status: "completed", occurred_at: "2026-07-07T09:10:00Z", started_at: "2026-07-07T09:10:00Z", completed_at: "2026-07-07T09:10:30Z", input: [traceField("product_id", "隔離商品", "prod_007", "prod_007")], output: [traceField("execution_id", "執行 ID", "exec_saved_retry")], source_refs: [PRIMARY_CASE_ID, "prod_007"], evidence: [], activities: [traceActivity({ activity_id: "retry.approval.read", sequence: 1, kind: "read", title: "讀取隔離核可", summary: "讀取同一商品與案件版本。", reason: "重試只更新同一筆 execution record。", actor: employee, occurred_at: "2026-07-07T09:10:30Z", input: [traceField("product_id", "商品 ID", "prod_007", "prod_007")], output: [traceField("execution_id", "執行 ID", "exec_saved_retry")], source_refs: ["prod_007"] })], case_before: before, case_after: before }),
    tracePhase({ phase_id: "retry.failed", sequence: 2, kind: "execution", title: "第一次模擬執行失敗", summary: "模擬平台回傳暫時性錯誤，商品維持上架。", reason: "錯誤與 attempts=1 保留，不能顯示成成功。", actor: simulation, status: "failed", occurred_at: "2026-07-07T09:11:00Z", started_at: "2026-07-07T09:11:00Z", completed_at: "2026-07-07T09:11:10Z", input: [traceField("execution_id", "執行 ID", "exec_saved_retry")], output: [traceField("status", "狀態", "failed"), traceField("product_status", "商品狀態", "active")], source_refs: ["exec_saved_retry", "prod_007"], evidence: [], activities: [traceActivity({ activity_id: failedActivityId, sequence: 1, kind: "tool", title: "呼叫模擬平台", summary: "第一次嘗試回傳暫時性錯誤。", reason: "保留錯誤與上架狀態。", actor: simulation, status: "failed", occurred_at: "2026-07-07T09:11:10Z", started_at: "2026-07-07T09:11:00Z", completed_at: "2026-07-07T09:11:10Z", input: [traceField("product_id", "商品 ID", "prod_007", "prod_007")], output: [traceField("status", "執行狀態", "failed")], source_refs: ["exec_saved_retry", "prod_007"], error: "模擬平台暫時拒絕下架，請保留錯誤並重試。" })], case_before: before, case_after: before }),
    tracePhase({ phase_id: "retry.succeeded", sequence: 3, kind: "retry", title: "重試同一執行並完成", summary: "第二次嘗試更新原執行紀錄，隔離商品完成模擬下架。", reason: "retry_of_activity_id 指向第一次失敗，不產生重複執行。", actor: simulation, status: "succeeded", occurred_at: "2026-07-07T09:12:00Z", started_at: "2026-07-07T09:12:00Z", completed_at: "2026-07-07T09:12:10Z", input: [traceField("execution_id", "原執行 ID", "exec_saved_retry"), traceField("attempt", "嘗試次數", 2)], output: [traceField("status", "狀態", "succeeded"), traceField("product_status", "商品狀態", "delisted")], source_refs: ["exec_saved_retry", "prod_007"], evidence: [], activities: [traceActivity({ activity_id: "retry.execute.attempt-2", sequence: 1, kind: "retry", title: "重試同一執行紀錄", summary: "第二次嘗試成功，更新原執行紀錄。", reason: "同一商品只保留一筆可追溯執行紀錄。", actor: simulation, status: "succeeded", occurred_at: "2026-07-07T09:12:10Z", started_at: "2026-07-07T09:12:00Z", completed_at: "2026-07-07T09:12:10Z", input: [traceField("execution_id", "執行 ID", "exec_saved_retry")], output: [traceField("status", "執行狀態", "succeeded")], source_refs: ["exec_saved_retry", "prod_007"], retry_of_activity_id: failedActivityId, attempt: 2 })], case_before: before, case_after: after }),
  ]);
  return { trace_status: "saved", scenario: "failure_retry", recorded_at: "2026-07-07T09:12:10Z", phase_count: phases.length, activity_count: 3, contains_human_pause: false, replay: traceReplay(), phases };
}

function enrichState(state) {
  if (!Array.isArray(state.traces)) state.traces = [];
  if (!Array.isArray(state.stage4_executed_product_ids)) {
    state.stage4_executed_product_ids = state.executions?.filter((execution) => execution.status === "succeeded" && STAGE4_REQUIRED_PRODUCT_IDS.includes(execution.product_id)).map((execution) => execution.product_id) ?? [];
  }
  state.stage4_executed_product_ids = [...new Set(state.stage4_executed_product_ids)];
  state.stage4_executed = STAGE4_REQUIRED_PRODUCT_IDS.every((productId) => state.stage4_executed_product_ids.includes(productId));
  state.traces.forEach((trace) => {
    const rich = trace.trace_id === "trace_oil_main" ? richMainTrace(state) : trace.trace_id === "trace_failure_retry" ? richFailureRetryTrace(state) : null;
    if (rich) Object.assign(trace, rich);
  });
  state.schema_version = CURRENT_SCHEMA_VERSION;
  return state;
}

async function preserveLegacyState(statePath) {
  const backupPath = `${statePath}.legacy-${Date.now()}.json`;
  try {
    await fs.rename(statePath, backupPath);
  } catch {
    await fs.copyFile(statePath, backupPath);
  }
  console.warn(`[mock] preserved incompatible state at ${backupPath}; starting ${PRIMARY_DATASET_ID}`);
}

async function readState(statePath) {
  try {
    const content = await fs.readFile(statePath, "utf8");
    const parsed = JSON.parse(content);
    if (!parsed || parsed.dataset_id !== PRIMARY_DATASET_ID || ![1, CURRENT_SCHEMA_VERSION].includes(parsed.schema_version)) {
      await preserveLegacyState(statePath);
      const fresh = initialState();
      await writeState(statePath, fresh);
      return fresh;
    }
    const previousVersion = parsed.schema_version;
    const state = enrichState(parsed);
    if (previousVersion !== CURRENT_SCHEMA_VERSION || !state.provenance || state.demo_stage === undefined) await writeState(statePath, state);
    return state;
  } catch (error) {
    if (error?.code !== "ENOENT") {
      console.warn(`[mock] preserving unreadable state before reset: ${error.message}`);
      try { await preserveLegacyState(statePath); } catch (preserveError) { console.warn(`[mock] could not preserve unreadable state: ${preserveError.message}`); }
    }
    const state = initialState();
    await writeState(statePath, state);
    return state;
  }
}

async function writeState(statePath, state) {
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  const temporary = `${statePath}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await fs.rename(temporary, statePath);
}

function send(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(payload), "cache-control": "no-store", "access-control-allow-origin": "*" });
  response.end(payload);
}

async function readJson(request) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > 32_000) throw Object.assign(new Error("Request body too large"), { code: "request_too_large" });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw Object.assign(new Error("Request body must be valid JSON"), { code: "invalid_json" }); }
}

const listResponse = (items) => ({ items, next_cursor: null });
const findCase = (state, caseId) => state.cases.find((item) => item.case_id === caseId);
const findApproval = (state, approvalId) => state.approvals.find((item) => item.approval_id === approvalId);

function recordIdempotent(state, method, pathname, key, body, status) {
  if (key) state.idempotency[`${method}:${pathname}:${key}`] = { body: clone(body), status };
}

function replayIdempotent(state, method, pathname, key) {
  if (!key) return null;
  const entry = state.idempotency[`${method}:${pathname}:${key}`];
  return entry ? { status: entry.status, body: clone(entry.body) } : null;
}

function requireIdempotency(request) {
  const key = request.headers["idempotency-key"];
  return typeof key === "string" && key.trim() ? key.trim() : null;
}

function addTimeline(state, caseId, kind, summary, reason, sourceRefs, actor) {
  const current = findCase(state, caseId);
  const timeline = state.timelines[caseId] || (state.timelines[caseId] = []);
  const item = { timeline_id: id("tl"), case_id: caseId, case_version: current?.version ?? 0, kind, occurred_at: now(), summary, reason, source_refs: sourceRefs, actor };
  timeline.push(item);
  if (current) current.updated_at = item.occurred_at;
  return item;
}

function caseSummary(item, state) {
  const agent = state.agent_status[item.case_id] || null;
  return { ...clone(item), latest_change: state.timelines[item.case_id]?.at(-1)?.summary ?? null, next_check_at: item.monitoring_plan?.next_check_at ?? null, agent_state: agent?.state ?? null };
}

function refreshAgent(state) {
  const stage = state.demo_stage;
  const agent = state.agent_status[PRIMARY_CASE_ID];
  if (!agent) return;
  agent.state = stage === 4 || stage === 5 ? "waiting_human" : stage === 6 || stage === 3 ? "waiting_follow_up" : "running";
  agent.current_step = stage === 4 ? "等待員工核可三筆 confirmed 商品" : stage === 5 ? "等待新候選的獨立核可" : stage === 6 ? "等待後續公告與商品層級證據" : `已完成 Stage ${stage}，等待下一段證據`;
  agent.latest_result = `已完成 Stage ${stage} 回放狀態`;
  agent.waiting_reason = stage === 4 ? "任何 listing 狀態改變前必須由商品安全營運人員核可" : stage === 5 ? "prod_007、prod_009 是新候選，不繼承 Stage 4 核可" : stage === 6 ? "部分放行不會自動恢復既有下架商品" : null;
  agent.next_action = stage < 6 ? `注入 Stage ${stage + 1} 證據` : "等待官方後續公告或人工決定";
  agent.observed_at = now();
}

function validateProductSelection(state, current, productIds) {
  if (!Array.isArray(productIds) || productIds.length < 1) return "至少選擇一個模擬商品";
  const unique = [...new Set(productIds)];
  if (state.demo_stage === 4) {
    const eligible = new Set(["prod_001", "prod_003", "prod_005"]);
    const invalid = unique.find((productId) => !eligible.has(productId));
    if (invalid) return `Stage 4 只有 prod_001、prod_003、prod_005 可核可；${invalid} 仍需補證或不在本次範圍`;
  }
  const candidates = new Map((current.candidate_products || []).map((item) => [item.product_id, item]));
  for (const productId of unique) {
    const candidate = candidates.get(productId);
    const product = state.products.find((item) => item.product_id === productId);
    if (!candidate || candidate.relation === "excluded" || !product) return `商品 ${productId} 不是本案件可核可的候選商品`;
    if (state.demo_stage === 4 && candidate.relation !== "confirmed") return `商品 ${productId} 在 Stage 4 尚未獲官方確認，不可核可`;
    if (!product.is_simulated) return `商品 ${productId} 不是模擬商品`;
    if (product.status !== "active") return `商品 ${productId} 已經不是上架狀態`;
  }
  return null;
}

function executeApproval(state, approval) {
  const current = findCase(state, approval.case_id);
  if (!current) return { status: 404, body: errorBody("not_found", "找不到案件") };
  if (approval.case_version !== current.version) return { status: 409, body: errorBody("version_conflict", "案件已更新，這筆核可已失效，請依最新版本重新確認。", { approval_case_version: approval.case_version, current_case_version: current.version }) };
  const executions = [];
  let succeeded = 0;
  let failed = 0;
  for (const productId of approval.product_ids) {
    const product = state.products.find((item) => item.product_id === productId);
    if (!product) continue;
    let execution = state.executions.find((item) => item.approval_id === approval.approval_id && item.product_id === productId);
    if (!execution) {
      execution = { execution_id: id("exec"), approval_id: approval.approval_id, product_id: productId, status: "pending", error: null, executed_at: null, attempts: 0 };
      state.executions.push(execution);
    }
    if (execution.status === "succeeded") { succeeded += 1; executions.push(execution); continue; }
    execution.attempts += 1;
    execution.executed_at = now();
    if (product.failure_mode === "fail_once" && execution.attempts === 1) {
      execution.status = "failed";
      execution.error = "模擬平台暫時拒絕下架，請保留錯誤並重試。";
      failed += 1;
      addTimeline(state, approval.case_id, "action_executed", `${product.name} 第一次模擬下架失敗。`, execution.error, [execution.execution_id], { type: "simulation", id: "mock_platform" });
    } else {
      execution.status = "succeeded";
      execution.error = null;
      if (product.status === "active") { product.status = "delisted"; product.version += 1; }
      succeeded += 1;
      addTimeline(state, approval.case_id, "action_executed", `${product.name} 已完成模擬下架。`, "使用者核可的商品與案件版本有效。", [execution.execution_id], { type: "simulation", id: "mock_platform" });
    }
    const candidate = current.candidate_products?.find((item) => item.product_id === productId);
    if (candidate) candidate.product_status = product.status;
    executions.push(execution);
  }
  if (succeeded > 0) current.status = "actioned";
  else if (failed > 0) current.status = "awaiting_approval";
  if (state.demo_stage === 4 && succeeded > 0) {
    for (const productId of approval.product_ids) {
      const product = state.products.find((item) => item.product_id === productId);
      if (product?.status === "delisted" && STAGE4_REQUIRED_PRODUCT_IDS.includes(productId)) state.stage4_executed_product_ids.push(productId);
    }
    state.stage4_executed_product_ids = [...new Set(state.stage4_executed_product_ids)];
    state.stage4_executed = STAGE4_REQUIRED_PRODUCT_IDS.every((productId) => state.stage4_executed_product_ids.includes(productId));
  }
  return { status: 200, body: { approval: clone(approval), executions: clone(executions), case: clone(current), summary: { succeeded, failed, total: executions.length } } };
}

function applyStage(state, nextStage) {
  const current = findCase(state, PRIMARY_CASE_ID);
  const stage4Executed = state.stage4_executed === true;
  const next = caseForStage(nextStage, { stage4Executed });
  Object.assign(current, next, { updated_at: now() });
  state.demo_stage = nextStage;
  state.signals = buildSignals(nextStage);
  state.products.forEach((product) => {
    if (stage4Executed && nextStage >= 5 && STAGE4_REQUIRED_PRODUCT_IDS.includes(product.product_id)) {
      product.status = "delisted";
      product.version = Math.max(product.version, 2);
    }
  });
  state.stage4_executed = stage4Executed;
  state.provenance = primaryProvenance();
  addTimeline(state, PRIMARY_CASE_ID, stageTimelineItem(nextStage).kind, stageTimelineItem(nextStage).summary, stageTimelineItem(nextStage).reason, stageTimelineItem(nextStage).source_refs, stageTimelineItem(nextStage).actor);
  refreshAgent(state);
}

async function createHandler({ statePath }) {
  const state = await readState(statePath);
  let writing = Promise.resolve();
  const persist = () => { writing = writing.then(() => writeState(statePath, state)); return writing; };
  return async (request, response) => {
    const url = new URL(request.url, "http://localhost");
    const pathname = url.pathname.replace(/\/$/, "") || "/";
    const method = request.method || "GET";
    if (method === "OPTIONS") { response.writeHead(204, { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type,idempotency-key", "access-control-allow-methods": "GET,POST,OPTIONS" }); response.end(); return; }
    if (method === "GET" && pathname === "/healthz") { send(response, 200, { status: "ok", database: "ok", mode: "mock" }); return; }
    if (!pathname.startsWith("/api/v1")) { send(response, 404, errorBody("not_found", "Mock service only serves /api/v1 endpoints")); return; }
    const key = method === "POST" ? requireIdempotency(request) : null;
    if (method === "POST" && pathname !== "/api/v1/mock/reset" && !key) { send(response, 400, errorBody("idempotency_key_required", "寫入請求需要 Idempotency-Key")); return; }
    const replay = method === "POST" ? replayIdempotent(state, method, pathname, key) : null;
    if (replay) { send(response, replay.status, replay.body); return; }
    let body = {};
    if (method === "POST") {
      try { body = await readJson(request); } catch (error) { send(response, error.code === "request_too_large" ? 413 : 400, errorBody(error.code || "invalid_json", error.message)); return; }
    }
    const caseMatch = pathname.match(/^\/api\/v1\/cases\/([^/]+)$/);
    const timelineMatch = pathname.match(/^\/api\/v1\/cases\/([^/]+)\/timeline$/);
    const agentMatch = pathname.match(/^\/api\/v1\/cases\/([^/]+)\/agent-status$/);
    const approvalMatch = pathname.match(/^\/api\/v1\/cases\/([^/]+)\/approvals$/);
    const advanceMatch = pathname.match(/^\/api\/v1\/cases\/([^/]+)\/advance$/);
    const executeMatch = pathname.match(/^\/api\/v1\/approvals\/([^/]+)\/execute$/);
    const traceMatch = pathname.match(/^\/api\/v1\/traces\/([^/]+)$/);
    let result;
    try {
      if (method === "GET" && pathname === "/api/v1/mock/status") {
        result = { status: 200, body: { stage: state.demo_stage, default_stage: DEFAULT_STAGE, scenario: state.demo_scenario, mode: "mock", dataset_id: state.dataset_id, provenance: clone(state.provenance), approvals: state.approvals.length, executions: state.executions.length } };
      } else if (method === "GET" && pathname === "/api/v1/cases") {
        result = { status: 200, body: listResponse(state.demo_stage === 0 ? [] : state.cases.map((item) => caseSummary(item, state))) };
      } else if (method === "GET" && caseMatch) {
        const current = findCase(state, caseMatch[1]); result = current ? { status: 200, body: clone(current) } : { status: 404, body: errorBody("not_found", "找不到案件") };
      } else if (method === "GET" && timelineMatch) {
        const current = findCase(state, timelineMatch[1]); result = current ? { status: 200, body: listResponse(clone(state.timelines[current.case_id] || [])) } : { status: 404, body: errorBody("not_found", "找不到案件") };
      } else if (method === "GET" && agentMatch) {
        const agent = state.agent_status[agentMatch[1]]; result = agent ? { status: 200, body: clone(agent) } : { status: 404, body: errorBody("not_found", "找不到案件專員狀態") };
      } else if (method === "GET" && approvalMatch) {
        const current = findCase(state, approvalMatch[1]); result = current ? { status: 200, body: listResponse(state.approvals.filter((item) => item.case_id === current.case_id).map((item) => ({ ...clone(item), executions: clone(state.executions.filter((execution) => execution.approval_id === item.approval_id)) }))) } : { status: 404, body: errorBody("not_found", "找不到案件") };
      } else if (method === "GET" && pathname === "/api/v1/products") {
        result = { status: 200, body: listResponse(clone(state.products)) };
      } else if (method === "GET" && pathname === "/api/v1/signals") {
        result = { status: 200, body: listResponse(clone(state.signals)) };
      } else if (method === "GET" && pathname === "/api/v1/traces") {
        result = { status: 200, body: listResponse(state.traces.map(({ steps, phases, ...trace }) => clone(trace))) };
      } else if (method === "GET" && traceMatch) {
        const trace = state.traces.find((item) => item.trace_id === traceMatch[1]); result = trace ? { status: 200, body: clone(trace) } : { status: 404, body: errorBody("not_found", "找不到保存的 trace") };
      } else if (method === "POST" && approvalMatch) {
        const current = findCase(state, approvalMatch[1]);
        if (!current) result = { status: 404, body: errorBody("not_found", "找不到案件") };
        else if (body.case_version !== current.version) result = { status: 409, body: errorBody("version_conflict", "案件版本已更新，請重新查看後再核可。", { current_case_version: current.version }) };
        else {
          const productError = validateProductSelection(state, current, body.product_ids);
          if (productError) result = { status: 422, body: errorBody("invalid_selection", productError) };
          else {
            const approval = { approval_id: id("apr"), case_id: current.case_id, case_version: current.version, product_ids: [...new Set(body.product_ids)], status: "approved", approved_by: typeof body.approved_by === "string" && body.approved_by.trim() ? body.approved_by.trim() : "employee_ops_listing", approved_at: now() };
            state.approvals.push(approval);
            current.status = "awaiting_approval";
            addTimeline(state, current.case_id, "approval_recorded", `已核可 ${approval.product_ids.length} 項模擬商品，等待明確執行。`, "核可只適用於目前案件版本與這次選定商品。", approval.product_ids, { type: "employee", id: approval.approved_by });
            result = { status: 201, body: { approval: clone(approval), case: clone(current) } };
          }
        }
      } else if (method === "POST" && executeMatch) {
        const approval = findApproval(state, executeMatch[1]); result = approval ? executeApproval(state, approval) : { status: 404, body: errorBody("not_found", "找不到核可紀錄") };
      } else if (method === "POST" && advanceMatch) {
        const current = findCase(state, advanceMatch[1]);
        if (!current) result = { status: 404, body: errorBody("not_found", "找不到案件") };
        else if (state.demo_stage >= 6) result = { status: 409, body: errorBody("stage_complete", "六段回放已完成，請重置後再開始。") };
        else if (state.demo_stage === 4 && !state.stage4_executed) {
          const missingProductIds = STAGE4_REQUIRED_PRODUCT_IDS.filter((productId) => !state.stage4_executed_product_ids.includes(productId));
          result = { status: 409, body: errorBody("stage_gate_required", "Stage 4 必須先核可並明確執行 prod_001、prod_003、prod_005，才能進入 Stage 5。", { required_product_ids: [...STAGE4_REQUIRED_PRODUCT_IDS], missing_product_ids: missingProductIds }) };
        }
        else {
          const previousVersion = current.version;
          applyStage(state, state.demo_stage + 1);
          result = { status: 200, body: { case: clone(current), previous_version: previousVersion, stage: state.demo_stage } };
        }
      } else if (method === "POST" && pathname === "/api/v1/mock/reset") {
        const requestedStage = safeStage(body.stage, DEFAULT_STAGE);
        if ((state.approvals.length || state.executions.length) && body.confirm !== true) result = { status: 409, body: errorBody("reset_requires_confirmation", "已有核可或執行紀錄；請明確確認後再重置，以免誤刪展示紀錄。", { approvals: state.approvals.length, executions: state.executions.length }) };
        else {
          const reset = initialState({ stage: requestedStage, scenario: body.scenario });
          Object.keys(state).forEach((keyName) => delete state[keyName]);
          Object.assign(state, reset);
          result = { status: 200, body: { status: "reset", mode: "mock", stage: requestedStage, scenario: state.demo_scenario, dataset_id: state.dataset_id } };
        }
      } else result = { status: 404, body: errorBody("not_found", "找不到 mock endpoint") };
    } catch (error) {
      console.error("[mock] request failed", error);
      result = { status: 500, body: errorBody("mock_error", "Mock service 發生未預期錯誤") };
    }
    if (method === "POST" && result.status < 500 && pathname !== "/api/v1/mock/reset") recordIdempotent(state, method, pathname, key, result.body, result.status);
    if (method === "POST" && result.status < 500) await persist();
    send(response, result.status, result.body);
  };
}

export async function createMockServer({ statePath = process.env.MOCK_STATE_PATH || DEFAULT_STATE_PATH, port = 0 } = {}) {
  const handler = await createHandler({ statePath });
  const server = createServer((request, response) => { handler(request, response).catch((error) => { console.error("[mock] handler failed", error); send(response, 500, errorBody("mock_error", "Mock service 發生未預期錯誤")); }); });
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  const address = server.address();
  return { server, url: `http://127.0.0.1:${address.port}`, statePath };
}

export const mockDefaults = { defaultStage: DEFAULT_STAGE, defaultStatePath: DEFAULT_STATE_PATH, datasetId: PRIMARY_DATASET_ID, caseId: PRIMARY_CASE_ID, replayWindow: REPLAY_WINDOW, sourceDir: here };

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { url } = await createMockServer({ port: PORT });
  console.log(`[mock] listening at ${url}`);
  console.log(`[mock] state: ${process.env.MOCK_STATE_PATH || DEFAULT_STATE_PATH}`);
}
