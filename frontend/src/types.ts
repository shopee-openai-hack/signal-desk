export type BusinessImpact = "opportunity" | "risk" | "bidirectional" | "no_material_impact" | "pending";
export type Priority = "low" | "medium" | "high" | "critical";
export type CaseStatus = "monitoring" | "investigating" | "awaiting_approval" | "actioned" | "closed";
export type ProductRelation = "candidate" | "confirmed" | "excluded";
export type ProductStatus = "active" | "delisted";
export type AgentState = "waiting" | "running" | "waiting_human" | "waiting_follow_up" | "failed";

export interface Owner {
  type: string;
  id: string;
}

export interface ProductCandidate {
  product_id: string;
  relation: ProductRelation;
  reason: string;
  missing_information: string[];
}

export interface MonitoringPlan {
  targets: string[];
  next_check_at: string | null;
  reason: string;
}

export interface CaseSummary {
  case_id: string;
  version: number;
  title: string;
  status: CaseStatus;
  business_impact: BusinessImpact;
  priority: Priority;
  priority_reasons: string[];
  owner: Owner;
  latest_change: string | null;
  updated_at: string;
  next_check_at: string | null;
  agent_state: AgentState | null;
}

export interface CaseSnapshot extends CaseSummary {
  claim_ids: string[];
  unknowns: string[];
  next_steps: string[];
  monitoring_plan: MonitoringPlan;
  candidate_products: ProductCandidate[];
}

export interface Product {
  product_id: string;
  name: string;
  brand: string;
  batch: string | null;
  seller_id: string;
  status: ProductStatus;
  version: number;
  is_simulated: boolean;
  failure_mode?: string | null;
}

export interface Source {
  provider: string;
  source_id: string;
  url: string;
  author_ref: string | null;
  published_at: string;
  retrieved_at: string;
  raw_text: string;
  retrieval_status: string;
}

export interface Evidence {
  evidence_id: string;
  claim_id: string;
  url: string;
  title: string;
  publisher: string;
  published_at: string;
  retrieved_at: string;
  excerpt: string;
  stance: "supports" | "refutes" | "context_only";
}

export interface Claim {
  claim_id: string;
  signal_id: string;
  kind: "fact" | "experience" | "hypothesis" | "request";
  quote: string;
  normalized_statement: string;
  entities: { type: string; name: string }[];
  scope: { region: string | null; batch: string | null; time_window: string | null };
  verification_status: "supported" | "refuted" | "insufficient_evidence" | "not_applicable";
  evidence: Evidence[];
}

export interface Signal {
  signal_id: string;
  source: Source;
  source_relation: "original" | "repost" | "independent_report" | "unknown";
  duplicate_of_signal_id: string | null;
  case_id: string;
  claims: Claim[];
}

export interface TimelineItem {
  timeline_id: string;
  case_id: string;
  case_version: number;
  kind: "signal_added" | "verification_updated" | "assessment_updated" | "monitoring_updated" | "approval_recorded" | "action_executed";
  occurred_at: string;
  summary: string;
  reason: string;
  source_refs: string[];
  actor: Owner;
}

export interface Approval {
  approval_id: string;
  case_id: string;
  case_version: number;
  product_ids: string[];
  status: "proposed" | "approved" | "rejected";
  approved_by: string;
  approved_at: string;
}

export interface ApprovalRecord extends Approval {
  executions: Execution[];
}

export interface Execution {
  execution_id: string;
  approval_id: string;
  product_id: string;
  status: "pending" | "succeeded" | "failed";
  error: string | null;
  executed_at: string | null;
  attempts: number;
}

export interface AgentStatus {
  case_id: string;
  agent_id: string;
  state: AgentState;
  current_step: string;
  latest_result: string;
  waiting_reason: string | null;
  next_action: string | null;
  observed_at: string;
  source: "saved_mock_observation" | "backend" | string;
}

export interface TraceStep {
  step_id: string;
  sequence: number;
  kind: string;
  title: string;
  summary: string;
  reason: string;
  actor: Owner;
  status: "completed" | "waiting_human" | "ready" | "failed" | "succeeded";
  input_refs: string[];
  case_before: { version: number; status: string };
  case_after: { version: number; status: string };
}

export interface TraceSummary {
  trace_id: string;
  name: string;
  description: string;
  mode: "saved_mock" | "backend" | string;
  case_id: string;
}

export interface Trace extends TraceSummary {
  steps: TraceStep[];
}

export interface ListResponse<T> {
  items: T[];
  next_cursor: string | null;
}

export interface ApprovalResponse {
  approval: Approval;
  case: CaseSnapshot;
}

export interface ExecutionResponse {
  approval: Approval;
  executions: Execution[];
  case: CaseSnapshot;
  summary: { succeeded: number; failed: number; total: number };
}

export interface ApiErrorPayload {
  error?: {
    code?: string;
    message?: string;
    details?: Record<string, unknown>;
  };
}
