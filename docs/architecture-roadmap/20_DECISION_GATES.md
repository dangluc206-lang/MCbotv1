# Decision Gates

## Gate 0 — Có nên tạo abstraction?

GO khi có:

- ít nhất hai consumer/implementation; hoặc
- một boundary risk rõ và contract test chứng minh.

NO-GO khi chỉ đổi tên wrapper/folder.

## Gate 1 — Có nên thêm resource lock?

GO khi có conflict graph/reproduction thật và owner/lifecycle rõ.

NO-GO khi boolean/check tuần tự hiện có đã đủ và không có cross-capability conflict.

## Gate 2 — Có nên tạo server profile boundary?

GO: luôn trước server thứ hai; contract dựa trên MinerUA inventory và fake profile.

NO-GO cho physical mass move trước façade/parity.

## Gate 3 — Có nên dùng composable workflow?

GO nếu sequence ngắn, module/capability có sẵn, no arbitrary code, bounded branch/retry.

NO-GO nếu cần planner phức tạp, raw protocol hoặc state machine riêng sâu.

## Gate 4 — Có nên retry mutation?

GO chỉ sau reconciliation chứng minh action chưa xảy ra và policy/attempt/generation còn hợp lệ.

NO-GO khi outcome uncertain.

## Gate 5 — Có nên hot reload config?

GO khi group có explicit candidate validation + runtime apply rollback contract.

NO-GO nếu consumer chỉ đọc startup hoặc apply không rollback được; báo restart required.

## Gate 6 — Có nên persist checkpoint?

GO khi checkpoint logical/versioned/revalidatable và mang giá trị recovery thật.

NO-GO cho raw runtime object hoặc state tính lại dễ dàng.

## Gate 7 — Có nên thêm scheduler domain?

GO khi nhiều capability cần recurring/cooldown scheduling chung và local timer duplication gây risk.

NO-GO chỉ để thay một timer đơn giản đã supervised.

## Gate 8 — Có nên phân tán worker process?

GO khi benchmark/incident/SLO chứng minh nhu cầu và protocol parity đạt.

NO-GO vì “kiến trúc lớn trông chuyên nghiệp hơn”.

## Gate 9 — Có nên xóa compatibility path?

GO khi:

- no consumer/reachability;
- parity/regression pass;
- migration window hết;
- rollback/release note rõ.

## Gate 10 — Có được sang phase tiếp theo?

GO khi mandatory WPs DONE, DoD/gate/evidence đạt, P0/P1 risk không mở.

Nếu blocker là environment, ghi BLOCKED; không giả PASS hoặc nới invariant.
