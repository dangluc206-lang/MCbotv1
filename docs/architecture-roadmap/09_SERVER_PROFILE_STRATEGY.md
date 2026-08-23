# Server Profile Strategy

## Mục tiêu

Tách MinerUA-specific knowledge khỏi generic framework mà không big-bang move hoặc làm hỏng B5/fishing hiện có.

## Server fact categories

### Connection/authentication

- host/port/version/auth defaults;
- login command capability;
- join/rejoin flow;
- resource pack behavior;
- kick/restart windows.

### Commands

- semantic key;
- template/parameters;
- throttle/confirmation policy;
- credential sensitivity;
- response rules;
- expected next state.

### GUI

- identity evidence;
- title regex/fingerprint;
- transition source;
- semantic actions;
- slot bootstrap facts;
- confidence threshold.

### Items

- vanilla/custom identity;
- NBT/lore/name evidence;
- aliases;
- confidence/fixed/learn-once policy.

### Economy/domain

- recipes;
- quantity actions;
- storage capacity/format;
- sell behavior;
- smelting/conversion facts;
- cooldowns.

## Knowledge status

Mỗi fact cần một status:

- `CONFIRMED`: evidence đáng tin cậy/current.
- `INFERRED`: workflow assumption có guard.
- `UNKNOWN`: không được dùng để mutation không reversible.
- `DEPRECATED`: giữ migration/history, không dùng runtime mới.

## Target ServerProfile contract

```text
ServerProfile
├── identity
├── connectionPolicy
├── commandCatalog
├── guiCatalog
├── itemCatalog
├── recipeCatalog
├── cooldownCatalog
├── joinFlow
├── storageProfile
├── capabilityBindings
└── knowledgeRevision/status
```

## Migration pattern

### Step 1 — Inventory

Lập mapping MinerUA fact → current file/symbol/config/test. Không move.

### Step 2 — Contract façade

Tạo `ServerProfile`/registry contract tối thiểu dựa trên consumer thật.

### Step 3 — Bootstrap binding

Bot profile chọn server profile; bootstrap inject profile/capability binding.

### Step 4 — Read path migration

Migrate một consumer đọc fact qua profile; giữ compatibility fallback có cảnh báo.

### Step 5 — Contract tests

MinerUA parity fixture và fake second profile khác command/GUI/item.

### Step 6 — Move physical files khi đáng giá

Chỉ move sau khi import graph/callers đã đi qua façade.

### Step 7 — Remove fallback

Sau deprecation window, reachability và regression pass.

## Fake second server

Fake profile không nhằm hỗ trợ server thật. Nó chứng minh generic contract:

- command key giống semantic nhưng raw command khác;
- GUI identity/action layout khác;
- item representation khác;
- recipe quantity/cooldown khác;
- join flow khác;
- không import MinerUA modules.

Nếu fake profile không thể chạy contract suite, boundary chưa thật.

## Config layout target

Một lựa chọn:

```text
config/servers/
├── minerua/
│   ├── commands/
│   ├── gui/
│   ├── items/
│   ├── recipes/
│   ├── storage/
│   └── profile.json
└── fake-contract/
```

Hoặc JS registry tương đương. Không quyết định physical layout trước WP-100 ADR.

## Capability implementation strategy

Không nhất thiết mỗi server có mọi capability. Registry:

- bind implementation nếu profile hỗ trợ;
- expose readiness/status;
- fail closed khi mode yêu cầu capability thiếu;
- không tạo no-op giả thành success.

## Server profile versioning

- `profileId + revision` vào decision/trace.
- Breaking semantic change có migration/compatibility rule.
- Observation learned runtime không tự ghi đè confirmed config.
- Learn-once/fixed policy rõ.

## Security

- Password/token không nằm trong profile.
- Credential command không cho composable raw command.
- Support bundle redact host/user nếu policy yêu cầu.
- Remote config chỉ qua validation/authorization.

## Exit gate

- MinerUA behavior parity qua profile.
- Fake second profile contract suite pass.
- Generic core không import MinerUA implementation ở boundary đã migrate.
- B5/fishing regression không đổi.
- `SERVER_BEHAVIOR.md` và machine-readable profile không mâu thuẫn.
