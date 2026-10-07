# MCbotv1 — Yêu cầu thực hiện từng giai đoạn Crafting Refactor

Tài liệu này là đặc tả yêu cầu triển khai theo từng giai đoạn để đạt mục tiêu crafting-only, generic, data-driven, procedure-driven, exact-quantity và loại bỏ hoàn toàn B5.

---

## Giai đoạn 1 — Freeze scope: Crafting-only

### Yêu cầu

1. Xác định crafting là phạm vi phát triển chính.
2. Không mở rộng thêm feature không phục vụ trực tiếp cho crafting.
3. Xác định rõ các thành phần:
   - phải giữ
   - phải generic hóa
   - phải xóa vì B5
4. Không tiếp tục duy trì compatibility cho B5.
5. Không tạo behavior mới dựa trên giả định B5 vẫn tồn tại.

### Phải rà soát

- `src/server-features/crafting/`
- `src/items/CraftingItemRegistry.js`
- `src/planning/crafting/`
- `config/server-data/recipes.json`
- `config/server-data/crafting-tiers.json`
- `config/server-data/crafting-targets.json`
- `config/items/items.json`
- `src/desktop/`
- `architecture/`
- toàn bộ test liên quan crafting/B5

### Không được

- thêm recipe-specific code mới vào `CraftingOperation`
- thêm switch/case theo item
- tạo compatibility path mới
- thêm logic B5 mới

---

## Giai đoạn 2 — Trace toàn bộ dependency của B5

### Yêu cầu

1. Tìm tất cả reference tới:
   - `B5`
   - `b5`
   - `B5CycleCoordinator`
   - `B5AutomationRuntimeDecorator`
   - `collector-b5`
   - các policy/rule/protection chỉ phục vụ B5
2. Phân loại mỗi dependency:
   - B5-only
   - generic nhưng bị đặt tên/thiết kế theo B5
   - generic thực sự
3. Xác định dependency graph trước khi xóa code.
4. Đảm bảo không còn reference ẩn qua:
   - import
   - config
   - architecture JSON
   - test fixture
   - UI
   - SLO
   - fault matrix

### Không được

- xóa file B5 khi chưa xử lý consumer
- đổi tên B5 thành tên generic nhưng giữ nguyên semantic B5

---

## Giai đoạn 3 — Remove B5 khỏi orchestration

### Yêu cầu

Trọng tâm là:

- `CraftAutomationService`
- `CraftCycleCoordinator`
- các service/decorator liên quan

Phải chuyển orchestration về một execution path duy nhất:

```text
CraftRequest
    -> Planner
    -> Input Acquisition
    -> Storage
    -> Craft Execution
    -> Verification
```

### Phải loại bỏ

- `legacyCycle`
- `B5CycleCoordinator`
- legacy plan adapter
- `B5AutomationRuntimeDecorator`
- branch chọn B5/legacy
- B5-specific metadata trong runtime

### Không được

- để generic path phụ thuộc gián tiếp vào B5 path
- giữ code “chỉ để phòng trường hợp cần rollback B5”

---

## Giai đoạn 4 — Remove B1/B2/B3/B4/B5 tier dependency

### Yêu cầu

1. Không dùng tier để xác định recipe có được phép craft.
2. Loại bỏ `allowedTiers`.
3. Loại bỏ logic “item thuộc Bx”.
4. Recipe eligibility chỉ phụ thuộc:
   - item
   - recipe
   - procedure
   - dependency
5. `CraftingItemRegistry` không còn cần mapping B1-B5 để resolve crafting.

### Phải xử lý

- `CraftingItemRegistry`
- `crafting-tiers.json`
- `crafting-targets.json`
- các validator đang kiểm tra tier

### Có thể giữ

Category/tag metadata generic, nhưng không được có quyền quyết định execution.

---

## Giai đoạn 5 — Genericize Item Registry

### Yêu cầu

Item registry phải là nguồn identity thống nhất.

