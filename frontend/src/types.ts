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
  demo_stage?: number;
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

export interface CaseSnapshot extends Omit<CaseSummary, "latest_change" | "next_check_at" | "agent_state"> {
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
  case_id: string | null;
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

/**
 * A scalar field shown in a saved trace. Values are deliberately small and
 * serialisable so a replay can explain an observed input or output without
 * exposing provider prompts, private chain of thought, or secrets.
 */
export type TraceScalar = string | number | boolean | null;

export interface TraceField {
  key: string;
  label: string;
  value: TraceScalar;
  ref?: string | null;
}

export interface TraceEvidenceRef {
  evidence_id: string;
  label: string;
  url?: string | null;
  excerpt?: string | null;
  stance?: "supports" | "refutes" | "context_only" | null;
}

export interface TraceClaimSnapshot {
  claim_id: string;
  verification_status: Claim["verification_status"];
  statement: string;
  evidence_refs: string[];
}

export interface TraceCandidateSnapshot {
  product_id: string;
  relation: ProductRelation;
  reason: string;
  missing_information: string[];
  product_status: ProductStatus | null;
}

/** Full business fields captured before and after a phase, not only a version. */
export interface TraceCaseSnapshot {
  case_id: string;
  title: string;
  version: number;
  status: CaseStatus | string;
  business_impact: BusinessImpact;
  priority: Priority;
  owner: Owner;
  claim_ids: string[];
  claims: TraceClaimSnapshot[];
  candidate_products: TraceCandidateSnapshot[];
  unknowns: string[];
  next_steps: string[];
}

export type TraceActivityKind = "search" | "read" | "tool" | "handoff" | "retry" | "decision" | "wait";
export type TraceActivityStatus = "completed" | "failed" | "waiting" | "succeeded";

export interface TraceActivity {
  activity_id: string;
  sequence: number;
  kind: TraceActivityKind | string;
  title: string;
  summary: string;
  reason: string;
  actor: Owner;
  status: TraceActivityStatus;
  occurred_at: string;
  started_at: string | null;
  completed_at: string | null;
  input: TraceField[];
  output: TraceField[];
  source_refs: string[];
  evidence: TraceEvidenceRef[];
  retry_of_activity_id: string | null;
  attempt: number;
  error: string | null;
}

export type TracePhaseStatus = "completed" | "waiting_human" | "ready" | "failed" | "succeeded";

export interface TracePointer {
  id: string;
  title: string;
  sequence: number;
}

export interface TracePhaseProgress {
  completed_activities: number;
  total_activities: number;
}

export interface TracePhase {
  phase_id: string;
  sequence: number;
  kind: string;
  title: string;
  summary: string;
  reason: string;
  actor: Owner;
  status: TracePhaseStatus;
  occurred_at: string;
  started_at: string | null;
  completed_at: string | null;
  progress: TracePhaseProgress;
  input: TraceField[];
  output: TraceField[];
  source_refs: string[];
  evidence: TraceEvidenceRef[];
  activities: TraceActivity[];
  case_before: TraceCaseSnapshot;
  case_after: TraceCaseSnapshot;
  /** Recorded next action from the source run; replay cursors are client state. */
  next_activity: TracePointer | null;
  next_phase: TracePointer | null;
  pause_reason: string | null;
}

export interface TraceReplay {
  strategy: "ordered_phases";
  default_speed: number;
  speed_options: number[];
  pause_on_human: boolean;
  read_only: true;
  cursor_semantics: "client_revealed";
}

export interface TraceSummary {
  trace_id: string;
  name: string;
  description: string;
  mode: "saved_mock" | "backend" | string;
  case_id: string;
  trace_status?: "saved" | "completed" | "failed" | string;
  scenario?: "main" | "failure_retry" | string;
  recorded_at?: string;
  phase_count?: number;
  activity_count?: number;
  contains_human_pause?: boolean;
}

export interface Trace extends TraceSummary {
  steps: TraceStep[];
  replay?: TraceReplay;
  phases?: TracePhase[];
}

export interface ListResponse<T> {
  items: T[];
  next_cursor: string | null;
}

export interface ReplayProvenance {
  dataset_id: string;
  replay_window: string;
  source: string;
  warning: string;
  expected_state_note: string;
  boundaries: {
    external_evidence: string;
    simulated_listing: string;
    controlled_replay: string;
    simulated_batch_mapping: string;
  };
}

export interface ReplayStatus {
  stage: number;
  default_stage: number;
  scenario: string;
  mode: "backend_replay";
  dataset_id: string;
  provenance: ReplayProvenance;
  approvals: number;
  executions: number;
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
