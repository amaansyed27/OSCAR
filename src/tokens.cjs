const { encode } = require("gpt-tokenizer/encoding/o200k_harmony");
function countText(text) {
  return encode(String(text), {
    allowedSpecial: new Set(),
    disallowedSpecial: new Set(),
  }).length;
}
function countMessages(messages, model = "openai/gpt-oss-20b") {
  return messages.reduce(
    (n, m) =>
      n +
      (/gpt-oss/.test(model)
        ? countText(m.content)
        : Buffer.byteLength(m.content, "utf8")) +
      24,
    64,
  );
}
function operatingBudget(config, setting) {
  const n = Number(setting || config.inputBudget || 16000);
  return Math.max(
    2048,
    Math.min(n, 32000, config.contextWindow - config.outputBudget - 1024),
  );
}
module.exports = { countText, countMessages, operatingBudget };
