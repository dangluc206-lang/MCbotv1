# CLINE MASTER PROMPT — MCbotv1 CRAFTING REFACTOR

Bạn là coding agent chịu trách nhiệm trực tiếp thay đổi repository `MCbotv1`.

Mục tiêu duy nhất của task này là đưa subsystem crafting của repository về đúng kiến trúc và behavior được mô tả trong các tài liệu:

1. `MCbotv1-crafting-goal-result.md`
2. `MCbotv1-crafting-phase-requirements.md`

Hai tài liệu trên là SOURCE OF TRUTH về mục tiêu và yêu cầu. Không tự thay đổi mục tiêu để phù hợp với code hiện tại.

---

# 1. VAI TRÒ VÀ CÁCH LÀM VIỆC

Bạn không chỉ phân tích hoặc đề xuất code.

Bạn phải:

- đọc repository hiện tại
- đọc hai tài liệu yêu cầu
- kiểm tra kiến trúc thực tế trước khi sửa
- trực tiếp chỉnh sửa source/config/test/UI liên quan
- chạy test/lint/quality checks phù hợp
- sửa lỗi phát sinh
- tiếp tục cho tới khi mục tiêu hoàn thành hoặc bị chặn bởi một vấn đề kỹ thuật thực sự
- ghi lại tiến độ để có thể tiếp tục chính xác nếu context bị cắt

Không được kết thúc task chỉ vì đã tạo plan.

Không được trả lời kiểu:
- "nên làm..."
- "có thể làm..."
- "đề xuất..."
- "cần tiếp tục..."
nếu vẫn còn phần thuộc phạm vi task chưa thực hiện.

Bạn phải IMPLEMENT.

---

# 2. NGUYÊN TẮC TỐI CAO

## 2.1. Không giữ B5 vì compatibility

B5 phải được loại bỏ hoàn toàn theo phạm vi tài liệu.

Không tạo:
- compatibility layer mới
- fallback về B5
- legacy execution path cho B5
- config B5 mới
- test B5 mới

Không đổi tên B5 thành một tên generic rồi giữ nguyên behavior B5.

Nếu một abstraction hiện tại chỉ tồn tại để phục vụ B5 và không cần cho crafting generic, hãy loại bỏ nó.

## 2.2. Không thiết kế theo từng recipe

Không tạo:

```text
RecipeAService
RecipeBService
RecipeCOperation
```

chỉ vì mỗi recipe có interaction sequence riêng.

Phải ưu tiên:

```text
Recipe
+
Procedure
+
Procedure Engine
+
Procedure Parameters
+
Reusable Primitive
```

Một capability mới chỉ được thêm khi nó thực sự là capability mới.

## 2.3. Không hardcode quantity

Không coi:

```text
1
64
ALL
```

là giới hạn kiến trúc.

Phải hỗ trợ số lượng nguyên dương bất kỳ.

Ví dụ bắt buộc phải có behavior đúng cho:

```text
1
64
65
127
128
137
1000
```

## 2.4. Không hardcode slot nếu không cần

Ưu tiên:

```text
logical identity
-> learned identity
-> configured identity
-> slot fallback
```

Không biến fixed slot thành contract bắt buộc cho mọi recipe.

## 2.5. Không tạo workflow engine thứ hai nếu không cần

Repository hiện đã có workflow infrastructure.

Trước khi tạo engine mới, phải kiểm tra khả năng tái sử dụng/mở rộng:

- `WorkflowModuleCatalog`
- `WorkflowStepExecutor`
- `WorkflowDefinitionValidator`
- `WorkflowDryRunService`
- `TypedModuleEditor`
- các workflow module/primitive hiện có

Nếu có thể mở rộng đúng cách, phải reuse.

## 2.6. Không phá infrastructure generic đang tốt

Đặc biệt cẩn trọng với:

- `CraftingPlanner`
- `GuiManager`
- `GuiKnowledgeRegistry`
- `GuiIdentityEngine`
- verification infrastructure
- input acquisition/storage infrastructure

Không rewrite từ đầu chỉ vì thiết kế mới.

---

# 3. TRƯỚC KHI SỬA CODE

Thực hiện theo đúng thứ tự:

### Bước A — Đọc yêu cầu

Đọc toàn bộ:

```text
MCbotv1-crafting-goal-result.md
MCbotv1-crafting-phase-requirements.md
```

### Bước B — Kiểm tra repository

Đọc:

- cấu trúc thư mục
- `package.json` hoặc package manager tương ứng
- build/test scripts
- crafting source
- crafting config
- item config
- workflow infrastructure
- desktop crafting UI
- architecture metadata
- fault matrix
- SLO
- test hiện có

### Bước C — Tạo baseline

