# WP-203 — Legacy Mode Adapter Migration

## Status

`DONE`

## Objective

Đưa `collector-b5` và fishing behavior cần giữ vào Mode SDK/capability boundaries bằng strangler migration, không copy/rewrite.

## Depends on

- WP-201.
- WP-202.

## In scope

- Legacy gap inventory.
- Compatibility adapter.
- Lifecycle/task/resource migration từng slice.
- Status/control parity.
- Sunset/debt record.

## Out of scope

- Make legacy mode reference template.
- Change gameplay policy.
- Move raw fishing protocol owner không có ADR.

## Minimal steps

1. Capture behavior/lifecycle parity fixtures.
2. Identify raw side effects and capability candidates.
3. Add adapter implementing ManagedMode contract.
4. Route one lifecycle/task slice via context/supervisor.
5. Route semantic actions via capabilities.
6. Preserve raw protocol exception only at catalog owner.
7. Generic control/status test.
8. Mark remaining debt and exit trigger.

## Acceptance criteria

- No new mode copies legacy source.
- Adapter lifecycle/status generic.
- Migrated task cancellation/generation-safe.
- Existing gameplay behavior parity.
- Remaining exceptions explicit/cataloged.

## Tests

- start/pause/resume/disable/reconnect;
- task cancellation;
- resource contention;
- behavior trace parity;
- legacy config compatibility.

## Rollback

Feature flag/adapter route can return to old implementation for one release; descriptor/control contract remains.

## Stop conditions

- Big-bang rewrite.
- Fishing private packet code generalized without second consumer.
- B5 policy changed incidentally.


## Completion evidence — 2026-08-22

- `LegacyModeAdapter` is a composition-only strangler: it does not copy/rewrite Collector+B5 or Fishing and does not acquire a second `primary-mode` lease.
- Generic RuntimeModeRegistry/ModeControl paths bind the adapter; direct legacy services remain available for one-release compatibility/config editing.
- Enable/resume revalidate ready capabilities through `ModeContext`; status exposes current connection generation while preserving legacy status fields.
- Collector+B5 restart scheduling remains supervised from WP-202; existing Collector/Fishing lifecycle, reconnect and cancellation parity suites pass unchanged.
- `architecture/legacy-mode-debt.json` records remaining ownership and keeps `ConnectionPacketObserver` as the explicit raw fishing protocol exception.
