import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "./components/ui/button";
import { Textarea } from "./components/ui/textarea";

type Plan = { mode: string; summary: string; first_step: string; steps: {title: string; action: string; done_when: string; minutes: number}[] };
type Run = {id: string; goal: string; status: string; plan: Plan | null; error: string | null};
async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, headers: {"Content-Type":"application/json", ...init?.headers} });
  const body = await response.json();
  if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : body.error?.message ?? "目前無法完成，請稍後再試。");
  return body;
}
export default function App() {
  const cache = useQueryClient();
  const [goal,setGoal] = useState("");
  const [selected,setSelected] = useState<string | null>(null);
  const config = useQuery({queryKey:["config"],queryFn:()=>api<{mode:string;max_goal_chars:number}>("/api/config")});
  const history = useQuery({queryKey:["runs"],queryFn:()=>api<Run[]>("/api/runs"),
    refetchInterval: query => query.state.data?.some(r=>r.status==="running") ? 3000 : false});
  const create = useMutation({mutationFn:(text:string)=>api<Run>("/api/plans",{method:"POST",body:JSON.stringify({goal:text})}),
    onSuccess: run=>{setSelected(run.id);setGoal("");},onSettled:()=>cache.invalidateQueries({queryKey:["runs"]})});
  const run = history.data?.find(r=>r.id===selected) ?? history.data?.[0];
  const max = config.data?.max_goal_chars ?? 500;
  return <main className="mx-auto max-w-5xl px-5 py-10 text-foreground">
    <header className="mb-8 flex items-center justify-between gap-4"><h1 className="text-2xl font-bold">Hackathon Starter</h1><span className="text-sm text-muted-foreground">{config.isError ? "連線失敗" : config.data ? config.data.mode === "live" ? "AI 模式" : "範例模式 · 非 AI 回應" : "連線中…"}</span></header>
    <p className="mb-8 text-muted-foreground">先跑通一個完整流程：輸入目標、產生行動、保存結果。再把範例換成你的產品。</p>
    <div className="grid gap-8 md:grid-cols-2">
      <form onSubmit={event=>{event.preventDefault();create.mutate(goal.trim());}} className="space-y-4">
        <label htmlFor="goal" className="block font-semibold">你想完成什麼？</label>
        <Textarea id="goal" value={goal} onChange={e=>setGoal(e.target.value)} maxLength={max} disabled={create.isPending} placeholder="例如：明天做出一個可以展示的讀書助手" />
        <p className="text-sm text-muted-foreground">{goal.length} / {max}</p>
        <Button disabled={create.isPending || goal.trim().length<3 || !config.isSuccess} type="submit">{create.isPending ? "正在產生…" : "產生行動計畫"}</Button>
        {create.error && <p role="alert" className="text-red-700">{create.error.message}</p>}
      </form>
      <section aria-label="歷史紀錄"><h2 className="mb-4 font-semibold">這個瀏覽器的歷史紀錄</h2>
        {history.isPending && <p role="status">載入中…</p>}
        {history.isError && <><p role="alert">歷史紀錄讀取失敗。</p><Button variant="outline" onClick={()=>history.refetch()}>重試</Button></>}
        {history.data?.length===0 && <p className="text-muted-foreground">送出第一個目標後，結果會保存在這裡。</p>}
        <ul className="space-y-2">{history.data?.map(item=><li key={item.id}><button onClick={()=>setSelected(item.id)} className="w-full rounded-md border p-3 text-left hover:bg-secondary focus-visible:outline-2 focus-visible:outline-primary"><span className="block break-words">{item.goal}</span><span className="text-xs text-muted-foreground">{item.status==="completed" ? "已完成" : item.status==="failed" ? "失敗" : "進行中"}</span></button></li>)}</ul>
      </section>
    </div>
    {run && <section className="mt-10 border-t pt-6" aria-live="polite"><h2 className="text-xl font-semibold break-words">{run.goal}</h2>
      {run.error && <p role="alert" className="mt-3 text-red-700">{run.error}</p>}
      {run.status==="running" && <p className="mt-3">正在處理。長時間中斷的任務會標示失敗。</p>}
      {run.plan && <><p className="mt-3">{run.plan.summary}</p><p className="mt-3 font-medium">先做：{run.plan.first_step}</p><ol className="mt-6 space-y-5">{run.plan.steps.map((step,i)=><li key={i} className="border-t pt-4"><h3 className="font-semibold">{i+1}. {step.title} · {step.minutes} 分鐘</h3><p className="mt-2">{step.action}</p><p className="mt-2 text-sm text-muted-foreground">完成判斷：{step.done_when}</p></li>)}</ol></>}
    </section>}
    <footer className="mt-10 text-xs text-muted-foreground">匿名 session；清除 cookie 後無法找回這個瀏覽器的歷史。</footer>
  </main>;
}
