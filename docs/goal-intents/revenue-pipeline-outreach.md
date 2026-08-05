---
goal_id: revenue-pipeline-outreach
goal_title: Fill and advance the revenue pipeline through relationship-led outreach
canvas_version: 1
status: draft
key_results:
  - Every active opportunity has a clear next action, decision stage, and owner signal.
  - At least one qualified conversation per week is created or advanced through outreach.
  - Warm A/B relationships have reviewable next-touch windows before they go stale.
  - Outreach targets and messages are tied to ICP, expensive problem, and service-first value.
leading_indicators:
  - Pipeline work updates CRM, proposal, discovery, nurture, or next-touch state.
  - Next actions distinguish advance, nurture, disqualify, pause, or proposal work.
  - New outreach work names target segment, channel, warmth, and next relationship action.
  - Human-facing messages pass Yuval-voice and recipient-first review before use.
fit_signals:
  - sales
  - proposal
  - crm
  - pipeline
  - deal
  - opportunity
  - nurture
  - discovery
  - follow-up
  - qualified
  - client conversation
  - outreach
  - prospect
  - linkedin
  - dm
  - email
  - ecosystem
  - partner
  - relationship
  - goextrovert
  - comment
  - connection
  - next touch
  - referral
anti_fit_signals:
  - website css
  - website bug
  - content pipeline
  - article draft
  - model routing
  - personal records
  - personal admin
  - generic infrastructure
  - client delivery with no commercial next step
straying_questions:
  - Is this opening, nurturing, or advancing a business relationship, or is it delivery/content/infra work that only mentions a customer?
  - Is this SDR prospecting, BDR nurture, or an active opportunity?
  - What evidence would make the next action reviewable in Mini CRM?
---

# Lean Product Canvas Intent: Revenue Pipeline & Outreach

## Outcome-Oriented Goal

Fill and advance Yuval's pipeline through high-trust relationship-building outreach, warm relationship development, clean CRM state, and value-based next commitments.

Leading indicators:

- Conversation creation: at least one qualified conversation is created or advanced per week.
- Next-action coverage: 100 percent of active opportunities have a clear next action, decision stage, and owner signal.
- Warm-relationship hygiene: A/B relationships reviewed in the weekly pipeline tick have a next-touch decision: advance, nurture, pause, disqualify, or ask Yuval.
- Message quality: human-facing messages pass recipient-first and Yuval-voice review before use.

## Customer Segments

- Yuval, operating a solo advisory practice and needing disciplined pipeline motion.
- Warm relationships, partners, prior clients, advisors, and ecosystem contacts who may benefit from AI transformation, product operating model, or flow/advisory support.
- Qualified prospects from LinkedIn, GoExtrovert, referrals, newsletter/community signals, or client/customer research.

## Problem

Pipeline activity is visible, but traction is not always observable. Warm relationships can sit with no next-touch plan, active opportunities can lack a clear next commitment, and outreach threads can blur together with content, customer delivery, or generic prospecting. Without clear fit rules, the goal network counts activity but cannot tell whether revenue moved.

## Existing Alternatives

- Leave follow-up decisions in memory or scattered notes.
- Generate generic nudges without real trigger context.
- Treat every LinkedIn, content, proposal, or customer-delivery thread as revenue work.
- Wait for opportunities to reappear instead of maintaining reviewable next-touch windows.

## Unique Value Proposition

Revenue work becomes inspectable relationship momentum: every meaningful thread either advances a conversation, clarifies a relationship plan, improves CRM evidence, or gets routed out of the revenue goal.

## Solution Shape

- Weekly Revenue tick reviews Mini CRM relationship/action state and the goal-network supporting threads.
- Separate SDR prospecting from BDR nurture and active opportunity work before recommending action.
- Draft messages only from real trigger context and run them through recipient-first and Yuval-voice review.
- Update CRM or thread state only after explicit approval when the action mutates records or sends messages.
- Route content, delivery, and infrastructure work out of this goal unless there is a clear commercial next step.

## Channels / Surfaces

- Mini CRM and its MCP/chat surfaces.
- `projects/crm-ops/active.md`.
- Revenue agent tick records in `agents/revenue/ticks/`.
- GoExtrovert and LinkedIn workflows for approved outreach/supporting evidence.
- Gmail and Calendar reads when needed for relationship context, with no raw-email caching.

## Revenue / Value Logic

The value is qualified conversations and cleaner relationship momentum. The pipeline improves when trusted relationships have timely, specific next actions and outreach is tied to an expensive problem instead of generic activity.

## Cost Structure

- Weekly relationship review and CRM hygiene.
- Research needed to find real trigger context before outreach.
- Yuval review for high-stakes relationship touches and any CRM/message mutation.
- Tooling fixes when CRM-generated nudges invent or overgeneralize context.

## Unfair Advantage

Yuval has a high-trust advisory network, real client delivery evidence, and a practical AI transformation point of view. The revenue system can work through useful, specific relationship moves instead of volume-based automation.

## Thread Association Guidance

Strong fit:

- The thread creates or advances a qualified conversation.
- The work updates CRM, proposal, discovery, nurture, next-touch, or opportunity state.
- Outreach names a target segment, channel, warmth level, real trigger, and next relationship action.
- Proposal or sales-material work is tied to a live opportunity and next commitment.

Weak fit:

- Prospect research with no selected segment, channel, or next action.
- LinkedIn/commenting work that creates attention but no relationship step yet.
- Customer-delivery work that could affect revenue but has no explicit commercial follow-up.
- Content work intended to support sales but not attached to a pipeline or nurture move.

Possible misfit:

- Website implementation, content pipeline, model routing, agent infra, personal admin, or client delivery labeled as revenue only because a customer, prospect, or message is mentioned.

## Suggested `/goal` Loop Prompt

```text
/goal Drive toward: Fill and advance Yuval's pipeline through high-trust relationship-building outreach, warm relationship development, clean CRM state, and value-based next commitments.
Leading indicators: at least one qualified conversation created or advanced per week; 100 percent active opportunities have clear next action, decision stage, and owner signal; A/B relationships reviewed in the weekly tick have next-touch decisions; human-facing messages pass recipient-first and Yuval-voice review before use.
Each cycle: review docs/goal-intents/revenue-pipeline-outreach.md, inspect the Revenue Pipeline & Outreach supporting threads, classify each as SDR prospecting, BDR nurture, active opportunity, misfit, or wait, choose the smallest action that creates traction evidence or improves CRM observability, and stop before any external send or CRM mutation unless Yuval explicitly approves it.
```
