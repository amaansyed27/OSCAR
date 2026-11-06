# Slice 02 evaluation

Status: in progress. API documentation/contract checks, read-only live validation and actual inference are distinct. No equivalence to established research assistants is claimed.

Baseline: `392efaa` on local and remote main; 23 Rust tests passed before edits. Tauri/WebView2, hover/pin navigation, SQLite history and private configuration are retained. The original configuration digest is checked locally without publishing credentials.

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
| Perplexity | openai | bearer | [Official documentation](https://docs.perplexity.ai/api-reference/chat-completions-post) |
| Moonshot AI | openai | bearer | [Official documentation](https://platform.moonshot.ai/docs/overview) |
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
| Nebius AI Studio | openai | bearer | [Official documentation](https://docs.nebius.com/studio/inference/quickstart) |
| SiliconFlow | openai | bearer | [Official documentation](https://docs.siliconflow.com/en/userguide/quickstart) |

Catalog entries are adapter/configuration definitions, not live-test claims. Custom connections require public HTTPS; local/private/metadata addresses and redirects are blocked, and DNS results are pinned. Restricted Coding Plan credentials are excluded from general chat.

## Evidence so far

- Baseline LRA checks remain passing. The first checkpoint passes 44 Rust tests covering storage, routing, protected credentials, endpoints, request families and streaming. Existing navigation checks pass in the actual Tauri app.
- Read-only live discovery succeeded for Groq (11 models), OpenRouter (422), NVIDIA (84), Google AI Studio (47), Z.ai (12) and Ollama Cloud (26). Tavily usage validation succeeded. Counts are a snapshot, not a fixed model list. All numbered slots were imported, including an extra Google slot beyond the brief.
- These connection checks did not generate paid inference. Eligible-free answer, vision, research, document and full LRA evaluations are pending at this checkpoint.
- Local receipts: ignored `.oscar/slice02-evidence/discovery.json` and `.oscar/motion-evidence/review.json`; no credential values are recorded.

## Pending delivery checks

Live eligible-free inference/routing; document extraction/recall; clear-view continuity; research source support; rich components/state; personalization; 100K+ and repeated compaction; release build/screenshots. Unconfigured specialized products need their endpoint, project/region and credentials before live verification. Availability can change.
