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
  const endpoint =
    env.OSCAR_GROQ_ENDPOINT ||
    "https://api.groq.com/openai/v1/chat/completions";
  if (env.OSCAR_GROQ_ENDPOINT) {
    const url = new URL(endpoint);
    if (
      url.protocol !== "http:" ||
      !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    )
      throw new Error("The transport-test endpoint must be HTTP loopback.");
  }
  return {
    key,
    model: env.OSCAR_MODEL || "openai/gpt-oss-20b",
    endpoint,
    inputBudget: Number(env.OSCAR_INPUT_TOKENS) || 16000,
    outputBudget: 4000,
    contextWindow: 131072,
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
            required: [
              "operation",
              "key",
              "quote",
              "replaces",
              "value",
              "aliases",
            ],
            properties: {
              operation: { type: "string", enum: ["remember", "forget"] },
              key: { type: "string" },
              quote: { type: "string" },
              value: { type: "string" },
              aliases: { type: "string" },
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
  async request(messages, json = false, stream = false, signal) {
    if (!this.config.key)
      throw new Error(
        "Add a Groq key to the local configuration, then restart OSCAR.",
      );
    let response;
    try {
      response = await fetch(this.config.endpoint, {
        method: "POST",
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(90000)])
          : AbortSignal.timeout(90000),
        headers: {
          Authorization: `Bearer ${this.config.key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.config.model,
          messages,
          temperature: 0.2,
          reasoning_effort: "low",
          max_tokens: this.config.outputBudget,
          stream,
          ...(stream ? { stream_options: { include_usage: true } } : {}),
          ...(json ? { response_format: memoryFormat } : {}),
        }),
      });
    } catch (e) {
      if (signal?.aborted) throw new DOMException("Stopped", "AbortError");
      throw new Error(
        "OSCAR could not reach Groq. Check your connection and retry.",
      );
    }
    if (!response.ok)
      throw new Error(
        response.status === 429
          ? `Groq rate limit reached. Retry in ${Math.max(1, Math.ceil(Number(response.headers.get("retry-after")) || 15))} seconds.`
          : `Groq could not answer (HTTP ${response.status}). Check your model and configuration.`,
      );
    return response;
  }
  async complete(messages, json = false, signal) {
    const response = await this.request(messages, json, false, signal);
    const data = await response.json();
    if (
      !data.choices?.[0]?.message?.content ||
      data.choices[0].finish_reason === "length"
    )
      throw new Error("The model returned an incomplete response.");
    return { content: data.choices[0].message.content, usage: data.usage };
  }
  async stream(messages, onChunk, signal) {
    const response = await this.request(messages, false, true, signal);
    let buffer = "",
      content = "",
      usage,
      finished = false,
      reason;
    const decoder = new TextDecoder();
    try {
      for await (const bytes of response.body) {
        buffer += decoder.decode(bytes, { stream: true });
        let at;
        while ((at = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, at).trim();
          buffer = buffer.slice(at + 1);
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (data === "[DONE]") {
            finished = true;
            continue;
          }
          const event = JSON.parse(data);
          if (event.error)
            throw new Error("The provider interrupted its response.");
          if (event.usage) usage = event.usage;
          const choice = event.choices?.[0];
          if (choice?.finish_reason) reason = choice.finish_reason;
          const delta = choice?.delta?.content;
          if (delta) {
            content += delta;
            onChunk(delta, content);
          }
        }
      }
    } catch (e) {
      if (signal?.aborted) throw new DOMException("Stopped", "AbortError");
      throw new Error(
        "The connection was interrupted. Your partial reply is saved; retry to continue.",
      );
    }
    if (!finished || !content || reason === "length")
      throw new Error(
        "The reply ended before it was complete. Your partial reply is saved.",
      );
    return { content, usage };
  }
}
module.exports = { loadConfig, Model };