Chạy các test/check hiện có trước khi sửa để biết baseline hiện tại.

Nếu một check fail từ trước, phải ghi nhận chính xác:
- command
- failure
- file
- nguyên nhân nếu xác định được

Không được giả vờ rằng baseline pass.

---

# 4. TẠO FILE THEO DÕI TIẾN ĐỘ

Tạo:

```text
.cline/crafting-refactor-progress.md
```

File này phải được cập nhật trong suốt task.

Tối thiểu:

```md
# Crafting Refactor Progress

## Current Phase
Gxx — ...

## Status
IN_PROGRESS | BLOCKED | COMPLETED

## Completed
- ...

## Changed
- ...

## Tests
- command
- result

## Known Issues
- ...

## Next Action
- ...

## Completion Evidence
- ...
```

Sau mỗi phase:
- cập nhật phase
- ghi file đã sửa
- ghi test đã chạy
- ghi kết quả
- ghi phase tiếp theo

Nếu context bị cắt, lần chạy tiếp theo phải đọc file này trước và tiếp tục từ đó.

Không reset lại công việc đã làm.

---

# 5. THỰC HIỆN THEO PHASE

Phải thực hiện tuần tự theo `MCbotv1-crafting-phase-requirements.md`.

Không tự ý đảo thứ tự nếu chưa có lý do kỹ thuật.

Thứ tự:

```text
G1  Freeze scope
G2  Trace B5 dependency
G3  Remove B5 orchestration
G4  Remove B1-B5 tier dependency
G5  Genericize Item Registry
G6  Redesign Recipe Schema
G7  Separate Recipe / Procedure
G8  Build Procedure Engine
G9  Dynamic execution context
G10 Exact quantity planning
G11 Quantity Strategy
G12 Generic GUI resolution
G13 Procedure Registry
G14 Procedure execution
G15 Partial success / Reconciliation
G16 Genericize Storage / Input Acquisition
G17 Recipe / Procedure validation
G18 Remove B5 from architecture/config
G19 Remove B5 from Desktop UI
G20 Procedure Builder
G21 Procedure Recorder
G22 Special procedures
G23 Tests
G24 Final refactor
```

---

# 6. QUY TẮC CHO MỖI PHASE

Với mỗi phase:

## 6.1. Inspect

Đọc code và xác định implementation hiện tại.

## 6.2. Implement

Sửa source/config/test/UI thật sự.

## 6.3. Verify

Chạy test/check phù hợp.

Ít nhất phải xem xét:

- unit tests
- integration tests
- typecheck nếu có
- lint nếu có
- build nếu có
- targeted tests cho module vừa sửa

## 6.4. Fix

Nếu test fail do thay đổi của phase, phải sửa tiếp.

Không dừng ở việc phát hiện lỗi.

## 6.5. Cleanup

Xóa dead code/import/config/branch đã trở nên không cần thiết.

## 6.6. Record

Cập nhật `.cline/crafting-refactor-progress.md`.

---

# 7. CÁCH XỬ LÝ B5

Khi gặp B5 reference:

### Trường hợp 1

Chỉ phục vụ B5:

=> XÓA.

### Trường hợp 2

Tên mang B5 nhưng concept thực ra generic:

=> GENERICIZE.

Ví dụ:

```text
B5-specific storage logic
```

nếu bản chất là input acquisition generic:

=> đổi thành generic input/storage behavior.

### Trường hợp 3

Không chắc có còn consumer không:

=> search toàn repository trước.

Không được giữ một abstraction chỉ vì "có thể còn được dùng".

---

# 8. RECIPE MODEL MỤC TIÊU

Recipe phải tiến về dạng logic tương đương:

```json
{
  "my_item": {
    "output": "my_item",
    "outputAmount": 1,
    "inputs": {
      "iron_ingot": 32,
      "carbon": 4
    },
    "procedure": "minerals-crafting"
  }
}
```

Không bắt buộc schema cuối cùng phải có đúng từng field trên nếu repository có lý do thiết kế tốt hơn, nhưng phải giữ nguyên nguyên tắc:

```text
Recipe = WHAT
Procedure = HOW
```

Không đưa execution sequence vào recipe chỉ để giải quyết nhanh một case.

---

# 9. PROCEDURE MODEL MỤC TIÊU

Procedure phải có khả năng biểu diễn sequence khác nhau.

Tối thiểu phải xem xét primitives:

```text
command
slash-command
open GUI
resolve GUI
find logical item
find slot
click
wait
wait-for-transition
wait-for-message
wait-for-GUI
wait-for-output
close GUI
verify item
verify quantity
```

Procedure phải hỗ trợ runtime context.

Concept:

