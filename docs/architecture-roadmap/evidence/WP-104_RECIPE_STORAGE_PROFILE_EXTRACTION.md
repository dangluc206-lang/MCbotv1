# WP-104 — Recipe/Storage Profile Extraction Evidence

Status: `DONE` on 2.7.12 (2026-08-22).

Crafting recipes/tiers, `/kho`, `/pv 2`, `/ks` quantity/conversion, `/nung`, and server timing are now selected from the immutable per-bot ServerProfile. The B5 target, reserve strategy and quantity optimization remain bot/workflow policy. Existing storage parser and quantity semantic detection tests remain unchanged and pass.
