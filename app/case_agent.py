from __future__ import annotations

import asyncio
import hashlib
import json
import logging
from datetime import datetime, timezone
from typing import Callable
from uuid import uuid4

from openai import AsyncOpenAI
from .case_schemas import (
    AgentStatus, CaseDecision, CaseOwner, CaseSnapshot, Claim, Signal, VerificationUpdate,
)
from .case_store import CaseStore, SignalConflict, VersionConflict, new_timeline_item
from .config import Settings

logger = logging.getLogger(__name__)


class CaseModelUnavailable(Exception):
    pass


class InvalidCaseDecision(Exception):
    pass


CASE_PROMPT = """You are an internal marketplace case specialist. Return only a JSON object.
Given a signal or verification update and the supplied existing cases, choose an
existing case_id or null for a new case. Then propose the complete case assessment.
Never invent signal, claim, evidence, case, or product IDs. Use only supplied IDs.
Keep verification truth, business impact, and investigation priority separate.
Missing evidence is unknown, not refuted. A repost is not an independent source.
One secondhand, unverified report with plausible product exposure should remain
pending and monitored at medium priority; a personal sensory impression is not
proof of a safety defect. Escalate when independent, specific reports or official
evidence justify it, and narrow product scope when later evidence excludes a batch.
An official document that is both a new Signal and verification Evidence is one
underlying source, not two independent corroborating sources.
Do not claim that a candidate product is proven unsafe or approved for delisting.
If new information changes nothing, preserve the assessment and explain why.
Provide case_id, title, status, business_impact, priority, priority_reasons,
unknowns, next_steps, monitoring_plan, candidate_products, summary, reason,
and source_refs. Monitoring plan has targets, next_check_at, and reason.
Candidate products have product_id, relation, reason, and missing_information.
Source refs should identify the signal, claims, or evidence that support this decision.
All times must be UTC ISO 8601. Do not output private reasoning."""


class OpenAICaseDecider:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.client = AsyncOpenAI(api_key=settings.openai_api_key, max_retries=0,
                                  timeout=settings.model_timeout_seconds) if settings.openai_api_key else None

    async def close(self) -> None:
        if self.client:
            await self.client.close()

    async def decide(self, *, signal: Signal | None, cases: list[CaseSnapshot],
                     case_signals: dict[str, list[Signal]],
                     updated_claims: list[Claim],
                     updates: list[VerificationUpdate], replay_at: datetime | None,
                     products: list[dict]) -> CaseDecision:
        if self.client is None:
            raise CaseModelUnavailable("Set a backend OPENAI_API_KEY for case decisions")
        payload = {
            "signal": signal.model_dump(mode="json") if signal else None,
            "cases": [case.model_dump(mode="json") for case in cases],
            "case_signals": {
                case_id: [item.model_dump(mode="json") for item in items]
                for case_id, items in case_signals.items()
            },
            "updated_claims": [claim.model_dump(mode="json") for claim in updated_claims],
            "verification_updates": [update.model_dump(mode="json") for update in updates],
            "replay_at": replay_at.isoformat() if replay_at else None,
            "simulated_products": products,
        }
        try:
            async with asyncio.timeout(self.settings.model_timeout_seconds + 2):
                response = await self.client.chat.completions.parse(
                    model=self.settings.openai_model,
                    messages=[{"role": "system", "content": CASE_PROMPT},
                              {"role": "user", "content": json.dumps(payload, ensure_ascii=False)}],
                    response_format=CaseDecision,
                    temperature=0.2,
                    max_tokens=1000,
                )
            parsed = response.choices[0].message.parsed
            if parsed is None:
                raise InvalidCaseDecision("empty or refused model decision")
            return parsed
        except Exception as exc:
            if isinstance(exc, InvalidCaseDecision):
                raise
            logger.warning("case model request failed: %s", type(exc).__name__)
            raise CaseModelUnavailable("case model request failed") from exc