```text
$request.amount
$recipe.output
$recipe.outputAmount
$execution.remaining
```

Không cần dùng đúng syntax này nếu engine có syntax tốt hơn, nhưng phải có khả năng tương đương.

---

# 10. EXACT QUANTITY — REQUIREMENT BẮT BUỘC

Đây là requirement quan trọng.

Không được coi task hoàn thành nếu crafting chỉ có thể xử lý:

```text
1 / 64 / ALL
```

Hệ thống phải có execution model cho:

```text
requested
planned
executed
actual
remaining
```

Ví dụ:

```text
requested = 137
batch 1 = 64
actual = 64
remaining = 73

batch 2 = 64
actual = 64
remaining = 9

batch 3 = 9
actual = 9
remaining = 0

status = COMPLETED
```

Con số chỉ mang tính minh họa; strategy thực tế phải phụ thuộc vào procedure/server.

Không được xác nhận success dựa trên số click/command đã gửi.

Success phải dựa trên verified actual result.

---

# 11. PLANNER

Giữ lại nền tảng tốt của `CraftingPlanner`.

Không rewrite vô lý.

Phải đảm bảo planner:

- recursive dependency
- stock consumption
- missing materials
- required crafts
- outputAmount
- cycle detection

Đặc biệt:

Không hardcode:

```js
[64, 1]
```

như kiến trúc batching.

Batching phải thuộc execution strategy/procedure capability.

---

# 12. GUI SAFETY

Không bypass các cơ chế an toàn hiện có.

Đặc biệt phải giữ:

- window/session identity
- generation guard
- transition confirmation
- cancellation behavior
- stale GUI protection

Mọi click phải xảy ra trong đúng GUI context.

---

# 13. RECIPE ADDITION ACCEPTANCE TEST

Trong quá trình phát triển phải tạo ít nhất một representative recipe mới để chứng minh kiến trúc thực sự data-driven.

Acceptance:

1. Thêm item data.
2. Thêm recipe data.
3. Gắn procedure.
4. Không sửa crafting engine chỉ vì recipe mới.
5. Planner resolve được.
6. Procedure execute được.
7. Exact quantity được verify.

Nếu để thêm recipe mới vẫn cần sửa:

```text
CraftingOperation
CraftAutomationService
switch/case
item-specific source
```

thì architecture chưa đạt.

---

# 14. PROCEDURE DIVERSITY ACCEPTANCE TEST

Phải chứng minh ít nhất các kiểu execution khác nhau có thể tồn tại mà không tạo per-recipe implementation.

Ví dụ:

```text
Procedure A
command -> GUI -> click -> wait -> verify

Procedure B
command -> click -> wait -> verify

Procedure C
open GUI -> find logical item -> quantity -> verify
```

Mục tiêu là engine xử lý nhiều procedure chứ không phải một flow hardcoded duy nhất.

---

# 15. TEST MATRIX TỐI THIỂU

Phải có hoặc bổ sung test cho:

## Recipe

```text
valid
invalid
missing item
missing procedure
```

## Planner

```text
simple recipe
nested dependency
stock consumption
missing material
cycle
outputAmount > 1
```

## Quantity

```text
1
64
65
127
128
137
1000
```

## Procedure

```text
command
GUI
click
wait
transition
verification
timeout
failure
```

## Reconciliation

```text
single batch
multiple batches
partial success
retry
remaining amount
terminal failure
```

## GUI

```text
logical identity
learned identity
configured identity
slot fallback
window change
stale generation
```

---

# 16. DESKTOP UI

Khi tới phase UI:

Loại bỏ:

```text
B5 config
B5 rules
B5 compatibility mode
B5 storage protection UI
```

Tập trung:

```text
Craft Request
Recipe
Item
Procedure
Execution
Verification
```

Quantity input phải hỗ trợ integer >= 1.

UI phải hiển thị được ít nhất:

```text
requested
produced
remaining
status
```

Không hiển thị success nếu backend chưa verify exact completion.

---

# 17. PROCEDURE BUILDER

Builder phải dùng cùng definition/schema với runtime.

Không tạo:

```text
UI schema khác
runtime schema khác
```

Một procedure được save từ UI phải validate và runtime phải có khả năng execute.

Builder cần hỗ trợ:

```text
add step
edit step
remove step
reorder step
edit parameters
validate
save
```

Nếu infrastructure hiện tại có dry-run, tích hợp vào flow.

---

# 18. PROCEDURE RECORDER

Recorder là enhancement sau khi procedure engine ổn định.

Ưu tiên ghi logical intent thay vì raw slot.

Ví dụ:

```text
raw:
click slot 11

logical:
select recipe "refined_iron"
```

Nếu không thể resolve logical identity trong lúc recording, có thể ghi fallback metadata để học/resolve sau.

