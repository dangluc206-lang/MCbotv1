# MCbotv1 — Crafting Refactor Goal

## Mục tiêu

Dựa trên cấu trúc hiện tại của `MCbotv1`, tái định hướng toàn bộ subsystem crafting thành một hệ thống **crafting độc lập, generic, data-driven và có khả năng mở rộng**, đồng thời **loại bỏ hoàn toàn mọi thành phần liên quan đến B5**.

Phạm vi mục tiêu:

- Chỉ tập trung phát triển và hoàn thiện chức năng crafting.
- Loại bỏ hoàn toàn B5 khỏi source code, compatibility layer, orchestration, configuration, architecture metadata, fault matrix, SLO và giao diện Desktop.
- Không duy trì backward compatibility cho B5 vì hệ thống chỉ phục vụ một người vận hành.
- Giữ và tái sử dụng các thành phần nền tảng hiện có khi phù hợp, đặc biệt: `CraftingPlanner`, `GuiManager`, `GuiKnowledgeRegistry`, `GuiIdentityEngine`, item identity/registry, verification infrastructure, workflow infrastructure, storage/input acquisition infrastructure.
- Tách rõ **Recipe** (craft cái gì) và **Procedure** (thực hiện như thế nào).
- Chuyển recipe sang mô hình data-driven để thêm recipe/item thông thường không cần sửa source code.
- Cho phép nhiều recipe dùng chung một procedure; recipe có interaction đặc biệt có thể dùng procedure riêng mà không phải tạo class riêng cho từng item.
- Dùng hoặc mở rộng workflow primitives hiện có thay vì tạo một workflow framework thứ hai.
- Procedure phải nhận execution context động: requested quantity, recipe, output item, output amount, inventory state, GUI state và execution progress.
- Quantity phải là **exact quantity**, không bị giới hạn ở `1`, `64`, `ALL` hay tập quantity cố định.
- Hỗ trợ các request như `1`, `16`, `64`, `65`, `127`, `128`, `137`, `1000` và các số nguyên dương khác.
- Tách `requestedAmount`, `requiredCrafts`, execution batch và actual output.
- Procedure phải có quantity strategy phù hợp với interaction của server: quantity buttons, quantity menu, repeat craft, command quantity hoặc strategy khác.
- Verification phải theo dõi toàn bộ craft request; sau mỗi batch phải có reconciliation để biết còn thiếu bao nhiêu.
- Chỉ coi request hoàn tất khi đạt đúng số lượng yêu cầu.
- GUI interaction ưu tiên logical item identity/learned identity; slot là fallback.
- Loại bỏ tier B1/B2/B3/B4/B5 khỏi logic quyết định khả năng craft.
- Item được quản lý bằng identity và metadata; recipe tham chiếu `itemId`.
- Recipe tham chiếu procedure thông qua registry.
- Validation phải bao phủ item, recipe, dependency, procedure và execution definition; tiếp tục phát hiện dependency cycle.
- Storage và input acquisition là capability generic của crafting, không mang semantic B5.
- Desktop UI chuyển sang quản lý crafting generic: request, recipe, item, procedure.
- Có nền tảng cho `Procedure Builder` và về sau `Procedure Recorder`.

Định hướng kiến trúc:

```text
Craft Request
    ↓
Crafting Planner
    ↓
Recipe Registry + Item Registry
    ↓
Procedure Registry
    ↓
Procedure Executor
    ↓
Quantity Strategy
    ↓
GUI / Command / Wait / Interaction
    ↓
Verification
    ↓
Reconciliation
    ↓
Exact Completion
```

Nguyên tắc bắt buộc:

1. Recipe không chứa execution logic.
2. Procedure chịu trách nhiệm về interaction sequence.
3. Item không phụ thuộc B1-B5.
4. Quantity là exact request.
5. Thêm recipe thông thường không được yêu cầu sửa source code.
6. Procedure phải có khả năng tái sử dụng.
7. Chỉ thêm code mới khi capability thực sự mới, không thêm code chỉ vì có recipe mới.
8. Không giữ compatibility layer cho B5.
9. Không xây thêm workflow engine độc lập nếu infrastructure hiện tại có thể tái sử dụng hoặc mở rộng.
10. Crafting phải xử lý partial success, retry, verification và reconciliation an toàn.

