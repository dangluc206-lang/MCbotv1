# R6 Worker Boundary Decision — 2026-08-25

## Quyết định

`NO_GO_MONOLITH_SUFFICIENT`.

Không triển khai worker/process control protocol ở thời điểm này. Đây là kết quả đúng của conditional gate XP-500, không phải công việc còn quên.

## Evidence

| Bots giả lập | p99 projection | Payload tối đa |
|---:|---:|---:|
| 1 | < 1 ms | < 1 KiB |
| 8 | < 1 ms | < 4 KiB |
| 16 | < 1 ms | < 8 KiB |
| 32 | < 2 ms | < 14 KiB |
| 64 | < 3 ms | < 28 KiB |

Contract hiện tại là p99 `< 50 ms`, payload 64 bot `< 128 KiB`. Snapshot projection không phải bottleneck theo workload này.

## Lý do không mở XP-501

- Chưa có field incident chứng minh một BotRuntime crash/freeze kéo cả fleet sau fault containment hiện tại.
- Chưa có deployment/operator model cần process isolation.
- Worker sẽ thêm protocol versioning, event ordering, split-brain, reconciliation và rolling-update failure modes.
- Renderer/snapshot/log issue phải sửa ở owner tương ứng, không dùng worker để che.

## Trigger bắt buộc mở lại

Mở lại decision chỉ khi có ít nhất một bằng chứng XP-500: event-loop/heap vượt SLO, blast radius không chấp nhận được, fault isolation thất bại có incident artifact, hoặc deployment thật yêu cầu process isolation. Khi đó phải benchmark prototype fake transport trước ADR GO.
