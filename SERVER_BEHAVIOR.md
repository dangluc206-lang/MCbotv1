# SERVER_BEHAVIOR.md

## Mục đích và status

File này là source of truth cho behavior riêng của server hiện tại mà bot đang target. Không dùng nó để mô tả generic Mineflayer behavior.

Status:

- **CONFIRMED**: contract đang có trong config/source/test và được code dựa vào.
- **OBSERVED**: đã có runtime observation/log/data snapshot trong repository.
- **INFERRED**: suy ra từ code/data nhưng chưa đủ bằng chứng server-side.
- **UNKNOWN**: chưa đủ dữ liệu, không được đoán.
- **DEPRECATED**: behavior cũ không còn là CURRENT contract.

Khi config/source và user/server observation mâu thuẫn, ghi rõ cả hai và ưu tiên re-capture trước khi sửa strategy.

## 1. Server Identity

Status: **CONFIRMED (repository config)**

- Host: `mc.minerua.com`.
- Port: `25565`.
- Minecraft version default: `1.21.1`.
- Auth default: `offline`.
- Source: `config/server.json`.

Status: **CONFIRMED (bot config/code)**

- Server login capability dùng command key `login` -> `/login {password}` khi enabled.
- Password lấy từ environment theo bot profile, không lưu ở file này.
- `ServerLoginService` và `config/authentication/login.json` sở hữu flow login.

Không ghi credential thật vào documentation/log/config commit.

## 2. Join Flow

Status: **CONFIRMED + OBSERVED**

CURRENT flow khái niệm:

```text
connect Mineflayer
-> client attached (new connectionGeneration)
-> login/spawn events
-> resource-pack auto accept nếu server yêu cầu
-> server login service nếu profile có password/config enabled
-> SkyblockAutoJoinService schedule /sky
-> /sky GUI
-> chọn server selection
-> join Skyblock
-> emit skyblock:auto-join:succeeded
-> mode có thể tiếp tục chuẩn bị
```

`config/skyblock/join.json` hiện:

- `autoJoin.enabled = true`;
- default selection `sky1`;
- delay sau login-like trigger `1200ms`;
- spawn fallback `5000ms`;
- `maxAttempts = 0` nghĩa là retry không giới hạn;
- retry/rejoin delay mặc định `300000ms` (5 phút);
- `waitForResourcePack = false`;
- operator có thể đặt manual HUB hold trong connection generation hiện tại; khi HOLD, auto-join bị chặn cho tới khi operator yêu cầu Vào Sky hoặc connection generation kết thúc.

Runtime log đã ghi `Skyblock auto join scheduled/attempting /sky` cho bot-01/bot-02.

Exact ordering giữa resource-pack/login/spawn có thể event-driven và không nên giả định một chuỗi synchronous cố định ngoài contract service.

## 3. Special Commands Registry

| Command | Key | Purpose | Opens GUI? | Verification hiện tại | Status |
|---|---|---|---|---|---|
| `/kho` | `storage` | mở storage đặc biệt | Có | readable `/kho` GUI + parsed entries/capacity | CONFIRMED |
| `/pv 2` | `personalVault2` | mở personal vault page 2 | Có | expected vault GUI + read/transfer delta | CONFIRMED |
| `/ks` | `minerals` | mở menu khoáng sản/crafting/conversion | Có | GUI route/slot transition | CONFIRMED |
| `/nung` | `smelting` | mở smelting menu trực tiếp | Có | smelting GUI + later `/kho` input/output verification | CONFIRMED |
| `/is` | `islandHome` | teleport về island/home | Không cần GUI | `movement:teleport` ở current generation | CONFIRMED |
| `/d` | `dungeon` | mở dungeon destination flow | Có | destination GUI + teleport verification | CONFIRMED |
| `/login {password}` | `login` | server authentication | Không | service event/state; command itself config currently `confirm:false` | CONFIRMED |
| `/sky` | `skyblock` | mở server selection/Skyblock join flow | Có | expected GUI + click/join events | CONFIRMED |
| `/kho sell` | `storageSell` | mở Sell GUI | Có | readable sell entries + post-click transition/amount evidence | CONFIRMED |
| `/afk` | `afk` | mở AFK area selection | Có | occupancy/GUI + teleport/position checks in fishing flow | CONFIRMED |

`config/commands/responses.json` chỉ có response rules đơn giản cho một số command; nhiều capability cố ý `confirm:false` rồi verify bằng GUI/position/inventory thay vì chat text.

## 4. `/is`

Status: **CONFIRMED**