class CaseService:
    def __init__(self, store: CaseStore, decider: OpenAICaseDecider,
                 product_catalog: Callable[[], list[dict]] | None = None,
                 daily_limit: int = 100):
        self.store = store
        self.decider = decider
        self.product_catalog = product_catalog or (lambda: [])
        self.daily_limit = daily_limit

    @staticmethod
    def _request_hash(value: object) -> str:
        return hashlib.sha256(json.dumps(value, sort_keys=True, default=str).encode()).hexdigest()

    @staticmethod
    def _validate_decision(decision: CaseDecision, allowed_cases: set[str],
                           allowed_refs: set[str], allowed_products: set[str]) -> None:
        if decision.status == "actioned":
            raise InvalidCaseDecision("only C's execution result may mark a case actioned")
        if decision.status == "closed":
            raise InvalidCaseDecision("closing a case requires explicit owner confirmation")
        if decision.case_id is not None and decision.case_id not in allowed_cases:
            raise InvalidCaseDecision("model selected an unavailable case")
        if not set(decision.source_refs).issubset(allowed_refs):
            raise InvalidCaseDecision("model cited an unavailable source")
        if not decision.source_refs:
            raise InvalidCaseDecision("model decision has no source references")
        if not {p.product_id for p in decision.candidate_products}.issubset(allowed_products):
            raise InvalidCaseDecision("model selected an unavailable product")

    async def dispatch(self, signal_id: str, key: str, replay_at: datetime | None = None) -> CaseSnapshot | None:
        request_hash = self._request_hash({"operation": "dispatch", "signal_id": signal_id,
                                           "replay_at": replay_at})
        prior = self.store.operation_result(key, request_hash)
        if prior:
            self._ensure_observation(prior, replay_at)
            return prior
        assigned = self.store.assigned_case(signal_id)
        if assigned:
            self._ensure_observation(assigned, replay_at)
            return assigned
        signal = self.store.get_signal(signal_id)
        if signal is None:
            return None
        if signal.source_relation == "repost" and not signal.claims:
            if not signal.duplicate_of_signal_id:
                raise InvalidCaseDecision("pure repost needs an original signal ID")
            original_case = self.store.assigned_case(signal.duplicate_of_signal_id)
            if original_case is None:
                raise InvalidCaseDecision("original signal must be dispatched first")
            now = replay_at or datetime.now(timezone.utc)
            item = new_timeline_item(
                original_case.case_id, original_case.version, "signal_added",
                f"Repost {signal.signal_id} added",
                "Pure repost preserves source activity without new independent evidence",
                [signal.signal_id, signal.duplicate_of_signal_id], now,
            )
            result = self.store.record_repost(
                signal.signal_id, signal.duplicate_of_signal_id, item, key, request_hash,
            )
            self._observe_waiting(result, item.summary, now)
            return result
        candidates = self.store.list_cases()
        products = self.product_catalog()
        self.store.reserve_model_call(self.daily_limit)
        decision = await self.decider.decide(signal=signal, cases=candidates, updates=[],
                                             case_signals={case.case_id: self.store.case_signals(case.case_id)
                                                           for case in candidates},
                                             updated_claims=[],
                                             replay_at=replay_at, products=products)
        refs = {signal_id, *(claim.claim_id for claim in signal.claims)}
        refs.update(e.evidence_id for claim in signal.claims for e in claim.evidence)
        refs.update(claim_id for case in candidates for claim_id in case.claim_ids)
        known_products = {p.product_id for case in candidates for p in case.candidate_products}
        self._validate_decision(decision, {case.case_id for case in candidates}, refs,
                                known_products | {p["product_id"] for p in products})
        previous = self.store.get_case(decision.case_id) if decision.case_id else None
        return self._persist(decision, previous, key, request_hash, signal, replay_at)

    async def advance(self, case_id: str, expected_version: int, updates: list[VerificationUpdate],
                      key: str, replay_at: datetime | None = None) -> CaseSnapshot | None:
        request_hash = self._request_hash({"operation": "advance", "case_id": case_id,
                                           "expected_version": expected_version,
                                           "updates": [u.model_dump(mode="json") for u in updates],
                                           "replay_at": replay_at})
        prior = self.store.operation_result(key, request_hash)
        if prior:
            self._ensure_observation(prior, replay_at)
            return prior
        previous = self.store.get_case(case_id)
        if previous is None:
            return None
        if previous.version != expected_version:
            raise VersionConflict("case version changed")
        if not updates:
            raise InvalidCaseDecision("advance needs a verification update")
        known_claims = set(previous.claim_ids)
        if any(update.claim_id not in known_claims for update in updates):
            raise InvalidCaseDecision("verification references a claim outside this case")
        if any(e.claim_id != u.claim_id for u in updates for e in u.evidence):
            raise InvalidCaseDecision("evidence claim_id mismatch")
        if any(u.verification_status in {"supported", "refuted"} and not u.evidence for u in updates):
            raise InvalidCaseDecision("a verdict needs evidence")
        updated_claims = []
        for update in updates:
            canonical = self.store.get_claim(update.claim_id)
            if canonical is not None:
                updated_claims.append(canonical)
            if self.store.signal_reader is not None:
                if canonical is None or (
                    canonical.verification_status != update.verification_status
                    or canonical.evidence != update.evidence
                ):
                    raise InvalidCaseDecision(
                        "verification update must match A's persisted Claim"
                    )
        products = self.product_catalog()
        self.store.reserve_model_call(self.daily_limit)
        decision = await self.decider.decide(signal=None, cases=[previous], updates=updates,
                                             case_signals={case_id: self.store.case_signals(case_id)},
                                             updated_claims=updated_claims,
                                             replay_at=replay_at, products=products)
        refs = known_claims | {e.evidence_id for u in updates for e in u.evidence}
        known_products = {p.product_id for p in previous.candidate_products}
        self._validate_decision(decision, {case_id}, refs,
                                known_products | {p["product_id"] for p in products})
        if decision.case_id != case_id:
            raise InvalidCaseDecision("advance cannot move a case")
        return self._persist(decision, previous, key, request_hash, None, replay_at, updates)

    def _persist(self, decision: CaseDecision, previous: CaseSnapshot | None, key: str,
                 request_hash: str, signal: Signal | None, replay_at: datetime | None,
                 updates: list[VerificationUpdate] | None = None) -> CaseSnapshot:
        case_id = previous.case_id if previous else f"case_{uuid4().hex}"
        version = previous.version + 1 if previous else 1
        now = replay_at or datetime.now(timezone.utc)
        claim_ids = list(previous.claim_ids) if previous else []
        if signal:
            claim_ids = list(dict.fromkeys(claim_ids + [claim.claim_id for claim in signal.claims]))
        snapshot = CaseSnapshot(
            case_id=case_id, version=version, title=decision.title, status=decision.status,
            business_impact=decision.business_impact, priority=decision.priority,
            priority_reasons=decision.priority_reasons,
            owner=previous.owner if previous else CaseOwner(id=f"agent_{case_id}"),
            claim_ids=claim_ids, unknowns=decision.unknowns, next_steps=decision.next_steps,
            monitoring_plan=decision.monitoring_plan, candidate_products=decision.candidate_products,
            updated_at=now,
        )
        items = []
        if signal:
            items.append(new_timeline_item(case_id,version,"signal_added",
                         f"Signal {signal.signal_id} added", f"Source relation: {signal.source_relation}",
                         [signal.signal_id], now))
        if updates:
            items.append(new_timeline_item(case_id,version,"verification_updated",
                         "Verification evidence updated", decision.reason,
                         [u.claim_id for u in updates] + [e.evidence_id for u in updates for e in u.evidence],now))
        items.append(new_timeline_item(case_id,version,"assessment_updated",
                     decision.summary,decision.reason,decision.source_refs,now))
        if previous is None or previous.monitoring_plan != snapshot.monitoring_plan:
            items.append(new_timeline_item(case_id,version,"monitoring_updated",
                         "Monitoring plan updated",snapshot.monitoring_plan.reason,decision.source_refs,now))
        result = self.store.save_revision(snapshot,items,key,request_hash,
                                        previous.version if previous else None,
                                        signal.signal_id if signal else None)
        self._observe_waiting(result, decision.summary, now)
        return result

    def _observe_waiting(self, snapshot: CaseSnapshot, latest_result: str,
                         observed_at: datetime) -> None:
        human = snapshot.status == "awaiting_approval"
        self.store.save_agent_status(AgentStatus(
            case_id=snapshot.case_id, agent_id=snapshot.owner.id,
            state="waiting_human" if human else "waiting_follow_up",
            current_step="等待人工核可" if human else "等待後續訊號或查核",
            latest_result=latest_result,
            waiting_reason="需要員工核可商品處置" if human else snapshot.monitoring_plan.reason,
            next_action=snapshot.next_steps[0] if snapshot.next_steps else None,
            observed_at=observed_at,
        ))

    def _ensure_observation(self, snapshot: CaseSnapshot,
                            replay_at: datetime | None) -> None:
        current = self.store.get_case(snapshot.case_id) or snapshot
        observed = self.store.get_agent_status(current.case_id)
        events = self.store.timeline(current.case_id)
        latest_event = events[-1] if events else None
        if observed is None or (
            latest_event is not None and observed.observed_at < latest_event.occurred_at
        ):
            self._observe_waiting(
                current, latest_event.summary if latest_event else current.title,
                latest_event.occurred_at if latest_event else
                (replay_at or datetime.now(timezone.utc)),
            )


class InProcessCaseDispatcher:
    """Adapter for A's ``CaseDispatcherProtocol`` after both services are composed."""

    def __init__(self, service: CaseService):
        self.service = service

    async def dispatch(self, signal_id: str) -> None:
        signal = self.service.store.get_signal(signal_id)
        if signal is None:
            raise SignalConflict("canonical signal was not available for dispatch")
        result = await self.service.dispatch(
            signal_id, key=f"a-signal-dispatch:{signal_id}",
            replay_at=signal.source.retrieved_at,
        )
        if result is None:
            raise SignalConflict("canonical signal was not available for dispatch")
