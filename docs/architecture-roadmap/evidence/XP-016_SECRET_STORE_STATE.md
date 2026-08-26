# XP-016 — Secret store state và recovery

Status: `DONE`

`DesktopSecretStore.status()` now returns `desktop-secret-state-v1` and distinguishes `OK`, `NOT_CONFIGURED`, `UNAVAILABLE`, `CORRUPT` and `DECRYPT_FAILED`. Diagnostics expose only allowlisted key names, stable state/code and remediation; ciphertext, plaintext and decrypt exceptions never cross the boundary.

Corrupt state is fail-closed for writes so a save cannot silently replace evidence. Environment projection includes only successfully decrypted values. The Desktop offers a destructive in-app reset with exact scope `SECRETS_ONLY`; it deletes only the configured secret-store file and preserves bot profiles, configuration and runtime data.