Mỗi item cần hỗ trợ khi cần:

```text
itemId
displayName
inventory identity
GUI identity
matching rules
```

### Quy tắc

1. Vanilla item không được yêu cầu custom identity.
2. Custom item có thể dùng display name/MMOItems identity hoặc rule tương đương.
3. Crafting chỉ tham chiếu `itemId`.
4. Không viết logic riêng theo tên item.
5. Identity resolution phải có tính ổn định và có fallback rõ ràng.

### Không được

- để recipe chứa logic nhận dạng item
- để procedure hardcode display name của từng recipe nếu registry đã có identity

---

## Giai đoạn 6 — Redesign Recipe Schema

### Yêu cầu

Recipe schema phải tập trung vào dữ liệu sản phẩm và dependency.

Tối thiểu cần có concept:

```json
{
  "id": "...",
  "output": "...",
  "outputAmount": 1,
  "inputs": {
    "...": 1
  },
  "procedure": "..."
}
```

### Phải loại bỏ khỏi recipe nếu không còn bắt buộc

- fixed `menuSlot`
- quantity slot cố định
- command cố định
- click sequence
- wait sequence
- logic execution

### Có thể tồn tại

Metadata bootstrap/fallback nếu architecture chứng minh cần, nhưng không được biến thành execution contract bắt buộc cho mọi recipe.

---

## Giai đoạn 7 — Separate Recipe và Procedure

### Yêu cầu

Phải có hai model độc lập:

```text
Recipe
= WHAT

Procedure
= HOW
```

### Recipe chịu trách nhiệm

- output
- outputAmount
- inputs
- procedure reference

### Procedure chịu trách nhiệm

- command
- GUI interaction
- click
- wait
- resolution
- quantity handling
- verification hooks
- recovery/transition khi cần

### Không được

- nhúng procedure trực tiếp vào từng recipe nếu có thể tái sử dụng
- tạo class riêng chỉ vì recipe mới

---

## Giai đoạn 8 — Build Procedure Engine

### Yêu cầu

Procedure engine phải hỗ trợ ít nhất các primitive sau:

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

### Yêu cầu kỹ thuật

1. Step phải có schema rõ ràng.
2. Step phải validate trước execution.
3. Step có timeout.
4. Step có failure state.
5. Step không được thao tác ngoài execution context hợp lệ.
6. Procedure execution phải có cancellation/generation guard tương thích với GUI/runtime hiện tại.
7. Procedure không được bypass safety boundary hiện có của bot.

### Tái sử dụng

Ưu tiên dùng hoặc mở rộng:

- `WorkflowModuleCatalog`
- `WorkflowStepExecutor`
- `WorkflowDefinitionValidator`
- module primitives hiện có

Không tạo workflow engine thứ hai nếu không cần.

---

## Giai đoạn 9 — Dynamic execution context

### Yêu cầu

Procedure phải nhận context runtime.

Context phải có khả năng cung cấp:

```text
request.amount
recipe
recipe.output
recipe.outputAmount
inventory
GUI/window state
executed amount
remaining amount
last result
```

### Yêu cầu biểu thức

Procedure phải có cách tham chiếu dữ liệu runtime mà không cần hardcode giá trị.

Ví dụ concept:

```text
$request.amount
$recipe.output
$execution.remaining
```

### Không được

- hardcode quantity trong procedure dùng chung
- hardcode item cụ thể trong engine

---

## Giai đoạn 10 — Redesign exact quantity planning

### Yêu cầu

`CraftingPlanner` phải hỗ trợ số lượng nguyên dương bất kỳ.

Không giới hạn:

```text
1 / 64 / ALL
```

### Planner phải tính

```text
requestedAmount
outputAmount
requiredCrafts
dependency requirements
available stock
missing materials
```

### Ví dụ

Nếu:

```text
1 craft -> 8 output
request = 137
```

Planner phải xác định số craft cần thực hiện đủ để đạt request, đồng thời executor/reconciliation phải xử lý phần output thực tế.

