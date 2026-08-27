MCbotv1 B5 timing + withdrawal synchronization fix (QA final)

Base revision inspected: deb66ee8a2c0f544cff64860b5af09cfc56820d5

Changed file:
src/server-features/crafting/b5/B5ReserveChainCoordinator.js

Changes:
1. After a successful B2 ALL/B2 craft iteration, wait 1500 ms before the next reserve-chain iteration so the server has time to settle inventory before B3 is attempted.
2. After a successful B3 ALL craft iteration, wait 1500 ms before the next reserve-chain iteration.
3. B2 withdrawal from /pv 2 now waits until the inventory count actually increases before committing vaultB2Remaining. It no longer trusts movedStacks alone.

QA:
- JavaScript syntax check passed with node --check.
- No changes to recipe selection, ALL semantics, verifier rules, storage protection, or non-B5 code.
- This is intentionally a test-oriented timing patch; 1500 ms is not claimed as the final optimized value.

This is an overlay ZIP: extract it over the MCbotv1 project so the file is replaced at the same path.