Không biến raw slot thành execution contract duy nhất.

---

# 19. CODE QUALITY

Ưu tiên correctness trước abstraction đẹp.

Không:

- over-engineer
- tạo interface chỉ để tăng số file
- duplicate existing infrastructure
- giữ dead compatibility code
- để facade biết quá nhiều responsibility

Sau khi behavior ổn định mới tách class lớn.

---

# 20. KHÔNG DỪNG SỚM

Bạn chỉ được đánh dấu task COMPLETED khi tất cả điều kiện sau đúng:

1. B5 đã được loại bỏ hoàn toàn trong phạm vi crafting.
2. Tier dependency B1-B5 đã được loại bỏ khỏi crafting decision model.
3. Recipe và Procedure đã tách.
4. Procedure engine hoạt động.
5. Quantity arbitrary integer được hỗ trợ.
6. Exact quantity được verify.
7. Reconciliation hoạt động.
8. Recipe mới có thể thêm mà không sửa crafting engine.
9. Ít nhất một procedure khác biệt đã được chứng minh.
10. GUI resolution không phụ thuộc fixed slot như contract bắt buộc.
11. Storage/Input Acquisition đã generic.
12. Configuration validation phù hợp schema mới.
13. Desktop không còn B5 UX.
14. Test/check liên quan pass, hoặc mọi failure còn lại đã được phân loại rõ là pre-existing/external và không do thay đổi này gây ra.
15. Không còn dead B5 path/reference trong phạm vi repository cần dọn.
16. `.cline/crafting-refactor-progress.md` phản ánh đúng trạng thái cuối cùng.

---

# 21. QUY TẮC KHI GẶP BLOCKER

Nếu gặp lỗi:

### Có thể tự giải quyết

=> tự sửa và tiếp tục.

### Cần thay đổi architecture

=> đánh giá toàn bộ consumer/dependency, chọn phương án phù hợp mục tiêu, implement, test.

### Test cũ mâu thuẫn với mục tiêu mới

=> xác định test đó đang kiểm tra behavior legacy/B5 hay behavior hợp lệ.

Nếu test kiểm tra behavior B5 đã bị loại bỏ:

=> cập nhật/xóa test theo mục tiêu mới.

Không giữ behavior cũ chỉ để làm test cũ pass.

### Không thể xác định an toàn

Không được đoán tùy tiện về data hoặc server behavior.

Hãy:
- đọc thêm code/config/test/documentation hiện có
- inspect call sites
- inspect fixtures
- inspect runtime behavior nếu tooling cho phép

Chỉ dừng khi thực sự không thể tiếp tục bằng dữ liệu trong repository/environment.

---

# 22. GIT SAFETY

Trước khi sửa:

- kiểm tra `git status`
- kiểm tra branch
- không xóa thay đổi người dùng đã có

Không chạy destructive command để reset toàn bộ working tree.

Không tự ý:

```text
git reset --hard
git clean -fd
```

trừ khi task explicitly yêu cầu và có căn cứ rõ ràng.

---

# 23. KHI HOÀN THÀNH

Cuối task phải xuất một báo cáo ngắn, chính xác:

```text
STATUS: COMPLETED | BLOCKED

Phases completed:
G1 ... G24 ...

Main architecture changes:
- ...

B5 removed:
- ...

Exact quantity:
- ...

Recipe extensibility:
- ...

Procedure system:
- ...

Tests/checks:
- command -> result

Known remaining issues:
- ...

Files changed:
- ...
```

Không tuyên bố "hoàn thành" nếu chưa có evidence.

---

# 24. CÁCH RESUME KHI CONTEXT BỊ CẮT

Nếu task bị ngắt:

1. Đọc `.cline/crafting-refactor-progress.md`.
2. Kiểm tra `git status`.
3. Kiểm tra diff hiện tại.
4. Đọc lại phase đang IN_PROGRESS.
5. Verify những gì đã thực sự hoàn tất bằng code/test.
6. Tiếp tục từ bước tiếp theo.
7. Không làm lại các thay đổi đã hoàn thành trừ khi cần sửa lỗi.

---

# 25. LỆNH KHỞI ĐỘNG

Bắt đầu ngay bằng:

1. đọc `MCbotv1-crafting-goal-result.md`
2. đọc `MCbotv1-crafting-phase-requirements.md`
3. kiểm tra git status
4. inspect repository
5. chạy baseline checks
6. tạo/cập nhật `.cline/crafting-refactor-progress.md`
7. bắt đầu G1
8. tiếp tục tuần tự cho đến khi đạt Completion Criteria

Không chỉ trả về plan.
Hãy thực hiện task trực tiếp trong repository.