### Không được

- hardcode batch `[64, 1]` như kiến trúc quantity
- coi `ALL` là cơ chế chính của exact quantity

---

## Giai đoạn 11 — Quantity Strategy

### Yêu cầu

Quantity handling phải là abstraction riêng.

Procedure có thể chọn:

```text
button-batch
menu-quantity
repeat
command-quantity
custom
```

### Quantity strategy phải nhận

```text
requested amount
remaining amount
recipe outputAmount
procedure capabilities
```

### Yêu cầu

Strategy phải trả ra một execution decision rõ ràng, ví dụ:

```text
batchAmount
action
expectedOutput
```

### Không được

- nhét quantity logic vào `CraftingOperation` dưới dạng if/else dài
- giả định mọi server có cùng quantity GUI

---

## Giai đoạn 12 — Genericize GUI resolution

### Yêu cầu

Tận dụng:

- `GuiManager`
- `GuiKnowledgeRegistry`
- `GuiIdentityEngine`

### Resolution priority

```text
logical identity
-> learned identity
-> configured identity
-> slot fallback
```

### Yêu cầu

1. Slot chỉ là bootstrap/fallback.
2. Recipe không bắt buộc fixed slot nếu logical identity đủ để resolve.
3. GUI transition phải được xác nhận trước khi thực hiện step tiếp theo.
4. Không click theo coordinate/slot nếu window identity không còn hợp lệ.
5. Giữ generation/session safety của GUI infrastructure.

### Không được

- quay lại mô hình recipe nào cũng hardcode slot
- bỏ qua window transition verification để đơn giản hóa

---

## Giai đoạn 13 — Procedure Registry

### Yêu cầu

Tạo registry quản lý procedure definition.

Concept:

```text
ProcedureRegistry
    get(id)
    validate(id)
    list()
```

### Yêu cầu dữ liệu

Procedure phải có:

```text
id
name/metadata nếu cần
steps
capabilities
parameters nếu cần
```

### Reuse

Ví dụ:

```text
minerals-crafting
    -> nhiều recipe

forge-crafting
    -> nhiều recipe

npc-crafting
    -> nhiều recipe
```

---

## Giai đoạn 14 — Recipe execution thông qua Procedure

### Yêu cầu

Flow chính phải chuyển thành:

```text
Craft Request
-> resolve item
-> resolve recipe
-> resolve procedure
-> plan
-> prepare inputs
-> execute procedure
-> verify
-> reconcile
```

### Không được

- `CraftingOperation` chứa một sequence duy nhất áp dụng cho mọi recipe
- recipe đặc biệt đi vòng qua Procedure Engine
- tạo execution path riêng ngoài engine mà không có abstraction rõ ràng

---

## Giai đoạn 15 — Partial success và Reconciliation

### Yêu cầu

Hệ thống phải xử lý được trường hợp:

```text
requested = 137
executed = 64
actual = 64
remaining = 73
```

Sau đó tiếp tục với phần còn thiếu.

### Phải theo dõi

```text
requested
produced
remaining
failed
verified
```

### Kết thúc success chỉ khi

```text
produced >= requested
```

và sau reconciliation phải xác nhận output thực tế đúng requirement.

### Failure terminal

Nếu không thể tiếp tục an toàn, phải chuyển sang terminal failure rõ ràng, không giả success.

---

## Giai đoạn 16 — Genericize Storage/Input Acquisition

### Yêu cầu

Giữ concept:

- `CraftInputAcquisitionFlow`
- `CraftStorageFlow`

nhưng loại bỏ B5 semantics.

### Input source

Tối thiểu hỗ trợ:

```text
inventory
storage
```

### Phải xử lý

- reserve/withdraw cần thiết
- kiểm tra nguyên liệu
- hoàn tất transaction boundary
- trạng thái thất bại
- không gây mất đồng bộ inventory

### Không được

