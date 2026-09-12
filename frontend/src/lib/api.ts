import type {
  AgentStatus,
  ApprovalRecord,
  ApprovalResponse,
  CaseSnapshot,
  CaseSummary,
  ExecutionResponse,
  ListResponse,
  Product,
  Signal,
  TimelineItem,
  Trace,
  TraceSummary,
} from "../types";

export class ApiError extends Error {
  code: string;
  details: Record<string, unknown>;

  constructor(message: string, code = "request_failed", details: Record<string, unknown> = {}) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.details = details;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set("Accept", "application/json");
  if (init?.body) headers.set("Content-Type", "application/json");
  const response = await fetch(path, { ...init, headers });
  const body = (await response.json().catch(() => ({}))) as T & { error?: ApiError["details"] };
  if (!response.ok) {
    const errorBody = body as { error?: { code?: string; message?: string; details?: Record<string, unknown> } };
    throw new ApiError(
      errorBody.error?.message ?? "目前無法完成請求，請稍後再試。",
      errorBody.error?.code,
      errorBody.error?.details,
    );
  }
  return body;
}

function mutationHeaders(idempotencyKey: string): HeadersInit {
  return { "Idempotency-Key": idempotencyKey };
}

export const api = {
  listCases: () => request<ListResponse<CaseSummary>>("/api/v1/cases"),
  getCase: (caseId: string) => request<CaseSnapshot>(`/api/v1/cases/${caseId}`),
  getTimeline: (caseId: string) => request<ListResponse<TimelineItem>>(`/api/v1/cases/${caseId}/timeline`),
  getProducts: () => request<ListResponse<Product>>("/api/v1/products"),
  getSignals: () => request<ListResponse<Signal>>("/api/v1/signals"),
  getAgentStatus: (caseId: string) => request<AgentStatus>(`/api/v1/cases/${caseId}/agent-status`),
  getApprovals: (caseId: string) => request<ListResponse<ApprovalRecord>>(`/api/v1/cases/${caseId}/approvals`),
  listTraces: () => request<ListResponse<TraceSummary>>("/api/v1/traces"),
  getTrace: (traceId: string) => request<Trace>(`/api/v1/traces/${traceId}`),
  createApproval: (caseId: string, body: { case_version: number; product_ids: string[]; approved_by?: string }) =>
    request<ApprovalResponse>(`/api/v1/cases/${caseId}/approvals`, {
      method: "POST",
      headers: mutationHeaders(`approval-${caseId}-${body.case_version}-${body.product_ids.join("-")}-${Date.now()}`),
      body: JSON.stringify(body),
    }),
  executeApproval: (approvalId: string, idempotencyKey = `execute-${approvalId}-${Date.now()}`) =>
    request<ExecutionResponse>(`/api/v1/approvals/${approvalId}/execute`, {
      method: "POST",
      headers: mutationHeaders(idempotencyKey),
      body: JSON.stringify({}),
    }),
  advanceCase: (caseId: string) =>
    request<{ case: CaseSnapshot; previous_version: number }>(`/api/v1/cases/${caseId}/advance`, {
      method: "POST",
      headers: mutationHeaders(`advance-${caseId}-${Date.now()}`),
      body: JSON.stringify({ reason: "Demo 以新證據示範案件版本更新" }),
    }),
};
