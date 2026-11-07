# Slice 02 evaluation · 2026-11-07

OSCAR 0.3.0 is the Windows owner review build. The provider table records the documented adapter interfaces. Live results are listed separately below.

Verified implementation commit `aef1d651ac9ceb891021a562f17f1504bbd1f2b3`. The documentation commit records this handoff on `main`.

The pre-slice checkpoint is `a020036`, which follows sidebar implementation `392efaa`. All 23 baseline Rust tests passed. The private configuration digest matched after testing. The migration creates `oscar.before-slice02.sqlite` before adding cloud and attachment tables.

```powershell
cd D:\Programming\03_Projects\oscar
npm ci
npm start
```

`npm run build` produces `src-tauri/target/release/oscar-desktop.exe` and `src-tauri/target/release/bundle/nsis/OSCAR_0.3.0_x64-setup.exe`. The installer is unsigned. Installation and visual acceptance remain with the owner.

## Provider catalog

| Provider | Protocol | Authentication | Source |
| --- | --- | --- | --- |
| GroqCloud | openai | bearer | [Official documentation](https://console.groq.com/docs/openai) |
| OpenRouter | openai | bearer | [Official documentation](https://openrouter.ai/docs/api_reference/overview) |
| NVIDIA NIM | openai | bearer | [Official documentation](https://docs.api.nvidia.com/nim/reference/llm-apis) |
| Google AI Studio | gemini | google-key | [Official documentation](https://ai.google.dev/gemini-api/docs) |
| Z.ai | openai | bearer | [Official documentation](https://docs.z.ai/api-reference/introduction) |
| Ollama Cloud | ollama | bearer | [Official documentation](https://docs.ollama.com/cloud) |
| OpenAI | responses | bearer | [Official documentation](https://developers.openai.com/api/reference/responses/overview) |
| Anthropic | anthropic | anthropic-key | [Official documentation](https://platform.claude.com/docs/en/api/overview) |
| xAI | openai | bearer | [Official documentation](https://docs.x.ai/docs/overview) |
| DeepSeek | openai | bearer | [Official documentation](https://api-docs.deepseek.com) |
| Mistral AI | openai | bearer | [Official documentation](https://docs.mistral.ai/api) |
| Cohere | cohere | bearer | [Official documentation](https://docs.cohere.com/reference/chat) |
| Together AI | openai | bearer | [Official documentation](https://docs.together.ai/docs/openai-api-compatibility) |
| Fireworks AI | openai | bearer | [Official documentation](https://docs.fireworks.ai/api-reference/introduction) |
| Cerebras | openai | bearer | [Official documentation](https://inference-docs.cerebras.ai/api-reference) |
| DeepInfra | openai | bearer | [Official documentation](https://deepinfra.com/docs/openai_api) |
| Perplexity Agent API | responses | bearer | [Official documentation](https://docs.perplexity.ai/docs/agent-api/openai-compatibility) |
| Moonshot AI | openai | bearer | [Official documentation](https://platform.kimi.ai/docs/api/chat) |
| Alibaba Qwen | openai | bearer | [Official documentation](https://www.alibabacloud.com/help/en/model-studio/compatibility-of-openai-with-dashscope) |
| MiniMax | anthropic | anthropic-key | [Official documentation](https://platform.minimax.io/docs/api-reference/text-anthropic-api) |
| Hugging Face | openai | bearer | [Official documentation](https://huggingface.co/docs/inference-providers) |
| SambaNova | openai | bearer | [Official documentation](https://docs.sambanova.ai/cloud/docs/get-started) |
| Novita AI | openai | bearer | [Official documentation](https://novita.ai/docs/api-reference/model-apis-llm-create-chat-completion) |
| AI21 Labs | openai | bearer | [Official documentation](https://docs.ai21.com/reference/chat-completions) |
| Replicate | replicate | bearer | [Official documentation](https://replicate.com/docs/reference/http) |
| Cloudflare Workers AI | cloudflare | account-token | [Official documentation](https://developers.cloudflare.com/workers-ai/configuration/open-ai-compatibility/) |
| Azure OpenAI / Foundry | openai | azure-key | [Official documentation](https://learn.microsoft.com/en-us/azure/ai-foundry/openai/how-to/switching-endpoints) |
| Amazon Bedrock | bedrock | bedrock-key-or-iam | [Official documentation](https://docs.aws.amazon.com/bedrock/latest/userguide/api-keys.html) |
| Google Vertex AI | gemini | oauth-project | [Official documentation](https://cloud.google.com/vertex-ai/generative-ai/docs/model-reference/inference) |
| Baseten | openai | api-key | [Official documentation](https://docs.baseten.co/inference/overview) |
| Custom OpenAI-compatible | openai | configurable | [Official documentation](https://platform.openai.com/docs/api-reference/chat) |
| Custom Anthropic-compatible | anthropic | configurable | [Official documentation](https://platform.claude.com/docs/en/api/messages) |
| Tavily Search | search | bearer | [Official documentation](https://docs.tavily.com/documentation/api-reference/endpoint/search) |
| Z.ai Coding Plan | restricted | restricted-product | [Official documentation](https://docs.z.ai/devpack/overview) |
| Nebius Token Factory | openai | bearer | [Official documentation](https://docs.tokenfactory.nebius.com/quickstart) |
| SiliconFlow | openai | bearer | [Official documentation](https://docs.siliconflow.com/en/userguide/quickstart) |

The registry has 34 inference definitions, one search adapter and one restricted product. Public HTTPS custom connections support bounded headers and explicit authentication. Contract checks exercised adapter payloads and stream parsing, settings storage, private destination rejection and restrictions. A live third-party custom endpoint was unavailable. Bedrock and Vertex need account configuration and manual model registration. Live IAM, OAuth and individual specialized model compatibility remain open. Replicate requires a compatible text model with a stream URL. Background extraction via Replicate polling and remote prediction cancellation remain open. Coding Plan slots are excluded from general chat.

## Live and desktop checks

- Read-only discovery used configured credentials for Groq (11 models), OpenRouter (422), NVIDIA (84), Google AI Studio (47), Z.ai (12) and Ollama Cloud (26). Tavily usage validation passed. All numbered slots imported, including the extra Google slot. Tests covered duplicate detection, six protected credentials for one provider, atomic replacement and cooldown.
- Free and Efficient completed through OpenRouter at zero reported inference cost. Super ran with a fixture rating. The release app skipped an unpriced primary under a zero spending ceiling and streamed through the eligible fallback. Super uses recorded ratings and suitability filters. Task-specific benchmarking and the optional ambiguous-turn cloud classifier remain open. Model-specific reasoning and incompatibility checks have contract coverage.
- Nemotron 3.5 Super VL completed live text, document and image turns in 1.62–5.10 s end to end with 483–6,495 input tokens. The image answer identified a red square. The document answer cited the correct date and original passage. Earlier Liquid and Gemma requests returned HTTP 429 and HTTP 400 respectively. The cooldown stopped further requests against the limited provider without rotating keys.
- Live Tavily research answered a Rust ownership question in 11.01 s. Both displayed links came from retrieved sources. The current Rust Book supported the answer. The second link was a redundant older mirror. The pipeline bounds parallel queries, adds a follow-up for thin complex results and flags candidate numerical conflicts. Local tests reject invented references. Broader claim support, research quality and injection resistance still need evaluation. [Tavily Search API](https://docs.tavily.com/documentation/api-reference/endpoint/search) · [Tavily billing](https://help.tavily.com/articles/8298987937-billing-credits-usage-limits) · [Rust Book source](https://doc.rust-lang.org/book/ch04-01-what-is-ownership.html)
- The WebView checks exercised TXT, PDF, DOCX, XLSX, PPTX and PNG, archive traversal rejection, original file storage, previews and draft persistence. File selection, a WebView drop event, large-text paste and chip removal passed. Scanned PDF OCR and broad image compatibility across providers remain open. Physical Explorer drag is an owner check.
- Rich responses use Markdown, highlighted copyable code, KaTeX, Mermaid and bounded native templates for tables, comparisons, charts, timelines, calculators, checklists and sliders. The desktop fixture verified filtering, persisted component state and rejection of an unsupported JavaScript component. Profile and response preferences persist independently of the model selection. Persona adherence varies by model. [OpenAI UI component architecture](https://developers.openai.com/plugins/build/chatgpt-ui) · [Mermaid strict mode](https://mermaid.js.org/config/schema-docs/config-properties-securitylevel.html)

## LRA and performance

The live Clear Chat check recovered the owner and date of Juniper from before the display boundary. An automated check verified the boundary after restart and original source access. The live memory sequence learned the work drink and Cedar deadline, corrected the drink, then retained the deadline after forgetting the drink. Two replies incorrectly implied that a redacted preference had never been stated. The prompt was tightened to distinguish missing evidence from missing history.

On the final release, two zero-cost OpenRouter models both withheld the forgotten preference and cited the correct original Cedar deadline. Both still used the phrase “no record,” which can be read more broadly than unavailable evidence. Super VL took 4.23 s (1,259 input and 708 output/reasoning tokens). Lightning took 37.14 s (1,347 input and 1,682 output/reasoning tokens) on the repeated question with the next turn's context. These are individual observations, with no general latency ranking implied.

Four token compaction cycles retained all four tested project facts at three budgets per fact, with 12 of 12 expected values present in context and all original source records intact. Idle compaction, superseded memory, forget isolation, delayed-job prevention and interruption recovery also passed. Lexical retrieval still misses some paraphrases. The small set does not establish a production hallucination rate.

| Warm-cache probe (100,001 records) | Retrieval p95 | Packing p95 | Prior Tauri retrieval / packing p95 |
|---|---:|---:|---:|
| Specific lookup | 0.78 ms | 0.14 ms | 0.98 / 0.25 ms |
| Broad lookup | 46.37 ms | 1.74 ms | 52.65 / 3.70 ms |

The 8K, 16K and 32K probes kept the original source and carried 5, 11 and 22 recent long messages respectively. Timing excludes provider, UI and file extraction. Differences between runs are observations from one machine.

## Test and screenshot evidence

- `npm test` passed 50 Rust tests. Clippy passed with warnings denied. `npm run test:slice02` passed in actual Tauri with isolated data and a loopback fixture. The legacy billable Groq suite was left for a budgeted run.
- `node tests/ui-motion.cjs` checked hover, pin persistence, keyboard navigation, tooltips, smaller windows and reduced motion. The release check verified real streaming, fallback, restart, source-backed memory and local fonts. Six app screenshots covering Conversation, Memories and Settings in light and dark are in `.oscar/slice02-evidence/release/`. Provider, Personalization and rich conversation captures are in `.oscar/slice02-evidence/`, with a 760×700 provider capture. Screen reader testing remains open.
- Local receipts sit beside the screenshots. The optimized executable is 26.48 MiB and the installer is 9.39 MiB. The release fallback reported 559 input tokens, 30 output/reasoning tokens and $0 inference cost. The 100K-record probe writes `.oscar/tauri-evidence/performance.json`. Generated evidence and user data stay outside Git.
