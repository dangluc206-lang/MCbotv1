# Security and Update Safety

## Secret boundaries

Không đọc/commit/package/log:

- `.env*` thật;
- Discord token;
- Minecraft password/session;
- credential commands;
- private runtime identifiers nếu không cần;
- raw auth packets/client.

Secret store resolve vào runtime memory tại boundary cần dùng.

## Custom workflow safety

- JSON/schema validated.
- Module allowlist.
- Slash command phải bắt đầu `/` và qua `SlashCommandService`.
- Credential command bị cấm.
- Không `eval`, `new Function`, arbitrary import hoặc raw client.
- Capability/resource dependency explicit.
- Invalid file không làm backend boot fail; visible for repair.

## Desktop/renderer boundary

- Renderer không ghi filesystem/config trực tiếp.
- IPC action có allowlist, validation và authorization.
- Config write qua validator + backup + runtime apply contract.
- Log/status đã redact trước renderer.

## Local update package policy

ZIP phải:

- có manifest hợp lệ;
- version/base/type đúng;
- dependency contract đúng;
- không traversal/absolute path/symlink/duplicate normalized path;
- không chứa `.env*`, runtime data, logs, backups, secrets, custom modes;
- chỉ ghi application tree;
- dependency runtime đổi thì dùng installer, không patch ZIP.

## Update transaction

```text
scan
-> stage
-> validate manifest/package/dependencies
-> protected-path policy
-> backup targets
-> replace/delete
-> verify
-> rollback on failure
-> restart
-> runtime config migration
```

## Artifact ownership

Mọi temp/stage/backup/quarantine/delete target cần:

- normalized absolute path;
- allowed root proof;
- operation ownership;
- collision handling;
- digest/size khi cần;
- cleanup policy;
- recovery retention.

Không recursive-delete computed path trước khi verify parent/root/owner.

## Runtime config safety

- Application template và mutable runtime tree tách.
- Exact prestate snapshot/verified source.
- Metadata/config joint postcondition.
- Failed recovery stable code + evidence.
- Không overwrite unowned collision.
- Cleanup only owned.

## Logging/redaction

- Structured detail trước, redact sau, operator projection cuối.
- Không log command chứa password.
- Không dump full NBT/inventory/GUI ở INFO.
- Support bundle explicit allowlist.
- Error cause message cũng phải qua redaction nếu hiển thị.

## Dependency/supply chain

- Không đổi Mineflayer/protocol/dependency nếu task không yêu cầu.
- Lockfile diff phải giải thích.
- Local patch khai `dependenciesChanged` chính xác.
- Build/install gates không bị bypass bằng cài dependency ngẫu nhiên.

## Threat scenarios cần test

- malicious ZIP path/case collision/symlink;
- oversized/decompression bomb policy;
- update tries protected path;
- temp collision/unowned cleanup;
- custom workflow credential/raw command;
- renderer sends invalid config/action;
- support bundle secret leakage;
- stale generation performs destructive action;
- profile path/lastBackup points outside allowed root;
- rollback source corrupt/missing.

## Security exit gate

- No secret path/content in payload.
- All external/untrusted input validated.
- Side effect authorized and scoped.
- Filesystem paths normalized/owned.
- Redaction tests pass.
- Recovery preserves data/evidence.
- Security exception có owner, expiry và mitigation.
