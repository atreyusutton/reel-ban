const store = {};
globalThis.chrome = {
  storage: { local: {
    get: async (k) => { const keys = Array.isArray(k) ? k : [k]; const o = {}; for (const key of keys) if (key in store) o[key] = store[key]; return o; },
    set: async (o) => { Object.assign(store, JSON.parse(JSON.stringify(o))); },
  } },
};
globalThis.crypto = require('node:crypto').webcrypto;
globalThis.__store = store;