- Command key: `islandHome`.
- Config: `config/island/island.json`.
- Timeout: `10000ms`.
- `IslandTeleportOperation` arm waiter cho `movement:teleport` trước khi gửi command để không miss fast teleport.
- Verification bắt buộc exact `botId` + `connectionGeneration` và current connection.
- Success trả `before`/`after` position.

Không coi command send thành công là teleport thành công.

Không hard-code island coordinate như server contract; mode-specific destination là bot config riêng.

## 5. `/sky`

Status: **CONFIRMED + OBSERVED**

Config:

- entry GUI ID: `skyServerSelect`;
- selection `primary.slot = 11`;
- selection `secondary.slot = 13`;
- `joinSlot = 19`;
- GUI timeout `5000ms`;
- click timeout `3000ms`;
- slot-ready timeout `5000ms`.

Observed route `data/runtime/gui/bot-01/sky.json`:

- title: `ᴄʜọɴ ᴍáʏ ᴄʜủ`;
- type: `minecraft:generic_9x3`;
- total Mineflayer slot count observed: `63`;
- last source `/sky`.

`config/gui/windows.json` còn có fingerprints grass block ở slots 12 và 14 để nhận diện entry window.

Fixed selection slots là CURRENT config contract; nếu server update layout phải re-observe trước khi hard-code mới.

## 6. `/kho`

Status: **CONFIRMED + OBSERVED**

Đây là storage server-specific, không phải vanilla chest inventory.

Config `config/storage/kho.json`:

- command key `storage`;
- GUI ID `storage`;
- capacity indicator bootstrap slot `49`;
- fallback capacity limit `800000`;
- parser tìm text tương đương `đang có/số lượng/amount`, `đã sử dụng/used`, `đang trống/free`, `dung lượng/capacity`;
- `allowStackCountFallback = false`, nghĩa là stack count GUI không được coi mặc định là storage amount authority.

Observed `kho.json`:

- title hiện tại: `ᴋʜᴏ ᴄʜứᴀ ▮▮▮▯▯▯▯▯`;
- type `minecraft:generic_9x6`;
- total observed slot count `90` (container + player inventory).

`KhoService`/`KhoReader` là authority đọc full B1 stock. `SellGuiReader` không phải full stock source.

Capacity `800000` hiện là fallback configured indicator, không nên đổi nếu chưa có observation mới.

## 7. `/kho sell`

Status: **CONFIRMED (source/config/tests) + OBSERVED design comments**

CURRENT behavior:

```text
/kho sell
-> mở Sell GUI
```

Click semantics trong `KhoSellOperation`:

```text
Left Click        button=0 mode=0 -> sell 1
Right Click       button=1 mode=0 -> sell 64
Shift + Left      button=0 mode=1 -> sell ALL
```

Quan trọng:

- `/kho sell` không phải CURRENT command `/kho sell MATERIAL amount`.
- GUI `/kho` và `/kho sell` có thể rất giống nhau; code không được phân biệt chỉ bằng layout/title.
- `KhoSellOperation` dùng command provenance để sở hữu session Sell.
- Sau click, server có thể refresh same container hoặc replace `GuiSession`; operation re-attach `/kho sell` provenance để reuse GUI thay vì gửi lại command mỗi sale.
- Nếu GUI đóng mất sau click: `KHO_SELL_GUI_LOST`.
- Nếu click không có transition và amount cũng không đổi: `KHO_SELL_NOT_VERIFIED`.

Sell amount parsing:

- Sell GUI có instruction text chứa `1`, `64`; `SellGuiReader` lọc các line action để không nhầm thành stock amount.
- Positive labelled amount có thể dùng diagnostics; zero không đáng tin theo comment runtime hiện tại.
- Full stock planning luôn dùng `/kho`, không dùng Sell GUI.

Bot policy CURRENT:

- `sell.allowAll = false` cho production B1 nói chung.
- CURRENT executor không còn per-item SELL ALL whitelist; `fastDisposableSellAllIds` là field legacy và không vượt qua global gate. Nếu `allowAll=true`, quyền ALL áp dụng cho mọi configured `itemAliases`, vì vậy production phải giữ `false`.
- `blockOnly = true` cho strategy trim hiện tại.

Server rule (click semantics) phải tách khỏi bot policy (material nào được phép ALL).

## 8. `/pv 2`

Status: **CONFIRMED + OBSERVED**

Config:

- command key `personalVault2`;
- `storageSlots = 54`;
- GUI ID `personalVault2`;
- open timeout `5000ms`.

Observed `pv-2.json`:

