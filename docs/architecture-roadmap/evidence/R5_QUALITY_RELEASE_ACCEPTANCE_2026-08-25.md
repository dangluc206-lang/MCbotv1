# R5 Quality and Release Acceptance — 2026-08-25

## Acceptance status

`OFFLINE_ENGINEERING_ACCEPTED_WITH_DECLARED_LIMITS`.

Acceptance bao phủ source/config/fixtures và Electron fixture local. Nó không bao gồm public Minecraft server, secret thật, field SLO history hoặc independent human accessibility review.

## Gate set

- Incremental static quality với 91 managed files và frozen/reduced legacy debt budgets.
- Actual-contract fixture cho config/runtime artifact/preload consumer.
- Desktop critical-flow E2E bằng fake runtime, keyboard/a11y/structural visual assertions.
- Desktop first-start integration dùng runtime migration thật + fake Mineflayer client, chứng minh resolved credential đi tới `/login` ngay lần autostart đầu mà không kết nối server public.
- R5 deterministic fault matrix: command, GUI, inventory, generation, mode, B5/storage, persistence, update, Desktop và fleet.
- Operator projection benchmark p50/p95/p99 tại 1/8/16/32/64 fake bots.
- Release canary policy check cho invalid/unsafe/hold/rollback/advance/complete.
- Packaging footprint, ZIP exclusion, architecture reachability, ownership, config cross-reference và support-bundle integrity.

## Performance acceptance

Contract: p99 `< 50 ms`, payload 64 bot `< 128 KiB`. Lần đo acceptance trên máy audit đạt p99 dưới `3 ms` và payload tối đa dưới `28 KiB` tại 64 fake bots. Đây là synthetic projection benchmark, không phải 64 Mineflayer connection live.

## Fault/rollback acceptance

- Config restore có exact-tree apply, pre-restore rollback, target source retention protection và manifest byte/hash/path guard.
- Runtime migrator có planner/journal/applier/verifier/recovery seam và deterministic fault tests.
- Local ZIP vẫn exclude `.env`, runtime data/log/backup/secret/custom user mode và rollback khi helper apply fail.
- Canary không advance nếu integrity/rollback prerequisite thiếu; critical/failure-rate regression trả `ROLLBACK`.

## XP-406 field SLO

Status: `NOT_MEASURABLE_NO_OPT_IN_EPISODES`. Metric/privacy contract và support feedback path đã sẵn sàng, nhưng repository không có field history hợp lệ. Không tạo dữ liệu giả để nâng support status.

## Promotion rule

Chỉ đổi sang `PRODUCTION_STABLE` khi có đủ episode tối thiểu được product owner chốt trước, SLO đạt, rollback/canary qua môi trường operator lab và independent reviewer chấp nhận known limitations.

## Final gate record

- Full repository: `1104` tests; `1100` pass, `4` skipped, `0` fail. Bốn skip là symlink-creation cases bị Windows host từ chối; implementation vẫn có fail-closed guards.
- Fast quality lane: `22 PASS / 0 FAIL / 0 BLOCKED`.
- Release quality lane: `25 PASS / 0 FAIL / 0 BLOCKED`, gồm broader regression, installed regression và coverage thresholds.
- Architecture: `355/355` source reachable, `0` architecture failure.
- Config: `32/32` group schema pass và cross-reference pass.

## Supplemental Desktop first-start closure

- `quality:fast`: `22 PASS / 0 FAIL / 0 BLOCKED` sau khi cập nhật architecture baseline.
- Targeted environment/readiness/provenance/controller/first-start integration: pass, gồm một fake Mineflayer login qua runtime config đã migrate.
- Electron critical-flow E2E: `1/1` pass, không dùng network hoặc secret thật.
- Static-quality: `91` file được quản lý; `DesktopController` ceiling giảm còn `986`, Electron `main.js` còn `587`.
- Không chạy live public-server acceptance và không dùng `.env`, AppData runtime thật hoặc operator secret; promotion boundary phía trên không thay đổi.
