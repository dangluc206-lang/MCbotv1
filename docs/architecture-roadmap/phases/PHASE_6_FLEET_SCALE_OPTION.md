# Phase 6 — Optional Fleet Scale and Distribution

## Gate status

`NOT ENTERED — 2026-08-22`: P0–P5 are complete, but the required measurable scale/reliability driver is absent. Modular monolith remains the governed deployment architecture.


## Outcome

Ra quyết định có evidence về process isolation/distribution. Không mặc định phải triển khai.

## Entry criteria

- P0–P5 gates đạt.
- Modular monolith boundaries/contracts đã chứng minh.
- Có measurable driver.

## Mandatory decision packages

- WP-500.
- WP-501 chỉ khi WP-500 đề xuất prototype.

## Evidence cần thu

- bot count target/current;
- CPU/memory/event-loop delay;
- crash blast radius;
- reconnect/update rollout requirements;
- multi-machine/network constraints;
- secret/security isolation;
- operational staffing/complexity budget.

## Prototype boundary

Nếu GO prototype:

```text
Control protocol
├── desired intent revision
├── runtime command
├── status/health
├── event/result envelope
└── shutdown/recovery handshake
```

Không truyền raw Mineflayer objects.

## Go criteria

- Driver định lượng vượt threshold.
- In-process/public contract parity.
- At-least-once/duplicate command semantics xử lý.
- Worker death/restart/stale message tests.
- Secret/config distribution policy.
- Operational benefit lớn hơn complexity.

## No-go criteria

- Vấn đề giải được bằng worker thread/tuning/bot count partition đơn giản.
- Chưa có SLO hoặc measurement.
- Protocol cần expose raw client/state.
- Dual architecture không có owner.

## Exit outcomes

### NO-GO

ADR giữ modular monolith, xóa prototype, ghi revisit trigger.

### GO

Tạo roadmap riêng cho distribution rollout; không implement production rollout trong WP-501.