- title `ᴋʜᴏ đồ #2`;
- type `minecraft:generic_9x6`;
- total Mineflayer slot count `90`.

`PersonalVaultReader` chỉ scan first 54 storage slots, không giả định item ở fixed slot.

Transfer semantics trong `PersonalVaultTransfer`:

- vault -> inventory: shift-left click matching storage slot;
- inventory -> vault: shift-left click player-inventory section;
- logical matching có thể học strong custom identity trước/sau transfer.

Verification ở service/B5 flow phải dựa source/destination delta, không chỉ click resolve.

B2–B5 đang được B5 workflow dùng với PV2, nhưng đây là workflow policy, không phải generic rule rằng PV2 luôn chỉ chứa B2–B5.

## 9. `/ks`

Status: **CONFIRMED + OBSERVED**

`/ks` mở root minerals GUI.

Observed `ks.json`:

- title `ᴋʜᴏáɴɢ ѕảɴ`;
- type `minecraft:generic_9x3`;
- observed slot count `63`.

Config `config/minerals/menu.json` bootstrap slots:

- conversion menu: slot `10`;
- smelting menu: slot `12`;
- crafting menu: slot `16`.

Crafting root flow:

```text
/ks
-> resolve `menu_crafting`
-> crafting recipe menu
-> resolve recipe logical item/menu slot
-> quantity GUI
-> resolve quantity from live content
-> click
-> inventory/event synchronization
-> verify output and input evidence
```

Quantity GUI configured choices:

- `1` bootstrap slot `20`;
- `64` bootstrap slot `22`;
- `ALL` bootstrap slot `24`.

Các slot chỉ là fallback. `CraftingQuantityResolver` ưu tiên live text/lore/components và special-case 64/ALL.

Không assume mọi recipe/strategy đều được phép dùng cả ba quantity; capability có thể detect button, còn B5 policy quyết định quantity nào an toàn.

## 10. Smelting / Conversion

### Smelting

Status: **CONFIRMED**

`SmeltingOperation` ghi rõ MinerUA behavior:

```text
/nung -> smelting GUI -> click material
```

hoặc:

```text
/ks -> smelting entry -> smelting GUI -> click material
```

Một click xử lý **ALL stock của đúng material đó trực tiếp trong `/kho`**; không có quantity-selection GUI.

Configured recipes:

- `raw_iron_to_iron`: `raw_iron -> iron_ingot`;
- `raw_gold_to_gold`: `raw_gold -> gold_ingot`;
- B5 không nung đá. Smelting policy của B5 chỉ cho phép `raw_iron -> iron_ingot` và `raw_gold -> gold_ingot`.

Smelting operation chỉ gửi action; `B1StorageMaterialService` chịu trách nhiệm verify bằng fresh `/kho` input decreased/output increased.

Observed `nung.json`:

- title `ɴᴜɴɢ ᴋʜᴏáɴɢ ѕảɴ`;
- type `minecraft:generic_9x1`;
- slot count `45`.

### Mineral block conversion

Status: **CONFIRMED (CURRENT implementation)**

CURRENT code dùng `/ks` -> conversion menu qua `MineralConversionOperation`, không dùng `/kho` trực tiếp cho block conversion.

Configured ratio `9` cho coal/redstone/lapis/iron/gold/diamond/emerald base <-> block. Cobblestone ratio `1`, không có block conversion ID.

Nếu server behavior thực tế đã chuyển conversion sang `/kho`, repository hiện chưa phản ánh điều đó; cần re-capture và code task riêng. Không sửa documentation để giả vờ code đã đổi.

## 11. GUI Interaction Semantics

Chỉ liệt kê semantics server-specific đã xác nhận:

| Context | Input | Meaning | Status |
|---|---|---|---|
| `/kho sell` material | Left click | sell 1 | CONFIRMED |
| `/kho sell` material | Right click | sell 64 | CONFIRMED |
| `/kho sell` material | Shift-left | sell ALL | CONFIRMED |
| `/pv 2` matching item | Shift-left | transfer giữa vault/player inventory tùy section | CONFIRMED |
| `/ks` menu/recipe/quantity | Left click mặc định | chọn entry/recipe/quantity | CONFIRMED |
| `/nung` material | Left click mặc định | smelt ALL stock của material đó | CONFIRMED |

Shift-right, middle click, number key: **UNKNOWN** cho server-specific meaning; không hard-code.

## 12. GUI Signatures

### `/sky`

- Command: `/sky`.
- Title observed: `ᴄʜọɴ ᴍáʏ ᴄʜủ`.
- Type: generic 9x3.
- Fingerprint config: grass blocks at 12,14.
- Data: `data/runtime/gui/<botId>/sky.json`.