- tên biến/metadata kiểu `b1Materials` nếu không còn semantic B1
- `decompressionPolicy` hoặc logic tương tự nếu chỉ phục vụ B5
- storage flow phụ thuộc vào tier

---

## Giai đoạn 17 — Recipe/Procedure Validation

### Recipe validator phải kiểm tra

```text
recipe id
output
outputAmount
inputs
procedure reference
```

### Procedure validator phải kiểm tra

```text
procedure id
step type
required fields
parameter type
timeout
dependency/reference
```

### Dependency validator phải kiểm tra

```text
missing item
missing recipe
cycle
invalid output amount
invalid input amount
```

### Mục tiêu

Configuration lỗi phải được phát hiện trước execution thay vì gây lỗi giữa chừng.

---

## Giai đoạn 18 — Xóa B5 khỏi architecture/config

### Phải rà soát và cập nhật

```text
architecture/legacy-mode-debt.json
architecture/static-quality/current.json
architecture/slo/current.json
architecture/fault-matrix/*
config/server-data/crafting-tiers.json
config/server-data/crafting-targets.json
```

### Phải xóa

Các rule/metric/test case chỉ dành cho B5.

### Nếu metric vẫn có giá trị

Đổi thành metric generic, ví dụ:

```text
craft-request-exact-completion
craft-operation-reconcile
craft-input-acquisition
craft-safe-terminal
```

### Không được

- giữ B5 chỉ vì architecture metadata chưa dọn
- để CI/quality gate vẫn yêu cầu artifact B5

---

## Giai đoạn 19 — Xóa B5 khỏi Desktop UI

### Phải loại bỏ

- B5 config
- B5 rules
- B5 compatibility mode
- B5 storage protection UI
- B5-only controls
- text/label mang nghĩa B5 nếu không còn dùng

### UI crafting mới cần tập trung vào

```text
Craft Request
Recipe
Item
Procedure
Execution
Verification
```

### Yêu cầu

1. Request quantity là số nguyên bất kỳ >= 1.
2. Không coi `ALL` là lựa chọn chính.
3. Hiển thị rõ progress:
   - requested
   - produced
   - remaining
   - status
4. Hiển thị failure/reconciliation rõ ràng.

---

## Giai đoạn 20 — Procedure Builder

### Yêu cầu

Dựa trên workflow editor hiện có để tạo procedure.

Builder phải cho phép người vận hành:

```text
add step
remove step
reorder step
edit parameters
validate
save
dry-run nếu infrastructure hỗ trợ
```

### Step types

Phải phản ánh Procedure Engine, không tạo một schema UI khác với runtime schema.

### Không được

- Builder tạo JSON mà runtime không chạy được
- runtime hỗ trợ step mà Builder không thể biểu diễn một cách không cần code, trừ step system/internal

---

## Giai đoạn 21 — Procedure Recorder

### Yêu cầu

Tạo nền tảng để ghi lại interaction sequence.

Recorder cần hướng tới việc chuyển:

```text
user action
-> logical procedure step
```

thay vì chỉ ghi:

```text
raw slot click
```

### Ví dụ

Người vận hành:

```text
/ks
click crafting
click recipe
click quantity
wait
```

Recorder nên hướng tới:

```text
command(...)
open crafting GUI
find recipe logical identity
select quantity(...)
wait-for-output
```

### Không được

- biến raw GUI slot thành contract duy nhất
- phụ thuộc tuyệt đối vào recording của một session nếu identity đã có thể chuẩn hóa

---

## Giai đoạn 22 — Procedure mới cho interaction đặc biệt

### Quy tắc

Khi recipe mới xuất hiện:

#### Trường hợp A

Sequence đã được procedure hiện tại biểu diễn:

```text
thêm recipe
```

Không sửa source.

#### Trường hợp B

Cùng procedure nhưng parameter khác:

```text
thêm procedure parameter/config
```

Không tạo recipe-specific class.

#### Trường hợp C

Có capability mới hoàn toàn:

