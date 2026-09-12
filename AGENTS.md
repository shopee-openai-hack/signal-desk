# AGENTS.md — SEA × OpenAI Codex Hackathon 2026-09-12

> Hackathon build. 7-hour window, code freeze 17:30. Read this file at the start of every session.
> Keep every change small, integrated, and demoable.
>
> **STATUS: sections marked `TBD` are filled in after the 10:30 kickoff. If a section still says TBD,
> ask the human before assuming anything about it. Do not invent a problem domain or a tech stack.**

## What we are building

TBD — one paragraph, written as Question & Solution, filled in after kickoff.

## Demo loop (the only thing that matters)

TBD — the single end-to-end loop the demo walks through.

Shape it must take, regardless of topic:
**one screen, three tools, one loop, one approval gate.**
Anything outside that loop is out of scope unless a human says otherwise.

## Architecture

TBD after stack is chosen. Constraints that hold either way:

- Synthetic data only. **Do not call real external APIs.** Fixtures live in `data/`.
- Every tool is a separate file with a typed input/output schema and a dry-run mode.
- The agent loop is one file, readable top to bottom. A judge may read it.

## Commands

TBD — install / run backend / run frontend / test / generate demo data.
Fill these in the moment the scaffold exists; an agent that has to guess a command wastes a turn.

## Rules for agents (these are final, not TBD)

1. **Plan first for anything over 20 lines.** Post the plan, wait for an OK, then implement.
2. **No new dependencies without asking.** If you believe one is necessary, say so and stop.
3. **Typed tools.** Every tool has an explicit input/output schema and a dry-run mode.
   Any destructive tool (taking a listing down, refunding, freezing, notifying a seller)
   must route through the approval gate. Never let one fire directly from the agent loop.
4. **Every agent decision writes exactly one audit record:**
   `{who, what, why, evidence, timestamp}`.
   This record *is* the demo. If a code path can act without writing one, that is a bug.
5. **Test every tool.** Run the full suite before reporting done. Report failures verbatim —
   do not paper over a failure or narrow a test until it passes.
6. **Stay in your lane.** Only edit the files your task names. If you must touch something else,
   say so explicitly in your report.
7. **Integration cadence.** Commit to your own branch as each piece finishes.
   The merge owner integrates every 45–60 minutes. Never force-push. Never commit to `main` directly.
8. **Stop condition.** When the acceptance criteria in your task prompt pass, stop.
   Maximum 2 attempts per approach, then stop and report the failure trail.
9. **Report format.** Conclusions as bullets with `file:line`. State what you did *not* verify.
   No file dumps.

## Ownership

| Area | Owner | Codex session |
|---|---|---|
| Agent loop + tools | TBD | #1 |
| Frontend / audit-trail UI | TBD | #2 |
| Synthetic data + failure injection | TBD | #3 |
| Merge owner / demo script / pitch | Morris | — |

Team: easonyu0203, Brian-Konr, minchenlee, morrisch3n.

## Definition of done (for the day)

- Demo script runs end to end from a clean start in under 3 minutes.
- The failure-injection scenario works: contradictory data or a tool fault goes in,
  the agent halts, re-evaluates, keeps the safe actions it already executed,
  and asks for the right approval. **This is the winning moment. Protect it.**
- Backup video recorded before 16:45.

## Hard schedule

| Time | Gate |
|---|---|
| 11:00 | Scope locked, demo script written, scaffold up |
| **12:30** | **Working vertical slice** |
| **15:30** | **Finals-grade build** |
| 16:00 | Hard cutoff — anything not integrated gets cut, not finished |
| 16:45 | Feature freeze, backup video recorded |
| 17:30 | Code freeze |
