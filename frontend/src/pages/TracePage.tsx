import { useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleDot,
  Clock3,
  ExternalLink,
  Gauge,
  Handshake,
  Loader2,
  Pause,
  Play,
  RotateCcw,
  Search,
  SkipBack,
  SkipForward,
  Sparkles,
  StepForward,
  UserRound,
  Wrench,
  XCircle,
} from "lucide-react";
import { Button } from "../components/ui/button";
import { api } from "../lib/api";
import type {
  Trace,
  TraceActivity,
  TraceCaseSnapshot,
  TraceEvidenceRef,
  TraceField,
  TracePhase,
} from "../types";

type StatusTone = "neutral" | "orange" | "red" | "green" | "blue";

type TracePageProps = {
  onNavigate: (path: string) => void;
  Pill: ComponentType<{ children: ReactNode; tone?: StatusTone }>;
  Panel: ComponentType<{ children: ReactNode; className?: string }>;
  ErrorNotice: ComponentType<{ error: unknown; onRetry?: () => void }>;
  statusLabel: (status: string) => string;
  statusTone: (status: string) => StatusTone;
};

type ReplayFocus = { phaseIndex: number; activityIndex: number };

const defaultSpeedOptions = [0.5, 1, 1.5, 2];

function formatTraceDate(value: string | null | undefined) {
  if (!value) return "未提供時間";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "時間格式未知";
  return new Intl.DateTimeFormat("zh-TW", { year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

function displayValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "未提供";
  if (typeof value === "boolean") return value ? "是" : "否";
  return String(value);
}

function safeHref(value: string | null | undefined) {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function activityKindLabel(kind: string) {
  return ({ search: "搜尋", read: "讀取", tool: "工具", handoff: "交接", retry: "重試", decision: "判斷", wait: "等待" } as Record<string, string>)[kind] ?? kind;
}

function phaseKindLabel(kind: string) {
  return ({ intake: "收件", dispatch: "分派", verification: "查核", assessment: "影響評估", approval: "人工核可", execution: "執行", retry: "重試" } as Record<string, string>)[kind] ?? kind;
}

function actorLabel(id: string) {
  return ({ agent_signal_gatherer: "訊號蒐集專員", agent_food_safety: "食品安全專員", employee_ops_listing: "商品營運人員" } as Record<string, string>)[id] ?? id;
}

function activityIcon(kind: string) {
  if (kind === "search") return Search;
  if (kind === "read") return BookOpen;
  if (kind === "handoff") return Handshake;
  if (kind === "retry") return RotateCcw;
  if (kind === "wait") return Clock3;
  if (kind === "tool") return Wrench;
  return Activity;
}

function orderedPhases(trace: Trace) {
  return [...(trace.phases ?? [])].sort((left, right) => left.sequence - right.sequence);
}

function phaseIsWaitingHuman(phase: TracePhase) {
  return phase.status === "waiting_human";
}

function phaseTitle(title: string) {
  return title.replace(/^Stage \d+｜/, "");
}

function phaseChangeSummary(phase: TracePhase, statusLabel: (status: string) => string) {
  const before = phase.case_before;
  const after = phase.case_after;
  const changedClaims = after.claims.filter((item) => before.claims.find((previous) => previous.claim_id === item.claim_id)?.verification_status !== item.verification_status).length;
  const changedProducts = after.candidate_products.filter((item) => {
    const previous = before.candidate_products.find((candidate) => candidate.product_id === item.product_id);
    return !previous || previous.relation !== item.relation || previous.product_status !== item.product_status;
  }).length;
  return {
    before,
    after,
    changedClaims,
    changedProducts,
    line: `${statusLabel(before.status)} → ${statusLabel(after.status)} · ${changedClaims} 項陳述 · ${changedProducts} 項商品`,
  };
}

function FieldList({ fields, statusLabel }: { fields: TraceField[]; statusLabel: (status: string) => string }) {
  if (!fields.length) return <p className="text-xs text-stone-500">未提供欄位。</p>;
  return (
    <dl className="divide-y divide-stone-200">
      {fields.map((field) => (
        <div key={`${field.key}-${field.label}`} className="grid gap-1 py-2 sm:grid-cols-[minmax(120px,0.4fr)_minmax(0,1fr)] sm:gap-4">
          <dt className="text-xs text-stone-500">{field.label}</dt>
          <dd className="min-w-0 break-words text-xs leading-5 text-stone-800">
            {field.key.includes("status") || field.key === "status" ? statusLabel(displayValue(field.value)) : displayValue(field.value)}
            {field.ref && <span className="ml-2 text-stone-500">參照：{field.ref}</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function EvidenceList({ evidence, statusLabel }: { evidence: TraceEvidenceRef[]; statusLabel: (status: string) => string }) {
  if (!evidence.length) return <p className="text-xs text-stone-500">沒有直接附上的證據。</p>;
  return (
    <div className="divide-y divide-stone-200">
      {evidence.map((item) => {
        const href = safeHref(item.url);
        return (
          <div key={item.evidence_id} className="py-2.5 first:pt-0 last:pb-0">
            <p className="text-xs font-medium text-stone-800">
              {item.label}
              {item.stance && <span className="ml-2 font-normal text-stone-500">{statusLabel(item.stance)}</span>}
            </p>
            {item.excerpt && <p className="mt-1 text-xs leading-5 text-stone-600">{item.excerpt}</p>}
            <p className="mt-1 text-xs text-stone-500">
              {item.evidence_id}
              {href ? <> · <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline underline-offset-2">開啟來源 <ExternalLink className="size-3" /></a></> : item.url ? ` · ${item.url}` : null}
            </p>
          </div>
        );
      })}
    </div>
  );
}

function SourceRefs({ refs }: { refs: string[] }) {
  return (
    <div>
      <p className="text-xs text-stone-500">來源與關聯</p>
      <p className="mt-1 break-all text-xs leading-5 text-stone-700">{refs.length ? refs.join(" · ") : "沒有提供來源參照。"}</p>
    </div>
  );
}

function SnapshotMeta({ snapshot, label, statusLabel }: { snapshot: TraceCaseSnapshot; label: string; statusLabel: (status: string) => string }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-stone-500">{label} · v{snapshot.version}</p>
      <p className="mt-1 text-sm font-medium text-stone-900">{snapshot.title || "未提供案件標題"}</p>
      <p className="mt-1 text-xs leading-5 text-stone-600">
        {statusLabel(snapshot.status)} · {statusLabel(snapshot.business_impact)} · {statusLabel(snapshot.priority)}優先 · {snapshot.owner.id}
      </p>
      <p className="mt-1 text-xs text-stone-500">{snapshot.claims.length} 項陳述 · {snapshot.candidate_products.length} 個候選商品</p>
    </div>
  );
}

function SnapshotComparison({ before, after, statusLabel }: { before: TraceCaseSnapshot; after: TraceCaseSnapshot; statusLabel: (status: string) => string }) {
  const beforeClaims = new Map(before.claims.map((claim) => [claim.claim_id, claim]));
  const afterClaims = new Map(after.claims.map((claim) => [claim.claim_id, claim]));
  const claimIds = [...new Set([...before.claims.map((claim) => claim.claim_id), ...after.claims.map((claim) => claim.claim_id)])];
  const beforeProducts = new Map(before.candidate_products.map((product) => [product.product_id, product]));
  const afterProducts = new Map(after.candidate_products.map((product) => [product.product_id, product]));
  const productIds = [...new Set([...before.candidate_products.map((product) => product.product_id), ...after.candidate_products.map((product) => product.product_id)])];
  const unknownsChanged = JSON.stringify(before.unknowns) !== JSON.stringify(after.unknowns);
  return (
    <div className="space-y-5">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:items-start">
        <SnapshotMeta snapshot={before} label="案件之前" statusLabel={statusLabel} />
        <ArrowRight className="hidden size-4 text-stone-400 lg:mt-6 lg:block" aria-hidden="true" />
        <SnapshotMeta snapshot={after} label="案件之後" statusLabel={statusLabel} />
      </div>
      <div className="border-t border-stone-200 pt-4">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-medium text-stone-800">查核狀態變化</p>
          <span className="text-xs text-stone-500">{claimIds.length} 項陳述</span>
        </div>
        {claimIds.length ? (
          <div className="mt-2 divide-y divide-stone-200">
            {claimIds.map((claimId) => {
              const previous = beforeClaims.get(claimId);
              const current = afterClaims.get(claimId);
              const changed = previous?.verification_status !== current?.verification_status;
              return (
                <div key={claimId} className="py-2 first:pt-0 last:pb-0">
                  <p className="text-xs leading-5 text-stone-700">
                    {current?.statement ?? previous?.statement ?? "未提供陳述"}
                    {changed && <span className="ml-2 font-medium text-stone-900">有變化</span>}
                  </p>
                  <p className="mt-1 text-xs text-stone-500">
                    {previous ? statusLabel(previous.verification_status) : "未出現"} → {current ? statusLabel(current.verification_status) : "未出現"}
                  </p>
                </div>
              );
            })}
          </div>
        ) : <p className="mt-2 text-xs text-stone-500">沒有提供查核陳述。</p>}
      </div>
      <div className="border-t border-stone-200 pt-4">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-medium text-stone-800">候選商品變化</p>
          <span className="text-xs text-stone-500">{productIds.length} 個商品</span>
        </div>
        {productIds.length ? (
          <div className="mt-2 divide-y divide-stone-100">
            {productIds.map((productId) => {
              const previous = beforeProducts.get(productId);
              const current = afterProducts.get(productId);
              const changed = previous?.relation !== current?.relation || previous?.product_status !== current?.product_status;
              return (
                <div key={productId} className="py-2.5">
                  <p className="break-all text-xs font-medium text-stone-800">
                    {productId}
                    {changed && <span className="ml-2 font-medium text-stone-900">有變化</span>}
                  </p>
                  <p className="mt-1 text-xs text-stone-500">關聯：{previous ? statusLabel(previous.relation) : "未出現"} → {current ? statusLabel(current.relation) : "未出現"}</p>
                  <p className="mt-0.5 text-xs text-stone-500">商品狀態：{previous?.product_status ? statusLabel(previous.product_status) : "未提供"} → {current?.product_status ? statusLabel(current.product_status) : "未提供"}</p>
                  {current?.reason && <p className="mt-1 text-xs leading-5 text-stone-600">{current.reason}</p>}
                  {current?.missing_information.length ? <p className="mt-1 text-xs text-stone-500">待補：{current.missing_information.join("、")}</p> : null}
                </div>
              );
            })}
          </div>
        ) : <p className="mt-2 text-xs text-stone-500">沒有候選商品。</p>}
      </div>
      <div className="grid gap-4 border-t border-stone-200 pt-4 sm:grid-cols-2">
        <div>
          <p className="text-xs font-medium text-stone-800">未知事項{unknownsChanged ? " · 有變化" : ""}</p>
          <ul className="mt-2 space-y-1.5 text-xs leading-5 text-stone-600">
            {(after.unknowns.length ? after.unknowns : ["沒有記錄未知事項"]).map((item) => <li key={item}>{item}</li>)}
          </ul>
        </div>
        <div>
          <p className="text-xs font-medium text-stone-800">下一步</p>
          <ul className="mt-2 space-y-1.5 text-xs leading-5 text-stone-600">
            {(after.next_steps.length ? after.next_steps : ["沒有記錄下一步"]).map((item) => <li key={item}>{item}</li>)}
          </ul>
        </div>
      </div>
    </div>
  );
}

function ActivityDetail({ activity, statusLabel }: { activity: TraceActivity; statusLabel: (status: string) => string }) {
  return (
    <div className="mt-3 space-y-4 border-t border-stone-200 pt-3">
      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <p className="mb-1 text-xs font-medium text-stone-600">輸入</p>
          <FieldList fields={activity.input} statusLabel={statusLabel} />
        </div>
        <div>
          <p className="mb-1 text-xs font-medium text-stone-600">輸出</p>
          <FieldList fields={activity.output} statusLabel={statusLabel} />
        </div>
      </div>
      {activity.error && (
        <div className="flex items-start gap-2 bg-red-50 px-3 py-2 text-xs leading-5 text-red-800">
          <XCircle className="mt-0.5 size-4 shrink-0" />
          <div><p className="font-medium">錯誤</p><p className="mt-1">{activity.error}</p></div>
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <EvidenceList evidence={activity.evidence} statusLabel={statusLabel} />
        <SourceRefs refs={activity.source_refs} />
      </div>
      {activity.retry_of_activity_id && (
        <p className="text-xs leading-5 text-stone-600">第 {activity.attempt} 次嘗試；重試來源：{activity.retry_of_activity_id}</p>
      )}
      <details className="text-xs text-stone-500">
        <summary className="cursor-pointer text-stone-600 hover:text-stone-900">技術識別碼</summary>
        <dl className="mt-2 grid gap-2 sm:grid-cols-2">
          <div><dt>activity_id</dt><dd className="mt-0.5 break-all">{activity.activity_id}</dd></div>
          <div><dt>sequence</dt><dd className="mt-0.5">{activity.sequence}</dd></div>
          <div><dt>開始時間</dt><dd className="mt-0.5">{formatTraceDate(activity.started_at)}</dd></div>
          <div><dt>完成時間</dt><dd className="mt-0.5">{formatTraceDate(activity.completed_at)}</dd></div>
        </dl>
      </details>
    </div>
  );
}

function ActivityRow({ activity, expanded, current, onToggle, statusLabel }: { activity: TraceActivity; expanded: boolean; current: boolean; onToggle: () => void; statusLabel: (status: string) => string }) {
  const Icon = activityIcon(activity.kind);
  const failed = activity.status === "failed";
  return (
    <div className="border-b border-stone-200 last:border-0">
      <button type="button" onClick={onToggle} aria-expanded={expanded} className="group flex w-full items-start gap-2.5 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-400">
        <Icon className="mt-0.5 size-3.5 shrink-0 text-stone-400" />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="text-sm font-medium text-stone-900 group-hover:underline">{activity.title}</span>
            {current && <span className="text-xs text-stone-500">目前</span>}
          </span>
          <span className="mt-0.5 block max-w-[70ch] text-sm leading-6 text-stone-600">{activity.summary}</span>
          <span className="mt-1 block text-xs text-stone-500">
            {activityKindLabel(activity.kind)} · <span className={failed ? "font-medium text-red-700" : ""}>{statusLabel(String(activity.status))}</span>
            {activity.attempt > 1 ? ` · 第 ${activity.attempt} 次` : ""}
          </span>
        </span>
        <ChevronDown className={`mt-0.5 size-3.5 shrink-0 text-stone-400 transition-transform ${expanded ? "rotate-180" : ""}`} />
      </button>
      {expanded && (
        <div className="mb-3 ml-6 bg-stone-50 px-3 py-3">
          <p className="text-sm leading-6 text-stone-700"><span className="font-medium text-stone-900">判斷依據：</span>{activity.reason}</p>
          <p className="mt-1 text-xs text-stone-500">{actorLabel(activity.actor.id)} · {formatTraceDate(activity.occurred_at)}</p>
          <ActivityDetail activity={activity} statusLabel={statusLabel} />
        </div>
      )}
    </div>
  );
}

function PhaseDetails({ phase, allActivitiesRevealed, statusLabel }: { phase: TracePhase; allActivitiesRevealed: boolean; statusLabel: (status: string) => string }) {
  if (!allActivitiesRevealed) return null;
  const change = phaseChangeSummary(phase, statusLabel);
  return (
    <div className="mt-4 border-t border-stone-200 pt-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-sm font-semibold text-stone-900">案件變化</h4>
        <span className="text-xs text-stone-500">v{change.before.version} → v{change.after.version}</span>
      </div>
      <p className="mt-1 text-sm leading-6 text-stone-700">{change.line}</p>
      <details className="group mt-1">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 py-2 text-sm text-stone-600 hover:text-stone-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-400">
          <ChevronRight className="size-3.5 group-open:rotate-90" />比較完整案件快照
        </summary>
        <div className="pb-2"><SnapshotComparison before={change.before} after={change.after} statusLabel={statusLabel} /></div>
      </details>
      <details className="group">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 py-2 text-sm text-stone-600 hover:text-stone-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-400">
          <ChevronRight className="size-3.5 group-open:rotate-90" />
          階段資料與證據
          <span className="text-xs text-stone-500">{phase.evidence.length ? `${phase.evidence.length} 筆證據` : "輸入、輸出與來源"}</span>
        </summary>
        <div className="space-y-4 bg-stone-50 px-3 py-3">
          <div className="grid gap-4 md:grid-cols-2">
            <div><h5 className="mb-1 text-xs font-medium text-stone-600">輸入</h5><FieldList fields={phase.input} statusLabel={statusLabel} /></div>
            <div><h5 className="mb-1 text-xs font-medium text-stone-600">輸出</h5><FieldList fields={phase.output} statusLabel={statusLabel} /></div>
          </div>
          <EvidenceList evidence={phase.evidence} statusLabel={statusLabel} />
          <SourceRefs refs={phase.source_refs} />
          {phase.pause_reason && <p className="text-sm leading-6 text-stone-700">停頓原因：{phase.pause_reason}</p>}
        </div>
      </details>
    </div>
  );
}

function PhaseTimeline({ phases, focus, revealedPhaseCount, revealedActivities, expandedPhases, expandedActivities, currentPhaseRef, statusLabel, onTogglePhase, onToggleActivity }: { phases: TracePhase[]; focus: ReplayFocus; revealedPhaseCount: number; revealedActivities: Record<string, number>; expandedPhases: Record<string, boolean>; expandedActivities: Record<string, boolean>; currentPhaseRef: { current: HTMLDivElement | null }; statusLabel: (status: string) => string; onTogglePhase: (phaseId: string) => void; onToggleActivity: (activityId: string) => void }) {
  return (
    <ol aria-label="Trace 垂直時間軸">
      {phases.map((phase, index) => {
        const revealed = index < revealedPhaseCount;
        const current = revealed && index === focus.phaseIndex;
        const expanded = Boolean(expandedPhases[phase.phase_id]);
        const count = Math.min(revealedActivities[phase.phase_id] ?? 0, phase.activities.length);
        const allActivitiesRevealed = count >= phase.activities.length;
        const change = revealed && allActivitiesRevealed ? phaseChangeSummary(phase, statusLabel) : null;
        return (
          <li key={phase.phase_id} className="relative flex gap-3 pb-6 last:pb-0 sm:gap-4">
            <div className="relative flex w-7 shrink-0 justify-center">
              {index < phases.length - 1 && <span aria-hidden="true" className="absolute bottom-[-1.5rem] top-7 w-px bg-stone-200" />}
              <span aria-hidden="true" className={`relative mt-0.5 flex size-7 items-center justify-center rounded-full text-xs font-semibold ${current ? "bg-stone-900 text-white" : revealed ? "border border-stone-300 bg-white text-stone-700" : "bg-stone-100 text-stone-400"}`}>{phase.sequence}</span>
            </div>
            <div ref={current ? currentPhaseRef : undefined} aria-current={current ? "step" : undefined} className="min-w-0 flex-1 scroll-mt-28">
              {revealed ? (
                <>
                  <button type="button" onClick={() => onTogglePhase(phase.phase_id)} aria-expanded={expanded} className="w-full rounded-md py-0.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-400">
                    <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs text-stone-500">
                      <span>{phaseKindLabel(phase.kind)}</span>
                      {current && <span className="font-medium text-stone-900">目前播放</span>}
                      <span className="ml-auto">{statusLabel(phase.status)}</span>
                    </span>
                    <span className="mt-1 flex items-start justify-between gap-3">
                      <span role="heading" aria-level={3} className={`leading-7 tracking-tight ${current || expanded ? "text-lg font-semibold text-stone-950" : "text-base font-semibold text-stone-800"}`}>{phaseTitle(phase.title)}</span>
                      <ChevronDown className={`mt-1.5 size-4 shrink-0 text-stone-400 transition-transform ${expanded ? "rotate-180" : ""}`} />
                    </span>
                    {expanded ? (
                      <>
                        <span className="mt-1 block max-w-[70ch] text-sm leading-6 text-stone-700">{phase.summary}</span>
                        <span className="mt-2 block text-xs text-stone-500">{formatTraceDate(phase.occurred_at)} · {count} / {phase.activities.length} 個活動</span>
                      </>
                    ) : (
                      <span className="mt-1 block max-w-[70ch] text-sm leading-6 text-stone-600">
                        {change ? change.line : `${count} / ${phase.activities.length} 個活動`}
                      </span>
                    )}
                  </button>
                  {expanded && (
                    <div className="mt-3 border-t border-stone-200 pt-3">
                      <p className="max-w-[70ch] text-sm leading-6 text-stone-700"><span className="font-medium text-stone-900">判斷依據：</span>{phase.reason}</p>
                      <section className="mt-4 pl-3" aria-label="Agent 活動">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <h4 className="text-xs font-medium text-stone-500">Agent 活動</h4>
                          <span className="text-xs text-stone-500">{actorLabel(phase.actor.id)}</span>
                        </div>
                        <div className="mt-1">
                          {phase.activities.slice(0, count).map((activity, activityIndex) => (
                            <ActivityRow key={activity.activity_id} activity={activity} current={current && activityIndex === focus.activityIndex} expanded={Boolean(expandedActivities[activity.activity_id])} onToggle={() => onToggleActivity(activity.activity_id)} statusLabel={statusLabel} />
                          ))}
                        </div>
                        {count < phase.activities.length && <p className="py-2 text-sm text-stone-500">還有 {phase.activities.length - count} 個活動待播放</p>}
                        {!phase.activities.length && <p className="py-2 text-sm text-stone-500">此階段沒有活動記錄。</p>}
                      </section>
                      <PhaseDetails phase={phase} allActivitiesRevealed={allActivitiesRevealed} statusLabel={statusLabel} />
                    </div>
                  )}
                </>
              ) : (
                <p className="pt-1 text-sm text-stone-400">{phaseKindLabel(phase.kind)} · 尚未播放</p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function LegacyTraceFallback({ trace, Pill, Panel, statusLabel, statusTone, onNavigate }: { trace: Trace; Pill: TracePageProps["Pill"]; Panel: TracePageProps["Panel"]; statusLabel: (status: string) => string; statusTone: (status: string) => StatusTone; onNavigate: (path: string) => void }) {
  const [stepIndex, setStepIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const steps = trace.steps ?? [];
  const currentStep = steps[stepIndex];
  useEffect(() => setStepIndex(0), [trace.trace_id]);
  useEffect(() => { if (!playing || !steps.length) return; const timer = window.setInterval(() => setStepIndex((index) => { if (index >= steps.length - 1) { setPlaying(false); return index; } return index + 1; }), 2600); return () => window.clearInterval(timer); }, [playing, steps.length]);
  if (!currentStep) return <Panel className="p-6"><p className="font-semibold text-slate-800">這個情境沒有可播放的舊版步驟。</p></Panel>;
  return <Panel className="p-6"><div className="flex flex-wrap items-start justify-between gap-4"><div><Pill tone="neutral">legacy steps</Pill><h2 className="mt-2 text-xl font-semibold text-slate-900">{trace.name}</h2><p className="mt-2 text-sm leading-6 text-slate-600">此保存紀錄尚未提供 rich phases；先以相容模式顯示既有步驟。</p></div><Pill tone="neutral">第 {stepIndex + 1} / {steps.length} 步</Pill></div><ol className="mt-6 space-y-3">{steps.map((step, index) => <li key={step.step_id} className={`rounded-lg border p-4 ${index === stepIndex ? "border-slate-400 bg-slate-50" : index < stepIndex ? "border-slate-200 bg-white" : "border-dashed border-slate-300 bg-slate-50/60"}`}><button type="button" onClick={() => { setStepIndex(index); setPlaying(false); }} className="w-full text-left"><div className="flex flex-wrap items-center gap-2"><span className="text-xs font-semibold text-slate-500">第 {step.sequence} 步</span><Pill tone={statusTone(step.status)}>{statusLabel(step.status)}</Pill></div><p className="mt-2 text-sm font-semibold text-slate-800">{step.title}</p><p className="mt-1 text-sm leading-6 text-slate-600">{step.summary}</p></button></li>)}</ol><div className="mt-6 flex flex-wrap items-center gap-2"><button type="button" onClick={() => { setStepIndex((index) => Math.max(index - 1, 0)); setPlaying(false); }} disabled={stepIndex === 0} className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 disabled:opacity-40"><ArrowLeft className="size-4" />上一步</button><button type="button" onClick={() => setPlaying((value) => !value)} disabled={stepIndex === steps.length - 1} className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40">{playing ? <Pause className="size-4" /> : <Play className="size-4" />}{playing ? "暫停" : "播放"}</button><button type="button" onClick={() => { setStepIndex((index) => Math.min(index + 1, steps.length - 1)); setPlaying(false); }} disabled={stepIndex === steps.length - 1} className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 disabled:opacity-40">下一步<ArrowRight className="size-4" /></button><button type="button" onClick={() => onNavigate(`/cases/${trace.case_id}/timeline`)} className="ml-auto inline-flex items-center gap-1.5 text-sm font-medium text-slate-700 underline underline-offset-2">查看案件時間軸<ArrowRight className="size-3.5" /></button></div></Panel>;
}

function PlaybackDock({ children }: { children: ReactNode }) {
  const dockRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(96);
  useEffect(() => {
    const dock = dockRef.current;
    if (!dock) return;
    const update = () => setHeight(dock.getBoundingClientRect().height);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(dock);
    return () => observer.disconnect();
  }, []);
  return (
    <>
      <div aria-hidden="true" style={{ height: height + 16 }} />
      <div
        ref={dockRef}
        role="region"
        aria-label="回放控制"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-stone-200 bg-white px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2.5 sm:px-8 lg:left-[var(--sidebar-width)]"
      >
        <div className="mx-auto max-w-5xl">{children}</div>
      </div>
    </>
  );
}

function RichTraceReplay({ trace, phases, statusLabel, onNavigate }: { trace: Trace; phases: TracePhase[]; Pill: TracePageProps["Pill"]; Panel: TracePageProps["Panel"]; statusLabel: (status: string) => string; statusTone: TracePageProps["statusTone"]; onNavigate: (path: string) => void }) {
  const firstPhase = phases[0];
  const [revealedPhaseCount, setRevealedPhaseCount] = useState(0);
  const [revealedActivities, setRevealedActivities] = useState<Record<string, number>>({});
  const [focus, setFocus] = useState<ReplayFocus>({ phaseIndex: 0, activityIndex: 0 });
  const [expandedPhases, setExpandedPhases] = useState<Record<string, boolean>>({});
  const [expandedActivities, setExpandedActivities] = useState<Record<string, boolean>>({});
  const [humanPauseHandled, setHumanPauseHandled] = useState<Record<string, boolean>>({});
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(trace.replay?.default_speed ?? 1);
  const currentPhaseRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const initialCount = firstPhase?.activities.length ? 1 : 0;
    setRevealedPhaseCount(firstPhase ? 1 : 0);
    setRevealedActivities(firstPhase ? { [firstPhase.phase_id]: initialCount } : {});
    setFocus({ phaseIndex: 0, activityIndex: 0 });
    setExpandedPhases(firstPhase ? { [firstPhase.phase_id]: true } : {});
    setExpandedActivities({});
    setHumanPauseHandled({});
    setPlaying(false);
    setSpeed(trace.replay?.default_speed ?? 1);
  }, [trace.trace_id, firstPhase?.phase_id]);

  const currentPhase = phases[focus.phaseIndex];
  const currentRevealedActivityCount = currentPhase ? Math.min(revealedActivities[currentPhase.phase_id] ?? 0, currentPhase.activities.length) : 0;
  const canGoBack = focus.phaseIndex > 0 || focus.activityIndex > 0;
  const speedOptions = trace.replay?.speed_options?.length ? trace.replay.speed_options : defaultSpeedOptions;

  const revealPhase = (phaseIndex: number, activityCount = 1) => {
    const phase = phases[phaseIndex];
    if (!phase) return;
    setRevealedPhaseCount((count) => Math.max(count, phaseIndex + 1));
    setRevealedActivities((current) => ({ ...current, [phase.phase_id]: Math.max(current[phase.phase_id] ?? 0, Math.min(activityCount, phase.activities.length)) }));
    setExpandedPhases({ [phase.phase_id]: true });
    setFocus({ phaseIndex, activityIndex: Math.max(0, Math.min(activityCount - 1, phase.activities.length - 1)) });
  };
  const revealAllActivities = (phase: TracePhase) => setRevealedActivities((current) => ({ ...current, [phase.phase_id]: phase.activities.length }));
  const moveToNextPhase = (explicitContinue = true) => {
    if (!currentPhase) return;
    if (phaseIsWaitingHuman(currentPhase) && explicitContinue) setHumanPauseHandled((current) => ({ ...current, [currentPhase.phase_id]: true }));
    revealAllActivities(currentPhase);
    if (focus.phaseIndex >= phases.length - 1) { setFocus({ phaseIndex: focus.phaseIndex, activityIndex: Math.max(0, currentPhase.activities.length - 1) }); setPlaying(false); return; }
    revealPhase(focus.phaseIndex + 1, 1);
  };
  const moveToNextActivity = () => {
    if (!currentPhase) return;
    setPlaying(false);
    if (currentRevealedActivityCount < currentPhase.activities.length) {
      const nextCount = currentRevealedActivityCount + 1;
      setRevealedActivities((current) => ({ ...current, [currentPhase.phase_id]: nextCount }));
      setFocus({ phaseIndex: focus.phaseIndex, activityIndex: nextCount - 1 });
      setExpandedPhases((current) => ({ ...current, [currentPhase.phase_id]: true }));
      return;
    }
    moveToNextPhase(true);
  };
  const moveBack = () => {
    setPlaying(false);
    if (!currentPhase) return;
    if (focus.activityIndex > 0) { setFocus((current) => ({ ...current, activityIndex: current.activityIndex - 1 })); return; }
    if (focus.phaseIndex > 0) { const previousIndex = focus.phaseIndex - 1; const previous = phases[previousIndex]; setExpandedPhases({ [previous.phase_id]: true }); const previousCount = revealedActivities[previous.phase_id] ?? previous.activities.length; setFocus({ phaseIndex: previousIndex, activityIndex: Math.max(0, Math.min(previousCount - 1, previous.activities.length - 1)) }); }
  };
  const restart = () => {
    const initialCount = firstPhase?.activities.length ? 1 : 0;
    setPlaying(false); setRevealedPhaseCount(firstPhase ? 1 : 0); setRevealedActivities(firstPhase ? { [firstPhase.phase_id]: initialCount } : {}); setFocus({ phaseIndex: 0, activityIndex: 0 }); setExpandedPhases(firstPhase ? { [firstPhase.phase_id]: true } : {}); setExpandedActivities({}); setHumanPauseHandled({});
  };
  const togglePlay = () => {
    if (playing) { setPlaying(false); return; }
    if (currentPhase && phaseIsWaitingHuman(currentPhase) && !humanPauseHandled[currentPhase.phase_id]) { moveToNextPhase(true); return; }
    setPlaying(true);
  };

  useEffect(() => {
    if (!playing || !currentPhase) return;
    const timer = window.setTimeout(() => {
      const count = Math.min(revealedActivities[currentPhase.phase_id] ?? 0, currentPhase.activities.length);
      if (count < currentPhase.activities.length) { const nextCount = count + 1; setRevealedActivities((current) => ({ ...current, [currentPhase.phase_id]: nextCount })); setFocus({ phaseIndex: focus.phaseIndex, activityIndex: nextCount - 1 }); return; }
      if (phaseIsWaitingHuman(currentPhase) && !humanPauseHandled[currentPhase.phase_id] && trace.replay?.pause_on_human !== false) { setPlaying(false); return; }
      if (focus.phaseIndex < phases.length - 1) { revealAllActivities(currentPhase); revealPhase(focus.phaseIndex + 1, 1); return; }
      setPlaying(false);
    }, Math.max(450, 1500 / Math.max(speed, 0.1)));
    return () => window.clearTimeout(timer);
  }, [playing, currentPhase, focus.phaseIndex, revealedActivities, humanPauseHandled, phases.length, speed, trace.replay?.pause_on_human]);

  const currentIsPausedForHuman = Boolean(currentPhase && phaseIsWaitingHuman(currentPhase) && !humanPauseHandled[currentPhase.phase_id]);
  const returnToCurrent = () => currentPhaseRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  const atEnd = focus.phaseIndex >= phases.length - 1 && currentRevealedActivityCount >= (currentPhase?.activities.length ?? 0);
  return (
    <div className="mx-auto max-w-5xl">
      <header className="mb-8">
        <h2 className="text-2xl font-semibold tracking-tight text-stone-950">{trace.name}</h2>
        <p className="mt-2 max-w-[70ch] text-sm leading-6 text-stone-600">{trace.description}</p>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-stone-500">
          <span>{phases.length} 個階段 · {phases.reduce((total, phase) => total + phase.activities.length, 0)} 個活動</span>
          <span>保存於 {formatTraceDate(trace.recorded_at)}</span>
          <button type="button" onClick={() => onNavigate(`/cases/${trace.case_id}/timeline`)} className="inline-flex items-center gap-1 text-stone-700 underline underline-offset-4">案件時間軸<ArrowRight className="size-3" /></button>
        </div>
      </header>
      <PhaseTimeline phases={phases} focus={focus} revealedPhaseCount={revealedPhaseCount} revealedActivities={revealedActivities} expandedPhases={expandedPhases} expandedActivities={expandedActivities} currentPhaseRef={currentPhaseRef} statusLabel={statusLabel} onTogglePhase={(phaseId) => setExpandedPhases((current) => ({ ...current, [phaseId]: !current[phaseId] }))} onToggleActivity={(activityId) => setExpandedActivities((current) => ({ ...current, [activityId]: !current[activityId] }))} />
      <details className="mt-8 border-t border-stone-200 py-4 text-xs text-stone-500">
        <summary className="cursor-pointer text-stone-600 hover:text-stone-900">關於這份回放與原始紀錄</summary>
        <p className="mt-3 max-w-[70ch] leading-6">播放與展開只讀取保存紀錄；未播放的結果保持隱藏。手動捲動不會被播放拉回，可使用「定位目前階段」回看。</p>
        <dl className="mt-3 space-y-2">
          <div><dt>Trace ID</dt><dd className="break-all">{trace.trace_id}</dd></div>
          <div><dt>案件 ID</dt><dd className="break-all">{trace.case_id}</dd></div>
          <div><dt>暫停規則</dt><dd>{trace.replay?.pause_on_human === false ? "不在人工點停頓" : "人工點停頓一次"}</dd></div>
        </dl>
      </details>
      <PlaybackDock>
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <p className="min-w-0 text-sm font-medium text-stone-900">
            {atEnd ? "回放已到最後一個活動" : `第 ${focus.phaseIndex + 1} / ${phases.length} 階段`}
            <span className="ml-2 font-normal text-stone-500">{currentPhase ? phaseTitle(currentPhase.title) : ""}</span>
          </p>
          <button type="button" onClick={returnToCurrent} className="inline-flex items-center gap-1.5 text-xs text-stone-600 hover:text-stone-950">
            <CircleDot className="size-3.5" />定位目前階段
          </button>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={moveBack} disabled={!canGoBack}><SkipBack className="size-4" />上一步</Button>
          <Button size="sm" onClick={togglePlay} disabled={atEnd && !playing}>{playing ? <Pause className="size-4" /> : <Play className="size-4" />}{playing ? "暫停" : currentIsPausedForHuman ? "繼續回放" : "播放"}</Button>
          <Button variant="outline" size="sm" onClick={moveToNextActivity} disabled={!currentPhase || atEnd}><StepForward className="size-4" />下一活動</Button>
          <Button variant="ghost" size="sm" onClick={() => { setPlaying(false); moveToNextPhase(true); }} disabled={!currentPhase || focus.phaseIndex >= phases.length - 1}><SkipForward className="size-4" />下一階段</Button>
          <Button variant="ghost" size="sm" onClick={restart}><RotateCcw className="size-3.5" />重播</Button>
          <label className="ml-auto inline-flex h-9 items-center gap-1.5 text-xs text-stone-600">
            <Gauge className="size-3.5" />
            <select aria-label="播放速度" value={speed} onChange={(event) => setSpeed(Number(event.target.value))} className="rounded-md border border-stone-200 bg-white px-2 py-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-400">
              {speedOptions.map((option) => <option key={option} value={option}>{option}x</option>)}
            </select>
          </label>
        </div>
        {currentIsPausedForHuman && (
          <div role="status" className="mt-2 flex gap-2 bg-amber-50 px-3 py-2 text-sm leading-6 text-amber-950">
            <UserRound className="mt-1 size-4 shrink-0" />
            <span><strong>人工核可點</strong> · 已暫停，繼續只播放保存紀錄，不會建立核可。</span>
          </div>
        )}
      </PlaybackDock>
    </div>
  );
}

export function TracePage({ onNavigate, Pill, Panel, ErrorNotice, statusLabel, statusTone }: TracePageProps) {
  const traces = useQuery({ queryKey: ["traces"], queryFn: api.listTraces });
  const [traceId, setTraceId] = useState<string | undefined>();
  const selectedId = traceId ?? traces.data?.items[0]?.trace_id;
  const trace = useQuery({ queryKey: ["trace", selectedId], queryFn: () => api.getTrace(selectedId as string), enabled: Boolean(selectedId) });
  useEffect(() => { if (!traceId && traces.data?.items[0]?.trace_id) setTraceId(traces.data.items[0].trace_id); }, [traceId, traces.data?.items]);
  const scenarios = traces.data?.items ?? [];
  const phases = useMemo(() => trace.data ? orderedPhases(trace.data) : [], [trace.data]);
  if (traces.isLoading) return <div role="status" className="flex items-center gap-2 text-sm text-stone-500"><Loader2 className="size-4 animate-spin" />載入回放情境…</div>;
  if (traces.isError) return <ErrorNotice error={traces.error} onRetry={() => traces.refetch()} />;
  if (!scenarios.length) return <Panel className="p-6"><div className="flex items-start gap-3"><CircleAlert className="mt-0.5 size-5 text-stone-500" /><div><h2 className="font-semibold text-stone-900">目前沒有保存的回放</h2><p className="mt-1 text-sm leading-6 text-stone-600">請先啟動提供 `/api/v1/traces` 的服務，或確認保存紀錄仍可讀取。</p></div></div></Panel>;
  return (
    <div className="space-y-6">
      {trace.isLoading && <div role="status" className="flex items-center gap-2 text-sm text-stone-500"><Loader2 className="size-4 animate-spin" />載入保存情境…</div>}
      {trace.isError && <ErrorNotice error={trace.error} onRetry={() => trace.refetch()} />}
      {trace.data && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-200 pb-3 text-xs text-stone-600">
            <label className="inline-flex items-center gap-2 font-medium" htmlFor="trace-scenario-top">
              <span>情境</span>
              <select id="trace-scenario-top" aria-label="選擇保存情境" value={selectedId} onChange={(event) => setTraceId(event.target.value)} className="max-w-[min(70vw,28rem)] rounded-md border border-stone-300 bg-white px-2 py-1.5 text-xs text-stone-800 outline-none focus-visible:ring-2 focus-visible:ring-stone-400">
                {scenarios.map((item) => <option key={item.trace_id} value={item.trace_id}>{item.name}</option>)}
              </select>
            </label>
            <span className="inline-flex items-center gap-1.5"><Sparkles className="size-3.5" />{trace.data.mode === "saved_mock" ? "合成 mock · 唯讀" : `${trace.data.mode} · 唯讀`}</span>
          </div>
          {phases.length ? (
            <RichTraceReplay trace={trace.data} phases={phases} Pill={Pill} Panel={Panel} statusLabel={statusLabel} statusTone={statusTone} onNavigate={onNavigate} />
          ) : trace.data.steps?.length ? (
            <LegacyTraceFallback trace={trace.data} Pill={Pill} Panel={Panel} statusLabel={statusLabel} statusTone={statusTone} onNavigate={onNavigate} />
          ) : (
            <Panel className="p-6">
              <h2 className="font-semibold text-stone-900">這個情境沒有可播放資料</h2>
              <p className="mt-1 text-sm leading-6 text-stone-600">Trace 回應沒有 `phases` 或相容的 `steps`，請檢查保存紀錄形狀。</p>
            </Panel>
          )}
        </>
      )}
    </div>
  );
}
