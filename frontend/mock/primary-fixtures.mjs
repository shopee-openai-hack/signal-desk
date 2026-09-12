import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const productsFixture = require("../../contracts/fixtures/demo/products.json");
const signalsFixture = require("../../contracts/fixtures/demo/signals.json");
const evidenceFixture = require("../../contracts/fixtures/demo/evidence.json");

export const PRIMARY_DATASET_ID = "demo-zhonglian-oil-v1";
export const PRIMARY_CASE_ID = "case_zhonglian_oil";
export const REPLAY_WINDOW = "2026-06-30 至 2026-07-23";
export const STAGE4_REQUIRED_PRODUCT_IDS = ["prod_001", "prod_003", "prod_005"];

const clone = (value) => JSON.parse(JSON.stringify(value));
const evidenceByClaim = new Map(evidenceFixture.items.map((item) => [item.claim_id, item]));

const claim = (signalId, claimId, kind, quote, normalizedStatement, entities, scope = {}, verificationStatus = "insufficient_evidence", evidence = []) => ({
  claim_id: claimId,
  signal_id: signalId,
  kind,
  quote,
  normalized_statement: normalizedStatement,
  entities,
  scope: { region: null, batch: null, time_window: null, ...scope },
  verification_status: verificationStatus,
  evidence: evidence.map(clone),
});

const claimDefinitions = {
  post_001: [
    claim("sig_post_001", "clm_s1_hypothesis_taishan", "hypothesis", "接到通知要先把泰山某批沙拉油收起來", "泰山某批沙拉油可能正被通路收回", [{ type: "brand", name: "泰山" }]),
    claim("sig_post_001", "clm_s1_experience_flavor", "experience", "我家上週剛買一桶，味道好像有點怪", "作者回報自家沙拉油味道可能異常", [{ type: "brand", name: "泰山" }], {}, "not_applicable"),
    claim("sig_post_001", "clm_s1_request_others", "request", "有人也遇到嗎？", "作者詢問其他人是否遇到相同情況", [{ type: "brand", name: "泰山" }], {}, "not_applicable"),
  ],
  post_002: [
    claim("sig_post_002", "clm_s2_repost", "request", "轉貼：朋友在賣場上班，說今天接到通知要先把泰山某批沙拉油收起來……有人也遇到嗎？", "這是 post_001 的轉傳，沒有新增獨立可查核事實", [{ type: "brand", name: "泰山" }]),
  ],
  post_003: [
    claim("sig_post_003", "clm_s3_fact_zhonglian", "fact", "中聯油脂的大豆油驗出苯駢芘超標", "中聯油脂大豆油可能驗出苯駢芘超標", [{ type: "supplier", name: "中聯油脂" }]),
    claim("sig_post_003", "clm_s3_fact_fushou_batch", "fact", "瓶身標示原料批號 315-1150404", "作者購買的福壽大豆沙拉油標示原料批號 315-1150404", [{ type: "brand", name: "福壽" }], { batch: "315-1150404" }),
    claim("sig_post_003", "clm_s3_hypothesis_upstream", "hypothesis", "福壽是不是也用中聯的油？", "福壽商品可能使用中聯油脂原料", [{ type: "brand", name: "福壽" }, { type: "supplier", name: "中聯油脂" }]),
  ],
  fda_20260701: [
    claim("sig_fda_20260701", "clm_s4_official_flow", "fact", "中聯油脂批號 315-1150404 大豆沙拉油約 1,300 公噸苯駢芘 8.1 μg/kg，超過限量 2.0；流向福懋 588 公噸、福壽 421 公噸、泰山 291 公噸；首波 15 項油品下架。", "食藥署公告支持中聯批號 315-1150404 超標及流向三個品牌", [{ type: "supplier", name: "中聯油脂" }, { type: "batch", name: "315-1150404" }], { batch: "315-1150404" }, "supported", [evidenceByClaim.get("clm_s3_fact_zhonglian")]),
  ],
  fda_20260707: [
    claim("sig_fda_20260707", "clm_s5_scope_expansion", "fact", "擴大為所有使用受影響原料製成之食品，不論比例，7/8 24 時前全面下架。前一日 7/6 公告已擴為 360 家、18 項產品、30 批號。", "食藥署公告將受影響範圍擴大到使用受影響原料的加工食品", [{ type: "category", name: "使用受影響原料製成之食品" }], {}, "supported", [evidenceByClaim.get("clm_s5_scope_expansion")]),
  ],
  cna_20260723: [
    claim("sig_cna_20260723", "clm_s5_all_expanded_batches_affected", "fact", "全面檢驗結案後，除已知 7 批不合格油品外未新增問題批號；19 批合格油品由泰山、福懋及福壽製成共 501 項產品，可重新上架。", "中央社報導反駁所有擴大列管批次都仍有問題", [{ type: "batch", name: "19 批合格油品" }], {}, "supported", [evidenceByClaim.get("clm_s5_all_expanded_batches_affected")]),
  ],
};

