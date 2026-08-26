(function universal(root, factory) {
  const value = factory();
  if (typeof module === 'object' && module.exports) module.exports = value;
  else root.MCbotRendererApiClient = value;
}(typeof globalThis !== 'undefined' ? globalThis : this, function create() {
  'use strict';

  function unwrap(response) {
    if (!response?.success) {
      const error = new Error(response?.error?.message || 'API phần mềm gặp lỗi.');
      error.code = response?.error?.code || null;
      throw error;
    }
    const data = response.data;
    if (data && typeof data === 'object' && data.success === false) {
      const error = new Error(data.error?.message || data.message || 'Tác vụ bị core từ chối.');
      error.code = data.error?.code || null;
      throw error;
    }
    return data;
  }

  async function call(request) {
    return unwrap(await request);
  }

  return Object.freeze({ call, unwrap });
}));
