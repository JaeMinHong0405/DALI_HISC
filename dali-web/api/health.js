// GET /api/health — tells the page whether real Claude is available.
"use strict";
const { cfg, json } = require("./_shared");

module.exports = (req, res) => {
  const c = cfg();
  // Real Claude is only switched on when BOTH the key and an access code are set,
  // so a public URL can never spend the API key without the code.
  json(res, 200, {
    app: "dali",
    hasKey: !!(c.apiKey && c.accessCode),
    needCode: true,
    keyWithoutCode: !!(c.apiKey && !c.accessCode),
    models: { default: c.modelDefault, quick: c.modelQuick },
  });
};