function retrievedAt(publishedAt) {
  return new Date(new Date(publishedAt).getTime() + 60_000).toISOString();
}

function signalFor(item, revealedStage) {
  const signalId = `sig_${item.source_id}`;
  const definitions = (claimDefinitions[item.source_id] || []).map((itemClaim) => ({ ...clone(itemClaim), signal_id: signalId }));
  if (revealedStage >= 4 && item.source_id === "post_003") {
    const verification = definitions.find((itemClaim) => itemClaim.claim_id === "clm_s3_fact_zhonglian");
    if (verification) {
      verification.verification_status = "supported";
      verification.evidence = [clone(evidenceByClaim.get("clm_s3_fact_zhonglian"))];
    }
  }
  if (revealedStage >= 6 && item.source_id === "cna_20260723") {
    const expandedScope = definitions.find((itemClaim) => itemClaim.claim_id === "clm_s5_all_expanded_batches_affected");
    if (expandedScope) expandedScope.verification_status = "refuted";
  }
  return {
    signal_id: signalId,
    stage: item.stage,
    source: {
      provider: item.provider,
      source_id: item.source_id,
      url: item.url,
      author_ref: item.author_ref,
      published_at: item.published_at,
      retrieved_at: retrievedAt(item.published_at),
      raw_text: item.raw_text,
      retrieval_status: "succeeded",
    },
    source_relation: item.source_relation,
    duplicate_of_signal_id: item.duplicate_of_source_id ? `sig_${item.duplicate_of_source_id}` : null,
    case_id: PRIMARY_CASE_ID,
    claims: definitions,
  };
}

export function buildSignals(revealedStage) {
  return signalsFixture.items.filter((item) => item.stage <= revealedStage).map((item) => signalFor(item, revealedStage));
}

export function buildProducts({ failureScenario = false } = {}) {
  return productsFixture.items.map((item) => ({
    ...clone(item),
    failure_mode: failureScenario && item.product_id === "prod_007" ? "fail_once" : null,
  }));
}

const candidate = (product_id, relation, reason, missing_information = []) => ({ product_id, relation, reason, missing_information });

