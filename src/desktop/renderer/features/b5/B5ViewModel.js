(function universal(root, factory) {
  const value = factory();
  if (typeof module === 'object' && module.exports) module.exports = value;
  else root.MCbotB5ViewModel = value;
}(typeof globalThis !== 'undefined' ? globalThis : this, function create() {
  'use strict';
  function validate(item) {
    return Boolean(item?.contract === 'b5-operator-presentation-v1' && item.sell?.quantityPerAction === 64 && item.reserve?.requiredCoverage === 1.5 && Array.isArray(item.stages));
  }
  function summary(item) {
    if (!validate(item)) throw new Error('Invalid B5 operator presentation DTO.');
    return Object.freeze({ botId:item.botId, status:item.status, safeState:item.safeState, currentStage:item.currentStage, sellQuantity:64, reserveCoverage:1.5, canRetry:item.recovery?.allowedActions?.includes('retry-storage-protection') === true });
  }
  return Object.freeze({ validate, summary });
}));
