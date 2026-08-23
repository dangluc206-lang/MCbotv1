# Phase 2 — Server Profile Boundary

## Outcome

MinerUA-specific facts/implementations được truy cập qua explicit ServerProfile/capability binding; fake second profile chứng minh generic boundary.

## Entry criteria

- Phase 1 critical gate đạt.
- WP-002 contract decisions có.
- MinerUA source of truth và config validator ổn định.

## Mandatory work packages

- WP-100 đến WP-105.

## Migration slices

1. Contract/registry/bootstrap binding.
2. Knowledge inventory.
3. Command/auth/join read path.
4. GUI/item identity read path.
5. Recipe/storage/cooldown read path.
6. Fake profile contract suite.
7. Deprecate direct generic imports.

## Compatibility strategy

- Façade trước, move sau.
- MinerUA defaults giữ behavior.
- Fallback có warning/telemetry và expiry.
- Config migration additive.
- Profile missing capability fail closed.

## Required tests

- MinerUA parity fixtures.
- Fake profile with different raw semantics.
- Bootstrap per-bot profile selection.
- Missing/unknown capability readiness.
- No MinerUA import in designated generic modules.
- B5/fishing/storage regression.

## Exit criteria

- ServerProfile selected per bot/profile.
- Core/mode semantic path không hard-code MinerUA commands/GUI/items ở migrated scope.
- Fake profile passes generic contract suite.
- `SERVER_BEHAVIOR.md` mapping/revision rõ.

## Stop conditions

- Mass file move trước façade.
- Fake profile chỉ clone MinerUA values.
- Secret đưa vào profile.
- Unknown server fact treated as confirmed.

## Gate status — 2026-08-22

`PASS` — WP-100 through WP-105 complete. Fake second-server contracts exercise command/join/GUI/item/recipe/storage differences and unsupported capability readiness without a MinerUA conditional in generic modules.