### `/kho`

- Command: `/kho`.
- Title regex config: `kho|storage`; exact stylized title observed separately.
- Type observed: generic 9x6.
- Capacity anchor bootstrap: 49.
- Data: `.../kho.json`.

### `/pv 2`

- Command `/pv 2`.
- Title regex config: `pv\s*2|personal\s*vault`; observed stylized title differs, nên knowledge/provenance cũng quan trọng.
- Type generic 9x6, 54 container storage slots + player inventory.
- Data: `.../pv-2.json`.

### `/ks`

- Command `/ks`.
- Observed title `ᴋʜᴏáɴɢ ѕảɴ`.
- Type generic 9x3.
- Menu logical items/slots từ `config/minerals/menu.json`.
- Data: `ks.json`, plus route-specific `ks__menu_*` files.

### `/nung`

- Command `/nung`.
- Observed type generic 9x1.
- Data `nung.json`.

GUI recognition phải dùng combination của command provenance, title/type/layout/fingerprint/known logical item khi phù hợp; không dùng một field duy nhất như universal identity.

## 13. Custom Item System

Status: **CONFIRMED**

Server dùng custom item identity tương thích MMOItems-style custom data. Normalized snapshots/tests có dạng:

```text
identityComponents:
  - MMOITEMS_ITEM_ID:DADOTINHLUYEN
  - id:22
```

`config/items/items.json` định nghĩa B2–B5 inventory/personal-vault representations bằng `identity` rule như:

```text
MMOITEMS_ITEM_ID:KIMCUONGTINHLUYEN
MMOITEMS_ITEM_ID:KHOIKIMCUONGTINHLUYEN
```

Strong identity phải ưu tiên hơn English/vanilla display name/material.

Vanilla `redstone`, `diamond_block`, v.v. có thể chỉ là carrier. Không nhận diện custom item chỉ bằng material nếu `customMetadataPresent`/identity component tồn tại.

## 14. B1 / B2 / B3 / B4 / B5

Status: **CONFIRMED (config contract)**

Tiers trong `config/server-data/crafting-tiers.json`:

B1:
`cobblestone`, `coal`, `redstone`, `lapis_lazuli`, `iron_ingot`, `gold_ingot`, `diamond`, `emerald`.

B2:
`super_cobblestone`, `refined_coal`, `refined_redstone`, `refined_lapis`, `refined_iron`, `refined_gold`, `refined_diamond`, `refined_emerald`.

B3:
block variant tương ứng.

B4:
`carbon`, `titanium`, `tungsten`.

B5:
`super_alloy`.

### B1 -> B2 recipe facts

- super cobblestone: 16 cobblestone.
- refined coal: 16 coal.
- refined redstone: 64 redstone.
- refined lapis: 64 lapis.
- refined iron: 64 iron ingot.
- refined gold: 64 gold ingot.
- refined diamond: 32 diamond.
- refined emerald: 32 emerald.

### B2 -> B3

Mỗi B3 hiện cần 16 B2 tương ứng.

### B4

- `carbon`: 8 refined redstone block + 4 super cobblestone block + 16 refined coal block.
- `titanium`: 4 refined lapis block + 16 refined iron block + 8 refined gold block + 2 refined emerald block.
- `tungsten`: 2 super cobblestone block + 16 refined diamond block + 4 refined emerald block + 8 refined iron block + 8 refined gold block.

### B5

`super_alloy`: 8 tungsten + 16 titanium + 32 carbon.

Recipe menu slots 10..33 là CURRENT bootstrap/config data, không phải logical identity.

## 15. B1 -> B2 Special Rule

### Server limitation

Status: **INFERRED/CURRENT workflow assumption**

B5 config có `inventorySafetyEmptySlots = 2`; policy còn dùng `b3AllMinEmptySlots = 1`. Code được thiết kế để tránh inventory backpressure/full-inventory failure.

Exact server statement “inventory full luôn từ chối craft B1->B2” chưa có một canonical server-message contract trong config; nếu cần khẳng định như server rule, phải capture failure message/observation mới.

### Bot policy

Status: **CONFIRMED**

`config/server-data/b5.json`:

- `useAllForB2 = true`;
- `b2BatchSize = 64` vẫn là fallback khi ALL bị tắt bằng config.
- `b2InputSource = storage` là mặc định tương thích config cũ; lựa chọn còn lại là `inventory`.

