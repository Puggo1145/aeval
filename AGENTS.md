# YouEval Agent Roadmap

This file is the agent-facing roadmap for `youeval`.

## 1. Current Scope (Early Stage)
1. We are still in initial architecture and contract phase.
2. No mandatory build/run/test flow is defined yet.
3. Keep changes minimal and iterative (YAGNI).

## 2. Read Order
Read these files first, in order:
1. `README.md`
2. `DESIGN.md`
3. `docs/core-contracts-v1.md`
4. `docs/core-v1-implementation-plan.md`

If instructions conflict, follow this precedence:
1. User request in current task
2. This file (`AGENTS.md`)
3. `docs/core-contracts-v1.md`
4. `DESIGN.md`

## 3. Change Rules for Agents
1. Keep design changes synchronized across `DESIGN.md` and related docs.
2. Avoid speculative features; only implement what current milestone needs.
3. Keep docs concise when a section has no current ownership or actionable requirement.
4. Do not expand adapter-specific execution docs unless the milestone explicitly requires it.

## 4. General Working Style
- write clean comments on necessary code
