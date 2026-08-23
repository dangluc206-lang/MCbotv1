# WP-105 — Fake Second Server Contract Evidence

Status: `DONE` on 2.7.13 (2026-08-22). Phase 2 gate: `PASS`.

The test-only `fake-second` profile intentionally differs from MinerUA in command templates, join GUI/slots, item carrier, recipe quantities, storage capacity, post-B5 timing, and capability availability. Generic command and join consumers execute it without profile-id branching. Mixed-profile catalogs are immutable and isolated.
