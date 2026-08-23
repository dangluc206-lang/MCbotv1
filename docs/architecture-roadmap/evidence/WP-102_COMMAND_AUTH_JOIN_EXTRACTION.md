# WP-102 — Command/Auth/Join Extraction Evidence

Status: `DONE` on 2.7.10 (2026-08-22).

The selected `ServerProfile` now owns the command catalog, command response rules, authentication behavior, Sky join behavior, and registered Sky commands used by bot runtime construction. Password material is intentionally absent from the profile and remains an environment/profile-secret input passed directly to `ServerLoginService`.

Reference tests: `CommandAuthJoinProfile.test.js`, `CommandGenerationContract.test.js`, `ServerLoginGeneration.test.js`, and `SkyblockJoinOperation.test.js`. The latter retains post-command GUI/teleport verification and stale-generation rejection.