```text
thêm primitive/procedure capability
```

Sau đó nhiều recipe có thể tái sử dụng capability đó.

### Không được

```text
1 recipe = 1 implementation class
```

trừ trường hợp đặc biệt thực sự không thể biểu diễn bằng engine.

---

## Giai đoạn 23 — Test theo kiến trúc mới

### Phải có test cho

#### Recipe

```text
valid
invalid
missing item
missing procedure
```

#### Planner

```text
simple recipe
nested dependency
existing stock
missing stock
cycle
outputAmount > 1
```

#### Quantity

```text
1
64
65
127
128
137
1000
```

#### Procedure

```text
command
GUI
click
wait
transition
verification
failure
timeout
```

#### Exact execution

```text
complete in one batch
complete in multiple batches
partial success
retry
reconciliation
terminal failure
```

#### GUI resolution

```text
configured slot
logical identity
learned identity
slot fallback
window change
stale generation
```

### Không được

- test chỉ kiểm tra command đã gửi
- test coi success khi actual output chưa được xác nhận

---

## Giai đoạn 24 — Refactor và dọn kiến trúc cuối

### Sau khi behavior ổn định

Chia nhỏ facade lớn nếu responsibility đã rõ.

Ưu tiên tách crafting thành:

```text
CraftRequestService
CraftingPlanner
RecipeRegistry
ItemRegistry
ProcedureRegistry
ProcedureExecutor
QuantityStrategy
CraftingVerification
CraftingReconciler
```

### Yêu cầu

1. Mỗi component có responsibility rõ.
2. Không tạo abstraction chỉ để giảm số dòng.
3. Không tách class làm tăng indirection vô ích.
4. Xóa dead code sau migration.
5. Xóa compatibility code không còn consumer.
6. Cập nhật naming để không còn dấu vết B5 trong generic subsystem.

---

# Điều kiện chuyển giai đoạn

Một giai đoạn chỉ được coi là đủ điều kiện chuyển tiếp khi:

1. Scope của giai đoạn đã được thực hiện.
2. Consumer/dependency liên quan đã được cập nhật.
3. Không tạo thêm dependency ngược về B5.
4. Test liên quan không bị bỏ qua để che lỗi.
5. Config/schema tương ứng đã đồng bộ với source.
6. Không còn dead path rõ ràng của kiến trúc cũ.

---

# Thứ tự phụ thuộc bắt buộc

```text
G1 Scope
 ↓
G2 B5 dependency trace
 ↓
G3 Remove B5 orchestration
 ↓
G4 Remove tier dependency
 ↓
G5 Generic Item Registry
 ↓
G6 Recipe Schema
 ↓
G7 Recipe / Procedure separation
 ↓
G8 Procedure Engine
 ↓
G9 Dynamic Context
 ↓
G10 Exact Quantity Planner
 ↓
G11 Quantity Strategy
 ↓
G12 Generic GUI Resolution
 ↓
G13 Procedure Registry
 ↓
G14 Procedure Execution
 ↓
G15 Reconciliation
 ↓
G16 Storage/Input genericization
 ↓
G17 Validation
 ↓
G18 Architecture/Config cleanup
 ↓
G19 Desktop cleanup
 ↓
G20 Procedure Builder
 ↓
G21 Procedure Recorder
 ↓
G22 Special procedures
 ↓
G23 Tests
 ↓
G24 Final refactor
```

# Nguyên tắc nghiệm thu xuyên suốt

Hệ thống cuối cùng phải bảo đảm các phát biểu sau đều đúng:

```text
"Recipe nói cái gì."
"Procedure nói làm như thế nào."
"Item được nhận dạng bằng identity."
"Quantity là exact request."
"Planner tính dependency."
"Procedure thực thi."
"Verification xác nhận."
"Reconciliation xử lý phần còn thiếu."
"Thêm recipe bình thường không cần sửa source."
"B5 không còn trong crafting subsystem."
```