Với `storage`, strategy cho phép `ALL` ở B1 -> B2 **chỉ sau guard storage pressure**. Sau khi ALL làm đầy inventory, reserve-chain sẽ park tối thiểu một stack B2 vào PV2 khi cần để tạo slot cho B2 -> B3 ALL. Với `inventory`, bot rút đúng numeric amount đã plan và tắt B2 `ALL` để lượng input/output có thể kiểm soát. Đây là bot policy có guard, không phải universal server rule.

### `/kho` material withdrawal

Status: **PARTIALLY CONFIRMED (operator description; exact live identity unknown)**

Luồng được xác nhận về mặt hành vi: `/kho` overview → click material B1 → material detail → semantic `Rút/Withdraw` → quantity GUI. Server có thể đưa ra `1`, `8`, `16`, `64`, `128`, `256`, `512`, `1 stack` và `đầy inventory`. Bot hiện chỉ dùng các numeric amount có identity text chính xác, chọn tổ hợp ít click và không vượt request; `1 stack`/`đầy inventory` được nhận diện là action riêng nhưng không được chọn mặc định. Exact title, fingerprint và slot cho material-detail/quantity GUI vẫn **UNKNOWN** cho tới khi có capture runtime; implementation vì vậy yêu cầu fresh `/kho` provenance, new-window transition và semantic live text thay vì hard-code slot.

Withdrawal chạy sau smelting/conversion đưa B1 về đúng recipe form. Mỗi click được verify bằng delta B1 trong player inventory; nếu click báo lỗi nhưng delta đã xuất hiện thì coi action đã áp dụng và không click lại. Generation đổi ở bất kỳ boundary nào phải hủy flow trước B2.

## 16. B2 -> B3 Special Rule

Status: **CONFIRMED (bot policy + quantity capability)**

- `useAllForB3 = true`.
- `b3AllMinEmptySlots = 1`.

Server quantity GUI có `ALL` capability; B5 strategy được phép chọn `ALL` cho B2 -> B3 khi precondition inventory/policy đạt.

Không suy ra rằng ALL luôn an toàn cho mọi recipe/mode.

## 17. B5 Cooldown

Status: **CONFIRMED (bot workflow policy)**

CURRENT `config/modes/b5-craft.json` đặt `postB5CooldownMs = 1800000`, tức B5 thuần nghỉ **30 phút** sau khi hoàn thành một B5 trước campaign tiếp theo. Sau cooldown, campaign mới bắt buộc chạy B1 normalization trước khi tiếp tục chế.

Đây là policy của bot hiện tại. Việc server có enforce một cooldown độc lập hay không vẫn **UNKNOWN** nếu không có message/packet xác nhận riêng; không được suy từ policy của bot thành server constant.

## 18. Server Time / Kick / Restart Behavior

Status: **CONFIRMED (bot recovery policy), server cause partly UNKNOWN**

`config/recovery/daily.json`:

- timezone offset: `+420` phút (UTC+7).
- sky window: `03:00`, wait `5` phút, retry window `20` phút.
- server window: `05:00`, wait `5` phút, retry window `20` phút.

`DailyRecoverySchedule` default nếu config thiếu là 10 phút, nhưng CURRENT config override thành **5 phút**. Documentation phải theo effective config hiện tại.

Behavior code:

- Around 03:00, `SkyblockAutoJoinService` có thể hold `/sky` auto join đến `resumeAt`.
- `CollectorB5ModeService` có daily Sky recovery logic.
- Around 05:00, `ReconnectManager` lấy `dailyRecovery.reconnectDelay()` làm floor cho reconnect delay.

Server-side statement “03:00 kick Sky” / “05:00 kick whole server” là **OBSERVED/USER-SPEC dependent**, nhưng exact kick packet/message/type không được canonicalize trong config hiện tại. Khi debug, capture `kicked/end` reason để nâng status.

## 19. Resource Pack

Status: **CONFIRMED**

`config/resource-pack/resource-pack.json`:

- enabled: true;
- autoAccept: true.

`SkyblockAutoJoinService` config hiện `waitForResourcePack = false`, nghĩa là auto join không bắt buộc block tới resource-pack ready.

Known risk: resource-pack/login/spawn có thể race; generation-scoped events phải được dùng thay vì sleep assumption.

## 20. Chat / Message Patterns

Status: **PARTIAL**

`config/commands/responses.json` hiện có includes đơn giản:

- storage -> `kho`;
- personalVault2 -> `pv`;
- minerals -> `ks`;
- smelting -> `nung`;
- islandHome -> `island`;
- dungeon -> `dungeon`.

Nhiều production flows không dựa vào các pattern này mà verify bằng GUI/position/inventory.

