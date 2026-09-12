import { useCallback, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Check, ChevronRight, CircleAlert, Clock3, FileText, Inbox, Layers3, Loader2, Play, RotateCcw, ShieldAlert, UsersRound } from "lucide-react";
import { api } from "./lib/api";
import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import { Card } from "./components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "./components/ui/tabs";
import { TracePage } from "./pages/TracePage";
import type { AgentStatus, ApprovalRecord, CaseSnapshot, CaseSummary, MockStatus, Product, ProductCandidate, Signal, TimelineItem } from "./types";

type Page = "inbox" | "cases" | "case" | "trace";
type CaseTab = "overview" | "products" | "timeline";
type Route = { page: Page; caseId?: string; tab?: CaseTab };

const navItems: { page: Page; label: string; icon: typeof Inbox; path: string }[] = [
  { page: "cases", label: "案件列表", icon: Layers3, path: "/cases" },
  { page: "inbox", label: "訊號收件匣", icon: Inbox, path: "/inbox" },
  { page: "trace", label: "Trace 回放", icon: Play, path: "/trace" },
];

function readRoute(): Route {
  const path = window.location.pathname.replace(/\/$/, "") || "/cases";
  if (path === "/inbox") return { page: "inbox" };
  if (path === "/trace") return { page: "trace" };
  const caseMatch = path.match(/^\/cases\/([^/]+)(?:\/(overview|products|timeline))?$/);
  if (caseMatch) return { page: "case", caseId: caseMatch[1], tab: (caseMatch[2] as CaseTab | undefined) ?? "overview" };
  return { page: "cases" };
}

function formatDate(value: string | null | undefined) {
  if (!value) return "尚未安排";
  return new Intl.DateTimeFormat("zh-TW", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    monitoring: "觀察中", investigating: "查核中", awaiting_approval: "等待核可", actioned: "已執行", closed: "已關閉",
    waiting: "待處理", running: "執行中", waiting_human: "等待人工", waiting_follow_up: "等待追蹤", failed: "執行失敗",
    active: "上架中", delisted: "已下架", candidate: "候選關聯", confirmed: "已確認關聯", excluded: "排除",
    supported: "有支持證據", refuted: "有反駁證據", insufficient_evidence: "證據不足", context_only: "背景脈絡",
    completed: "已完成", ready: "待執行", succeeded: "成功", proposed: "待核可", approved: "已核可", rejected: "已拒絕",
  };
  return labels[status] ?? status;
}

function priorityLabel(priority: CaseSummary["priority"]) {
  return { low: "低", medium: "中", high: "高", critical: "緊急" }[priority];
}

function claimKindLabel(kind: string) {
  return { fact: "事實", experience: "經驗回報", hypothesis: "假設", request: "請求" }[kind] ?? "陳述";
}

function timelineKindLabel(kind: string) {
  return {
    signal_added: "收到訊號",
    verification_updated: "查核更新",
    assessment_updated: "判讀更新",
    monitoring_updated: "追蹤更新",
    approval_recorded: "完成核可",
    action_executed: "執行處置",
  }[kind] ?? "案件更新";
}

function missingInformationLabel(value: string) {
  return { batch: "批次", seller_confirmation: "賣家確認" }[value] ?? "待補資訊";
}

function sourceLabel(value: string) {
  return { saved_mock_observation: "已保存的 mock 觀測", backend: "後端觀測" }[value] ?? "觀測資料";
}

function actorLabel(type: string) {
  return { case_agent: "案件專員", general_gatherer: "訊號整理員" }[type] ?? "系統角色";
}

function impactLabel(impact: CaseSummary["business_impact"]) {
  return { risk: "風險", opportunity: "機會", bidirectional: "雙向影響", no_material_impact: "無實質影響", pending: "待判定" }[impact];
}

function statusTone(status: string) {
  if (["actioned", "succeeded", "delisted", "supported", "completed"].includes(status)) return "green" as const;
  if (["failed", "refuted"].includes(status)) return "red" as const;
  if (["awaiting_approval", "waiting_human", "candidate", "pending", "insufficient_evidence"].includes(status)) return "orange" as const;
  if (["investigating", "monitoring", "running", "waiting_follow_up"].includes(status)) return "blue" as const;
  return "neutral" as const;
}

function Pill({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "orange" | "red" | "green" | "blue" }) {
  return <Badge variant={tone === "red" ? "destructive" : tone === "neutral" ? "outline" : "secondary"} className="py-1 font-medium">{children}</Badge>;
}

function Panel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <Card className={className}>{children}</Card>;
}

function EmptyState({ title, message }: { title: string; message: string }) {
  return <div className="rounded-xl border border-dashed border-stone-300 bg-stone-50/60 px-5 py-10 text-center"><p className="font-semibold text-stone-800">{title}</p><p className="mt-2 text-sm text-stone-500">{message}</p></div>;
}

