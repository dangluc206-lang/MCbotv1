# Risk Register

## Scale

- Probability: Low / Medium / High.
- Impact: P3 minor / P2 material / P1 critical / P0 catastrophic.
- Status: Open / Mitigating / Accepted / Closed.

## Risks

| ID | Risk | Probability | Impact | Trigger/evidence | Mitigation/WP |
|---|---|---|---|---|---|
| R-001 | Big-bang server extraction breaks MinerUA | High | P1 | broad moves/import churn | façade + parity, WP-100–105 |
| R-002 | New mode bypasses SDK | Medium | P1 | control switch/raw client | WP-201/204 + architecture gate |
| R-003 | Stale callback mutates new connection | Medium | P0 | reconnect incident | WP-005 |
| R-004 | Blind GUI retry duplicates craft/sell | Medium | P0 | timeout/no delta | WP-301/302/303 |
| R-005 | Cleanup deletes unowned path | Medium | P0 | temp collision/fault | WP-003/004 |
| R-006 | Config/update leaves mixed state | Medium | P0 | failure after rename | WP-003 |
| R-007 | Capability abstraction is cosmetic | High | P2 | one impl/no tests | fake profile/consumer gate |
| R-008 | Resource locks deadlock | Medium | P1 | multi-resource operations | WP-202 conflict/order model |
| R-009 | Durable checkpoint replays stale runtime object | Low | P0 | restart/recovery | state contract + tests |
| R-010 | Support bundle leaks secret | Medium | P0 | incident export | WP-400 redaction |
| R-011 | Test suite flaky from real time/global call count | High | P2 | intermittent CI | WP-401 virtual clock/path hooks |
| R-012 | Roadmap docs break validator | Certain initially | P2 | MARKDOWN_UNAUTHORIZED | WP-000 |
| R-013 | Existing dirty worktree causes overwrite | High | P1 | overlapping edits | new namespace, scoped patches |
| R-014 | Microservice split doubles failure modes | Medium | P1 | premature Phase 6 | WP-500/501 go-no-go |
| R-015 | Server observation treated as config authority | Medium | P1 | learned GUI/item overwrite | profile/observation separation |
| R-016 | Error contract migration breaks UI/tests | Medium | P2 | removed fields/messages | additive façade, WP-002/300 |
| R-017 | Legacy modes copied into future modes | High | P2 | scaffold by copy | WP-203 + Mode SDK docs |
| R-018 | B5 policy leaks into generic engine | Medium | P1 | generic B1/B5 concepts | WP-303/server profile boundary |
| R-019 | Documentation becomes stale | High | P2 | code moves without update | WP-000 governance + release gate |
| R-020 | Architecture metrics gamed | Medium | P3 | empty wrappers/tests | evidence + consumer tests |

## Risk review cadence

- Review trước mỗi phase gate.
- Update khi incident hoặc contract đổi.
- P0/P1 Open chặn phase feature expansion trừ approved emergency.
- Accepted risk cần owner, reason, expiry/revisit trigger.

## Risk entry template

```text
ID:
Description:
Affected assets/invariants:
Probability:
Impact:
Trigger:
Detection:
Mitigation:
Fallback:
Owner:
Review date:
Status:
Evidence:
```