Canonical success/failure/cooldown text cho sell/craft/kick: **UNKNOWN**. Không copy raw log hàng trăm dòng; nếu cần, thêm semantic pattern có test fixture.

## 21. Known Server Quirks

1. `/kho` và `/kho sell` có thể gần như cùng layout; command provenance quan trọng. Status: **CONFIRMED in code comments**.
2. Sell click có thể refresh same window hoặc replace `GuiSession` mà mất source metadata; operation reclaims Sell source. **CONFIRMED**.
3. Một số GUI transition có thể mutate `currentWindow` mà Mineflayer không emit đúng transition event; code có reconcile fallback ở sell/mineral conversion. **CONFIRMED**.
4. Sell GUI không expose toàn bộ raw material; không dùng nó làm full `/kho` snapshot. **CONFIRMED**.
5. Sell GUI amount `0` có thể unreliable do lore/action text matching; full planning dùng `/kho`. **CONFIRMED**.
6. Craft quantity buttons có thể dùng carrier/custom item gần giống nhau, khác chủ yếu numeric text `1`/`64`; learned fingerprint có thể collapse. **CONFIRMED**.
7. Inventory while GUI open có thể cần currentWindow player section để tránh stale `bot.inventory`. **CONFIRMED by tests**.
8. Custom MMOItems may show vanilla English display/material in inventory; strong identity component phải giữ. **CONFIRMED by tests/config**.
9. Smelting click processes ALL stored input material, không có quantity GUI. **CONFIRMED**.

## 22. Verification Rules

| Capability | Không đủ | Success evidence hiện tại |
|---|---|---|
| `/is` | command sent | `movement:teleport` current generation + position after |
| `/sky` | `/sky` sent | expected GUI/selection/join completion event current generation |
| `/kho` | window opened | readable storage entries/capacity under `/kho` provenance |
| `/kho sell` | click resolved | GUI transition và/hoặc reliable material amount changed; later full stock can be checked via `/kho` |
| `/pv 2` transfer | shift-click resolved | source/destination inventory/vault delta |
| smelt | material click resolved | fresh `/kho`: input decreases/output increases |
| craft | quantity click resolved | `CraftingResultVerifier`: output observed, sync/event/input evidence |
| movement | pathfinder Promise resolve | final arrival detector/position guard |
| fishing | `bot.fish()` call | cycle result + rod/position guard; server bobber-destroyed signal handled |

Action packet/click không bao giờ là final verification nếu postcondition có thể quan sát.

## 23. Server Knowledge Data Files

### Manual/validated config

- `config/server.json`
- `config/commands/commands.json`
- `config/authentication/login.json`
- `config/resource-pack/resource-pack.json`
- `config/skyblock/join.json`
- `config/storage/kho.json`
- `config/personal-vault/pv2.json`
- `config/minerals/menu.json`
- `config/minerals/conversions.json`
- `config/smelting/recipes.json`
- `config/server-data/recipes.json`
- `config/server-data/crafting-tiers.json`
- `config/server-data/b5.json`
- `config/items/items.json`
- mode/recovery config liên quan.

### Captured observation / generated knowledge

Per bot dưới `data/runtime/gui/<botId>/`, ví dụ:

- `sky.json`
- `ks.json`
- `kho.json`
- `pv-2.json`
- `nung.json`
- route files như `ks__menu_crafting__recipe-*.json`.

Inventory observation:

- `data/runtime/inventory/<botId>/inventory.json`.

Runtime log/error:

- `data/logs/*.jsonl`
- `data/runtime/errors/<botId>/*`.

Observation có timestamp/revision và có thể stale sau server update; config hard-code chỉ nên cập nhật từ observation đã xác minh.

## 24. Server Policy vs Bot Policy

### SERVER RULE / behavior

- Sell GUI: right click bán 64.
- Sell GUI: shift-left là ALL.
- `/nung` click material xử lý ALL stock material đó.
- `/ks` quantity GUI cung cấp các action mà resolver nhận `1`, `64`, `ALL` theo CURRENT contract.
- `/pv 2` là container 54 storage slots trong current flow.

### BOT POLICY

- B1 -> B2: được dùng ALL khi quantityOptimization bật và storage-pressure guard xác nhận an toàn; batch 64 là fallback.
- B2 -> B3: được dùng ALL với inventory precondition và cơ chế park B2 vào PV2 để chừa slot.
- Storage sell ALL mặc định disabled; chỉ explicit disposable ID có thể cho phép.
- Storage pressure thresholds/reserve strategy nằm ở config, không phải server limitation.
- Collector pickup coordinate và polling timing là mode config, không phải server contract.
- Daily recovery wait hiện 5 phút là recovery policy; exact server downtime có thể khác.

