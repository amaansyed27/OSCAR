import mermaid from "mermaid";
import katex from "katex";
import "katex/dist/katex.min.css";
import hljs from "highlight.js/lib/core";
import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import rust from "highlight.js/lib/languages/rust";
import python from "highlight.js/lib/languages/python";
import json from "highlight.js/lib/languages/json";
import xml from "highlight.js/lib/languages/xml";
import css from "highlight.js/lib/languages/css";
import bash from "highlight.js/lib/languages/bash";
import sql from "highlight.js/lib/languages/sql";
for (const [name, language] of Object.entries({
  javascript,
  typescript,
  rust,
  python,
  json,
  xml,
  css,
  bash,
  sql,
}))
  hljs.registerLanguage(name, language);
export { mermaid, katex, hljs };
