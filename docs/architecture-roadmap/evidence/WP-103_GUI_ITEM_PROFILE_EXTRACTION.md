# WP-103 — GUI/Item Profile Extraction Evidence

Status: `DONE` on 2.7.11 (2026-08-22).

`registerBotServices` no longer reads the fixed GUI window, GUI identity, GUI slot or item catalogs directly from global configuration. It constructs per-bot identity readers from the selected immutable `ServerProfile`. Runtime observation/learning remains outside profile data and therefore cannot mutate fixed profile facts. Existing strong MMOItems, learn-once, ambiguity and stale-generation tests remain the regression oracle. B5 trace evidence now includes `serverProfileId` and `serverProfileRevision`.