Không biến bot strategy thành “server bắt buộc” nếu chưa có evidence.

## 25. Unknowns / Needs Verification / Potentially Outdated

### UNKNOWN

- Server có enforce B5 cooldown hay không; CURRENT repo không implement 30 phút.
- Exact chat message cho craft success/failure/cooldown.
- Exact kicked reason/type ở 03:00 và 05:00.
- Shift-right/middle/number-key semantics trong server GUI.
- Whether every recipe always exposes all quantity actions.
- Whether `/login` needs chat confirmation on every connection profile; config hiện `confirm:false`.

### Needs verification

- Nếu operator/user kỳ vọng daily wait 10 phút: CURRENT config là 5 phút, cần xác nhận rồi update config/code trong task riêng.
- Nếu server đã chuyển block conversion sang `/kho`: CURRENT code vẫn dùng `/ks` conversion menu.
- Re-capture `sky`, `ks`, `kho`, `pv-2`, `nung` sau server UI update trước khi đổi fixed/bootstrap slots.
- Capture strong identities cho any new B2–B5 item trước khi dựa vào material/display name.

### Potentially outdated

- Stylized GUI title có thể đổi do resource pack/server update; route knowledge/provenance và fingerprints quan trọng hơn exact title đơn lẻ.
- `fallbackLimit = 800000` phải được verify lại nếu server nâng storage capacity.

## Project policy CURRENT: chế B5 thuần (MCbot 2.7.67)

Phần này là **project policy**, không phải khẳng định mechanic mới của server.

Mode `b5-craft` được cố ý tách khỏi Collector để chỉ làm chuỗi chế tạo:

```text
chờ Skyblock ready
→ /is
→ fresh /kho
→ chỉ nung raw iron/raw gold
→ nén mọi B1 family có block form
→ chốt immutable sell baseline
→ bán block surplus 64-only, giữ remainder <64
→ không đọc/xác minh lại reserve sau sell
→ đổi base/block B1 khi planner/crafting cần
→ B2 → B3 → B4 → B5
```

Policy bắt buộc:

- không tự di chuyển/pickup;
- chỉ gọi `/nung` cho raw iron và raw gold tại boundary bảo vệ kho; không nung stone hoặc resource khác;
- bảo vệ `/kho` vẫn được compact base → block và bán block surplus theo reserve/pressure policy;
- khi cần base B1, block → base chỉ được thực hiện qua conversion capability với capacity guard hiện có;
- B5 thuần bắt buộc chạy boundary trước mỗi đợt; `/nung` chỉ được dùng cho raw iron/raw gold, sau đó nén phôi/base thành block rồi mới chốt baseline và bán; vẫn không dùng movement/pathfinder;
- sau khi nén xong, sell baseline được chốt một lần cho đợt B5; mỗi click bán đúng `64`, không có click `1` cuối. Amount/delta đọc được sau click không được dùng để đổi hoặc ngắt kế hoạch bất biến; right-click đúng material trong verified Sell GUI và semantic transition tương ứng là acknowledgement của action `64`. Phần surplus dưới `64` và inflow phát sinh sau baseline đều để lại cho đợt B5 kế tiếp;
- kho lớn được bán qua nhiều bounded slice cùng episode; continuation chỉ tiếp tục remaining budget đã verify, không nung/nén hoặc lập baseline mới;
- không fresh-read `/kho` sau sell để kiểm tra amount, inflow hoặc mức 1.5; mọi thay đổi sau baseline thuộc đợt B5 kế tiếp;
- trong một Sell session, slot phải được resolve lại trước từng click và có thể đổi khi server refresh GUI. Khi chuyển loại mà target chưa xuất hiện, client được reopen `/kho sell` đúng một lần; nếu vẫn không có target thì hoãn riêng action của loại đó, tiếp tục loại khác đã nằm trong baseline, rồi báo blocker có `sellId` cùng danh sách entry thực tế. Retry không được bán lại action đã acknowledgement;
- mở crafting ngay khi mọi full-stack action của immutable baseline đã được acknowledgement; `1.5 B5` chỉ là sàn tính action tại baseline, không phải postcondition. Family thiếu từ baseline không được bán và không giữ mode chờ. Sau khi B5 mới được xác nhận chế và cất xong, chạy một lượt nung raw iron/raw gold; nếu lỗi, boundary đợt sau retry trước craft;
- `collector-b5` giữ behavior cũ riêng và không định nghĩa contract của `b5-craft`.

