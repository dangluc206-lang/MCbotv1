# XP-017 — Documentation behavior/version closure

Status: `DONE`

README now declares package version `2.7.67` and a canonical CURRENT B5 contract. Older 2.5–2.6 release narrative is explicitly bracketed as historical and excluded from the current-behavior gate. `SERVER_BEHAVIOR.md`, `RULES.md`, README and Desktop copy agree on the mandatory sequence: fresh `/kho`, smelt raw iron/raw gold only, compact block-capable families, immutable baseline, quantity-64 surplus sale, retain `<64`, verify `1.5 B5`, then craft.

Legacy statements that protection may be skipped, B5 never smelts, smelting is a UI toggle, B5 uses `SELL ALL`, or a final quantity-1 click is allowed were removed from CURRENT sections. `node scripts/check-product-docs.js` validates package/docs version, required semantics, config reserve/single-sell flags and B1 implementation guards.
