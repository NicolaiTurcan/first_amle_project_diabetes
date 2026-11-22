/* Project site: renders all charts from window.SITE_DATA (see scripts/export_site_data.py). */
(() => {
  "use strict";
  const D = window.SITE_DATA;
  const NS = "http://www.w3.org/2000/svg";
  const $ = (sel) => document.querySelector(sel);
  const pct = (v, d = 1) => `${(v * 100).toFixed(d)}%`;
  const fmt = (v, d = 3) => Number(v).toFixed(d);

  // ---------- Small helpers ----------
  function svgEl(tag, attrs = {}, parent) {
    const node = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    if (parent) parent.appendChild(node);
    return node;
  }

  function htmlEl(tag, attrs = {}, html = "") {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    node.innerHTML = html;
    return node;
  }

  function linear(d0, d1, r0, r1) {
    return (v) => r0 + ((v - d0) / (d1 - d0)) * (r1 - r0);
  }

  // Horizontal bar: square at the baseline (x0), 4px rounded data end
  function hbarPath(x0, y, w, h, r = 4) {
    const sign = w < 0 ? -1 : 1;
    const aw = Math.abs(w);
    r = Math.min(r, aw, h / 2);
    const x1 = x0 + w;
    return [
      `M${x0},${y}`,
      `H${x1 - sign * r}`,
      `Q${x1},${y} ${x1},${y + r}`,
      `V${y + h - r}`,
      `Q${x1},${y + h} ${x1 - sign * r},${y + h}`,
      `H${x0}Z`,
    ].join(" ");
  }

  // Vertical column: square at the baseline, 4px rounded top
  function vbarPath(x, yBase, w, h, r = 4) {
    r = Math.min(r, w / 2, h);
    const yTop = yBase - h;
    return `M${x},${yBase} V${yTop + r} Q${x},${yTop} ${x + r},${yTop} H${x + w - r} Q${x + w},${yTop} ${x + w},${yTop + r} V${yBase} Z`;
  }

  function makeTooltip(container) {
    const tip = htmlEl("div", { class: "tooltip", role: "status" });
    container.appendChild(tip);
    return {
      show(html, x, y) {
        tip.innerHTML = html;
        tip.style.opacity = 1;
        const cw = container.clientWidth;
        const tw = tip.offsetWidth;
        let left = x + 14;
        if (left + tw > cw) left = x - tw - 14;
        tip.style.left = `${Math.max(0, left)}px`;
        tip.style.top = `${Math.max(0, y - tip.offsetHeight - 10)}px`;
      },
      hide() { tip.style.opacity = 0; },
    };
  }

  function ttRow(label, value, color) {
    const dot = color ? `<i style="background:${color}"></i>` : "";
    return `<div class="tt-row"><span>${dot}${label}</span><span>${value}</span></div>`;
  }

  function segmented(container, options, initial, onChange) {
    container.innerHTML = "";
    const buttons = options.map(({ value, label }) => {
      const b = htmlEl("button", { type: "button", "aria-pressed": String(value === initial) }, label);
      b.addEventListener("click", () => {
        buttons.forEach((x) => x.setAttribute("aria-pressed", "false"));
        b.setAttribute("aria-pressed", "true");
        onChange(value);
      });
      container.appendChild(b);
      return b;
    });
  }

  // Re-render charts on resize, since they are drawn to the container's width
  const renderers = [];
  function responsive(fn) {
    renderers.push(fn);
    fn();
  }
  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => renderers.forEach((fn) => fn()), 120);
  });

  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  // ---------- Theme toggle ----------
  $("#theme-toggle").addEventListener("click", () => {
    const root = document.documentElement;
    const isDark = root.dataset.theme
      ? root.dataset.theme === "dark"
      : matchMedia("(prefers-color-scheme: dark)").matches;
    root.dataset.theme = isDark ? "light" : "dark";
    try { localStorage.setItem("theme", root.dataset.theme); } catch (e) { /* storage unavailable */ }
  });

  // ---------- Hero ----------
  const best = D.results.find((r) => r.kind === "best");
  const bestCm = D.confusion[best.name];
  const positives = bestCm.tp + bestCm.fn;
  $("#hero-recall").innerHTML = `${(best.test.recall * 100).toFixed(1)}<small>%</small>`;
  $("#hero-tp").textContent = bestCm.tp;
  $("#hero-pos").textContent = positives;
  const dots = $("#hero-dots");
  for (let i = 0; i < positives; i++) {
    dots.appendChild(htmlEl("span", i < bestCm.tp ? {} : { class: "miss" }));
  }

  // ---------- Stat tiles ----------
  const zerosTotal = Object.values(D.dataset.hidden_zeros_train).reduce((a, b) => a + b, 0);
  const tiles = [
    { label: "Patients", value: D.dataset.rows, sub: `${D.dataset.train_rows} train · ${D.dataset.test_rows} test` },
    { label: "Features", value: D.dataset.features, sub: "Medical measurements" },
    { label: "Have diabetes", value: pct(D.dataset.positive_share), sub: "Class imbalance ~ 1 : 2" },
    { label: "Hidden zeros", value: zerosTotal, sub: "Missing values in training set" },
  ];
  const tileWrap = $("#stat-tiles");
  tiles.forEach((t) => {
    tileWrap.appendChild(htmlEl("div", { class: "card stat reveal" },
      `<div class="label">${t.label}</div><div class="value num">${t.value}</div><div class="sub">${t.sub}</div>`));
  });

  // ---------- Hidden zeros chart (single series, horizontal bars) ----------
  const zerosBox = $("#chart-zeros");
  const zerosTip = makeTooltip(zerosBox);
  responsive(() => {
    zerosBox.querySelectorAll("svg").forEach((n) => n.remove());
    const rows = Object.entries(D.dataset.hidden_zeros_train).sort((a, b) => b[1] - a[1]);
    const W = zerosBox.clientWidth;
    const labelW = W < 480 ? 96 : 120;
    const rowH = 36, barH = 20, pad = { t: 4, r: 56, b: 8 };
    const H = pad.t + rows.length * rowH + pad.b;
    const x = linear(0, 0.5, labelW, W - pad.r);
    const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Share of hidden zeros per column" });
    const g = svgEl("g", { class: "grid" }, svg);
    [0, 0.25, 0.5].forEach((v) => svgEl("line", { x1: x(v), x2: x(v), y1: 0, y2: H - pad.b }, g));
    rows.forEach(([col, count], i) => {
      const share = count / D.dataset.train_rows;
      const y = pad.t + i * rowH + (rowH - barH) / 2;
      svgEl("text", { x: labelW - 12, y: y + barH / 2 + 4, "text-anchor": "end" }, svg).textContent = col;
      svgEl("path", { d: hbarPath(x(0), y, Math.max(2, x(share) - x(0)), barH), fill: css("--accent") }, svg);
      svgEl("text", { x: x(share) + 8, y: y + barH / 2 + 4, class: "value-label" }, svg).textContent = pct(share, 0);
      const hit = svgEl("rect", { x: 0, y: pad.t + i * rowH, width: W, height: rowH, fill: "transparent" }, svg);
      hit.addEventListener("mousemove", (e) => {
        const r = zerosBox.getBoundingClientRect();
        zerosTip.show(`<div class="tt-title">${col}</div>${ttRow("Zeros", `${count} / ${D.dataset.train_rows}`)}${ttRow("Imputed with", D.model.medians[col])}`,
          e.clientX - r.left, e.clientY - r.top);
      });
      hit.addEventListener("mouseleave", zerosTip.hide);
    });
    zerosBox.prepend(svg);
  });

  // ---------- Hypothesis cards ----------
  const units = { BMI: "", Age: " yrs", Glucose: " mg/dL" };
  const hypWrap = $("#hyp-cards");
  D.hypotheses.forEach((h) => {
    hypWrap.appendChild(htmlEl("div", { class: "card hyp reveal" }, `
      <div style="display:flex;justify-content:space-between;align-items:center">
        <span class="code">${h.code} · ${h.feature}</span>
        <span class="verdict">✓ ${h.verdict}</span>
      </div>
      <h3>${h.statement}</h3>
      <div class="medians">
        <div><span><i style="background:var(--series-neg)"></i>No diabetes</span><b class="num">${h.median_neg}${units[h.feature]}</b></div>
        <div><span><i style="background:var(--series-pos)"></i>Diabetes</span><b class="num">${h.median_pos}${units[h.feature]}</b></div>
      </div>
      <div class="pval">Median per group · Mann-Whitney U <span class="num">p = ${h.p_value.toExponential(1)}</span></div>`));
  });

  // ---------- Distribution chart (two series, grouped columns) ----------
  const distBox = $("#chart-dist");
  const distTip = makeTooltip(distBox);
  let distFeature = "Glucose";
  function renderDist() {
    distBox.querySelectorAll("svg").forEach((n) => n.remove());
    const { edges, neg, pos } = D.distributions[distFeature];
    const W = distBox.clientWidth, H = 260;
    const pad = { t: 12, r: 8, b: 34, l: 40 };
    const n = neg.length;
    const yMax = Math.ceil(Math.max(...neg, ...pos) * 20) / 20;
    const y = linear(0, yMax, H - pad.b, pad.t);
    const band = (W - pad.l - pad.r) / n;
    const barW = Math.min(12, (band - 6) / 2);
    const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": `Distribution of ${distFeature} by outcome` });
    const g = svgEl("g", { class: "grid" }, svg);
    for (let v = 0; v <= yMax + 1e-9; v += yMax / 4) {
      svgEl("line", { x1: pad.l, x2: W - pad.r, y1: y(v), y2: y(v) }, g);
      svgEl("text", { x: pad.l - 8, y: y(v) + 4, "text-anchor": "end", class: "axis-label" }, svg).textContent = pct(v, 0);
    }
    const tickEvery = Math.ceil(n / Math.max(4, Math.floor(W / 70)));
    for (let i = 0; i < n; i++) {
      const cx = pad.l + i * band + band / 2;
      // 2px surface gap between the two touching columns
      if (neg[i] > 0) svgEl("path", { d: vbarPath(cx - barW - 1, y(0), barW, y(0) - y(neg[i])), fill: css("--series-neg") }, svg);
      if (pos[i] > 0) svgEl("path", { d: vbarPath(cx + 1, y(0), barW, y(0) - y(pos[i])), fill: css("--series-pos") }, svg);
      if (i % tickEvery === 0) {
        svgEl("text", { x: pad.l + i * band, y: H - pad.b + 18, "text-anchor": "middle", class: "axis-label" }, svg).textContent = edges[i];
      }
      const hit = svgEl("rect", { x: pad.l + i * band, y: pad.t, width: band, height: H - pad.t - pad.b, fill: "transparent" }, svg);
      hit.addEventListener("mousemove", (e) => {
        const r = distBox.getBoundingClientRect();
        distTip.show(`<div class="tt-title">${distFeature} ${edges[i]}–${edges[i + 1]}</div>`
          + ttRow("No diabetes", pct(neg[i]), css("--series-neg")) + ttRow("Diabetes", pct(pos[i]), css("--series-pos")),
          e.clientX - r.left, e.clientY - r.top);
      });
      hit.addEventListener("mouseleave", distTip.hide);
    }
    svgEl("line", { x1: pad.l, x2: W - pad.r, y1: y(0), y2: y(0), class: "baseline" }, svg);
    distBox.prepend(svg);
  }
  segmented($("#dist-toggle"), ["Glucose", "BMI", "Age"].map((v) => ({ value: v, label: v })), distFeature, (v) => {
    distFeature = v;
    renderDist();
  });
  responsive(renderDist);

  // ---------- Model comparison ----------
  const metricNames = { recall: "Recall", f1: "F1", precision: "Precision", accuracy: "Accuracy" };
  const modelsBox = $("#chart-models");
  const modelsTip = makeTooltip(modelsBox);
  let metric = "recall";
  function renderModels() {
    modelsBox.querySelectorAll("svg").forEach((n) => n.remove());
    const W = modelsBox.clientWidth;
    const labelW = W < 520 ? 140 : 180;
    const rowH = 44, barH = 22, pad = { t: 4, r: 64, b: 26 };
    const H = pad.t + D.results.length * rowH + pad.b;
    const x = linear(0, 1, labelW, W - pad.r);
    const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": `${metricNames[metric]} by model` });
    const g = svgEl("g", { class: "grid" }, svg);
    (W < 520 ? [0, 0.5, 1] : [0, 0.25, 0.5, 0.75, 1]).forEach((v) => {
      svgEl("line", { x1: x(v), x2: x(v), y1: 0, y2: H - pad.b }, g);
      svgEl("text", { x: x(v), y: H - 6, "text-anchor": "middle", class: "axis-label" }, svg).textContent = v.toFixed(2);
    });
    D.results.forEach((m, i) => {
      const y = pad.t + i * rowH + (rowH - barH) / 2;
      const test = m.test[metric], train = m.train[metric];
      const label = svgEl("text", { x: labelW - 12, y: y + barH / 2 + 4, "text-anchor": "end" }, svg);
      label.textContent = m.name;
      if (m.kind === "best") label.setAttribute("style", `fill:${css("--text-primary")};font-weight:600`);
      svgEl("path", { d: hbarPath(x(0), y, x(test) - x(0), barH), fill: css("--series-neg"), opacity: m.kind === "baseline" ? 0.55 : 1 }, svg);
      // Train score marker with a 2px surface ring
      svgEl("circle", { cx: x(train), cy: y + barH / 2, r: 5, fill: css("--text-primary"), stroke: css("--surface-1"), "stroke-width": 2 }, svg);
      svgEl("text", { x: Math.max(x(test), x(train)) + 10, y: y + barH / 2 + 4, class: "value-label" }, svg).textContent = fmt(test);
      const hit = svgEl("rect", { x: 0, y: pad.t + i * rowH, width: W, height: rowH, fill: "transparent" }, svg);
      hit.addEventListener("mousemove", (e) => {
        const r = modelsBox.getBoundingClientRect();
        const rows = Object.keys(metricNames).map((k) => ttRow(metricNames[k], `${fmt(m.test[k])} / ${fmt(m.train[k])}`)).join("");
        modelsTip.show(`<div class="tt-title">${m.name}</div><div class="tt-row" style="font-size:11px"><span>Metric</span><span>test / train</span></div>${rows}`,
          e.clientX - r.left, e.clientY - r.top);
      });
      hit.addEventListener("mouseleave", modelsTip.hide);
    });
    svgEl("line", { x1: x(0), x2: x(0), y1: 0, y2: H - pad.b, class: "baseline" }, svg);
    modelsBox.prepend(svg);
  }
  segmented($("#metric-toggle"), Object.entries(metricNames).map(([value, label]) => ({ value, label })), metric, (v) => {
    metric = v;
    renderModels();
  });
  responsive(renderModels);

  // Accessible table view of every score
  const cols = ["recall", "precision", "f1", "accuracy"];
  $("#results-table").innerHTML = `<table>
    <thead><tr><th>Model</th>${cols.map((c) => `<th>Train ${metricNames[c]}</th><th>Test ${metricNames[c]}</th>`).join("")}</tr></thead>
    <tbody>${D.results.map((m) => `<tr class="${m.kind === "best" ? "best" : ""}"><td>${m.name}</td>${cols.map((c) => `<td>${fmt(m.train[c])}</td><td>${fmt(m.test[c])}</td>`).join("")}</tr>`).join("")}</tbody>
  </table>`;

  // ---------- Confusion matrix ----------
  function renderCm(name) {
    const c = D.confusion[name];
    $("#cm").innerHTML = `
      <div></div><div class="h">Predicted<br>healthy</div><div class="h">Predicted<br>diabetes</div>
      <div class="h row">Actually<br>healthy</div>
      <div class="cell tn"><span>True negative</span><b>${c.tn}</b></div>
      <div class="cell fp"><span>False alarm</span><b>${c.fp}</b></div>
      <div class="h row">Actually<br>diabetes</div>
      <div class="cell fn"><span>Missed case</span><b>${c.fn}</b></div>
      <div class="cell tp"><span>Caught</span><b>${c.tp}</b></div>`;
    const pos = c.tp + c.fn;
    $("#cm-notes").innerHTML = `
      <div class="row"><span>Diabetes cases caught</span><b>${c.tp} / ${pos}</b></div>
      <div class="row"><span>Missed cases (false negatives)</span><b style="color:var(--danger)">${c.fn}</b></div>
      <div class="row"><span>False alarms (false positives)</span><b>${c.fp}</b></div>
      <div class="row"><span>Recall</span><b>${pct(c.tp / pos)}</b></div>`;
  }
  const cmOptions = D.results.filter((m) => m.kind !== "baseline").map((m) => ({ value: m.name, label: m.name.replace("LogReg, ", "") }));
  cmOptions[0].label = "Plain";
  segmented($("#cm-toggle"), cmOptions, best.name, renderCm);
  renderCm(best.name);

  // ---------- Threshold curve (three series, line chart with crosshair) ----------
  const thrBox = $("#chart-threshold");
  const thrTip = makeTooltip(thrBox);
  const series = [
    { key: "recall", label: "Recall", color: "--series-neg" },
    { key: "precision", label: "Precision", color: "--series-pos" },
    { key: "f1", label: "F1", color: "--series-3" },
  ];
  responsive(() => {
    thrBox.querySelectorAll("svg").forEach((n) => n.remove());
    const pts = D.threshold_curve;
    const W = thrBox.clientWidth, H = 300;
    const pad = { t: 16, r: 74, b: 34, l: 40 };
    const x = linear(0, 1, pad.l, W - pad.r);
    const y = linear(0, 1, H - pad.b, pad.t);
    const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Recall, precision and F1 versus decision threshold" });
    const g = svgEl("g", { class: "grid" }, svg);
    [0, 0.25, 0.5, 0.75, 1].forEach((v) => {
      svgEl("line", { x1: pad.l, x2: W - pad.r, y1: y(v), y2: y(v) }, g);
      svgEl("text", { x: pad.l - 8, y: y(v) + 4, "text-anchor": "end", class: "axis-label" }, svg).textContent = v.toFixed(2);
    });
    [0, 0.2, 0.4, 0.6, 0.8, 1].forEach((v) => {
      svgEl("text", { x: x(v), y: H - pad.b + 18, "text-anchor": "middle", class: "axis-label" }, svg).textContent = v.toFixed(1);
    });
    svgEl("text", { x: W - pad.r, y: H - 2, "text-anchor": "end", class: "axis-label" }, svg).textContent = "Decision threshold →";

    // Default (0.5) and chosen (0.3) thresholds
    [[0.5, "default 0.5", "--text-muted", 24], [D.model.threshold, "chosen 0.3", "--text-primary", 10]].forEach(([t, txt, c, dy]) => {
      svgEl("line", { x1: x(t), x2: x(t), y1: pad.t, y2: H - pad.b, stroke: css(c), "stroke-width": 1 }, svg);
      svgEl("text", { x: x(t) + 6, y: pad.t + dy, class: "axis-label", style: `fill:${css(c)}` }, svg).textContent = txt;
    });

    // Lines with direct end labels (aqua needs a visible label for contrast relief)
    const ends = series.map((s) => ({ ...s, y: y(pts[pts.length - 1][s.key]) })).sort((a, b) => a.y - b.y);
    for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 14) ends[i].y = ends[i - 1].y + 14;
    series.forEach((s) => {
      const d = pts.map((p, i) => `${i ? "L" : "M"}${x(p.t)},${y(p[s.key])}`).join(" ");
      svgEl("path", { d, fill: "none", stroke: css(s.color), "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }, svg);
      const last = pts[pts.length - 1];
      const ey = ends.find((e) => e.key === s.key).y;
      svgEl("circle", { cx: x(last.t), cy: y(last[s.key]), r: 4, fill: css(s.color), stroke: css("--surface-1"), "stroke-width": 2 }, svg);
      svgEl("text", { x: x(last.t) + 10, y: ey + 4 }, svg).textContent = s.label;
    });

    // Crosshair layer
    const cross = svgEl("line", { y1: pad.t, y2: H - pad.b, stroke: css("--text-muted"), "stroke-width": 1, opacity: 0 }, svg);
    const markers = series.map((s) => svgEl("circle", { r: 5, fill: css(s.color), stroke: css("--surface-1"), "stroke-width": 2, opacity: 0 }, svg));
    const hit = svgEl("rect", { x: pad.l, y: pad.t, width: W - pad.l - pad.r, height: H - pad.t - pad.b, fill: "transparent" }, svg);
    hit.addEventListener("mousemove", (e) => {
      const r = thrBox.getBoundingClientRect();
      const sx = (e.clientX - r.left) * (W / r.width);
      const p = pts.reduce((a, b) => (Math.abs(x(b.t) - sx) < Math.abs(x(a.t) - sx) ? b : a));
      cross.setAttribute("x1", x(p.t)); cross.setAttribute("x2", x(p.t)); cross.setAttribute("opacity", 1);
      markers.forEach((m, i) => { m.setAttribute("cx", x(p.t)); m.setAttribute("cy", y(p[series[i].key])); m.setAttribute("opacity", 1); });
      thrTip.show(`<div class="tt-title">Threshold ${p.t.toFixed(3)}</div>` + series.map((s) => ttRow(s.label, fmt(p[s.key]), css(s.color))).join(""),
        e.clientX - r.left, e.clientY - r.top);
    });
    hit.addEventListener("mouseleave", () => {
      cross.setAttribute("opacity", 0);
      markers.forEach((m) => m.setAttribute("opacity", 0));
      thrTip.hide();
    });
    thrBox.prepend(svg);
  });

  // ---------- Feature importance (diverging bars around zero) ----------
  const impBox = $("#chart-importance");
  const impTip = makeTooltip(impBox);
  const shortName = { DiabetesPedigreeFunction: "Pedigree fn.", BloodPressure: "Blood pressure", SkinThickness: "Skin thickness" };
  responsive(() => {
    impBox.querySelectorAll("svg").forEach((n) => n.remove());
    const rows = D.importance;
    const W = impBox.clientWidth;
    const labelW = 108, rowH = 32, barH = 16, pad = { t: 4, r: 44, b: 26 };
    const H = pad.t + rows.length * rowH + pad.b;
    const maxAbs = Math.max(...rows.map((r) => Math.abs(r.value)));
    const lo = -0.25, hi = Math.ceil(maxAbs * 4) / 4;
    const x = linear(lo, hi, labelW, W - pad.r);
    const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Standardised logistic regression coefficients" });
    const g = svgEl("g", { class: "grid" }, svg);
    for (let v = 0; v <= hi + 1e-9; v += 0.5) {
      svgEl("line", { x1: x(v), x2: x(v), y1: 0, y2: H - pad.b }, g);
      svgEl("text", { x: x(v), y: H - 6, "text-anchor": "middle", class: "axis-label" }, svg).textContent = `+${v.toFixed(1)}`.replace("+0.0", "0");
    }
    rows.forEach((r, i) => {
      const y = pad.t + i * rowH + (rowH - barH) / 2;
      svgEl("text", { x: 0, y: y + barH / 2 + 4 }, svg).textContent = shortName[r.feature] || r.feature;
      const color = r.value >= 0 ? css("--series-pos") : css("--series-neg");
      const w = x(r.value) - x(0);
      svgEl("path", { d: hbarPath(x(0), y, Math.abs(w) < 2 ? Math.sign(w || 1) * 2 : w, barH), fill: color }, svg);
      const vx = r.value >= 0 ? x(r.value) + 6 : x(0) + 6;
      svgEl("text", { x: vx, y: y + barH / 2 + 4, class: "value-label", style: "font-size:11px" }, svg).textContent = (r.value > 0 ? "+" : "") + r.value.toFixed(2);
      const hit = svgEl("rect", { x: 0, y: pad.t + i * rowH, width: W, height: rowH, fill: "transparent" }, svg);
      hit.addEventListener("mousemove", (e) => {
        const b = impBox.getBoundingClientRect();
        impTip.show(`<div class="tt-title">${r.feature}</div>${ttRow("Log-odds / +1 SD", (r.value > 0 ? "+" : "") + r.value.toFixed(3))}${ttRow("Effect", r.value >= 0 ? "raises risk" : "lowers risk")}`,
          e.clientX - b.left, e.clientY - b.top);
      });
      hit.addEventListener("mouseleave", impTip.hide);
    });
    svgEl("line", { x1: x(0), x2: x(0), y1: 0, y2: H - pad.b, class: "baseline" }, svg);
    impBox.prepend(svg);
  });

  // ---------- Try the model ----------
  const M = D.model;
  const sliderSpec = {
    Pregnancies: { label: "Pregnancies", step: 1 },
    Glucose: { label: "Glucose (mg/dL)", step: 1 },
    BloodPressure: { label: "Blood pressure (mm Hg)", step: 1 },
    SkinThickness: { label: "Skin thickness (mm)", step: 1 },
    Insulin: { label: "Insulin (µU/ml)", step: 1 },
    BMI: { label: "BMI", step: 0.1 },
    DiabetesPedigreeFunction: { label: "Diabetes pedigree", step: 0.01 },
    Age: { label: "Age (years)", step: 1 },
  };
  const values = { ...M.medians };
  const slidersBox = $("#sliders");
  const inputs = {};
  M.features.forEach((f) => {
    const spec = sliderSpec[f];
    const id = `s-${f}`;
    const wrap = htmlEl("div", { class: "slider" }, `
      <label for="${id}"><span>${spec.label}</span><output id="${id}-out"></output></label>
      <input type="range" id="${id}" min="${M.min[f]}" max="${M.max[f]}" step="${spec.step}" value="${M.medians[f]}">`);
    slidersBox.appendChild(wrap);
    const input = wrap.querySelector("input");
    inputs[f] = input;
    input.addEventListener("input", () => { values[f] = Number(input.value); predict(); });
  });

  // Threshold tick on the gauge (semicircle, centre 100,100, radius 86)
  const thrAngle = Math.PI * (1 - M.threshold);
  const tick = $("#gauge-thr");
  tick.setAttribute("x1", 100 + 74 * Math.cos(thrAngle)); tick.setAttribute("y1", 100 - 74 * Math.sin(thrAngle));
  tick.setAttribute("x2", 100 + 98 * Math.cos(thrAngle)); tick.setAttribute("y2", 100 - 98 * Math.sin(thrAngle));

  function predict() {
    const z = M.features.reduce((acc, f, i) => acc + M.coef[i] * values[f], M.intercept);
    const p = 1 / (1 + Math.exp(-z));
    M.features.forEach((f) => {
      const d = sliderSpec[f].step < 1 ? (sliderSpec[f].step < 0.1 ? 2 : 1) : 0;
      $(`#s-${f}-out`).textContent = values[f].toFixed(d);
    });
    const flagged = p >= M.threshold;
    const arc = $("#gauge-arc");
    arc.setAttribute("stroke-dasharray", `${(p * 100).toFixed(1)} 100`);
    arc.setAttribute("stroke", flagged ? "var(--danger)" : "var(--good)");
    $("#gauge-val").textContent = pct(p, 0);
    const flag = $("#flag");
    flag.className = `flag ${flagged ? "on" : "off"}`;
    flag.textContent = flagged ? "Flagged for a follow-up test" : "Not flagged";
  }
  $("#reset").addEventListener("click", () => {
    M.features.forEach((f) => { values[f] = M.medians[f]; inputs[f].value = M.medians[f]; });
    predict();
  });
  predict();

  // Theme changes need a redraw, since SVG fills are resolved from CSS variables
  new MutationObserver(() => renderers.forEach((fn) => fn()))
    .observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => renderers.forEach((fn) => fn()));

  // ---------- Reveal on scroll ----------
  const io = "IntersectionObserver" in window
    ? new IntersectionObserver((entries) => entries.forEach((en) => {
      if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); }
    }), { threshold: 0.12 })
    : null;
  document.querySelectorAll(".reveal").forEach((n) => (io ? io.observe(n) : n.classList.add("in")));
})();