Các ngưỡng pressure/sell/reserve là config project (`config/minerals/conversions.json`, `config/storage/kho.json`), không phải server constant.

## Lệnh riêng theo Sky (2.6.12+)

- Lệnh do người vận hành tự đăng ký nằm ở `config/commands/sky-commands.json`, tách khỏi registry lệnh hệ thống.
- Mỗi lệnh thuộc đúng một Sky selection (`sky1`, `sky2`, ...). Cùng một command ID có thể có giá trị khác nhau ở các Sky khác nhau.
- Runtime chỉ gửi lệnh khi `SkyblockAutoJoinService` xác nhận bot đang `SKY`, readiness hợp lệ và selection hiện tại khớp Sky của lệnh.
- Khi ở `HUB`, đang reconnect, hoặc selection không khớp, lệnh bị chặn fail-closed.
- Lệnh đăng nhập/mật khẩu, lệnh nhiều dòng và chuỗi không bắt đầu bằng `/` không được phép đăng ký.
- Cấu hình được hot-reload; không cần restart backend sau khi thêm/xóa/sửa lệnh.

## Discord remote / HUB hold (2.6.14+)

- Discord mặc định `remoteOnly=true`; Desktop là owner của cấu hình/chẩn đoán sâu.
- Remote cho phép kết nối/ngắt riêng bot, điều khiển generic mode, `/is`, Vào Sky, Về HUB và gọi lệnh Sky đã đăng ký.
- `Vào Sky` phải đi qua `SkyblockAutoJoinService.requestJoinNow()` để readiness/generation được cập nhật đúng.
- `Về HUB` tạo manual HUB hold trước khi gửi `/hub`; hold chặn auto-join trong đúng connection generation hiện tại. Disconnect/reconnect tự xóa hold để daily recovery và reconnect vẫn hội tụ.
- Lệnh Sky custom vẫn phải qua `SkyCommandService`; Discord không được gửi raw command đi tắt safety gate.

## GUI close/command pacing (2.6.14+)

- Sau khi GUI vừa đóng, server MinerUA có thể chưa sẵn sàng nhận ngay command GUI kế tiếp. `GuiManager` giữ timestamp close và cung cấp post-close settle gate.
- `/kho` và `/pv 2` dùng gate này ngay cả khi GUI đã được server đóng trước lúc service bắt đầu; verification/retry hiện có vẫn giữ nguyên.
- `/nung` title `ɴᴜɴɢ ᴋʜᴏáɴɢ ѕảɴ` được nhận diện riêng là `smelting`, không fallback sang root `minerals`.

## B5 campaign / B1 normalization (2.6.13+)

- Nung raw iron/raw gold và ép B1 loose thành block được coi là boundary normalization, không phải thao tác phải lặp sau từng B2/B3.
- Khi một cycle đã tạo được B2/B3/B4 (`productive=true`), bot phải fresh re-plan và tiếp tục chế ngay.
- Chỉ khi cycle không tạo được gì và blocker là thiếu vật liệu thì mới hẹn kiểm B1 lại theo `b1NormalizeIntervalMs`.
- Sau B5 hoàn tất, bot vẫn nghỉ theo `postB5CooldownMs`; đợt mới bắt buộc normalization trước khi chế tiếp.



## /kho percentage telemetry + reconciliation (2.6.15+)

- Capacity indicator có thể chỉ hiện phần trăm. Token ngay trước `%` không được dùng làm absolute used/free/limit.
- Absolute capacity phải chứa được tổng item đọc từ cùng cửa sổ `/kho`; nếu mâu thuẫn, runtime dùng item totals + `fallbackLimit` thay cho telemetry lỗi.
- Một lần fresh-read thấy B1 thấp hơn baseline sau uncertain craft chỉ là provisional evidence. Cần đủ `maxFreshReads` lần giảm liên tiếp mới khóa nó thành confirmed fresh side-effect.
- Nếu click-time không có strong side-effect evidence và nhiều fresh-read cho thấy output không tăng, mọi input quan sát được đều bằng hoặc cao hơn baseline, planner được phép bỏ stale baseline và lập kế hoạch lại từ state mới.


## ServerProfile mapping (2.7.13)

MinerUA fixed server facts are resolved through the selected immutable `ServerProfile`. Current profile revision is deterministic over endpoint plus extracted command/auth/join/GUI/item/recipe/storage/timing facts. Runtime observation remains separate from fixed profile facts. Password/token material is prohibited from ServerProfile construction. A test-only fake profile proves generic consumers are not coupled to MinerUA raw values.