function ErrorNotice({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message = error instanceof Error ? error.message : "目前無法載入資料。";
  return <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert"><CircleAlert className="mt-0.5 size-4 shrink-0" /><div className="flex-1"><p>{message}</p>{onRetry && <button type="button" onClick={onRetry} className="mt-2 font-semibold underline underline-offset-2">重試</button>}</div></div>;
}

function Header({ route, onNavigate, mockStatus }: { route: Route; onNavigate: (path: string) => void; mockStatus: MockStatus | undefined }) {
  const title = route.page === "inbox" ? "訊號收件匣" : route.page === "trace" ? "Trace 回放" : route.page === "case" ? "案件詳情" : "案件列表";
  return <header className="sticky top-0 z-10 flex min-h-[74px] items-center justify-between border-b border-stone-200/80 bg-[#f8f8f5]/90 px-8 backdrop-blur"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-orange-700">Signal desk</p><h1 className="mt-1 text-2xl font-semibold tracking-tight text-stone-900">{title}</h1></div><div className="flex items-center gap-3">{mockStatus && <><Pill tone="orange"><span className="mr-1.5 size-1.5 rounded-full bg-orange-500" />Mock 模式</Pill><Pill tone="neutral">Stage {mockStatus.stage} / 6</Pill></>}{route.page === "case" && <button type="button" onClick={() => onNavigate("/cases")} className="hidden items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-stone-500 hover:bg-white hover:text-stone-900 sm:flex"><ArrowLeft className="size-4" />回到案件列表</button>}</div></header>;
}

function Sidebar({ route, onNavigate }: { route: Route; onNavigate: (path: string) => void }) {
  return <aside className="fixed inset-y-0 left-0 z-20 hidden w-[248px] border-r border-stone-200 bg-[#f2f2ee] lg:flex lg:flex-col"><div className="px-6 pb-8 pt-7"><div className="flex items-center gap-3"><div className="flex size-10 items-center justify-center rounded-xl bg-orange-600 text-lg font-bold text-white shadow-sm">S</div><div><p className="font-semibold tracking-tight text-stone-900">Signal Desk</p><p className="text-xs text-stone-500">案件查核工作台</p></div></div></div><nav className="space-y-1 px-3" aria-label="主要導覽">{navItems.map((item) => { const Icon = item.icon; const active = route.page === item.page; return <button key={item.page} type="button" onClick={() => onNavigate(item.path)} className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-medium transition ${active ? "bg-white text-orange-800 shadow-sm" : "text-stone-600 hover:bg-white/70 hover:text-stone-900"}`}><Icon className={`size-4 ${active ? "text-orange-600" : "text-stone-400"}`} />{item.label}{active && <ChevronRight className="ml-auto size-4 text-orange-400" />}</button>; })}</nav><div className="mt-auto px-5 pb-6"><div className="rounded-xl border border-stone-200 bg-white/70 p-3"><div className="flex items-center gap-2 text-xs font-semibold text-stone-700"><ShieldAlert className="size-3.5 text-orange-600" />展示環境</div><p className="mt-2 text-xs leading-5 text-stone-500">資料來自可重置的本機 mock，操作成功不代表真實平台已執行。</p></div></div></aside>;
}

function MobileNav({ route, onNavigate }: { route: Route; onNavigate: (path: string) => void }) {
  return <nav className="flex gap-1 overflow-x-auto border-b border-stone-200 bg-white px-4 py-2 lg:hidden" aria-label="主要導覽">{navItems.map((item) => { const active = route.page === item.page; const Icon = item.icon; return <button type="button" key={item.page} onClick={() => onNavigate(item.path)} className={`flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm ${active ? "bg-orange-50 font-semibold text-orange-800" : "text-stone-500"}`}><Icon className="size-4" />{item.label}</button>; })}</nav>;
}

function CasesPage({ cases, isLoading, isError, onRetry, onNavigate }: { cases: CaseSummary[] | undefined; isLoading: boolean; isError: boolean; onRetry: () => void; onNavigate: (path: string) => void }) {
  return <div className="space-y-6"><div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-sm text-stone-500">日常首頁</p><h2 className="mt-1 text-xl font-semibold text-stone-900">需要你判斷的案件</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-stone-500">依業務影響與優先級查看案件。案件專員的承接狀態會保留等待原因與下一步，避免把「已承接」誤讀成正在執行。</p></div><div className="flex items-center gap-2"><Pill tone="neutral">{cases?.length ?? 0} 個案件</Pill><Pill tone="orange">資料快照</Pill></div></div>{isError && <ErrorNotice error={new Error("案件列表讀取失敗。請確認 mock service 已啟動。")} onRetry={onRetry} />}{isLoading && <div role="status" className="flex items-center gap-2 text-sm text-stone-500"><Loader2 className="size-4 animate-spin" />載入案件…</div>}<div className="grid gap-4 xl:grid-cols-2">{cases?.map((item) => <button key={item.case_id} type="button" onClick={() => onNavigate(`/cases/${item.case_id}/overview`)} className="group text-left"><Panel className="h-full p-5 transition group-hover:-translate-y-0.5 group-hover:border-orange-300 group-hover:shadow-[0_12px_34px_rgba(125,70,20,0.1)]"><div className="flex items-start justify-between gap-4"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><Pill tone={statusTone(item.business_impact === "risk" ? "awaiting_approval" : item.business_impact)}>{impactLabel(item.business_impact)}</Pill><Pill tone={statusTone(item.priority)}>{item.priority.toUpperCase()} 優先</Pill></div><h3 className="mt-4 text-lg font-semibold leading-7 text-stone-900">{item.title}</h3></div><ChevronRight className="mt-1 size-5 shrink-0 text-stone-300 transition group-hover:translate-x-1 group-hover:text-orange-500" /></div><div className="mt-5 grid grid-cols-2 gap-3 border-t border-stone-100 pt-4 text-sm"><div><p className="text-xs text-stone-400">案件狀態</p><p className="mt-1 font-medium text-stone-700">{statusLabel(item.status)}</p></div><div><p className="text-xs text-stone-400">案件版本</p><p className="mt-1 font-medium text-stone-700">v{item.version}</p></div><div><p className="text-xs text-stone-400">專員狀態</p><p className="mt-1 font-medium text-stone-700">{item.agent_state ? statusLabel(item.agent_state) : "未知"}</p></div><div><p className="text-xs text-stone-400">下次追蹤</p><p className="mt-1 font-medium text-stone-700">{formatDate(item.next_check_at)}</p></div></div><p className="mt-5 rounded-lg bg-stone-50 px-3 py-2.5 text-sm leading-6 text-stone-600">{item.latest_change ?? "尚無最新變化"}</p></Panel></button>)}</div>{!isLoading && !isError && !cases?.length && <EmptyState title="目前沒有案件" message="等待第一個訊號進入案件池。" />}</div>;
}

function InboxPage({ signals, isLoading, isError, onRetry, onNavigate }: { signals: Signal[] | undefined; isLoading: boolean; isError: boolean; onRetry: () => void; onNavigate: (path: string) => void }) {
  return <div className="space-y-6"><div><p className="text-sm text-stone-500">原始訊號</p><h2 className="mt-1 text-xl font-semibold text-stone-900">從來源找到案件脈絡</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-stone-500">保留來源、原文與查核狀態。轉傳會連回原始訊號，不會因為內容相似就重複派工。</p></div>{isError && <ErrorNotice error={new Error("訊號收件匣讀取失敗。請確認 mock service 已啟動。")} onRetry={onRetry} />}{isLoading && <div role="status" className="flex items-center gap-2 text-sm text-stone-500"><Loader2 className="size-4 animate-spin" />載入訊號…</div>}<div className="space-y-3">{signals?.map((signal) => <Panel key={signal.signal_id} className="p-5"><div className="flex flex-wrap items-start justify-between gap-4"><div className="flex min-w-0 items-start gap-3"><div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-orange-50 text-orange-700"><FileText className="size-4" /></div><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><Pill tone={signal.source_relation === "repost" ? "neutral" : "blue"}>{signal.source_relation === "repost" ? "重複轉傳" : signal.source_relation === "independent_report" ? "獨立回報" : "原始來源"}</Pill><span className="text-xs text-stone-400">{signal.source.provider} · {formatDate(signal.source.published_at)}</span></div><p className="mt-3 text-sm leading-6 text-stone-800">{signal.source.raw_text}</p></div></div>{signal.case_id ? <button type="button" onClick={() => onNavigate(`/cases/${signal.case_id}/overview`)} className="flex shrink-0 items-center gap-1.5 rounded-lg border border-stone-200 px-3 py-2 text-sm font-medium text-stone-600 hover:border-orange-300 hover:text-orange-800">查看案件<ArrowRight className="size-4" /></button> : <span className="text-xs text-stone-500">尚未歸案</span>}</div><div className="mt-4 border-t border-stone-100 pt-4"><div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-stone-500"><span>訊號 ID：{signal.signal_id}</span>{signal.duplicate_of_signal_id && <span>原始訊號：{signal.duplicate_of_signal_id}</span>}<span>案件：{signal.case_id ?? "尚未歸案"}</span></div><div className="mt-3 flex flex-wrap gap-2">{signal.claims.map((claim) => <Pill key={claim.claim_id} tone={statusTone(claim.verification_status)}>{claim.kind} · {statusLabel(claim.verification_status)}</Pill>)}</div></div></Panel>)}</div>{!isLoading && !isError && !signals?.length && <EmptyState title="收件匣是空的" message="目前沒有可展示的原始訊號。" />}</div>;
}

function AgentPanel({ agent, onAdvance, isAdvancing, isMock }: { agent: AgentStatus | undefined; onAdvance: () => void; isAdvancing: boolean; isMock: boolean }) {
  if (!agent) {
    return (
      <Panel className="p-5 shadow-none">
        <div className="flex items-center gap-2 text-sm font-semibold text-stone-800">
          <UsersRound className="size-4 text-stone-400" />
          專員狀態
        </div>
        <p className="mt-3 text-sm text-stone-500">尚未提供可觀測的專員狀態。</p>
      </Panel>
    );
  }

  return (
    <Panel className="p-5 shadow-none">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-stone-800">
            <UsersRound className="size-4 text-stone-500" />
            專員狀態
          </div>
          <p className="mt-1 text-xs text-stone-500">資料來源：{sourceLabel(agent.source)}</p>
        </div>
        <Pill tone={statusTone(agent.state)}>{statusLabel(agent.state)}</Pill>
      </div>
      <dl className="mt-5 space-y-4 text-sm">
        <div>
          <dt className="text-xs text-stone-500">目前步驟</dt>
          <dd className="mt-1 font-medium leading-6 text-stone-800">{agent.current_step}</dd>
        </div>
        <div>
          <dt className="text-xs text-stone-500">最近結果</dt>
          <dd className="mt-1 leading-6 text-stone-700">{agent.latest_result}</dd>
        </div>
        {agent.waiting_reason && (
          <div className="rounded-md border border-orange-200 bg-orange-50 px-3 py-2.5 text-orange-900">
            <dt className="text-xs font-semibold">等待原因</dt>
            <dd className="mt-1 leading-5">{agent.waiting_reason}</dd>
          </div>
        )}
        <div>
          <dt className="text-xs text-stone-500">下一步</dt>
          <dd className="mt-1 leading-6 text-stone-700">{agent.next_action ?? "尚未安排"}</dd>
        </div>
      </dl>
      {isMock && <div className="mt-5 border-t border-stone-100 pt-4">
        <Button type="button" variant="outline" size="sm" onClick={onAdvance} disabled={isAdvancing} className="border-orange-200 bg-orange-50 text-orange-800 hover:bg-orange-100 hover:text-orange-900">
          <RotateCcw className={`size-3.5 ${isAdvancing ? "animate-spin" : ""}`} />
          模擬收到新證據（mock）
        </Button>
        <p className="mt-2 text-xs leading-5 text-stone-500">新證據可能更新案件版本；純轉傳只記入時間軸。</p>
      </div>}
    </Panel>
  );
}

function OverviewTab({ current, signals, agent, onAdvance, isAdvancing, isMock }: { current: CaseSnapshot; signals: Signal[] | undefined; agent: AgentStatus | undefined; onAdvance: () => void; isAdvancing: boolean; isMock: boolean }) {
  const claims = signals?.flatMap((signal) => signal.claims.filter((claim) => current.claim_ids.includes(claim.claim_id))) ?? [];
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-6">
        <Panel className="p-6 shadow-none">
          <h3 className="text-sm font-semibold text-stone-900">判讀摘要</h3>
          <div className="mt-5 grid gap-5 sm:grid-cols-2">
            <div>
              <p className="text-xs text-stone-500">優先級理由</p>
              <ul className="mt-2 space-y-2 text-sm leading-6 text-stone-700">
                {current.priority_reasons.map((item) => (
                  <li key={item} className="flex gap-2">
                    <span className="mt-2 size-1.5 shrink-0 rounded-full bg-orange-500" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-xs text-stone-500">追蹤計畫</p>
              <p className="mt-2 text-sm font-medium text-stone-800">下次檢查：{formatDate(current.monitoring_plan.next_check_at)}</p>
              <p className="mt-1 text-sm leading-6 text-stone-600">{current.monitoring_plan.reason}</p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {current.monitoring_plan.targets.map((target) => (
                  <span key={target} className="rounded-md border border-stone-200 bg-stone-50 px-2 py-1 text-xs text-stone-600">{target}</span>
                ))}
              </div>
            </div>
          </div>
        </Panel>

        <Panel className="p-6 shadow-none">
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-semibold text-stone-900">陳述與查核</h3>
            <Pill tone="neutral">{claims.length} 項陳述</Pill>
          </div>
          {claims.length ? (
            <div className="mt-4 divide-y divide-stone-100">
              {claims.map((claim) => (
                <div key={claim.claim_id} className="py-4 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs font-medium text-stone-500">{claimKindLabel(claim.kind)} · {claim.claim_id}</p>
                    <Pill tone={statusTone(claim.verification_status)}>{statusLabel(claim.verification_status)}</Pill>
                  </div>
                  <p className="mt-2 text-sm font-medium leading-6 text-stone-800">{claim.normalized_statement}</p>
                  <p className="mt-2 border-l-2 border-stone-200 pl-3 text-sm leading-6 text-stone-600">「{claim.quote}」</p>
                  {claim.evidence.length > 0 && (
                    <div className="mt-3 border-t border-stone-100 pt-3 text-xs leading-5 text-stone-600">
                      <span className="font-medium text-stone-800">證據：</span>
                      {claim.evidence.map((item) => <span key={item.evidence_id} className="ml-2">{item.title}（{statusLabel(item.stance)}）</span>)}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : <p className="mt-4 text-sm text-stone-500">尚未找到關聯陳述。</p>}
        </Panel>

        <Panel className="p-6 shadow-none">
          <div className="grid gap-6 sm:grid-cols-2">
            <div>
              <h3 className="font-semibold text-stone-900">尚未確認</h3>
              <ul className="mt-3 space-y-2 text-sm leading-6 text-stone-600">
                {current.unknowns.map((item) => <li key={item} className="flex gap-2"><CircleAlert className="mt-1 size-4 shrink-0 text-orange-600" />{item}</li>)}
              </ul>
            </div>
            <div>
              <h3 className="font-semibold text-stone-900">下一步</h3>
              <ul className="mt-3 space-y-2 text-sm leading-6 text-stone-600">
                {current.next_steps.map((item) => <li key={item} className="flex gap-2"><ArrowRight className="mt-1 size-4 shrink-0 text-stone-500" />{item}</li>)}
              </ul>
            </div>
          </div>
        </Panel>
      </div>
      <div>
        <AgentPanel agent={agent} onAdvance={onAdvance} isAdvancing={isAdvancing} isMock={isMock} />
      </div>
    </div>
  );
}

function ProductRow({ candidate, product, selected, disabled, onToggle }: { candidate: ProductCandidate; product: Product | undefined; selected: boolean; disabled: boolean; onToggle: () => void }) {
  const excluded = candidate.relation === "excluded";
  return (
    <TableRow className={excluded ? "bg-stone-50/70" : selected ? "bg-orange-50/60" : undefined}>
      <TableCell className="w-12 pr-0">
        <input
          type="checkbox"
          role="checkbox"
          checked={selected}
          disabled={disabled || excluded || product?.status !== "active"}
          onChange={onToggle}
          aria-label={`選擇 ${product?.name ?? candidate.product_id}`}
          className="size-4 accent-orange-600"
        />
      </TableCell>
      <TableCell className="min-w-[220px]">
        <p className="font-medium text-stone-800">{product?.name ?? candidate.product_id}</p>
        <p className="mt-1 text-xs text-stone-500">{product?.brand ?? "未知品牌"} · 賣家 {product?.seller_id ?? "未知"}</p>
      </TableCell>
      <TableCell className="whitespace-nowrap">
        <div className="flex flex-wrap gap-1.5">
          <Pill tone={statusTone(candidate.relation)}>{statusLabel(candidate.relation)}</Pill>
          {product && <Pill tone={statusTone(product.status)}>{statusLabel(product.status)}</Pill>}
        </div>
      </TableCell>
      <TableCell className="min-w-[240px] max-w-[380px] text-stone-600">
        <p className="leading-5">{candidate.reason}</p>
        {candidate.missing_information.length > 0 && <p className="mt-1 text-xs text-stone-500">待補：{candidate.missing_information.map(missingInformationLabel).join("、")}</p>}
        {product?.failure_mode === "fail_once" && product.status === "active" && <p className="mt-1 text-xs font-medium text-orange-700">首次執行會示範失敗，可重試同一筆紀錄。</p>}
      </TableCell>
    </TableRow>
  );
}

function ProductsTab({ current, products, approvals, onInvalidate, queryError }: { current: CaseSnapshot; products: Product[] | undefined; approvals: ApprovalRecord[] | undefined; onInvalidate: () => void; queryError?: unknown }) {
  const [selected, setSelected] = useState<string[]>([]);
  const createApproval = useMutation({ mutationFn: () => api.createApproval(current.case_id, { case_version: current.version, product_ids: selected }), onSuccess: () => { setSelected([]); onInvalidate(); } });
  const execute = useMutation({ mutationFn: (approvalId: string) => api.executeApproval(approvalId), onSuccess: onInvalidate });
  const latestApproval = approvals?.[approvals.length - 1];
  const productMap = new Map((products ?? []).map((product) => [product.product_id, product]));
  const toggle = (productId: string) => setSelected((items) => items.includes(productId) ? items.filter((item) => item !== productId) : [...items, productId]);
  const approvalStale = latestApproval && latestApproval.case_version !== current.version;
  return (
    <div className="space-y-6">
      <Panel className="p-6 shadow-none">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-stone-900">相關商品</h3>
            <p className="mt-1 text-sm text-stone-500">選取商品後建立核可，再明確執行模擬下架。</p>
          </div>
          <Pill tone="neutral">案件 v{current.version}</Pill>
        </div>
        {queryError !== undefined && queryError !== null && <div className="mt-5"><ErrorNotice error={queryError} /></div>}
        <div className="mt-5 overflow-hidden rounded-md border border-stone-200">
          <Table>
            <caption className="sr-only">案件相關商品與模擬處置狀態</caption>
            <TableHeader>
              <TableRow className="bg-stone-50 hover:bg-stone-50">
                <TableHead className="w-12 pr-0"><span className="sr-only">選取</span></TableHead>
                <TableHead>商品</TableHead>
                <TableHead>關聯與狀態</TableHead>
                <TableHead>關聯依據</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {current.candidate_products.map((candidate) => <ProductRow key={candidate.product_id} candidate={candidate} product={productMap.get(candidate.product_id)} selected={selected.includes(candidate.product_id)} disabled={createApproval.isPending || (current.demo_stage === 4 && candidate.relation !== "confirmed")} onToggle={() => toggle(candidate.product_id)} />)}
            </TableBody>
          </Table>
        </div>
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-stone-100 pt-5">
          <p className="text-sm text-stone-500">已選 {selected.length} 項 · 新增商品不會沿用舊核可</p>
          <Button type="button" disabled={selected.length === 0 || createApproval.isPending} onClick={() => createApproval.mutate()}>
            <Check className="size-4" />
            {createApproval.isPending ? "建立核可中…" : "確認核可選取商品"}
          </Button>
        </div>
        {createApproval.error && <div className="mt-4"><ErrorNotice error={createApproval.error} /></div>}
      </Panel>

      {latestApproval ? (
        <Panel className="p-6 shadow-none">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="font-semibold text-stone-900">最近一次核可</h3>
              <p className="mt-1 text-sm text-stone-500">案件 v{latestApproval.case_version} · {formatDate(latestApproval.approved_at)}</p>
            </div>
            <Pill tone={approvalStale ? "red" : "green"}>{approvalStale ? "版本已失效" : statusLabel(latestApproval.status)}</Pill>
          </div>
          {approvalStale && <div className="mt-4 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-3 text-sm leading-6 text-red-800"><CircleAlert className="mt-1 size-4 shrink-0" />案件已更新，這筆核可不能執行；請依目前 v{current.version} 重新選取與核可。</div>}
          <div className="mt-4 divide-y divide-stone-100 border-y border-stone-100">
            {latestApproval.executions.map((execution) => {
              const product = productMap.get(execution.product_id);
              return (
                <div key={execution.execution_id} className="flex flex-wrap items-start justify-between gap-3 py-4">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-stone-800">{product?.name ?? execution.product_id}</p>
                    <p className="mt-1 text-xs text-stone-500">第 {execution.attempts} 次嘗試</p>
                    {execution.error && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-xs leading-5 text-red-800">{execution.error}</p>}
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                    <Pill tone={statusTone(execution.status)}>{statusLabel(execution.status)}</Pill>
                    {execution.status !== "succeeded" && !approvalStale && <Button type="button" variant="outline" size="sm" onClick={() => execute.mutate(latestApproval.approval_id)} disabled={execute.isPending}><RotateCcw className="size-3.5" />{execute.isPending ? "重試中…" : "重試"}</Button>}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs leading-5 text-stone-500">執行結果會保留在案件紀錄中。</p>
            <Button type="button" variant="outline" onClick={() => execute.mutate(latestApproval.approval_id)} disabled={Boolean(approvalStale) || execute.isPending}>
              {execute.isPending ? <Loader2 className="size-4 animate-spin" /> : <ShieldAlert className="size-4" />}
              明確執行模擬下架
            </Button>
          </div>
          {execute.error && <div className="mt-4"><ErrorNotice error={execute.error} /></div>}
        </Panel>
      ) : (
        <Panel className="p-5 shadow-none">
          <div className="flex items-center gap-2 text-sm font-semibold text-stone-800"><Clock3 className="size-4 text-stone-500" />尚未建立核可</div>
          <p className="mt-2 text-sm leading-6 text-stone-500">選取候選商品後，核可紀錄會出現在這裡。</p>
        </Panel>
      )}
    </div>
  );
}

function TimelineTab({ timeline }: { timeline: TimelineItem[] | undefined }) {
  if (!timeline?.length) return <EmptyState title="尚無時間軸紀錄" message="案件的來源、查核與操作會在這裡保留。" />;
  return (
    <Panel className="overflow-hidden p-0 shadow-none">
      <div className="flex items-center justify-between gap-3 px-6 pb-4 pt-6">
        <h3 className="font-semibold text-stone-900">案件時間軸</h3>
        <Pill tone="neutral">{timeline.length} 個事件</Pill>
      </div>
      <ol>
        {timeline.map((item, index) => (
          <li key={item.timeline_id} className="border-t border-stone-100 px-6 py-5">
            <div className="flex gap-4">
              <div className="relative flex w-8 shrink-0 justify-center">
                {index < timeline.length - 1 && <span aria-hidden="true" className="absolute bottom-[-1.25rem] top-8 w-px bg-stone-200" />}
                <span className={`z-[1] mt-0.5 flex size-7 items-center justify-center rounded-full ${index === timeline.length - 1 ? "bg-orange-600 text-white" : "bg-orange-100 text-orange-700"}`}>
                  <span className="size-1.5 rounded-full bg-current" />
                </span>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Pill tone="neutral">v{item.case_version}</Pill>
                    <span className="text-xs font-medium text-stone-600">{timelineKindLabel(item.kind)}</span>
                  </div>
                  <time className="text-xs text-stone-500">{formatDate(item.occurred_at)}</time>
                </div>
                <p className="mt-3 text-sm font-medium leading-6 text-stone-800">{item.summary}</p>
                <p className="mt-1 text-sm leading-6 text-stone-600">{item.reason}</p>
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-stone-100 pt-3 text-xs text-stone-500">
                  <span>角色：{actorLabel(item.actor.type)}</span>
                  {item.source_refs.length > 0 && <span>來源：{item.source_refs.join("、")}</span>}
                </div>
              </div>
            </div>
          </li>
        ))}
      </ol>
    </Panel>
  );
}

function DemoControls({ status, onAdvance, onReset, isAdvancing, isResetting }: { status: MockStatus | undefined; onAdvance: () => void; onReset: (stage: 0 | 3) => void; isAdvancing: boolean; isResetting: boolean }) {
  if (!status) return null;
  const hasWrites = status.approvals > 0 || status.executions > 0;
  const reset = (stage: 0 | 3) => {
    if (hasWrites && !window.confirm("此回放已有核可或執行紀錄；重置會清除本機 mock 狀態，確定繼續嗎？")) return;
    onReset(stage);
  };
  return <Panel className="border-orange-200 bg-orange-50/50 p-4 shadow-none"><div className="flex flex-wrap items-start justify-between gap-4"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><Pill tone="orange">受控回放 Stage {status.stage} / 6</Pill><span className="text-xs text-stone-500">回放：{status.provenance.replay_window}</span></div><p className="mt-2 text-xs leading-5 text-stone-600">{status.provenance.boundaries.external_evidence} {status.provenance.boundaries.simulated_listing}</p><p className="mt-1 text-xs leading-5 text-orange-900">{status.provenance.warning}</p></div><div className="flex shrink-0 flex-wrap gap-2"><Button type="button" size="sm" variant="outline" onClick={() => reset(3)} disabled={isResetting}><RotateCcw className={`size-3.5 ${isResetting ? "animate-spin" : ""}`} />重置 Stage 3</Button><Button type="button" size="sm" variant="outline" onClick={() => reset(0)} disabled={isResetting}>從 Stage 0 開始</Button><Button type="button" size="sm" onClick={onAdvance} disabled={isAdvancing || status.stage >= 6}>{isAdvancing ? <Loader2 className="size-3.5 animate-spin" /> : <ArrowRight className="size-3.5" />}下一 Stage</Button></div></div>{status.stage === 3 && <p className="mt-3 border-t border-orange-200 pt-3 text-xs leading-5 text-stone-600">舞台預設停在 Stage 3：三則訊號、risk／high／investigating、九筆商品均 active，尚無核可或執行。</p>}{status.stage === 4 && <p className="mt-3 border-t border-orange-200 pt-3 text-xs leading-5 text-orange-900">Stage 4 先等待人員核可；只能選 prod_001、prod_003、prod_005，核可後仍需明確執行。</p>}</Panel>;
}

function CaseDetailPage({ caseId, tab, onNavigate, signals, products, isProductsLoading, isProductsError, onRetryProducts, mockStatus }: { caseId: string; tab: CaseTab; onNavigate: (path: string) => void; signals: Signal[] | undefined; products: Product[] | undefined; isProductsLoading: boolean; isProductsError: boolean; onRetryProducts: () => void; mockStatus: MockStatus | undefined }) {
  const cache = useQueryClient();
  const current = useQuery({ queryKey: ["case", caseId], queryFn: () => api.getCase(caseId) });
  const timeline = useQuery({ queryKey: ["timeline", caseId], queryFn: () => api.getTimeline(caseId) });
  const agent = useQuery({ queryKey: ["agent", caseId], queryFn: () => api.getAgentStatus(caseId) });
  const approvals = useQuery({ queryKey: ["approvals", caseId], queryFn: () => api.getApprovals(caseId) });
  const advance = useMutation({ mutationFn: () => api.advanceCase(caseId), onSuccess: () => { cache.invalidateQueries({ queryKey: ["case", caseId] }); cache.invalidateQueries({ queryKey: ["cases"] }); cache.invalidateQueries({ queryKey: ["timeline", caseId] }); cache.invalidateQueries({ queryKey: ["agent", caseId] }); cache.invalidateQueries({ queryKey: ["approvals", caseId] }); cache.invalidateQueries({ queryKey: ["products"] }); cache.invalidateQueries({ queryKey: ["signals"] }); cache.invalidateQueries({ queryKey: ["mock-status"] }); } });
  const reset = useMutation({ mutationFn: (stage: 0 | 3) => api.resetMock(stage, true), onSuccess: () => { cache.invalidateQueries(); } });
  const switchTab = (next: CaseTab) => onNavigate(`/cases/${caseId}/${next}`);
  if (current.isLoading) return <div role="status" className="flex items-center gap-2 text-sm text-stone-500"><Loader2 className="size-4 animate-spin" />載入案件…</div>;
  if (current.isError || !current.data) return <ErrorNotice error={current.error ?? new Error("案件不存在。")} onRetry={() => current.refetch()} />;
  const snapshot = current.data;
  return (
    <div className="space-y-6">
      <DemoControls status={mockStatus} onAdvance={() => advance.mutate()} onReset={(stage) => reset.mutate(stage)} isAdvancing={advance.isPending} isResetting={reset.isPending} />
      {reset.error && <ErrorNotice error={reset.error} />}
      <Tabs value={tab} onValueChange={(value) => switchTab(value as CaseTab)} className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-xl font-semibold tracking-tight text-stone-900">{snapshot.title}</h2>
            <Pill tone="neutral">v{snapshot.version}</Pill>
          </div>
          <p className="mt-1 text-sm text-stone-500">{snapshot.case_id} · 更新於 {formatDate(snapshot.updated_at)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Pill tone={statusTone(snapshot.business_impact === "risk" ? "awaiting_approval" : snapshot.business_impact)}>{impactLabel(snapshot.business_impact)}</Pill>
          <Pill tone={statusTone(snapshot.status)}>{statusLabel(snapshot.status)}</Pill>
          <Pill tone={statusTone(snapshot.priority)}>{priorityLabel(snapshot.priority)}優先</Pill>
        </div>
      </div>

      <TabsList className="h-auto w-full justify-start gap-6 rounded-none border-0 border-b bg-transparent p-0">
        <TabsTrigger value="overview" className="h-10 rounded-none border-b-2 border-transparent bg-transparent px-0 text-stone-500 shadow-none hover:bg-transparent hover:text-stone-900 data-[state=active]:border-stone-900 data-[state=active]:bg-transparent data-[state=active]:text-stone-900 data-[state=active]:shadow-none">案件概覽</TabsTrigger>
        <TabsTrigger value="products" className="h-10 rounded-none border-b-2 border-transparent bg-transparent px-0 text-stone-500 shadow-none hover:bg-transparent hover:text-stone-900 data-[state=active]:border-stone-900 data-[state=active]:bg-transparent data-[state=active]:text-stone-900 data-[state=active]:shadow-none">相關商品</TabsTrigger>
        <TabsTrigger value="timeline" className="h-10 rounded-none border-b-2 border-transparent bg-transparent px-0 text-stone-500 shadow-none hover:bg-transparent hover:text-stone-900 data-[state=active]:border-stone-900 data-[state=active]:bg-transparent data-[state=active]:text-stone-900 data-[state=active]:shadow-none">案件時間軸</TabsTrigger>
      </TabsList>

      {advance.error && <ErrorNotice error={advance.error} />}
      {tab === "overview" && <OverviewTab current={snapshot} signals={signals} agent={agent.data} onAdvance={() => advance.mutate()} isAdvancing={advance.isPending} isMock={mockStatus?.mode === "mock"} />}
      {tab === "products" && <>{isProductsLoading ? <div role="status" className="flex items-center gap-2 text-sm text-stone-500"><Loader2 className="size-4 animate-spin" />載入商品…</div> : isProductsError ? <ErrorNotice error={new Error("商品資料讀取失敗。請重試。")} onRetry={onRetryProducts} /> : <ProductsTab current={snapshot} products={products} approvals={approvals.data?.items} onInvalidate={() => { cache.invalidateQueries({ queryKey: ["case", caseId] }); cache.invalidateQueries({ queryKey: ["cases"] }); cache.invalidateQueries({ queryKey: ["products"] }); cache.invalidateQueries({ queryKey: ["timeline", caseId] }); cache.invalidateQueries({ queryKey: ["approvals", caseId] }); cache.invalidateQueries({ queryKey: ["mock-status"] }); }} queryError={approvals.error} />}</>}
      {tab === "timeline" && (timeline.isLoading ? <div role="status" className="flex items-center gap-2 text-sm text-stone-500"><Loader2 className="size-4 animate-spin" />載入時間軸…</div> : timeline.isError ? <ErrorNotice error={timeline.error} onRetry={() => timeline.refetch()} /> : <TimelineTab timeline={timeline.data?.items} />)}
      </Tabs>
    </div>
  );
}

export default function App() {
  const [route, setRoute] = useState<Route>(readRoute);
  const navigate = useCallback((path: string) => { window.history.pushState({}, "", path); setRoute(readRoute()); window.scrollTo({ top: 0, behavior: "smooth" }); }, []);
  useEffect(() => { const listener = () => setRoute(readRoute()); window.addEventListener("popstate", listener); return () => window.removeEventListener("popstate", listener); }, []);
  const cases = useQuery({ queryKey: ["cases"], queryFn: api.listCases });
  const mockStatus = useQuery({ queryKey: ["mock-status"], queryFn: api.getMockStatus });
  const signals = useQuery({ queryKey: ["signals"], queryFn: api.getSignals, enabled: route.page === "inbox" || route.page === "case" });
  const products = useQuery({ queryKey: ["products"], queryFn: api.getProducts, enabled: route.page === "case" && route.tab === "products" });
  const selectedCase = route.page === "case" ? route.caseId : undefined;
  return <div className="min-h-screen bg-[#f8f8f5] text-stone-900"><Sidebar route={route} onNavigate={navigate} /><div className="lg:pl-[248px]"><Header route={route} onNavigate={navigate} mockStatus={mockStatus.data} /><MobileNav route={route} onNavigate={navigate} /><main className="mx-auto max-w-[1440px] px-5 py-7 sm:px-8 lg:px-10 lg:py-9">{route.page === "cases" && <CasesPage cases={cases.data?.items} isLoading={cases.isLoading} isError={cases.isError} onRetry={() => cases.refetch()} onNavigate={navigate} />}{route.page === "inbox" && <InboxPage signals={signals.data?.items} isLoading={signals.isLoading} isError={signals.isError} onRetry={() => signals.refetch()} onNavigate={navigate} />}{route.page === "trace" && <TracePage onNavigate={navigate} Pill={Pill} Panel={Panel} ErrorNotice={ErrorNotice} statusLabel={statusLabel} statusTone={statusTone} />}{route.page === "case" && selectedCase && <CaseDetailPage caseId={selectedCase} tab={route.tab ?? "overview"} onNavigate={navigate} signals={signals.data?.items} products={products.data?.items} isProductsLoading={products.isLoading} isProductsError={products.isError} onRetryProducts={() => products.refetch()} mockStatus={mockStatus.data} />}</main></div></div>;
}