export function stageDefinition(stage) {
  const definitions = {
    0: {
      version: 0,
      status: "monitoring",
      business_impact: "pending",
      priority: "medium",
      priority_reasons: ["尚未載入六段回放訊號"],
      claim_ids: [],
      candidate_products: [],
      unknowns: ["尚未載入案件訊號"],
      next_steps: ["接收 Stage 1 原始訊號"],
      monitoring_plan: { targets: [], next_check_at: null, reason: "完整驗收從零訊號開始" },
    },
    1: {
      version: 1,
      status: "monitoring",
      business_impact: "pending",
      priority: "medium",
      priority_reasons: ["潛在消費者健康風險", "品牌與在售商品吻合", "來源單一且二手"],
      claim_ids: ["clm_s1_hypothesis_taishan", "clm_s1_experience_flavor", "clm_s1_request_others"],
      candidate_products: [
        candidate("prod_001", "candidate", "品牌吻合，事件的受影響批號未知", ["affected_batch"]),
        candidate("prod_002", "candidate", "品牌吻合，商品批號與事件的受影響批號均未知", ["batch", "affected_batch"]),
      ],
      unknowns: ["受影響批號與官方公告尚未確認", "個人經驗無法外部查核"],
      next_steps: ["追蹤泰山公告", "追蹤食藥署公告"],
      monitoring_plan: { targets: ["泰山", "食藥署公告"], next_check_at: "2026-07-01T05:20:00Z", reason: "medium：每日追蹤弱訊號與官方公告" },
    },
    2: {
      version: 2,
      status: "monitoring",
      business_impact: "pending",
      priority: "medium",
      priority_reasons: ["純轉傳沒有新增獨立來源或新事實，維持原判斷"],
      claim_ids: ["clm_s1_hypothesis_taishan", "clm_s1_experience_flavor", "clm_s1_request_others", "clm_s2_repost"],
      candidate_products: [
        candidate("prod_001", "candidate", "品牌吻合，事件的受影響批號未知", ["affected_batch"]),
        candidate("prod_002", "candidate", "品牌吻合，商品批號與事件的受影響批號均未知", ["batch", "affected_batch"]),
      ],
      unknowns: ["受影響批號與官方公告尚未確認", "轉傳沒有新增獨立事實"],
      next_steps: ["維持原追蹤計畫", "等待獨立回報或官方公告"],
      monitoring_plan: { targets: ["泰山", "食藥署公告"], next_check_at: "2026-07-01T05:20:00Z", reason: "medium：純轉傳不增加查核頻率" },
    },
    3: {
      version: 3,
      status: "investigating",
      business_impact: "risk",
      priority: "high",
      priority_reasons: ["兩個獨立來源", "出現具體批號", "上游供應商被具名", "有潛在健康危害"],
      claim_ids: ["clm_s1_hypothesis_taishan", "clm_s1_experience_flavor", "clm_s1_request_others", "clm_s2_repost", "clm_s3_fact_zhonglian", "clm_s3_fact_fushou_batch", "clm_s3_hypothesis_upstream"],
      candidate_products: [
        candidate("prod_001", "candidate", "品牌與沙拉油品類吻合，批號待官方證實", ["official_verification"]),
        candidate("prod_002", "candidate", "品牌與沙拉油品類吻合，批號未知", ["batch"]),
        candidate("prod_003", "candidate", "批號與獨立回報吻合，待官方證實", ["official_verification"]),
        candidate("prod_004", "excluded", "宣告批號不是獨立回報指出的批號"),
      ],
      unknowns: ["官方公告是否支持中聯超標尚待查核", "三個品牌的實際流向與商品範圍尚待確認"],
      next_steps: ["查食藥署公告", "比對中聯下游品牌與批號"],
      monitoring_plan: { targets: ["食藥署公告", "中聯油脂下游品牌"], next_check_at: "2026-07-01T02:40:00Z", reason: "high：每小時追蹤官方證據與批號" },
    },
    4: {
      version: 4,
      status: "awaiting_approval",
      business_impact: "risk",
      priority: "critical",
      priority_reasons: ["官方證實", "涉及三個在售品牌", "有健康危害"],
      claim_ids: ["clm_s1_hypothesis_taishan", "clm_s1_experience_flavor", "clm_s1_request_others", "clm_s2_repost", "clm_s3_fact_zhonglian", "clm_s3_fact_fushou_batch", "clm_s3_hypothesis_upstream", "clm_s4_official_flow"],
      candidate_products: [
        candidate("prod_001", "confirmed", "品牌與批號均與官方公告吻合"),
        candidate("prod_002", "candidate", "品牌吻合但商品頁未標示批號", ["batch"]),
        candidate("prod_003", "confirmed", "品牌與批號均與官方公告吻合"),
        candidate("prod_004", "excluded", "宣告批號不在已證實範圍"),
        candidate("prod_005", "confirmed", "品牌與批號均與官方公告吻合"),
        candidate("prod_006", "excluded", "商品原料類型不同，不是沙拉油"),
      ],
      unknowns: ["prod_002 的商品批號仍未補件", "批號未知商品不在本次核可範圍"],
      next_steps: ["核對三筆 confirmed 商品", "由商品安全營運人員核可後再執行模擬下架"],
      monitoring_plan: { targets: ["官方批號公告", "泰山、福壽、福懋商品"], next_check_at: "2026-07-01T08:15:00Z", reason: "critical：每 15 分鐘追蹤受影響範圍與逐批結果" },
    },
    5: {
      version: 5,
      status: "awaiting_approval",
      business_impact: "risk",
      priority: "critical",
      priority_reasons: ["影響範圍擴大", "已執行的下架維持有效"],
      claim_ids: ["clm_s1_hypothesis_taishan", "clm_s1_experience_flavor", "clm_s1_request_others", "clm_s2_repost", "clm_s3_fact_zhonglian", "clm_s3_fact_fushou_batch", "clm_s3_hypothesis_upstream", "clm_s4_official_flow", "clm_s5_scope_expansion"],
      candidate_products: [
        candidate("prod_001", "confirmed", "品牌與批號均與官方公告吻合"),
        candidate("prod_002", "candidate", "品牌吻合但商品頁未標示批號", ["batch"]),
        candidate("prod_003", "confirmed", "品牌與批號均與官方公告吻合"),
        candidate("prod_004", "excluded", "宣告批號不在已證實範圍"),
        candidate("prod_005", "confirmed", "品牌與批號均與官方公告吻合"),
        candidate("prod_006", "excluded", "商品原料類型不同，不是沙拉油"),
        candidate("prod_007", "candidate", "宣告使用受影響原料，但真實公告未直接確認此模擬 listing", ["product_level_confirmation"]),
        candidate("prod_009", "candidate", "回放將模擬批號列入擴大範圍，待賣家補件", ["seller_documentation"]),
      ],
      unknowns: ["prod_002 的商品批號仍未補件", "加工食品需要逐項商品層級確認", "模擬批號 315-1150411 不是外部證據直接列出的批號"],
      next_steps: ["持續追蹤加工食品公告", "新候選需建立新的人工核可"],
      monitoring_plan: { targets: ["加工食品公告", "賣家補件", "受影響批號"], next_check_at: "2026-07-07T09:15:00Z", reason: "critical：每 15 分鐘追蹤擴大範圍；新候選不沿用舊核可" },
    },
    6: {
      version: 6,
      status: "investigating",
      business_impact: "risk",
      priority: "high",
      priority_reasons: ["主要下架已完成", "部分批號放行", "仍有批號未知的候選商品"],
      claim_ids: ["clm_s1_hypothesis_taishan", "clm_s1_experience_flavor", "clm_s1_request_others", "clm_s2_repost", "clm_s3_fact_zhonglian", "clm_s3_fact_fushou_batch", "clm_s3_hypothesis_upstream", "clm_s4_official_flow", "clm_s5_scope_expansion", "clm_s5_all_expanded_batches_affected"],
      candidate_products: [
        candidate("prod_001", "confirmed", "315-1150404 仍為不合格批號"),
        candidate("prod_002", "candidate", "品牌吻合但商品頁未標示批號", ["batch"]),
        candidate("prod_003", "confirmed", "315-1150404 仍為不合格批號"),
        candidate("prod_004", "excluded", "宣告批號不在已證實範圍"),
        candidate("prod_005", "confirmed", "315-1150404 仍為不合格批號"),
        candidate("prod_006", "excluded", "商品原料類型不同，不是沙拉油"),
        candidate("prod_007", "candidate", "宣告使用受影響原料，但真實公告未直接確認此模擬 listing", ["product_level_confirmation"]),
        candidate("prod_009", "excluded", "外部證據顯示部分批次已放行；回放將模擬批號 315-1150411 映射為合格批次"),
      ],
      unknowns: ["prod_002 的商品批號仍未補件", "prod_007 仍需商品層級確認", "本次沒有新的恢復上架核可"],
      next_steps: ["等待官方後續公告", "由營運人員決定 prod_007 是否建立新核可"],
      monitoring_plan: { targets: ["官方後續公告", "缺批號商品", "加工食品商品層級證據"], next_check_at: "2026-07-23T10:04:00Z", reason: "high：每小時追蹤；部分放行不會自動恢復已下架商品" },
    },
  };
  const selected = definitions[Math.max(0, Math.min(6, stage))];
  return clone(selected);
}

