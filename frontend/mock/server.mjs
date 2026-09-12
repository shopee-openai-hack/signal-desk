import { createServer } from "node:http";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_STATE_PATH = path.join(os.tmpdir(), "shopee-openai-hack-mock-state.json");
const PORT = Number(process.env.MOCK_PORT || 4100);
const CURRENT_SCHEMA_VERSION = 2;

const now = () => new Date().toISOString();
const id = (prefix) => `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
const clone = (value) => JSON.parse(JSON.stringify(value));

function errorBody(code, message, details = {}) {
  return { error: { code, message, details } };
}

function initialState() {
  const timestamps = {
    first: "2026-09-12T02:00:00.000Z",
    second: "2026-09-12T02:05:00.000Z",
    third: "2026-09-12T02:12:00.000Z",
    fourth: "2026-09-12T02:20:00.000Z",
  };
  const state = {
    schema_version: CURRENT_SCHEMA_VERSION,
    cases: [
      {
        case_id: "case_oil_safety",
        version: 3,
        title: "食用油安全疑慮：品牌與批次待查",
        status: "awaiting_approval",
        business_impact: "risk",
        priority: "high",
        priority_reasons: ["可能涉及消費者安全", "平台上存在品牌相符的模擬商品"],
        owner: { type: "case_agent", id: "agent_food_safety" },
        claim_ids: ["clm_oil_001", "clm_oil_002"],
        unknowns: ["受影響批次尚未確認", "官方公告的適用範圍仍需比對"],
        next_steps: ["確認員工要處理的模擬商品", "持續追蹤官方食安公告"],
        monitoring_plan: {
          targets: ["金橘食品", "官方食安公告"],
          next_check_at: "2026-09-12T03:00:00.000Z",
          reason: "高潛在傷害但證據與批次仍不完整",
        },
        candidate_products: [
          {
            product_id: "prod_oil_001",
            relation: "candidate",
            reason: "品牌名稱相符；批次未知",
            missing_information: ["batch"],
          },
          {
            product_id: "prod_oil_002",
            relation: "candidate",
            reason: "同品牌不同容量；需確認供應批次",
            missing_information: ["batch", "seller_confirmation"],
          },
          {
            product_id: "prod_oil_003",
            relation: "excluded",
            reason: "品牌與來源不符，保留在案件中供追溯",
            missing_information: [],
          },
        ],
        updated_at: timestamps.third,
      },
      {
        case_id: "case_logistics_watch",
        version: 1,
        title: "進口原料物流延遲觀察",
        status: "monitoring",
        business_impact: "pending",
        priority: "medium",
        priority_reasons: ["單一來源回報，尚無明確平台影響"],
        owner: { type: "case_agent", id: "agent_supply_watch" },
        claim_ids: ["clm_logistics_001"],
        unknowns: ["是否影響平台賣家庫存尚待確認"],
        next_steps: ["比對其他獨立回報", "下一次追蹤後再評估影響"],
        monitoring_plan: {
          targets: ["進口原料", "物流公告"],
          next_check_at: "2026-09-12T05:00:00.000Z",
          reason: "目前證據不足，維持一般追蹤",
        },
        candidate_products: [],
        updated_at: timestamps.second,
      },
    ],
    signals: [
      {
        signal_id: "sig_oil_001",
        source: {
          provider: "threads",
          source_id: "post_demo_oil_001",
          url: "https://example.test/threads/post_demo_oil_001",
          author_ref: null,
          published_at: timestamps.first,
          retrieved_at: "2026-09-12T02:01:00.000Z",
          raw_text: "有人說最近買到的金橘食品食用油有異味，想知道是不是同一批次。",
          retrieval_status: "succeeded",
        },
        source_relation: "original",
        duplicate_of_signal_id: null,
        case_id: "case_oil_safety",
        claims: [
          {
            claim_id: "clm_oil_001",
            signal_id: "sig_oil_001",
            kind: "experience",
            quote: "最近買到的金橘食品食用油有異味",
            normalized_statement: "有人回報金橘食品食用油可能有異味",
            entities: [{ type: "brand", name: "金橘食品" }],
            scope: { region: null, batch: null, time_window: null },
            verification_status: "insufficient_evidence",
            evidence: [],
          },
        ],
      },
      {
        signal_id: "sig_oil_002",
        source: {
          provider: "threads",
          source_id: "post_demo_oil_002",
          url: "https://example.test/threads/post_demo_oil_002",
          author_ref: null,
          published_at: timestamps.second,
          retrieved_at: "2026-09-12T02:06:00.000Z",
          raw_text: "轉貼：請先不要把上次的回報當成官方確認，批次還沒找到。",
          retrieval_status: "succeeded",
        },
        source_relation: "repost",
        duplicate_of_signal_id: "sig_oil_001",
        case_id: "case_oil_safety",
        claims: [
          {
            claim_id: "clm_oil_002",
            signal_id: "sig_oil_002",
            kind: "request",
            quote: "請先不要把上次的回報當成官方確認",
            normalized_statement: "原始回報尚未形成官方確認",
            entities: [{ type: "brand", name: "金橘食品" }],
            scope: { region: null, batch: null, time_window: null },
            verification_status: "supported",
            evidence: [
              {
                evidence_id: "evidence_oil_001",
                claim_id: "clm_oil_002",
                url: "https://example.test/evidence/official-check",
                title: "目前沒有對應批次的官方公告",
                publisher: "Demo Food Safety Desk",
                published_at: timestamps.third,
                retrieved_at: timestamps.third,
                excerpt: "查詢結果尚未找到可對應品牌與批次的公告。",
                stance: "context_only",
              },
            ],
          },
        ],
      },
      {
        signal_id: "sig_logistics_001",
        source: {
          provider: "threads",
          source_id: "post_demo_logistics_001",
          url: "https://example.test/threads/post_demo_logistics_001",
          author_ref: null,
          published_at: timestamps.second,
          retrieved_at: "2026-09-12T02:07:00.000Z",
          raw_text: "港口延遲可能影響下週的進口原料，還在等其他賣家回報。",
          retrieval_status: "succeeded",
        },
        source_relation: "independent_report",
        duplicate_of_signal_id: null,
        case_id: "case_logistics_watch",
        claims: [
          {
            claim_id: "clm_logistics_001",
            signal_id: "sig_logistics_001",
            kind: "hypothesis",
            quote: "可能影響下週的進口原料",
            normalized_statement: "港口延遲可能影響進口原料供應",
            entities: [{ type: "category", name: "進口原料" }],
            scope: { region: null, batch: null, time_window: "下週" },
            verification_status: "insufficient_evidence",
            evidence: [],
          },
        ],
      },
    ],
    products: [
      {
        product_id: "prod_oil_001",
        name: "金橘初榨橄欖油 1L",
        brand: "金橘食品",
        batch: null,
        seller_id: "seller_demo_a",
        status: "active",
        version: 1,
        is_simulated: true,
        failure_mode: null,
      },
      {
        product_id: "prod_oil_002",
        name: "金橘純芝麻油 500ml",
        brand: "金橘食品",
        batch: null,
        seller_id: "seller_demo_b",
        status: "active",
        version: 1,
        is_simulated: true,
        failure_mode: "fail_once",
      },
      {
        product_id: "prod_oil_003",
        name: "山茶花冷壓油 500ml",
        brand: "山茶花農產",
        batch: "SC-2026-08",
        seller_id: "seller_demo_c",
        status: "active",
        version: 1,
        is_simulated: true,
        failure_mode: null,
      },
    ],
    timelines: {
      case_oil_safety: [
        {
          timeline_id: "tl_oil_001",
          case_id: "case_oil_safety",
          case_version: 1,
          kind: "signal_added",
          occurred_at: timestamps.first,
          summary: "收到消費者對金橘食品食用油的異味回報。",
          reason: "保留原始經驗，尚未把回報當作已確認事實。",
          source_refs: ["sig_oil_001"],
          actor: { type: "general_gatherer", id: "agent_signal_gatherer" },
        },
        {
          timeline_id: "tl_oil_002",
          case_id: "case_oil_safety",
          case_version: 2,
          kind: "verification_updated",
          occurred_at: timestamps.second,
          summary: "發現重複轉傳，沿用原始來源脈絡。",
          reason: "轉傳沒有新增可查核陳述，因此不重複派工。",
          source_refs: ["sig_oil_002", "sig_oil_001"],
          actor: { type: "case_agent", id: "agent_food_safety" },
        },
        {
          timeline_id: "tl_oil_003",
          case_id: "case_oil_safety",
          case_version: 3,
          kind: "assessment_updated",
          occurred_at: timestamps.third,
          summary: "維持高優先級，將兩項模擬商品列為候選，證據仍不足。",
          reason: "潛在傷害高，但批次與官方公告範圍尚未確認；需要員工確認處置範圍。",
          source_refs: ["clm_oil_001", "clm_oil_002"],
          actor: { type: "case_agent", id: "agent_food_safety" },
        },
      ],
      case_logistics_watch: [
        {
          timeline_id: "tl_logistics_001",
          case_id: "case_logistics_watch",
          case_version: 1,
          kind: "monitoring_updated",
          occurred_at: timestamps.second,
          summary: "建立一般追蹤，等待獨立回報。",
          reason: "目前只有單一假說，尚未看到具體商品或庫存影響。",
          source_refs: ["sig_logistics_001"],
          actor: { type: "case_agent", id: "agent_supply_watch" },
        },
      ],
    },
    approvals: [],
    executions: [],
    traces: [
      {
        trace_id: "trace_oil_main",
        name: "食用油安全疑慮｜完整主線",
        description: "從弱訊號、重複轉傳到人工確認候選商品的保存紀錄。",
        mode: "saved_mock",
        case_id: "case_oil_safety",
        steps: [
          {
            step_id: "step_01",
            sequence: 1,
            kind: "signal_added",
            title: "訊號進入收件匣",
            summary: "收到消費者的異味經驗，先保留原文與來源。",
            reason: "尚未有官方證據，不把經驗當作確定事實。",
            actor: { type: "general_gatherer", id: "訊號蒐集" },
            status: "completed",
            input_refs: ["sig_oil_001"],
            case_before: { version: 0, status: "new" },
            case_after: { version: 1, status: "investigating" },
          },
          {
            step_id: "step_02",
            sequence: 2,
            kind: "dispatch",
            title: "分派給食安案件專員",
            summary: "建立案件並交由 food safety case agent 承接。",
            reason: "訊號能連到具體品牌，需要持續保留脈絡。",
            actor: { type: "brain", id: "案件 dispatcher" },
            status: "completed",
            input_refs: ["case_oil_safety"],
            case_before: { version: 1, status: "investigating" },
            case_after: { version: 1, status: "investigating" },
          },
          {
            step_id: "step_03",
            sequence: 3,
            kind: "verification",
            title: "辨識轉傳與證據不足",
            summary: "同一事件的轉傳不重複查核，批次仍標示未知。",
            reason: "轉傳沒有新增獨立事實；查詢結果也未形成批次確認。",
            actor: { type: "case_agent", id: "案件專員" },
            status: "completed",
            input_refs: ["sig_oil_002", "clm_oil_002"],
            case_before: { version: 1, status: "investigating" },
            case_after: { version: 3, status: "awaiting_approval" },
          },
          {
            step_id: "step_04",
            sequence: 4,
            kind: "approval",
            title: "等待人工核可",
            summary: "員工從候選商品中選擇要執行的模擬下架對象。",
            reason: "候選關聯不等於商品已被證實有問題，需由員工確認範圍。",
            actor: { type: "employee", id: "人工核可" },
            status: "waiting_human",
            input_refs: ["prod_oil_001", "prod_oil_002"],
            case_before: { version: 3, status: "awaiting_approval" },
            case_after: { version: 3, status: "awaiting_approval" },
          },
          {
            step_id: "step_05",
            sequence: 5,
            kind: "execution",
            title: "模擬下架並留下結果",
            summary: "執行結果逐項保存；失敗的項目可以重試。",
            reason: "核可只適用於當次選定商品與案件版本。",
            actor: { type: "simulation", id: "模擬平台" },
            status: "ready",
            input_refs: ["case_oil_safety"],
            case_before: { version: 3, status: "awaiting_approval" },
            case_after: { version: 3, status: "actioned" },
          },
        ],
      },
      {
        trace_id: "trace_failure_retry",
        name: "模擬執行失敗｜重試主線",
        description: "保存一個先失敗、再以相同執行紀錄重試成功的例外情境。",
        mode: "saved_mock",
        case_id: "case_oil_safety",
        steps: [
          {
            step_id: "failure_01",
            sequence: 1,
            kind: "execution",
            title: "第一次執行失敗",
            summary: "模擬平台回傳暫時性錯誤，商品維持上架。",
            reason: "失敗不被轉成成功提示，執行紀錄保留錯誤。",
            actor: { type: "simulation", id: "模擬平台" },
            status: "failed",
            input_refs: ["prod_oil_002"],
            case_before: { version: 3, status: "awaiting_approval" },
            case_after: { version: 3, status: "awaiting_approval" },
          },
          {
            step_id: "failure_02",
            sequence: 2,
            kind: "execution",
            title: "重試同一執行",
            summary: "第二次嘗試更新原執行紀錄，成功後不產生重複下架。",
            reason: "同一核可與商品只保留一筆可追溯執行紀錄。",
            actor: { type: "simulation", id: "模擬平台" },
            status: "succeeded",
            input_refs: ["prod_oil_002"],
            case_before: { version: 3, status: "awaiting_approval" },
            case_after: { version: 3, status: "actioned" },
          },
        ],
      },
    ],
    agent_status: {
      case_oil_safety: {
        case_id: "case_oil_safety",
        agent_id: "agent_food_safety",
        state: "waiting_human",
        current_step: "等待員工確認模擬商品範圍",
        latest_result: "已整理候選商品與證據不足原因",
        waiting_reason: "候選商品尚未代表已確認受影響，需要人工核可",
        next_action: "收到核可後執行模擬下架",
        observed_at: timestamps.fourth,
        source: "saved_mock_observation",
      },
      case_logistics_watch: {
        case_id: "case_logistics_watch",
        agent_id: "agent_supply_watch",
        state: "waiting_follow_up",
        current_step: "等待下一次訊號追蹤",
        latest_result: "尚未找到第二個獨立來源",
        waiting_reason: "目前證據不足以判定平台影響",
        next_action: "2026-09-12 13:00 重新檢查",
        observed_at: timestamps.second,
        source: "saved_mock_observation",
      },
    },
    idempotency: {},
  };
  return enrichState(state);
}

const traceField = (key, label, value, ref = null) => ({ key, label, value, ref });

const traceEvidence = (evidence_id, label, url = null, excerpt = null, stance = null) => ({
  evidence_id,
  label,
  url,
  excerpt,
  stance,
});

function traceSnapshot(state, caseId, overrides = {}) {
  const current = findCase(state, caseId) || {};
  const claimIds = overrides.claim_ids ?? current.claim_ids ?? [];
  const claims = claimIds.map((claimId) => {
    const signal = (state.signals || []).find((item) => item.claims?.some((claim) => claim.claim_id === claimId));
    const claim = signal?.claims?.find((item) => item.claim_id === claimId);
    return {
      claim_id: claimId,
      verification_status: claim?.verification_status ?? "insufficient_evidence",
      statement: claim?.normalized_statement ?? "尚未提供查核陳述",
      evidence_refs: (claim?.evidence || []).map((item) => item.evidence_id),
    };
  });
  const candidateProducts = overrides.candidate_products ?? current.candidate_products ?? [];
  return {
    case_id: caseId,
    title: overrides.title ?? current.title ?? "",
    version: overrides.version ?? current.version ?? 0,
    status: overrides.status ?? current.status ?? "new",
    business_impact: overrides.business_impact ?? current.business_impact ?? "pending",
    priority: overrides.priority ?? current.priority ?? "low",
    owner: overrides.owner ?? current.owner ?? { type: "case_agent", id: "unknown" },
    claim_ids: [...claimIds],
    claims,
    candidate_products: candidateProducts.map((candidate) => ({
      product_id: candidate.product_id,
      relation: candidate.relation,
      reason: candidate.reason,
      missing_information: [...(candidate.missing_information || [])],
      product_status: candidate.product_status ?? (state.products || []).find((product) => product.product_id === candidate.product_id)?.status ?? null,
    })),
    unknowns: [...(overrides.unknowns ?? current.unknowns ?? [])],
    next_steps: [...(overrides.next_steps ?? current.next_steps ?? [])],
  };
}

function traceActivity({
  activity_id,
  sequence,
  kind,
  title,
  summary,
  reason,
  actor,
  status = "completed",
  occurred_at,
  started_at = occurred_at,
  completed_at = occurred_at,
  input = [],
  output = [],
  source_refs = [],
  evidence = [],
  retry_of_activity_id = null,
  attempt = 1,
  error = null,
}) {
  return {
    activity_id,
    sequence,
    kind,
    title,
    summary,
    reason,
    actor,
    status,
    occurred_at,
    started_at,
    completed_at,
    input,
    output,
    source_refs,
    evidence,
    retry_of_activity_id,
    attempt,
    error,
  };
}

function tracePhase({
  phase_id,
  sequence,
  kind,
  title,
  summary,
  reason,
  actor,
  status,
  occurred_at,
  started_at,
  completed_at,
  input,
  output,
  source_refs,
  evidence,
  activities,
  case_before,
  case_after,
  pause_reason = null,
}) {
  return {
    phase_id,
    sequence,
    kind,
    title,
    summary,
    reason,
    actor,
    status,
    occurred_at,
    started_at,
    completed_at,
    progress: {
      completed_activities: activities.filter((activity) => activity.status === "completed" || activity.status === "succeeded").length,
      total_activities: activities.length,
    },
    input,
    output,
    source_refs,
    evidence,
    activities,
    case_before,
    case_after,
    next_activity: null,
    next_phase: null,
    pause_reason,
  };
}

function addPhasePointers(phases) {
  phases.forEach((phase, index) => {
    const waiting = phase.activities.find((activity) => activity.status === "waiting");
    const ready = phase.activities.find((activity) => activity.status === "ready");
    const suggested = waiting || ready;
    phase.next_activity = suggested
      ? { id: suggested.activity_id, title: suggested.title, sequence: suggested.sequence }
      : null;
    const next = phases[index + 1];
    phase.next_phase = next ? { id: next.phase_id, title: next.title, sequence: next.sequence } : null;
  });
  return phases;
}

function traceReplay() {
  return {
    strategy: "ordered_phases",
    default_speed: 1,
    speed_options: [0.5, 1, 1.5, 2],
    pause_on_human: true,
    read_only: true,
    cursor_semantics: "client_revealed",
  };
}

function richMainTrace(state, source) {
  const caseId = "case_oil_safety";
  const gatherer = { type: "general_gatherer", id: "agent_signal_gatherer" };
  const caseAgent = { type: "case_agent", id: "agent_food_safety" };
  const dispatcher = { type: "dispatcher", id: "case_dispatcher" };
  const employee = { type: "employee", id: "employee_demo" };
  const simulation = { type: "simulation", id: "mock_platform" };
  const phases = addPhasePointers([
    tracePhase({
      phase_id: "main.phase.intake",
      sequence: 1,
      kind: "intake",
      title: "收件與保留原始訊號",
      summary: "把消費者經驗與來源存成可追溯的初始訊號。",
      reason: "目前沒有官方證據，先保留原文與來源，避免把經驗當作確定事實。",
      actor: gatherer,
      status: "completed",
      occurred_at: "2026-09-12T02:01:00.000Z",
      started_at: "2026-09-12T02:00:30.000Z",
      completed_at: "2026-09-12T02:01:30.000Z",
      input: [traceField("query", "收件篩選", "金橘食品 食用油")],
      output: [traceField("signal_id", "訊號", "sig_oil_001", "sig_oil_001"), traceField("retrieval_status", "讀取狀態", "succeeded")],
      source_refs: ["sig_oil_001"],
      evidence: [],
      activities: [
        traceActivity({
          activity_id: "main.intake.search",
          sequence: 1,
          kind: "search",
          title: "搜尋收件匣訊號",
          summary: "找到一則提及品牌與異味的原始回報。",
          reason: "品牌關鍵字足以建立待查案件，但不足以完成查核。",
          actor: gatherer,
          occurred_at: "2026-09-12T02:01:00.000Z",
          input: [traceField("query", "搜尋條件", "金橘食品 食用油")],
          output: [traceField("result_count", "結果數", 1), traceField("signal_id", "訊號 ID", "sig_oil_001", "sig_oil_001")],
          source_refs: ["sig_oil_001"],
        }),
        traceActivity({
          activity_id: "main.intake.read",
          sequence: 2,
          kind: "read",
          title: "讀取原始貼文",
          summary: "保留原文、來源與發布時間。",
          reason: "後續判斷必須能回到原始訊號。",
          actor: gatherer,
          occurred_at: "2026-09-12T02:01:30.000Z",
          input: [traceField("signal_id", "訊號 ID", "sig_oil_001", "sig_oil_001")],
          output: [traceField("raw_text", "原文摘要", "有人回報金橘食品食用油有異味"), traceField("source_relation", "來源關係", "original")],
          source_refs: ["sig_oil_001"],
        }),
      ],
      case_before: traceSnapshot(state, caseId, { version: 0, status: "new", claim_ids: [], candidate_products: [], unknowns: ["尚未建立案件"], next_steps: ["建立案件並分派"] }),
      case_after: traceSnapshot(state, caseId, { version: 1, status: "investigating", claim_ids: ["clm_oil_001"], candidate_products: [], unknowns: ["受影響批次尚未確認"], next_steps: ["分派食安案件專員"] }),
    }),
    tracePhase({
      phase_id: "main.phase.dispatch",
      sequence: 2,
      kind: "dispatch",
      title: "建立案件並交接專員",
      summary: "把訊號脈絡交給食安案件專員持續調查。",
      reason: "訊號涉及具體品牌，需要保留脈絡並持續比對證據。",
      actor: dispatcher,
      status: "completed",
      occurred_at: "2026-09-12T02:02:00.000Z",
      started_at: "2026-09-12T02:01:45.000Z",
      completed_at: "2026-09-12T02:02:30.000Z",
      input: [traceField("signal_id", "輸入訊號", "sig_oil_001", "sig_oil_001")],
      output: [traceField("case_id", "案件 ID", caseId, caseId), traceField("owner", "承接角色", "agent_food_safety")],
      source_refs: ["sig_oil_001", caseId],
      evidence: [],
      activities: [
        traceActivity({
          activity_id: "main.dispatch.handoff",
          sequence: 1,
          kind: "handoff",
          title: "交接給食安案件專員",
          summary: "建立案件脈絡並指定 agent_food_safety。",
          reason: "具體品牌與消費者安全疑慮需要專責追蹤。",
          actor: dispatcher,
          occurred_at: "2026-09-12T02:02:00.000Z",
          input: [traceField("signal_id", "訊號 ID", "sig_oil_001", "sig_oil_001")],
          output: [traceField("owner", "案件專員", "agent_food_safety"), traceField("case_version", "案件版本", 1)],
          source_refs: [caseId],
        }),
        traceActivity({
          activity_id: "main.dispatch.tool",
          sequence: 2,
          kind: "tool",
          title: "寫入案件摘要",
          summary: "保存初始 claim、未知事項與下一步。",
          reason: "案件狀態要能在後續回放與日常檢視中追溯。",
          actor: caseAgent,
          occurred_at: "2026-09-12T02:02:30.000Z",
          input: [traceField("claim_id", "初始陳述", "clm_oil_001", "clm_oil_001")],
          output: [traceField("status", "案件狀態", "investigating"), traceField("unknown", "未知事項", "受影響批次尚未確認")],
          source_refs: [caseId, "clm_oil_001"],
        }),
      ],
      case_before: traceSnapshot(state, caseId, { version: 1, status: "investigating", claim_ids: ["clm_oil_001"], candidate_products: [], unknowns: ["受影響批次尚未確認"], next_steps: ["查找獨立來源與官方公告"] }),
      case_after: traceSnapshot(state, caseId, { version: 1, status: "investigating", claim_ids: ["clm_oil_001"], candidate_products: [], unknowns: ["受影響批次尚未確認"], next_steps: ["查找獨立來源與官方公告"] }),
    }),
    tracePhase({
      phase_id: "main.phase.verify",
      sequence: 3,
      kind: "verification",
      title: "查核來源與更新案件判讀",
      summary: "辨識重複轉傳，查詢官方公告，保留批次未知。",
      reason: "轉傳沒有新增獨立事實；目前查詢也沒有形成批次確認。",
      actor: caseAgent,
      status: "completed",
      occurred_at: "2026-09-12T02:12:00.000Z",
      started_at: "2026-09-12T02:06:00.000Z",
      completed_at: "2026-09-12T02:12:30.000Z",
      input: [traceField("signal_id", "新增訊號", "sig_oil_002", "sig_oil_002"), traceField("claim_id", "待查陳述", "clm_oil_001", "clm_oil_001")],
      output: [traceField("verification_status", "查核結果", "insufficient_evidence"), traceField("case_version", "案件版本", 3)],
      source_refs: ["sig_oil_001", "sig_oil_002", "evidence_oil_001"],
      evidence: [traceEvidence("evidence_oil_001", "目前沒有對應批次的官方公告", "https://example.test/evidence/official-check", "查詢結果尚未找到可對應品牌與批次的公告。", "context_only")],
      activities: [
        traceActivity({
          activity_id: "main.verify.read-repost",
          sequence: 1,
          kind: "read",
          title: "讀取重複轉傳",
          summary: "將轉傳連回原始訊號，不重複建立事件。",
          reason: "來源關係是 repost，沒有新的獨立事實。",
          actor: caseAgent,
          occurred_at: "2026-09-12T02:06:00.000Z",
          input: [traceField("signal_id", "轉傳訊號", "sig_oil_002", "sig_oil_002")],
          output: [traceField("source_relation", "來源關係", "repost"), traceField("duplicate_of", "原始訊號", "sig_oil_001", "sig_oil_001")],
          source_refs: ["sig_oil_002", "sig_oil_001"],
        }),
        traceActivity({
          activity_id: "main.verify.search-official",
          sequence: 2,
          kind: "search",
          title: "搜尋官方公告",
          summary: "查詢結果未找到可對應品牌與批次的公告。",
          reason: "官方來源可支持或反駁原始回報，但目前沒有可匹配批次。",
          actor: caseAgent,
          occurred_at: "2026-09-12T02:10:00.000Z",
          input: [traceField("query", "查詢條件", "金橘食品 批次 官方公告")],
          output: [traceField("result_count", "結果數", 0), traceField("verification_status", "查核狀態", "insufficient_evidence")],
          source_refs: ["evidence_oil_001"],
          evidence: [traceEvidence("evidence_oil_001", "目前沒有對應批次的官方公告", "https://example.test/evidence/official-check", "查詢結果尚未找到可對應品牌與批次的公告。", "context_only")],
        }),
        traceActivity({
          activity_id: "main.verify.tool",
          sequence: 3,
          kind: "tool",
          title: "更新案件與候選商品",
          summary: "將兩項模擬商品列為候選，案件進入人工核可等待。",
          reason: "潛在傷害高但商品批次未知，處置範圍要由員工確認。",
          actor: caseAgent,
          occurred_at: "2026-09-12T02:12:30.000Z",
          input: [traceField("candidate_count", "候選數", 2), traceField("unknown", "仍未知", "受影響批次")],
          output: [traceField("status", "案件狀態", "awaiting_approval"), traceField("candidate_product_ids", "候選商品", "prod_oil_001, prod_oil_002")],
          source_refs: [caseId, "prod_oil_001", "prod_oil_002"],
        }),
      ],
      case_before: traceSnapshot(state, caseId, { version: 1, status: "investigating", claim_ids: ["clm_oil_001", "clm_oil_002"], candidate_products: [], unknowns: ["受影響批次尚未確認"], next_steps: ["查找獨立來源與官方公告"] }),
      case_after: traceSnapshot(state, caseId, { version: 3, status: "awaiting_approval", claim_ids: ["clm_oil_001", "clm_oil_002"], unknowns: ["受影響批次尚未確認", "官方公告的適用範圍仍需比對"], next_steps: ["確認員工要處理的模擬商品", "持續追蹤官方食安公告"] }),
    }),
    tracePhase({
      phase_id: "main.phase.approval",
      sequence: 4,
      kind: "approval",
      title: "等待人工核可",
      summary: "在處置範圍確認前停住，保存候選商品與理由。",
      reason: "候選關聯不等於商品已被證實有問題，需由員工確認範圍。",
      actor: employee,
      status: "waiting_human",
      occurred_at: "2026-09-12T02:20:00.000Z",
      started_at: "2026-09-12T02:20:00.000Z",
      completed_at: null,
      input: [traceField("case_version", "案件版本", 3, caseId), traceField("candidate_product_ids", "候選商品", "prod_oil_001, prod_oil_002")],
      output: [traceField("approval_status", "核可狀態", "waiting_human"), traceField("selected_product_ids", "已選商品", null)],
      source_refs: [caseId, "prod_oil_001", "prod_oil_002"],
      evidence: [],
      activities: [
        traceActivity({
          activity_id: "main.approval.wait",
          sequence: 1,
          kind: "wait",
          title: "等待員工選取商品",
          summary: "回放在人工核可點暫停。",
          reason: "播放不會替使用者建立核可，也不會觸發模擬下架。",
          actor: employee,
          status: "waiting",
          occurred_at: "2026-09-12T02:20:00.000Z",
          started_at: "2026-09-12T02:20:00.000Z",
          completed_at: null,
          input: [traceField("case_version", "案件版本", 3, caseId), traceField("selection_required", "需要選取", true)],
          output: [traceField("approval_id", "核可 ID", null), traceField("selected_product_ids", "已選商品", null)],
          source_refs: [caseId],
        }),
      ],
      case_before: traceSnapshot(state, caseId, { version: 3, status: "awaiting_approval", claim_ids: ["clm_oil_001", "clm_oil_002"] }),
      case_after: traceSnapshot(state, caseId, { version: 3, status: "awaiting_approval", claim_ids: ["clm_oil_001", "clm_oil_002"] }),
      pause_reason: "等待人工確認模擬商品範圍",
    }),
    tracePhase({
      phase_id: "main.phase.execution",
      sequence: 5,
      kind: "execution",
      title: "準備模擬執行",
      summary: "下一階段會依有效核可建立模擬執行紀錄。",
      reason: "目前只展示已保存的下一步，不在回放中建立核可或執行。",
      actor: simulation,
      status: "ready",
      occurred_at: "2026-09-12T02:21:00.000Z",
      started_at: null,
      completed_at: null,
      input: [traceField("approval_id", "核可 ID", null), traceField("case_version", "適用版本", 3, caseId)],
      output: [traceField("execution_status", "執行狀態", null)],
      source_refs: [caseId],
      evidence: [],
      activities: [
        traceActivity({
          activity_id: "main.execution.create",
          sequence: 1,
          kind: "tool",
          title: "建立模擬執行紀錄",
          summary: "等待有效核可後才會進入模擬平台。",
          reason: "核可與執行是兩個明確步驟，回放不會代替使用者操作。",
          actor: simulation,
          status: "ready",
          occurred_at: "2026-09-12T02:21:00.000Z",
          started_at: null,
          completed_at: null,
          input: [traceField("approval_id", "核可 ID", null), traceField("product_ids", "商品 IDs", "prod_oil_001, prod_oil_002")],
          output: [traceField("execution_id", "執行 ID", null)],
          source_refs: [caseId],
        }),
      ],
      case_before: traceSnapshot(state, caseId, { version: 3, status: "awaiting_approval", claim_ids: ["clm_oil_001", "clm_oil_002"] }),
      case_after: traceSnapshot(state, caseId, { version: 3, status: "awaiting_approval", claim_ids: ["clm_oil_001", "clm_oil_002"] }),
    }),
  ]);
  const activities = phases.reduce((total, phase) => total + phase.activities.length, 0);
  return {
    trace_status: "saved",
    scenario: "main",
    recorded_at: "2026-09-12T02:20:00.000Z",
    phase_count: phases.length,
    activity_count: activities,
    contains_human_pause: true,
    replay: traceReplay(),
    phases,
  };
}

function richFailureRetryTrace(state) {
  const caseId = "case_oil_safety";
  const employee = { type: "employee", id: "employee_demo" };
  const simulation = { type: "simulation", id: "mock_platform" };
  const caseBefore = traceSnapshot(state, caseId, { version: 3, status: "awaiting_approval", claim_ids: ["clm_oil_001", "clm_oil_002"], candidate_products: [{ product_id: "prod_oil_002", relation: "candidate", reason: "同品牌不同容量；需確認供應批次", missing_information: ["batch", "seller_confirmation"] }] });
  const caseAfterSuccess = traceSnapshot(state, caseId, { version: 3, status: "actioned", claim_ids: ["clm_oil_001", "clm_oil_002"], candidate_products: [{ product_id: "prod_oil_002", relation: "confirmed", reason: "人工核可後完成模擬處置", missing_information: ["batch", "seller_confirmation"], product_status: "delisted" }] });
  const failedActivityId = "retry.execute.attempt-1";
  const phases = addPhasePointers([
    tracePhase({
      phase_id: "retry.phase.approval",
      sequence: 1,
      kind: "approval",
      title: "讀取已保存核可",
      summary: "重試情境從既有核可範圍開始播放。",
      reason: "這個分支不建立新核可，只重播相同商品的執行結果。",
      actor: employee,
      status: "completed",
      occurred_at: "2026-09-12T02:20:00.000Z",
      started_at: "2026-09-12T02:20:00.000Z",
      completed_at: "2026-09-12T02:20:30.000Z",
      input: [traceField("product_id", "核可商品", "prod_oil_002", "prod_oil_002"), traceField("case_version", "案件版本", 3, caseId)],
      output: [traceField("approval_status", "核可狀態", "approved"), traceField("execution_id", "待執行紀錄", "exec_saved_retry")],
      source_refs: [caseId, "prod_oil_002"],
      evidence: [],
      activities: [
        traceActivity({
          activity_id: "retry.approval.read",
          sequence: 1,
          kind: "read",
          title: "讀取已保存核可",
          summary: "讀取同一案件版本與商品範圍。",
          reason: "重試沿用既有核可，避免建立第二筆處置授權。",
          actor: employee,
          occurred_at: "2026-09-12T02:20:30.000Z",
          input: [traceField("case_version", "案件版本", 3, caseId), traceField("product_id", "商品 ID", "prod_oil_002", "prod_oil_002")],
          output: [traceField("approval_status", "核可狀態", "approved"), traceField("execution_id", "執行 ID", "exec_saved_retry")],
          source_refs: [caseId, "prod_oil_002"],
        }),
      ],
      case_before: caseBefore,
      case_after: caseBefore,
    }),
    tracePhase({
      phase_id: "retry.phase.failed",
      sequence: 2,
      kind: "execution",
      title: "第一次模擬執行失敗",
      summary: "模擬平台回傳暫時性錯誤，商品維持上架。",
      reason: "失敗保留在原執行紀錄中，不能被轉成成功提示。",
      actor: simulation,
      status: "failed",
      occurred_at: "2026-09-12T02:21:00.000Z",
      started_at: "2026-09-12T02:21:00.000Z",
      completed_at: "2026-09-12T02:21:10.000Z",
      input: [traceField("execution_id", "執行 ID", "exec_saved_retry"), traceField("attempt", "嘗試次數", 1)],
      output: [traceField("status", "執行狀態", "failed"), traceField("error", "錯誤", "模擬平台暫時拒絕下架")],
      source_refs: ["exec_saved_retry", "prod_oil_002"],
      evidence: [],
      activities: [
        traceActivity({
          activity_id: failedActivityId,
          sequence: 1,
          kind: "tool",
          title: "呼叫模擬平台",
          summary: "第一次嘗試回傳暫時性錯誤。",
          reason: "保留錯誤與上架狀態，讓後續重試可被辨識。",
          actor: simulation,
          status: "failed",
          occurred_at: "2026-09-12T02:21:10.000Z",
          started_at: "2026-09-12T02:21:00.000Z",
          completed_at: "2026-09-12T02:21:10.000Z",
          input: [traceField("execution_id", "執行 ID", "exec_saved_retry"), traceField("product_id", "商品 ID", "prod_oil_002", "prod_oil_002")],
          output: [traceField("status", "執行狀態", "failed"), traceField("product_status", "商品狀態", "active")],
          source_refs: ["exec_saved_retry", "prod_oil_002"],
          error: "模擬平台暫時拒絕下架，請保留錯誤並重試。",
        }),
      ],
      case_before: caseBefore,
      case_after: caseBefore,
    }),
    tracePhase({
      phase_id: "retry.phase.retry",
      sequence: 3,
      kind: "retry",
      title: "重試同一執行並完成",
      summary: "第二次嘗試更新原執行紀錄，商品完成模擬下架。",
      reason: "retry_of_activity_id 指向第一次失敗，確保不產生重複執行。",
      actor: simulation,
      status: "succeeded",
      occurred_at: "2026-09-12T02:22:00.000Z",
      started_at: "2026-09-12T02:22:00.000Z",
      completed_at: "2026-09-12T02:22:10.000Z",
      input: [traceField("execution_id", "原執行 ID", "exec_saved_retry"), traceField("attempt", "嘗試次數", 2), traceField("retry_of", "重試來源", failedActivityId, failedActivityId)],
      output: [traceField("status", "執行狀態", "succeeded"), traceField("product_status", "商品狀態", "delisted")],
      source_refs: ["exec_saved_retry", "prod_oil_002"],
      evidence: [],
      activities: [
        traceActivity({
          activity_id: "retry.execute.attempt-2",
          sequence: 1,
          kind: "retry",
          title: "重試同一執行紀錄",
          summary: "第二次嘗試成功，更新原執行紀錄。",
          reason: "同一核可與商品只保留一筆可追溯執行紀錄。",
          actor: simulation,
          status: "succeeded",
          occurred_at: "2026-09-12T02:22:10.000Z",
          started_at: "2026-09-12T02:22:00.000Z",
          completed_at: "2026-09-12T02:22:10.000Z",
          input: [traceField("execution_id", "執行 ID", "exec_saved_retry"), traceField("attempt", "嘗試次數", 2), traceField("retry_of", "前次失敗", failedActivityId, failedActivityId)],
          output: [traceField("status", "執行狀態", "succeeded"), traceField("product_status", "商品狀態", "delisted")],
          source_refs: ["exec_saved_retry", "prod_oil_002"],
          retry_of_activity_id: failedActivityId,
          attempt: 2,
        }),
      ],
      case_before: caseBefore,
      case_after: caseAfterSuccess,
    }),
  ]);
  const activities = phases.reduce((total, phase) => total + phase.activities.length, 0);
  return {
    trace_status: "saved",
    scenario: "failure_retry",
    recorded_at: "2026-09-12T02:22:10.000Z",
    phase_count: phases.length,
    activity_count: activities,
    contains_human_pause: false,
    replay: traceReplay(),
    phases,
  };
}

function genericRichTrace(state, source) {
  const phases = (source.steps || []).map((step, index) => {
    const activity = traceActivity({
      activity_id: `${source.trace_id}.activity.${index + 1}`,
      sequence: 1,
      kind: step.status === "failed" ? "retry" : "tool",
      title: step.title,
      summary: step.summary,
      reason: step.reason,
      actor: step.actor,
      status: step.status === "failed" ? "failed" : step.status === "waiting_human" ? "waiting" : "completed",
      occurred_at: "2026-09-12T02:00:00.000Z",
      started_at: null,
      completed_at: null,
      input: (step.input_refs || []).map((ref) => traceField("ref", "輸入參考", ref, ref)),
      output: [],
      source_refs: step.input_refs || [],
    });
    return tracePhase({
      phase_id: `${source.trace_id}.phase.${index + 1}`,
      sequence: index + 1,
      kind: step.kind,
      title: step.title,
      summary: step.summary,
      reason: step.reason,
      actor: step.actor,
      status: step.status === "waiting_human" ? "waiting_human" : step.status === "failed" ? "failed" : step.status === "succeeded" ? "succeeded" : "completed",
      occurred_at: "2026-09-12T02:00:00.000Z",
      started_at: null,
      completed_at: null,
      input: (step.input_refs || []).map((ref) => traceField("ref", "輸入參考", ref, ref)),
      output: [],
      source_refs: step.input_refs || [],
      evidence: [],
      activities: [activity],
      case_before: traceSnapshot(state, source.case_id, { version: step.case_before?.version ?? 0, status: step.case_before?.status ?? "new" }),
      case_after: traceSnapshot(state, source.case_id, { version: step.case_after?.version ?? 0, status: step.case_after?.status ?? "new" }),
      pause_reason: step.status === "waiting_human" ? "等待人工確認" : null,
    });
  });
  addPhasePointers(phases);
  return {
    trace_status: "saved",
    scenario: "legacy",
    recorded_at: "2026-09-12T02:00:00.000Z",
    phase_count: phases.length,
    activity_count: phases.length,
    contains_human_pause: phases.some((phase) => phase.status === "waiting_human"),
    replay: traceReplay(),
    phases,
  };
}

function enrichState(state) {
  if (!Array.isArray(state.traces)) state.traces = [];
  state.traces.forEach((trace) => {
    const rich = trace.trace_id === "trace_oil_main" ? richMainTrace(state, trace) : trace.trace_id === "trace_failure_retry" ? richFailureRetryTrace(state, trace) : genericRichTrace(state, trace);
    Object.assign(trace, rich);
  });
  state.schema_version = CURRENT_SCHEMA_VERSION;
  return state;
}

async function readState(statePath) {
  try {
    const content = await fs.readFile(statePath, "utf8");
    const parsed = JSON.parse(content);
    if (!parsed || ![1, CURRENT_SCHEMA_VERSION].includes(parsed.schema_version)) throw new Error("Unsupported mock state");
    const previousVersion = parsed.schema_version;
    const state = enrichState(parsed);
    if (previousVersion !== CURRENT_SCHEMA_VERSION) await writeState(statePath, state);
    return state;
  } catch (error) {
    if (error?.code !== "ENOENT") console.warn(`[mock] resetting unreadable state: ${error.message}`);
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
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
  });
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
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw Object.assign(new Error("Request body must be valid JSON"), { code: "invalid_json" });
  }
}

function listResponse(items) {
  return { items, next_cursor: null };
}

function findCase(state, caseId) {
  return state.cases.find((item) => item.case_id === caseId);
}

function findApproval(state, approvalId) {
  return state.approvals.find((item) => item.approval_id === approvalId);
}

function recordIdempotent(state, method, pathname, key, body, status) {
  if (!key) return;
  state.idempotency[`${method}:${pathname}:${key}`] = { body: clone(body), status };
}

function replayIdempotent(state, method, pathname, key) {
  if (!key) return null;
  const entry = state.idempotency[`${method}:${pathname}:${key}`];
  return entry ? { status: entry.status, body: clone(entry.body) } : null;
}

function requireIdempotency(request) {
  const key = request.headers["idempotency-key"];
  return typeof key === "string" && key.trim().length > 0 ? key.trim() : null;
}

function addTimeline(state, caseId, kind, summary, reason, sourceRefs, actor) {
  const current = findCase(state, caseId);
  const timeline = state.timelines[caseId] || (state.timelines[caseId] = []);
  const item = {
    timeline_id: id("tl"),
    case_id: caseId,
    case_version: current?.version ?? 0,
    kind,
    occurred_at: now(),
    summary,
    reason,
    source_refs: sourceRefs,
    actor,
  };
  timeline.push(item);
  if (current) current.updated_at = item.occurred_at;
  return item;
}

function caseSummary(item, state) {
  const agent = state.agent_status[item.case_id] || null;
  return {
    case_id: item.case_id,
    version: item.version,
    title: item.title,
    status: item.status,
    business_impact: item.business_impact,
    priority: item.priority,
    priority_reasons: item.priority_reasons,
    owner: item.owner,
    latest_change: state.timelines[item.case_id]?.at(-1)?.summary ?? null,
    updated_at: item.updated_at,
    next_check_at: item.monitoring_plan?.next_check_at ?? null,
    agent_state: agent?.state ?? null,
  };
}

function validateProductSelection(state, current, productIds) {
  if (!Array.isArray(productIds) || productIds.length < 1) {
    return "至少選擇一個模擬商品";
  }
  const candidates = new Map((current.candidate_products || []).map((item) => [item.product_id, item]));
  for (const productId of productIds) {
    const candidate = candidates.get(productId);
    const product = state.products.find((item) => item.product_id === productId);
    if (!candidate || candidate.relation === "excluded" || !product) return `商品 ${productId} 不是本案件可核可的候選商品`;
    if (!product.is_simulated) return `商品 ${productId} 不是模擬商品`;
    if (product.status !== "active") return `商品 ${productId} 已經不是上架狀態`;
  }
  return null;
}

function executeApproval(state, approval) {
  const current = findCase(state, approval.case_id);
  if (!current) return { status: 404, body: errorBody("not_found", "找不到案件") };
  if (approval.case_version !== current.version) {
    return {
      status: 409,
      body: errorBody("version_conflict", "案件已更新，這筆核可已失效，請依最新版本重新確認。", {
        approval_case_version: approval.case_version,
        current_case_version: current.version,
      }),
    };
  }
  const executions = [];
  let succeeded = 0;
  let failed = 0;
  for (const productId of approval.product_ids) {
    const product = state.products.find((item) => item.product_id === productId);
    if (!product) continue;
    let execution = state.executions.find((item) => item.approval_id === approval.approval_id && item.product_id === productId);
    if (!execution) {
      execution = {
        execution_id: id("exec"),
        approval_id: approval.approval_id,
        product_id: productId,
        status: "pending",
        error: null,
        executed_at: null,
        attempts: 0,
      };
      state.executions.push(execution);
    }
    if (execution.status === "succeeded") {
      succeeded += 1;
      executions.push(execution);
      continue;
    }
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
      if (product.status === "active") {
        product.status = "delisted";
        product.version += 1;
      }
      succeeded += 1;
      addTimeline(state, approval.case_id, "action_executed", `${product.name} 已完成模擬下架。`, "使用者核可的商品與案件版本有效。", [execution.execution_id], { type: "simulation", id: "mock_platform" });
    }
    executions.push(execution);
  }
  if (succeeded > 0) current.status = "actioned";
  else if (failed > 0) current.status = "awaiting_approval";
  const body = {
    approval: clone(approval),
    executions: clone(executions),
    case: clone(current),
    summary: { succeeded, failed, total: executions.length },
  };
  return { status: 200, body };
}

async function createHandler({ statePath }) {
  const state = await readState(statePath);
  let writing = Promise.resolve();
  const persist = () => {
    writing = writing.then(() => writeState(statePath, state));
    return writing;
  };

  return async (request, response) => {
    const url = new URL(request.url, "http://localhost");
    const pathname = url.pathname.replace(/\/$/, "") || "/";
    const method = request.method || "GET";
    if (method === "OPTIONS") {
      response.writeHead(204, { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type,idempotency-key", "access-control-allow-methods": "GET,POST,OPTIONS" });
      response.end();
      return;
    }
    if (method === "GET" && pathname === "/healthz") {
      send(response, 200, { status: "ok", database: "ok", mode: "mock" });
      return;
    }
    if (!pathname.startsWith("/api/v1")) {
      send(response, 404, errorBody("not_found", "Mock service only serves /api/v1 endpoints"));
      return;
    }
    const key = method === "POST" ? requireIdempotency(request) : null;
    if (method === "POST" && pathname !== "/api/v1/mock/reset" && !key) {
      send(response, 400, errorBody("idempotency_key_required", "寫入請求需要 Idempotency-Key"));
      return;
    }
    const replay = method === "POST" ? replayIdempotent(state, method, pathname, key) : null;
    if (replay) {
      send(response, replay.status, replay.body);
      return;
    }
    let body = {};
    if (method === "POST") {
      try {
        body = await readJson(request);
      } catch (error) {
        const status = error.code === "request_too_large" ? 413 : 400;
        send(response, status, errorBody(error.code || "invalid_json", error.message));
        return;
      }
    }
    let result;
    const caseMatch = pathname.match(/^\/api\/v1\/cases\/([^/]+)$/);
    const timelineMatch = pathname.match(/^\/api\/v1\/cases\/([^/]+)\/timeline$/);
    const agentMatch = pathname.match(/^\/api\/v1\/cases\/([^/]+)\/agent-status$/);
    const approvalMatch = pathname.match(/^\/api\/v1\/cases\/([^/]+)\/approvals$/);
    const advanceMatch = pathname.match(/^\/api\/v1\/cases\/([^/]+)\/advance$/);
    const executeMatch = pathname.match(/^\/api\/v1\/approvals\/([^/]+)\/execute$/);
    const traceMatch = pathname.match(/^\/api\/v1\/traces\/([^/]+)$/);
    try {
      if (method === "GET" && pathname === "/api/v1/cases") {
        result = { status: 200, body: listResponse(state.cases.map((item) => caseSummary(item, state))) };
      } else if (method === "GET" && caseMatch) {
        const current = findCase(state, caseMatch[1]);
        result = current ? { status: 200, body: clone(current) } : { status: 404, body: errorBody("not_found", "找不到案件") };
      } else if (method === "GET" && timelineMatch) {
        const current = findCase(state, timelineMatch[1]);
        result = current ? { status: 200, body: listResponse(clone(state.timelines[current.case_id] || [])) } : { status: 404, body: errorBody("not_found", "找不到案件") };
      } else if (method === "GET" && agentMatch) {
        const agent = state.agent_status[agentMatch[1]];
        result = agent ? { status: 200, body: clone(agent) } : { status: 404, body: errorBody("not_found", "找不到案件專員狀態") };
      } else if (method === "GET" && approvalMatch) {
        const current = findCase(state, approvalMatch[1]);
        result = current
          ? { status: 200, body: listResponse(state.approvals.filter((item) => item.case_id === current.case_id).map((item) => ({ ...clone(item), executions: clone(state.executions.filter((execution) => execution.approval_id === item.approval_id)) }))) }
          : { status: 404, body: errorBody("not_found", "找不到案件") };
      } else if (method === "GET" && pathname === "/api/v1/products") {
        result = { status: 200, body: listResponse(clone(state.products)) };
      } else if (method === "GET" && pathname === "/api/v1/signals") {
        result = { status: 200, body: listResponse(clone(state.signals)) };
      } else if (method === "GET" && pathname === "/api/v1/traces") {
        result = { status: 200, body: listResponse(state.traces.map(({ steps, phases, ...trace }) => clone(trace))) };
      } else if (method === "GET" && traceMatch) {
        const trace = state.traces.find((item) => item.trace_id === traceMatch[1]);
        result = trace ? { status: 200, body: clone(trace) } : { status: 404, body: errorBody("not_found", "找不到保存的 trace") };
      } else if (method === "POST" && approvalMatch) {
        const current = findCase(state, approvalMatch[1]);
        if (!current) result = { status: 404, body: errorBody("not_found", "找不到案件") };
        else if (body.case_version !== current.version) {
          result = { status: 409, body: errorBody("version_conflict", "案件版本已更新，請重新查看後再核可。", { current_case_version: current.version }) };
        } else {
          const productError = validateProductSelection(state, current, body.product_ids);
          if (productError) result = { status: 422, body: errorBody("invalid_selection", productError) };
          else {
            const approval = {
              approval_id: id("apr"),
              case_id: current.case_id,
              case_version: current.version,
              product_ids: [...new Set(body.product_ids)],
              status: "approved",
              approved_by: typeof body.approved_by === "string" && body.approved_by.trim() ? body.approved_by.trim() : "employee_demo",
              approved_at: now(),
            };
            state.approvals.push(approval);
            current.status = "awaiting_approval";
            addTimeline(state, current.case_id, "approval_recorded", `已核可 ${approval.product_ids.length} 項模擬商品，等待明確執行。`, "核可只適用於目前案件版本與這次選定商品。", approval.product_ids, { type: "employee", id: approval.approved_by });
            result = { status: 201, body: { approval: clone(approval), case: clone(current) } };
          }
        }
      } else if (method === "POST" && executeMatch) {
        const approval = findApproval(state, executeMatch[1]);
        result = approval ? executeApproval(state, approval) : { status: 404, body: errorBody("not_found", "找不到核可紀錄") };
      } else if (method === "POST" && advanceMatch) {
        const current = findCase(state, advanceMatch[1]);
        if (!current) result = { status: 404, body: errorBody("not_found", "找不到案件") };
        else {
          const previousVersion = current.version;
          current.version += 1;
          current.status = "awaiting_approval";
          current.updated_at = now();
          current.unknowns = [...current.unknowns, "新回報的批次與範圍仍待確認"].filter((item, index, all) => all.indexOf(item) === index);
          addTimeline(state, current.case_id, "assessment_updated", "收到新的獨立回報，案件版本升級並要求重新確認。", body.reason || "新證據可能影響候選商品範圍，舊核可不可直接沿用。", [], { type: "case_agent", id: current.owner.id });
          state.agent_status[current.case_id] = {
            ...state.agent_status[current.case_id],
            state: "waiting_human",
            current_step: "等待員工依新案件版本重新確認",
            latest_result: `案件由 v${previousVersion} 更新為 v${current.version}`,
            waiting_reason: "案件版本改變，先前核可需要重新確認",
            next_action: "重新檢視候選商品並建立新核可",
            observed_at: now(),
          };
          result = { status: 200, body: { case: clone(current), previous_version: previousVersion } };
        }
      } else if (method === "POST" && pathname === "/api/v1/mock/reset") {
        const reset = initialState();
        Object.keys(state).forEach((keyName) => delete state[keyName]);
        Object.assign(state, reset);
        result = { status: 200, body: { status: "reset", mode: "mock" } };
      } else {
        result = { status: 404, body: errorBody("not_found", "找不到 mock endpoint") };
      }
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
  const server = createServer((request, response) => {
    handler(request, response).catch((error) => {
      console.error("[mock] handler failed", error);
      send(response, 500, errorBody("mock_error", "Mock service 發生未預期錯誤"));
    });
  });
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  const address = server.address();
  return { server, url: `http://127.0.0.1:${address.port}`, statePath };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { url } = await createMockServer({ port: PORT });
  console.log(`[mock] listening at ${url}`);
  console.log(`[mock] state: ${process.env.MOCK_STATE_PATH || DEFAULT_STATE_PATH}`);
}
