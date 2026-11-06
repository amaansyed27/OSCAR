const fs = require("node:fs");
const path = require("node:path");
const { parseEnv } = require("node:util");
function loadConfig(root) {
  const env = { ...process.env };
  for (const name of [".env", ".env.local"]) {
    const file = path.join(root, name);
    if (fs.existsSync(file))
      Object.assign(env, parseEnv(fs.readFileSync(file, "utf8")));
  }
  const key = env.GROQ_API_KEY || env.GROQ_API_KEY_1;
  if (
    env.OSCAR_MODEL &&
    !["openai/gpt-oss-20b", "openai/gpt-oss-120b"].includes(env.OSCAR_MODEL)
  )
    throw new Error(
      "OSCAR_MODEL must be openai/gpt-oss-20b or openai/gpt-oss-120b (131,072-token context).",
    );
  return {
    key,
    model: env.OSCAR_MODEL || "openai/gpt-oss-20b",
    endpoint: "https://api.groq.com/openai/v1/chat/completions",
    inputBudget: 10000,
    outputBudget: 1800,
  };
}
const memoryFormat = {
  type: "json_schema",
  json_schema: {
    name: "memory_changes",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["changes"],
      properties: {
        changes: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["operation", "key", "quote", "replaces"],
            properties: {
              operation: { type: "string", enum: ["remember", "forget"] },
              key: { type: "string" },
              quote: { type: "string" },
              replaces: { type: ["integer", "null"] },
            },
          },
        },
      },
    },
  },
};
class Model {
  constructor(config) {
    this.config = config;
  }
  async complete(messages, json = false) {
    if (!this.config.key)
      throw new Error(
        "Add a Groq key to the local .env configuration, then restart OSCAR.",
      );
    let response;
    try {
      response = await fetch(this.config.endpoint, {
        method: "POST",
        signal: AbortSignal.timeout(60000),
        headers: {
          Authorization: `Bearer ${this.config.key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.config.model,
          messages,
          temperature: 0.3,
          reasoning_effort: "low",
          max_tokens: this.config.outputBudget,
          ...(json ? { response_format: memoryFormat } : {}),
        }),
      });
    } catch {
      throw new Error(
        "OSCAR could not reach Groq. Check your connection and try again.",
      );
    }
    if (!response.ok)
      throw new Error(
        response.status === 429
          ? "Groq rate limit reached. Wait a moment and retry."
          : `Groq could not answer (HTTP ${response.status}). Check your key and model configuration.`,
      );
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content || data.choices[0].finish_reason === "length")
      throw new Error(
        "The model returned an incomplete response. Please retry with a shorter request.",
      );
    return { content, usage: data.usage };
  }
}
module.exports = { loadConfig, Model };