## Kết quả cần đạt

### 1. Crafting độc lập

Subsystem crafting tồn tại như một hệ thống riêng, không còn dependency logic vào B5 và không còn B5 trong execution/config/UI path.

### 2. Thêm item và recipe bằng dữ liệu

Recipe thông thường có thể được thêm bằng configuration/registry mà không sửa implementation của executor.

Ví dụ:

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

Thêm recipe mới không cần sửa `CraftingOperation`, `CraftAutomationService`, `CraftingPlanner`, switch/case theo item hoặc class riêng cho recipe.

### 3. Procedure độc lập với Recipe

Một procedure như `minerals-crafting`, `forge-crafting`, `npc-crafting`, `command-crafting` có thể được nhiều recipe sử dụng.

### 4. Hỗ trợ interaction sequence khác nhau

Procedure có thể biểu diễn `command`, `open GUI`, `find item`, `find slot`, `click`, `wait`, `wait for transition`, `wait for message`, `wait for output`, `close GUI`, `verify` và các primitive cần thiết khác.

### 5. Exact quantity

Request `1`, `64`, `65`, `127`, `128`, `137`, `1000` phải được xử lý tới đúng số lượng yêu cầu.

Hệ thống theo dõi:

```text
requested
planned
executed
actual
remaining
```

và chỉ hoàn tất khi:

```text
requested = actual
remaining = 0
```

### 6. Quantity strategy linh hoạt

Recipe không bị ràng buộc vào một kiểu quantity UI duy nhất. Cách chọn batch thuộc procedure/quantity strategy.

### 7. Planner generic

`CraftingPlanner` xử lý recursive dependencies, stock consumption, missing materials, craft count, cycle detection, execution plan và `outputAmount` khác nhau; không hardcode `64/1` như giới hạn kiến trúc.

### 8. GUI resolution generic

Ưu tiên:

```text
logical identity
→ learned identity
→ configured identity
→ slot fallback
```

### 9. Verification + Reconciliation hoàn chỉnh

Sau mỗi operation/batch xác định được actual output, remaining quantity và trạng thái inventory; partial result có thể được xử lý tiếp khi an toàn. Chỉ success khi đạt exact quantity.

### 10. Storage/Input Acquisition generic

Crafting lấy nguyên liệu từ các nguồn được hỗ trợ mà không gắn với B5-specific semantics.

### 11. Validation đầy đủ

Từ chối cấu hình lỗi trước execution khi phát hiện item/recipe/input/output/procedure/step/parameter không hợp lệ hoặc dependency cycle.

### 12. Desktop UI tập trung vào Crafting

Không còn control/khái niệm B5. Trọng tâm là:

```text
Craft Request
Recipe Management
Item Management
Procedure Management
Execution / Verification
```

### 13. Procedure Builder có nền tảng

Có thể tạo/chỉnh sửa procedure từ workflow representation thay vì sửa source code cho từng recipe; kiến trúc đủ mở để phát triển tiếp `Procedure Recorder`.

### 14. B5 được loại bỏ hoàn toàn

Không còn B5 trong production execution, compatibility execution, service orchestration, recipe eligibility, tier logic, config, Desktop UI, architecture debt, SLO, fault matrix, tests hoặc abstraction chỉ tồn tại để phục vụ B5.

### 15. Trạng thái cuối cùng

```text
MCbotv1
└── Crafting
    ├── Item Registry
    ├── Recipe Registry
    ├── Crafting Planner
    ├── Procedure Registry
    ├── Procedure Engine
    ├── Quantity Strategy
    ├── Input Acquisition
    ├── Storage
    ├── GUI Interaction
    ├── Verification
    └── Reconciliation
```

Tính chất bắt buộc:

```text
Generic
Data-driven
Procedure-driven
Exact-quantity
Extensible
Verifiable
B5-free
```

**Thước đo thành công cao nhất:** Người vận hành có thể thêm một item/recipe mới, khai báo cách craft của nó bằng procedure, yêu cầu một số lượng bất kỳ và hệ thống thực hiện đến đúng số lượng yêu cầu mà không cần sửa source code của crafting engine.
