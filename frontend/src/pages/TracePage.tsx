import { useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleDot,
  Clock3,
  ExternalLink,
  FileText,
  Gauge,
  Handshake,
  Info,
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
import { api } from "../lib/api";
import type {
  Trace,
  TraceActivity,
  TraceCaseSnapshot,
  TraceClaimSnapshot,
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
  return ({ intake: "收件", dispatch: "分派", verification: "查核", approval: "人工核可", execution: "執行", retry: "重試" } as Record<string, string>)[kind] ?? kind;
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

function FieldList({ fields, statusLabel }: { fields: TraceField[]; statusLabel: (status: string) => string }) {
  if (!fields.length) return <p className="text-xs text-slate-500">未提供欄位。</p>;
  return (
    <dl className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
      {fields.map((field) => (
        <div key={`${field.key}-${field.label}`} className="grid gap-1 px-3 py-2.5 sm:grid-cols-[minmax(120px,0.45fr)_minmax(0,1fr)] sm:gap-4">
          <dt className="text-xs font-medium text-slate-500">{field.label}</dt>
          <dd className="min-w-0 break-words text-xs leading-5 text-slate-800">
            {field.key.includes("status") || field.key === "status" ? statusLabel(displayValue(field.value)) : displayValue(field.value)}
            {field.ref && <span className="ml-2 text-[11px] text-slate-400">參照：{field.ref}</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function EvidenceList({ evidence, statusLabel }: { evidence: TraceEvidenceRef[]; statusLabel: (status: string) => string }) {
  if (!evidence.length) return <p className="text-xs text-slate-500">沒有直接附上的證據。</p>;
  return (
    <div className="space-y-2">
      {evidence.map((item) => {
        const href = safeHref(item.url);
        return (
          <div key={item.evidence_id} className="rounded-lg border border-slate-200 bg-white px-3 py-2.5">
            <div className="flex flex-wrap items-center gap-2"><p className="text-xs font-medium text-slate-800">{item.label}</p>{item.stance && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">{statusLabel(item.stance)}</span>}</div>
            {item.excerpt && <p className="mt-1.5 text-xs leading-5 text-slate-600">{item.excerpt}</p>}
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-400"><span>證據 ID：{item.evidence_id}</span>{href ? <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-slate-600 underline underline-offset-2">開啟來源 <ExternalLink className="size-3" /></a> : item.url ? <span>來源網址：{item.url}</span> : null}</div>
          </div>
        );
      })}
    </div>
  );
}

function SourceRefs({ refs }: { refs: string[] }) {
  return <div><p className="text-xs font-medium text-slate-500">來源與關聯</p>{refs.length ? <div className="mt-2 flex flex-wrap gap-1.5">{refs.map((ref) => <span key={ref} className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-600">{ref}</span>)}</div> : <p className="mt-2 text-xs text-slate-500">沒有提供來源參照。</p>}</div>;
}

function SnapshotMeta({ snapshot, label, statusLabel }: { snapshot: TraceCaseSnapshot; label: string; statusLabel: (status: string) => string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{label}</p><span className="rounded-full border border-slate-200 px-2 py-0.5 text-[11px] text-slate-600">v{snapshot.version}</span></div>
      <p className="mt-2 text-sm font-medium text-slate-800">{snapshot.title || "未提供案件標題"}</p>
      <div className="mt-2 flex flex-wrap gap-1.5"><span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">{statusLabel(snapshot.status)}</span><span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">{statusLabel(snapshot.business_impact)}</span><span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">{statusLabel(snapshot.priority)}優先</span><span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">負責：{snapshot.owner.id}</span></div>
      <p className="mt-2 text-xs text-slate-500">{snapshot.claims.length} 項陳述 · {snapshot.candidate_products.length} 個候選商品</p>
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
    <div className="space-y-4">
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:items-center"><SnapshotMeta snapshot={before} label="案件之前" statusLabel={statusLabel} /><ArrowRight className="hidden size-5 text-slate-400 lg:block" aria-hidden="true" /><SnapshotMeta snapshot={after} label="案件之後" statusLabel={statusLabel} /></div>
      <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3"><div className="flex items-center justify-between gap-2"><p className="text-xs font-semibold text-slate-700">查核狀態變化</p><span className="text-[11px] text-slate-500">{claimIds.length} 項陳述</span></div>{claimIds.length ? <div className="mt-2 divide-y divide-slate-200">{claimIds.map((claimId) => { const previous = beforeClaims.get(claimId); const current = afterClaims.get(claimId); const changed = previous?.verification_status !== current?.verification_status; return <div key={claimId} className="py-2 first:pt-0 last:pb-0"><div className="flex flex-wrap items-start justify-between gap-2"><p className="min-w-0 flex-1 text-xs leading-5 text-slate-700">{current?.statement ?? previous?.statement ?? "未提供陳述"}</p>{changed && <span className="rounded-full bg-slate-900 px-2 py-0.5 text-[10px] font-medium text-white">有變化</span>}</div><div className="mt-1 flex flex-wrap gap-1.5 text-[11px]"><span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-slate-500">之前：{previous ? statusLabel(previous.verification_status) : "未出現"}</span><span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-slate-700">之後：{current ? statusLabel(current.verification_status) : "未出現"}</span></div></div>; })}</div> : <p className="mt-2 text-xs text-slate-500">沒有提供查核陳述。</p>}</div>
      <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3"><div className="flex items-center justify-between gap-2"><p className="text-xs font-semibold text-slate-700">候選商品變化</p><span className="text-[11px] text-slate-500">{productIds.length} 個商品</span></div>{productIds.length ? <div className="mt-2 grid gap-2 sm:grid-cols-2">{productIds.map((productId) => { const previous = beforeProducts.get(productId); const current = afterProducts.get(productId); const changed = previous?.relation !== current?.relation || previous?.product_status !== current?.product_status; return <div key={productId} className="rounded-md border border-slate-200 bg-white p-2.5"><div className="flex items-start justify-between gap-2"><p className="break-all text-xs font-medium text-slate-700">{productId}</p>{changed && <span className="shrink-0 text-[10px] font-medium text-slate-700">有變化</span>}</div><p className="mt-1 text-[11px] text-slate-500">關聯：{previous ? statusLabel(previous.relation) : "未出現"} → {current ? statusLabel(current.relation) : "未出現"}</p><p className="mt-1 text-[11px] text-slate-500">商品狀態：{previous?.product_status ? statusLabel(previous.product_status) : "未提供"} → {current?.product_status ? statusLabel(current.product_status) : "未提供"}</p>{current?.reason && <p className="mt-1.5 text-[11px] leading-4 text-slate-600">{current.reason}</p>}{current?.missing_information.length ? <p className="mt-1 text-[11px] leading-4 text-slate-500">待補：{current.missing_information.join("、")}</p> : null}</div>; })}</div> : <p className="mt-2 text-xs text-slate-500">沒有候選商品。</p>}</div>
      <div className="grid gap-3 sm:grid-cols-2"><div className={`rounded-lg border p-3 ${unknownsChanged ? "border-slate-300 bg-white" : "border-slate-200 bg-slate-50/70"}`}><div className="flex items-center justify-between gap-2"><p className="text-xs font-semibold text-slate-700">未知事項</p>{unknownsChanged && <span className="text-[10px] font-medium text-slate-700">有變化</span>}</div><ul className="mt-2 space-y-1.5 text-xs leading-5 text-slate-600">{(after.unknowns.length ? after.unknowns : ["沒有記錄未知事項"]).map((item) => <li key={item} className="flex gap-2"><span className="mt-2 size-1 shrink-0 rounded-full bg-slate-400" />{item}</li>)}</ul></div><div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3"><p className="text-xs font-semibold text-slate-700">下一步</p><ul className="mt-2 space-y-1.5 text-xs leading-5 text-slate-600">{(after.next_steps.length ? after.next_steps : ["沒有記錄下一步"]).map((item) => <li key={item} className="flex gap-2"><ArrowRight className="mt-1 size-3 shrink-0 text-slate-400" />{item}</li>)}</ul></div></div>
    </div>
  );
}

function ActivityDetail({ activity, statusLabel }: { activity: TraceActivity; statusLabel: (status: string) => string }) {
  return <div className="mt-3 space-y-4 border-t border-slate-200 pt-3"><div className="grid gap-3 lg:grid-cols-2"><div><p className="mb-2 text-xs font-semibold text-slate-600">輸入</p><FieldList fields={activity.input} statusLabel={statusLabel} /></div><div><p className="mb-2 text-xs font-semibold text-slate-600">輸出</p><FieldList fields={activity.output} statusLabel={statusLabel} /></div></div>{activity.error && <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-xs leading-5 text-red-800"><XCircle className="mt-0.5 size-4 shrink-0" /><div><p className="font-semibold">錯誤</p><p className="mt-1">{activity.error}</p></div></div>}<div className="grid gap-3 lg:grid-cols-2"><EvidenceList evidence={activity.evidence} statusLabel={statusLabel} /><SourceRefs refs={activity.source_refs} /></div>{activity.retry_of_activity_id && <div className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs leading-5 text-slate-700"><RotateCcw className="mt-0.5 size-4 shrink-0" /><span>第 {activity.attempt} 次嘗試；重試來源：{activity.retry_of_activity_id}</span></div>}<details className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600"><summary className="cursor-pointer font-medium text-slate-700">原始活動細節（唯讀）</summary><dl className="mt-2 grid gap-2 border-t border-slate-200 pt-2 sm:grid-cols-2"><div><dt className="text-slate-400">activity_id</dt><dd className="mt-0.5 break-all">{activity.activity_id}</dd></div><div><dt className="text-slate-400">sequence</dt><dd className="mt-0.5">{activity.sequence}</dd></div><div><dt className="text-slate-400">開始時間</dt><dd className="mt-0.5">{formatTraceDate(activity.started_at)}</dd></div><div><dt className="text-slate-400">完成時間</dt><dd className="mt-0.5">{formatTraceDate(activity.completed_at)}</dd></div></dl></details></div>;
}

function ActivityRow({ activity, expanded, onToggle, statusLabel }: { activity: TraceActivity; expanded: boolean; onToggle: () => void; statusLabel: (status: string) => string }) {
  const Icon = activityIcon(activity.kind);
  const status = String(activity.status);
  return <div className="rounded-lg border border-slate-200 bg-white"><button type="button" onClick={onToggle} aria-expanded={expanded} className="flex w-full items-start gap-3 p-3 text-left hover:bg-slate-50"><span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-600"><Icon className="size-4" /></span><span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-1.5"><span className="rounded-full border border-slate-200 px-2 py-0.5 text-[10px] font-medium text-slate-600">{activityKindLabel(activity.kind)}</span><span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600">記錄：{statusLabel(status)}</span><span className="text-[11px] text-slate-400">第 {activity.attempt} 次</span></span><span className="mt-1 block text-sm font-medium leading-5 text-slate-800">{activity.title}</span><span className="mt-1 block text-xs leading-5 text-slate-600">{activity.summary}</span><span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-400"><span className="inline-flex items-center gap-1"><UserRound className="size-3" />{activity.actor.id}</span><span className="inline-flex items-center gap-1"><Clock3 className="size-3" />{formatTraceDate(activity.occurred_at)}</span></span></span><span className="mt-1 shrink-0 text-slate-400">{expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}</span></button>{expanded && <div className="px-3 pb-3"><p className="text-xs leading-5 text-slate-600"><span className="font-medium text-slate-700">為什麼：</span>{activity.reason}</p><ActivityDetail activity={activity} statusLabel={statusLabel} /></div>}</div>;
}

function PhaseDetails({ phase, allActivitiesRevealed, statusLabel }: { phase: TracePhase; allActivitiesRevealed: boolean; statusLabel: (status: string) => string }) {
  if (!allActivitiesRevealed) return <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-3 text-xs leading-5 text-slate-600">階段仍有活動尚未播放；案件前後快照、輸出與證據會在本階段活動全部揭露後顯示。</div>;
  return <div className="mt-4 space-y-4 border-t border-slate-200 pt-4"><div className="grid gap-3 lg:grid-cols-2"><div><p className="mb-2 text-xs font-semibold text-slate-600">階段輸入</p><FieldList fields={phase.input} statusLabel={statusLabel} /></div><div><p className="mb-2 text-xs font-semibold text-slate-600">階段輸出</p><FieldList fields={phase.output} statusLabel={statusLabel} /></div></div><div className="grid gap-3 lg:grid-cols-2"><EvidenceList evidence={phase.evidence} statusLabel={statusLabel} /><SourceRefs refs={phase.source_refs} /></div><div><div className="mb-2 flex items-center gap-2"><p className="text-xs font-semibold text-slate-600">案件前後快照</p><Info className="size-3.5 text-slate-400" /></div><SnapshotComparison before={phase.case_before} after={phase.case_after} statusLabel={statusLabel} /></div>{(phase.pause_reason || phase.next_activity || phase.next_phase) && <div className="grid gap-2 sm:grid-cols-2">{phase.pause_reason && <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs leading-5 text-slate-700"><span className="font-medium">停頓原因：</span>{phase.pause_reason}</div>}{phase.next_activity && <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs leading-5 text-slate-700"><span className="font-medium">紀錄中的下一活動：</span>{phase.next_activity.title}</div>}{phase.next_phase && <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs leading-5 text-slate-700"><span className="font-medium">紀錄中的下一階段：</span>{phase.next_phase.title}</div>}</div>}</div>;
}

function PhaseTimeline({ phases, focus, revealedPhaseCount, revealedActivities, expandedPhases, expandedActivities, currentPhaseRef, statusLabel, onTogglePhase, onToggleActivity }: { phases: TracePhase[]; focus: ReplayFocus; revealedPhaseCount: number; revealedActivities: Record<string, number>; expandedPhases: Record<string, boolean>; expandedActivities: Record<string, boolean>; currentPhaseRef: { current: HTMLDivElement | null }; statusLabel: (status: string) => string; onTogglePhase: (phaseId: string) => void; onToggleActivity: (activityId: string) => void }) {
  return <ol className="space-y-4" aria-label="Trace 垂直時間軸">{phases.map((phase, index) => { const revealed = index < revealedPhaseCount; const current = revealed && index === focus.phaseIndex; const activitiesRevealed = Math.min(revealedActivities[phase.phase_id] ?? 0, phase.activities.length); const allActivitiesRevealed = revealed && activitiesRevealed >= phase.activities.length; const phasePlaybackLabel = current ? "目前播放" : revealed ? "已揭露" : "尚未揭露"; return <li key={phase.phase_id}><div ref={current ? currentPhaseRef : undefined} className={`relative rounded-xl border p-4 transition-colors ${current ? "border-slate-400 bg-slate-50 shadow-sm" : revealed ? "border-slate-200 bg-white" : "border-dashed border-slate-300 bg-slate-50/60"}`}><div className="flex gap-3"><div className="relative flex w-8 shrink-0 justify-center">{index < phases.length - 1 && <span aria-hidden="true" className="absolute left-1/2 top-9 h-[calc(100%+1rem)] w-px -translate-x-1/2 bg-slate-200" />}<span className={`relative z-[1] flex size-8 items-center justify-center rounded-full border text-xs font-semibold ${current ? "border-slate-900 bg-slate-900 text-white" : revealed ? "border-slate-300 bg-white text-slate-700" : "border-dashed border-slate-300 bg-slate-50 text-slate-400"}`}>{revealed ? index + 1 : <span className="size-1.5 rounded-full bg-current" />}</span></div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-1.5"><span className="rounded-full border border-slate-200 px-2 py-0.5 text-[10px] font-medium text-slate-600">第 {phase.sequence} 階段 · {phaseKindLabel(phase.kind)}</span><span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${current ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"}`}>{phasePlaybackLabel}</span>{revealed && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600">保存狀態：{statusLabel(phase.status)}</span>}</div><h3 className={`mt-2 font-semibold ${current ? "text-lg text-slate-950" : "text-base text-slate-800"}`}>{revealed ? phase.title : "尚未揭露的階段"}</h3></div>{revealed && <button type="button" onClick={() => onTogglePhase(phase.phase_id)} aria-expanded={Boolean(expandedPhases[phase.phase_id])} className="inline-flex shrink-0 items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100">{expandedPhases[phase.phase_id] ? "收合階段" : "展開階段"}{expandedPhases[phase.phase_id] ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}</button>}</div>{revealed ? <><p className="mt-2 text-sm leading-6 text-slate-700">{phase.summary}</p><div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500"><span className="inline-flex items-center gap-1"><UserRound className="size-3.5" />{phase.actor.id}</span><span className="inline-flex items-center gap-1"><Clock3 className="size-3.5" />{formatTraceDate(phase.occurred_at)}</span><span>回放活動：{activitiesRevealed} / {phase.activities.length}</span><span>保存終態：{statusLabel(phase.status)}</span></div>{expandedPhases[phase.phase_id] && <div className="mt-4"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Agent 可觀測活動</p><span className="text-[11px] text-slate-500">已揭露 {activitiesRevealed} / 記錄 {phase.activities.length}</span></div><p className="mt-1 text-xs leading-5 text-slate-600"><span className="font-medium text-slate-700">為什麼：</span>{phase.reason}</p><div className="mt-3 space-y-2">{phase.activities.slice(0, activitiesRevealed).map((activity) => <ActivityRow key={activity.activity_id} activity={activity} expanded={Boolean(expandedActivities[activity.activity_id])} onToggle={() => onToggleActivity(activity.activity_id)} statusLabel={statusLabel} />)}{!allActivitiesRevealed && <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-3 text-xs text-slate-500">尚有 {phase.activities.length - activitiesRevealed} 個活動待播放；未播放活動的結果暫不顯示。</div>}{!phase.activities.length && <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-3 text-xs text-slate-500">此階段沒有活動記錄。</div>}</div><PhaseDetails phase={phase} allActivitiesRevealed={allActivitiesRevealed} statusLabel={statusLabel} /></div>}</> : <div className="mt-2 rounded-lg border border-dashed border-slate-200 bg-white/60 px-3 py-3 text-xs leading-5 text-slate-500">尚未播放到此階段。輸入、活動結果、證據與案件快照會在揭露後顯示。</div>}</div></div></div></li>; })}</ol>;
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

function RichTraceReplay({ trace, phases, Pill, Panel, statusLabel, statusTone: _statusTone, onNavigate }: { trace: Trace; phases: TracePhase[]; Pill: TracePageProps["Pill"]; Panel: TracePageProps["Panel"]; statusLabel: (status: string) => string; statusTone: TracePageProps["statusTone"]; onNavigate: (path: string) => void }) {
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
    setExpandedPhases((current) => ({ ...current, [phase.phase_id]: true }));
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
    if (focus.phaseIndex > 0) { const previousIndex = focus.phaseIndex - 1; const previous = phases[previousIndex]; const previousCount = revealedActivities[previous.phase_id] ?? previous.activities.length; setFocus({ phaseIndex: previousIndex, activityIndex: Math.max(0, Math.min(previousCount - 1, previous.activities.length - 1)) }); }
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
  return <div className="space-y-5"><Panel className="p-4 sm:p-5"><div className="flex flex-wrap items-start justify-between gap-4"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><Pill tone="neutral"><Sparkles className="mr-1 inline size-3.5" />保存回放</Pill><Pill tone="neutral">{trace.mode === "saved_mock" ? "合成 mock" : trace.mode}</Pill><Pill tone="neutral">唯讀</Pill></div><h2 className="mt-3 text-xl font-semibold tracking-tight text-slate-950 sm:text-2xl">{trace.name}</h2><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">{trace.description}</p></div><div className="flex min-w-[210px] flex-col gap-2 sm:items-end"><p className="text-xs font-medium text-slate-500">目前情境</p><p className="max-w-[18rem] truncate rounded-md border border-slate-200 bg-slate-50 px-2.5 py-2 text-sm text-slate-800">{trace.name}</p></div></div><div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-slate-100 pt-4 text-xs text-slate-500"><span>案例：{trace.case_id}</span><span>保存時間：{formatTraceDate(trace.recorded_at)}</span><span>記錄階段：{phases.length}</span><span>記錄活動：{phases.reduce((total, phase) => total + phase.activities.length, 0)}</span><span className="font-medium text-slate-700">目前揭露：{revealedPhaseCount} / {phases.length} 階段</span></div></Panel><div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_300px]"><Panel className="p-4 sm:p-6"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">目前階段</p><h3 className="mt-1 text-lg font-semibold text-slate-900">{currentPhase?.title ?? "尚未選擇階段"}</h3><p className="mt-1 text-sm text-slate-600">{currentPhase ? `第 ${currentPhase.sequence} 階段 · 回放活動 ${currentRevealedActivityCount} / ${currentPhase.activities.length}` : "等待保存紀錄"}</p></div><div className="flex flex-wrap items-center gap-2"><button type="button" onClick={returnToCurrent} className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100"><CircleDot className="size-3.5" />回到目前階段</button><button type="button" onClick={() => onNavigate(`/cases/${trace.case_id}/timeline`)} className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100">案件時間軸<ArrowRight className="size-3.5" /></button></div></div>{currentIsPausedForHuman && <div className="mt-4 flex items-start gap-2 rounded-lg border border-slate-300 bg-slate-100 px-3 py-2.5 text-sm leading-6 text-slate-800"><UserRound className="mt-1 size-4 shrink-0" /><span><span className="font-semibold">回放已在人工核可點暫停。</span>繼續回放只揭露已保存的下一階段，不建立新的核可或執行。</span></div>}<div className="mt-5 flex flex-wrap items-center gap-2 border-y border-slate-100 py-4"><button type="button" onClick={moveBack} disabled={!canGoBack} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-40"><SkipBack className="size-4" />上一步</button><button type="button" onClick={togglePlay} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-slate-900 px-3.5 text-sm font-semibold text-white hover:bg-slate-700">{playing ? <Pause className="size-4" /> : <Play className="size-4" />}{playing ? "暫停" : currentIsPausedForHuman ? "繼續回放" : "播放"}</button><button type="button" onClick={moveToNextActivity} disabled={!currentPhase || (focus.phaseIndex >= phases.length - 1 && currentRevealedActivityCount >= (currentPhase?.activities.length ?? 0))} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-40"><StepForward className="size-4" />下一活動</button><button type="button" onClick={() => { setPlaying(false); moveToNextPhase(true); }} disabled={!currentPhase || focus.phaseIndex >= phases.length - 1} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-40"><SkipForward className="size-4" />下一階段</button><button type="button" onClick={restart} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-100"><RotateCcw className="size-4" />重新開始</button><label className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-600"><Gauge className="size-3.5" /><span className="sr-only">播放速度</span><select aria-label="播放速度" value={speed} onChange={(event) => setSpeed(Number(event.target.value))} className="bg-transparent text-xs text-slate-700 outline-none">{speedOptions.map((option) => <option key={option} value={option}>{option}x</option>)}</select></label></div><PhaseTimeline phases={phases} focus={focus} revealedPhaseCount={revealedPhaseCount} revealedActivities={revealedActivities} expandedPhases={expandedPhases} expandedActivities={expandedActivities} currentPhaseRef={currentPhaseRef} statusLabel={statusLabel} onTogglePhase={(phaseId) => setExpandedPhases((current) => ({ ...current, [phaseId]: !current[phaseId] }))} onToggleActivity={(activityId) => setExpandedActivities((current) => ({ ...current, [activityId]: !current[activityId] }))} /></Panel><div className="space-y-4 xl:sticky xl:top-24 xl:h-fit"><Panel className="p-4"><div className="flex items-center gap-2"><FileText className="size-4 text-slate-500" /><h3 className="text-sm font-semibold text-slate-800">回放邊界</h3></div><p className="mt-2 text-xs leading-5 text-slate-600">目前揭露的階段會保留在時間軸上；未揭露階段只顯示佔位。播放、跳步與展開都只讀取保存紀錄。</p><dl className="mt-4 space-y-2 border-t border-slate-100 pt-3 text-xs"><div className="flex justify-between gap-3"><dt className="text-slate-500">保存終態</dt><dd className="font-medium text-slate-700">{trace.trace_status ? statusLabel(trace.trace_status) : "已保存"}</dd></div><div className="flex justify-between gap-3"><dt className="text-slate-500">暫停規則</dt><dd className="font-medium text-slate-700">{trace.replay?.pause_on_human === false ? "不在人工點停頓" : "人工點停頓一次"}</dd></div><div className="flex justify-between gap-3"><dt className="text-slate-500">資料模式</dt><dd className="font-medium text-slate-700">{trace.mode === "saved_mock" ? "合成 mock" : trace.mode}</dd></div></dl></Panel><Panel className="p-4"><div className="flex items-center gap-2"><Info className="size-4 text-slate-500" /><h3 className="text-sm font-semibold text-slate-800">閱讀提示</h3></div><ul className="mt-3 space-y-2 text-xs leading-5 text-slate-600"><li className="flex gap-2"><CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-slate-500" />保存狀態描述來源紀錄，回放活動描述目前已揭露範圍。</li><li className="flex gap-2"><CircleAlert className="mt-0.5 size-3.5 shrink-0 text-slate-500" />候選商品、查核結果與未知事項依階段前後快照分開呈現。</li><li className="flex gap-2"><StepForward className="mt-0.5 size-3.5 shrink-0 text-slate-500" />手動捲動不會被播放拉回；需要時使用「回到目前階段」。</li></ul></Panel><details className="rounded-xl border border-slate-200 bg-white p-4 text-xs text-slate-600"><summary className="cursor-pointer font-medium text-slate-700">原始 Trace 細節（唯讀）</summary><dl className="mt-3 space-y-2 border-t border-slate-100 pt-3"><div><dt className="text-slate-400">trace_id</dt><dd className="mt-0.5 break-all">{trace.trace_id}</dd></div><div><dt className="text-slate-400">recorded_at</dt><dd className="mt-0.5">{formatTraceDate(trace.recorded_at)}</dd></div><div><dt className="text-slate-400">replay</dt><dd className="mt-0.5">{trace.replay?.cursor_semantics ?? "未提供"}</dd></div></dl></details></div></div></div>;
}

export function TracePage({ onNavigate, Pill, Panel, ErrorNotice, statusLabel, statusTone }: TracePageProps) {
  const traces = useQuery({ queryKey: ["traces"], queryFn: api.listTraces });
  const [traceId, setTraceId] = useState<string | undefined>();
  const selectedId = traceId ?? traces.data?.items[0]?.trace_id;
  const trace = useQuery({ queryKey: ["trace", selectedId], queryFn: () => api.getTrace(selectedId as string), enabled: Boolean(selectedId) });
  useEffect(() => { if (!traceId && traces.data?.items[0]?.trace_id) setTraceId(traces.data.items[0].trace_id); }, [traceId, traces.data?.items]);
  const scenarios = traces.data?.items ?? [];
  const phases = useMemo(() => trace.data ? orderedPhases(trace.data) : [], [trace.data]);
  if (traces.isLoading) return <div role="status" className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="size-4 animate-spin" />載入回放情境…</div>;
  if (traces.isError) return <ErrorNotice error={traces.error} onRetry={() => traces.refetch()} />;
  if (!scenarios.length) return <Panel className="p-6"><div className="flex items-start gap-3"><CircleAlert className="mt-0.5 size-5 text-slate-500" /><div><h2 className="font-semibold text-slate-900">目前沒有保存的回放</h2><p className="mt-1 text-sm leading-6 text-slate-600">請先啟動提供 `/api/v1/traces` 的服務，或確認保存紀錄仍可讀取。</p></div></div></Panel>;
  return <div className="space-y-5">{trace.isLoading && <div role="status" className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="size-4 animate-spin" />載入保存情境…</div>}{trace.isError && <ErrorNotice error={trace.error} onRetry={() => trace.refetch()} />}{trace.data && <><div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600"><label className="inline-flex items-center gap-2 font-medium" htmlFor="trace-scenario-top"><span>情境</span><select id="trace-scenario-top" aria-label="選擇保存情境" value={selectedId} onChange={(event) => setTraceId(event.target.value)} className="max-w-[min(70vw,28rem)] rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-800 outline-none focus:ring-2 focus:ring-slate-400">{scenarios.map((item) => <option key={item.trace_id} value={item.trace_id}>{item.name}</option>)}</select></label><span className="inline-flex items-center gap-1.5"><Sparkles className="size-3.5" />{trace.data.mode === "saved_mock" ? "合成 mock · 唯讀" : `${trace.data.mode} · 唯讀`}</span></div>{phases.length ? <RichTraceReplay trace={trace.data} phases={phases} Pill={Pill} Panel={Panel} statusLabel={statusLabel} statusTone={statusTone} onNavigate={onNavigate} /> : trace.data.steps?.length ? <LegacyTraceFallback trace={trace.data} Pill={Pill} Panel={Panel} statusLabel={statusLabel} statusTone={statusTone} onNavigate={onNavigate} /> : <Panel className="p-6"><h2 className="font-semibold text-slate-900">這個情境沒有可播放資料</h2><p className="mt-1 text-sm leading-6 text-slate-600">Trace 回應沒有 `phases` 或相容的 `steps`，請檢查保存紀錄形狀。</p></Panel>}</>}</div>;
}
