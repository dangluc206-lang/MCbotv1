'use strict';

// Generic input-source policy (G16). Decides per material whether crafting
// inputs come from bot inventory (withdraw prepared stock into inventory
// first) or from storage (materials already live in /kho; compact/prepare
// the canonical base form, no withdrawal).
// Shape: { default: 'storage'|'inventory', overrides: { [materialId]: source } }.
// Legacy `b2InputSource` key is mapped once at the boundary; stored policy is
// generic-only. Pure: no side effects, no recipe knowledge.
class CraftInputSourcePolicy {
  constructor({ deflt = 'storage', overrides = {} } = {}) {
    this.default = deflt === 'inventory' ? 'inventory' : 'storage';
    this.overrides = Object.freeze({ ...(overrides || {}) });
    Object.freeze(this);
  }

  static fromConfig(config = {}) {
    const source = config?.inputSource ?? config?.b2InputSource ?? 'storage';
    const overrides = config?.inputSourceOverrides || config?.inputSources || {};
    return new CraftInputSourcePolicy({ deflt: source, overrides });
  }

  resolve(materialId) {
    const key = String(materialId || '').trim();
    const override = key ? this.overrides[key] : null;
    if (override === 'inventory' || override === 'storage') return override;
    return this.default;
  }

  isInventory(materialId) { return this.resolve(materialId) === 'inventory'; }
}

module.exports = CraftInputSourcePolicy;