export function caseTitle(stage) {
  return stage === 0 ? "中聯油脂事件｜尚未載入回放" : "中聯油脂苯駢芘事件｜商品安全案件";
}

export function productsAtStage(stage, { stage4Executed = false } = {}) {
  const statuses = Object.fromEntries(productsFixture.items.map((item) => [item.product_id, "active"]));
  if ((stage >= 5 && stage4Executed) || (stage === 4 && stage4Executed)) {
    for (const productId of STAGE4_REQUIRED_PRODUCT_IDS) statuses[productId] = "delisted";
  }
  return statuses;
}

export function evidenceForClaim(claimId) {
  const evidence = evidenceByClaim.get(claimId);
  return evidence ? clone(evidence) : null;
}

export function claimMapForStage(stage) {
  return new Map(buildSignals(stage).flatMap((signal) => signal.claims.map((item) => [item.claim_id, item])));
}

export function primaryProvenance() {
  return {
    dataset_id: PRIMARY_DATASET_ID,
    replay_window: REPLAY_WINDOW,
    source: "approved_demo_fixtures",
    warning: "公告與新聞標題、日期、數字與摘錄標示「demo 前需逐字核對」；未完成核對前不可當成現場已驗證事實。",
    expected_state_note: "Evaluation examples for B and C, not hard-coded model answers.",
    boundaries: {
      external_evidence: "食藥署公告與中央社報導，保留 URL、發布時間與來源狀態。",
      simulated_listing: "九筆商品與賣家資料均為 is_simulated=true 的回放資料。",
      controlled_replay: "回放只揭露目前 stage；讀取 saved trace 不會建立核可、執行或呼叫付費 API。",
      simulated_batch_mapping: "315-1150411 僅是回放映射的模擬批號，不宣稱外部證據直接提到它。",
    },
  };
}

export function fixtureProducts() {
  return clone(productsFixture.items);
}

export function fixtureSignals() {
  return clone(signalsFixture.items);
}

export function fixtureEvidence() {
  return clone(evidenceFixture.items);
}
