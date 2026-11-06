const richRendered = new WeakSet();
RichVendor.mermaid.initialize({
  startOnLoad: false,
  securityLevel: "strict",
  suppressErrorRendering: true,
  maxTextSize: 8000,
  theme: "neutral",
  flowchart: { htmlLabels: false },
  sequence: { useMaxWidth: true },
});
function richNode(tag, text, className) {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = String(text);
  if (className) e.className = className;
  return e;
}
function validateComponent(v) {
  if (
    !v ||
    v.version !== 1 ||
    ![
      "table",
      "chart",
      "comparison",
      "timeline",
      "calculator",
      "checklist",
      "slider",
    ].includes(v.type) ||
    JSON.stringify(v).length > 40000
  )
    throw new Error("Unsupported interactive response");
  if (v.title !== undefined && typeof v.title !== "string")
    throw new Error("Invalid title");
  return v;
}
async function enhanceRich(root, message) {
  if (!root || richRendered.has(root)) return;
  richRendered.add(root);
  let index = 0;
  for (const code of root.querySelectorAll("pre code")) {
    const language =
      [...code.classList].find((c) => c.startsWith("language-"))?.slice(9) ||
      "";
    const pre = code.parentElement;
    const source = code.textContent;
    if (language === "oscar-ui") {
      if (settings?.rich_ui === false) continue;
      try {
        const v = validateComponent(JSON.parse(source));
        const component = await renderComponent(
          v,
          message,
          `component-${index++}`,
        );
        if (root.isConnected) pre.replaceWith(component);
      } catch {
        pre.before(
          richNode(
            "small",
            "Interactive content unavailable; original data shown.",
            "secondary",
          ),
        );
      }
      continue;
    }
    if (
      language === "mermaid" &&
      source.length <= 8000 &&
      source.split("\n").length <= 120
    ) {
      try {
        const { svg } = await RichVendor.mermaid.render(
          `diagram-${message}-${index++}-${Date.now()}`,
          source,
        );
        const figure = richNode("figure", undefined, "diagram");
        figure.innerHTML = DOMPurify.sanitize(svg, {
          USE_PROFILES: { svg: true, svgFilters: true },
          FORBID_TAGS: ["foreignObject", "script"],
          FORBID_ATTR: ["onclick", "onload"],
        });
        figure
          .querySelectorAll("a")
          .forEach((a) => a.replaceWith(...a.childNodes));
        if (root.isConnected) pre.replaceWith(figure);
      } catch {
        pre.before(
          richNode(
            "small",
            "Diagram could not be rendered; source shown.",
            "secondary",
          ),
        );
      }
      continue;
    }
    if (source.length < 50000 && RichVendor.hljs.getLanguage(language)) {
      code.innerHTML = DOMPurify.sanitize(
        RichVendor.hljs.highlight(source, { language, ignoreIllegals: true })
          .value,
      );
    }
    const copy = richNode("button", "Copy", "copy-code");
    copy.onclick = () => {
      navigator.clipboard
        .writeText(source)
        .then(() => {
          copy.textContent = "Copied";
          setTimeout(() => (copy.textContent = "Copy"), 1200);
        })
        .catch(() => {
          copy.textContent = "Select code to copy";
        });
    };
    pre.append(copy);
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT),
    nodes = [];
  while (walker.nextNode())
    if (!walker.currentNode.parentElement.closest("pre,code,svg,.katex"))
      nodes.push(walker.currentNode);
  for (const node of nodes) {
    const pattern =
      /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\((.+?)\\\)|(?<!\\)\$([^$\n]+?)\$/g;
    let match,
      last = 0;
    const fragment = document.createDocumentFragment();
    while ((match = pattern.exec(node.textContent))) {
      fragment.append(node.textContent.slice(last, match.index));
      const math = richNode("span");
      const expression = match[1] || match[2] || match[3] || match[4];
      if (expression.length > 3000) {
        math.textContent = match[0];
      } else {
        try {
          RichVendor.katex.render(expression, math, {
            throwOnError: false,
            trust: false,
            strict: "error",
            displayMode: !!(match[1] || match[2]),
            maxExpand: 200,
            output: "htmlAndMathml",
          });
        } catch {
          math.textContent = match[0];
        }
      }
      fragment.append(math);
      last = pattern.lastIndex;
    }
    if (last) {
      fragment.append(node.textContent.slice(last));
      node.replaceWith(fragment);
    }
  }
}
async function renderComponent(v, message, id) {
  const box = richNode("section", undefined, "rich-component");
  if (v.title) box.append(richNode("h3", v.title));
  let state =
    (await api.componentState({ message, component: id }).catch(() => null)) ||
    {};
  let timer;
  const save = () => {
    clearTimeout(timer);
    timer = setTimeout(
      () =>
        api
          .saveComponentState({ message, component: id, state })
          .catch(() => {}),
      200,
    );
  };
  if (v.type === "table" || v.type === "comparison") {
    const columns = v.columns || [],
      rows = v.rows || v.data || [];
    if (
      !Array.isArray(columns) ||
      columns.length > 15 ||
      !Array.isArray(rows) ||
      rows.length > 300 ||
      rows.some((r) => !Array.isArray(r) || r.length > 15)
    )
      throw new Error("Invalid table");
    const filter = richNode("input");
    filter.type = "search";
    filter.placeholder = "Filter rows";
    filter.setAttribute("aria-label", "Filter " + (v.title || "table"));
    filter.value = state.filter || "";
    const wrap = richNode("div", undefined, "table-scroll"),
      table = richNode("table");
    function draw() {
      table.replaceChildren();
      const head = richNode("thead"),
        tr = richNode("tr");
      columns.forEach((name, i) => {
        const th = richNode("th"),
          b = richNode("button", String(name));
        b.onclick = () => {
          state.direction = state.sort === i ? -state.direction : 1;
          state.sort = i;
          draw();
          save();
        };
        th.append(b);
        tr.append(th);
      });
      head.append(tr);
      table.append(head);
      let displayed = rows.filter((r) =>
        r.join(" ").toLowerCase().includes(filter.value.toLowerCase()),
      );
      if (Number.isInteger(state.sort))
        displayed = [...displayed].sort(
          (a, b) =>
            String(a[state.sort]).localeCompare(
              String(b[state.sort]),
              undefined,
              { numeric: true },
            ) * (state.direction || 1),
        );
      const body = richNode("tbody");
      for (const row of displayed) {
        const tr = richNode("tr");
        for (const cell of row)
          tr.append(richNode("td", String(cell).slice(0, 1200)));
        body.append(tr);
      }
      table.append(body);
    }
    filter.oninput = () => {
      state.filter = filter.value;
      draw();
      save();
    };
    draw();
    wrap.append(table);
    box.append(filter, wrap);
  } else if (v.type === "chart") {
    const data = v.data;
    if (
      !Array.isArray(data) ||
      data.length > 100 ||
      data.some((d) => typeof d.label !== "string" || !Number.isFinite(d.value))
    )
      throw new Error("Invalid chart");
    const ns = "http://www.w3.org/2000/svg",
      svg = document.createElementNS(ns, "svg");
    svg.setAttribute(
      "viewBox",
      `0 0 600 ${Math.max(120, data.length * 33 + 20)}`,
    );
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", v.title || "Chart");
    const max = Math.max(...data.map((d) => Math.abs(d.value)), 1);
    data.forEach((d, i) => {
      const label = document.createElementNS(ns, "text");
      label.setAttribute("x", "0");
      label.setAttribute("y", String(25 + i * 33));
      label.textContent = d.label.slice(0, 22);
      const bar = document.createElementNS(ns, "rect");
      bar.setAttribute("x", "175");
      bar.setAttribute("y", String(10 + i * 33));
      bar.setAttribute("width", String((Math.abs(d.value) / max) * 330));
      bar.setAttribute("height", "20");
      bar.setAttribute("fill", "var(--focus)");
      const value = document.createElementNS(ns, "text");
      value.setAttribute("x", "520");
      value.setAttribute("y", String(25 + i * 33));
      value.textContent = String(d.value);
      svg.append(label, bar, value);
    });
    box.append(svg);
  } else if (v.type === "timeline" || v.type === "checklist") {
    if (!Array.isArray(v.items) || v.items.length > 100)
      throw new Error("Invalid items");
    const list = richNode(v.type === "timeline" ? "ol" : "div");
    v.items.forEach((item, i) => {
      const row = richNode(v.type === "timeline" ? "li" : "label");
      if (v.type === "checklist") {
        const check = richNode("input");
        check.type = "checkbox";
        check.checked = state[i] ?? !!item.checked;
        check.onchange = () => {
          state[i] = check.checked;
          save();
        };
        row.append(
          check,
          document.createTextNode(
            typeof item === "string" ? item : item.text || "",
          ),
        );
      } else
        row.append(
          richNode("strong", item.date || ""),
          richNode("p", item.text || item.label || ""),
        );
      list.append(row);
    });
    box.append(list);
  } else if (v.type === "calculator") {
    if (
      !["sum", "product", "compound", "loan"].includes(v.operation) ||
      !Array.isArray(v.inputs) ||
      v.inputs.length > 8
    )
      throw new Error("Unsupported calculator");
    const values = [];
    const output = richNode("output");
    const calculate = () => {
      const nums = values.map((i) => Number(i.value));
      let result = NaN;
      if (nums.every(Number.isFinite)) {
        if (v.operation === "sum") result = nums.reduce((a, b) => a + b, 0);
        if (v.operation === "product") result = nums.reduce((a, b) => a * b, 1);
        if (v.operation === "compound" && nums.length >= 3)
          result = nums[0] * Math.pow(1 + nums[1] / 100, nums[2]);
        if (v.operation === "loan" && nums.length >= 3) {
          const r = nums[1] / 1200,
            n = nums[2];
          result =
            r === 0 ? nums[0] / n : (nums[0] * r) / (1 - Math.pow(1 + r, -n));
        }
      }
      output.textContent = Number.isFinite(result)
        ? new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 }).format(
            result,
          )
        : "Enter valid values";
      state.values = values.map((i) => i.value);
      save();
    };
    v.inputs.forEach((item, i) => {
      const label = richNode("label", item.label || `Value ${i + 1}`),
        input = richNode("input");
      input.type = "number";
      input.step = "any";
      input.value = state.values?.[i] ?? item.value ?? 0;
      input.oninput = calculate;
      values.push(input);
      label.append(input);
      box.append(label);
    });
    box.append(output);
    calculate();
  } else if (v.type === "slider") {
    if (!Number.isFinite(v.min) || !Number.isFinite(v.max) || v.max <= v.min)
      throw new Error("Invalid slider");
    const label = richNode("label", v.label || "Value"),
      input = richNode("input"),
      output = richNode("output");
    input.type = "range";
    input.min = v.min;
    input.max = v.max;
    input.step = Number.isFinite(v.step) && v.step > 0 ? v.step : 1;
    input.value = state.value ?? v.value ?? v.min;
    const update = () => {
      state.value = Number(input.value);
      output.textContent = input.value;
      save();
    };
    input.oninput = update;
    label.append(input, output);
    box.append(label);
    update();
  }
  return box;
}
