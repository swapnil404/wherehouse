/* ==========================================================================
   Wherehouse — validation report mockup

   EVERY NUMBER ON THIS PAGE IS ILLUSTRATIVE. No labelling round has run and
   no model has been scored. The figures exist so the charts can be designed
   against realistic distributions; the pinned band at the top of the page
   says so and is not dismissible.

   What IS real: the metric set, targets and rubric structure from §8.6, and
   the chart forms themselves.
   ========================================================================== */

const NS = "http://www.w3.org/2000/svg";
const S = (t, a = {}) => {
  const e = document.createElementNS(NS, t);
  for (const k in a) e.setAttribute(k, a[k]);
  return e;
};
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

/* seeded so the illustrative geometry is stable across reloads */
let _s = 7;
const R = () => ((_s = (_s * 1103515245 + 12345) & 0x7fffffff), _s / 0x7fffffff);

/* -------------------------------------------------------------------------
   Tooltip — every chart gets one; it enhances, never gates. Each value here
   is also reachable through the card's table view.
   ------------------------------------------------------------------------- */

const tipEl = $("#ctip");
const showTip = (e, html) => {
  tipEl.innerHTML = html;
  tipEl.classList.add("is-on");
  moveTip(e);
};
const moveTip = (e) => {
  const r = tipEl.getBoundingClientRect();
  let x = e.clientX + 15;
  const y = e.clientY - r.height / 2;
  if (x + r.width > innerWidth - 10) x = e.clientX - r.width - 15;
  tipEl.style.left = Math.max(8, x) + "px";
  tipEl.style.top = Math.min(innerHeight - r.height - 8, Math.max(8, y)) + "px";
};
const hideTip = () => tipEl.classList.remove("is-on");

const row = (label, val, c) =>
  `<div class="ctip-r"${c ? ` style="--c:${c}"` : ""}>${c ? "<i></i>" : ""}${label}<span class="sp"></span><b>${val}</b></div>`;

function hoverable(node, html) {
  node.addEventListener("mouseenter", (e) => showTip(e, html));
  node.addEventListener("mousemove", moveTip);
  node.addEventListener("mouseleave", hideTip);
}

/* -------------------------------------------------------------------------
   Illustrative data
   ------------------------------------------------------------------------- */

const SCATTER = Array.from({ length: 30 }, (_, i) => {
  const label = +(1 + R() * 4).toFixed(1);
  const ideal = ((label - 1) / 4) * 100;
  const model = Math.max(5, Math.min(96, ideal + (R() - 0.5) * 32));
  return { id: "S" + String(i + 1).padStart(2, "0"), label, model: +model.toFixed(1) };
});

function centred(n, mean, spread) {
  const raw = Array.from({ length: n }, () => (R() - 0.5) * spread * 2);
  const off = raw.reduce((a, b) => a + b, 0) / n;
  return raw.map((v) => +(mean + v - off).toFixed(1));
}
const GOOD = centred(10, 78.4, 9);
const BAD = centred(10, 40.2, 11);
const GAP = +(78.4 - 40.2).toFixed(1);

const SENS = [
  { name: "Points of interest", v: 3.1 },
  { name: "Demographics", v: 2.4 },
  { name: "Transportation", v: 1.8 },
  { name: "Zoning", v: 1.1 },
  { name: "Flood risk", v: 0.6 },
  { name: "Air quality", v: 0.3 },
];
const SENS_TARGET = 5;

/* expert top-10 and where the model ranks each — 6 land inside 10 => P@10 0.60 */
const P10 = [
  [1, 2],
  [2, 1],
  [3, 7],
  [4, 4],
  [5, 14],
  [6, 9],
  [7, 3],
  [8, 22],
  [9, 11],
  [10, 18],
];

const RUBRIC = [
  [
    "Accessibility",
    "How easily can the catchment population reach the site by car and on foot?",
    0.78,
  ],
  [
    "Demand density",
    "Does the surrounding population support this use at this scale?",
    0.69,
  ],
  [
    "Competitive context",
    "Is the mix of competing and complementary businesses favourable?",
    0.64,
  ],
  [
    "Physical & regulatory fit",
    "Zoning, parcel suitability and flood exposure taken together.",
    0.85,
  ],
  [
    "Overall confidence",
    "Would you shortlist this site for a real client?",
    0.61,
  ],
];

/* -------------------------------------------------------------------------
   KPI row — the form for a handful of headline numbers is stat tiles, not a
   grouped bar chart. Status is icon + label, never colour alone.
   ------------------------------------------------------------------------- */

const ST = {
  ok: ['st-ok', '#i-check', 'pass'],
  warn: ['st-warn', '#i-alert', 'tentative'],
};

const KPIS = [
  ["Spearman ρ", "0.74", "target ≥ 0.70", "ok"],
  ["Precision@10", "0.60", "6 of 10 expert top sites", "ok"],
  ["Separation gap", String(GAP), "target > 35", "ok"],
  ["Krippendorff α", "0.71", "0.80 is the conventional floor", "warn"],
  ["Rank stability", "0.86", "±20% weight perturbation", "ok"],
];

function renderKpis() {
  $("#kpis").innerHTML = KPIS.map(([lbl, val, sub, st]) => {
    const [cls, icon, word] = ST[st];
    return `
      <div class="kpi">
        <div class="kpi-lbl">${lbl}</div>
        <div class="kpi-val num">${val}</div>
        <div class="kpi-sub">
          <span class="st ${cls}">
            <svg width="11" height="11" viewBox="0 0 24 24"><use href="${icon}"/></svg>${word}
          </span>
          ${sub}
        </div>
      </div>`;
  }).join("");
}

/* -------------------------------------------------------------------------
   Chart 1 — scatter: model score vs mean expert label
   Single series, so no legend box: the title already names what is plotted.
   ------------------------------------------------------------------------- */

function renderScatter() {
  const W = 520,
    H = 250,
    L = 46,
    Rp = 14,
    T = 14,
    B = 40;
  const svg = S("svg", { viewBox: `0 0 ${W} ${H}`, width: "100%" });
  const x = (v) => L + ((v - 1) / 4) * (W - L - Rp);
  const y = (v) => H - B - (v / 100) * (H - B - T);

  for (const t of [0, 25, 50, 75, 100]) {
    svg.appendChild(
      S("line", { class: "gridline", x1: L, x2: W - Rp, y1: y(t), y2: y(t) })
    );
    const tx = S("text", { class: "ax-txt", x: L - 8, y: y(t) + 3.5, "text-anchor": "end" });
    tx.textContent = t;
    svg.appendChild(tx);
  }
  for (const t of [1, 2, 3, 4, 5]) {
    const tx = S("text", { class: "ax-txt", x: x(t), y: H - B + 15, "text-anchor": "middle" });
    tx.textContent = t;
    svg.appendChild(tx);
  }
  svg.appendChild(S("line", { class: "ax-line", x1: L, x2: W - Rp, y1: H - B, y2: H - B }));

  // perfect-agreement diagonal
  svg.appendChild(
    S("line", { class: "ref-line", x1: x(1), y1: y(0), x2: x(5), y2: y(100) })
  );
  const rl = S("text", { class: "target-txt", x: x(4.55), y: y(92), "text-anchor": "end" });
  rl.setAttribute("fill", "var(--ink-4)");
  rl.textContent = "perfect agreement";
  svg.appendChild(rl);

  const nx = S("text", { class: "ax-name", x: (L + W - Rp) / 2, y: H - 6, "text-anchor": "middle" });
  nx.textContent = "Mean expert label";
  svg.appendChild(nx);
  const ny = S("text", {
    class: "ax-name",
    x: 0,
    y: 0,
    transform: `translate(11 ${(T + H - B) / 2}) rotate(-90)`,
    "text-anchor": "middle",
  });
  ny.textContent = "Model score";
  svg.appendChild(ny);

  for (const p of SCATTER) {
    const g = S("g");
    g.appendChild(
      S("circle", { class: "dot", cx: x(p.label), cy: y(p.model), r: 4.5, fill: "var(--seq-4)" })
    );
    // hit target well beyond the 8px mark
    const hit = S("circle", { class: "dot-hit", cx: x(p.label), cy: y(p.model), r: 13 });
    g.appendChild(hit);
    hoverable(
      hit,
      `<div class="ctip-t">Site ${p.id}</div>` +
        row("Expert label", p.label.toFixed(1)) +
        row("Model score", p.model.toFixed(1))
    );
    svg.appendChild(g);
  }

  mount("card-scatter", svg, tableFor(
    ["Site", "Expert label", "Model score"],
    SCATTER.map((p) => [p.id, p.label.toFixed(1), p.model.toFixed(1)])
  ));
}

/* -------------------------------------------------------------------------
   Chart 2 — sanity separation: two strip plots with mean markers
   Two series on screen, so the legend in the markup is mandatory.
   ------------------------------------------------------------------------- */

function renderSeparation() {
  const W = 520,
    H = 196,
    L = 96,
    Rp = 18,
    T = 18;
  const svg = S("svg", { viewBox: `0 0 ${W} ${H}`, width: "100%" });
  const x = (v) => L + (v / 100) * (W - L - Rp);
  const rows = [
    { label: "Known-good", data: GOOD, y: 48, c: "var(--div-hot)" },
    { label: "Bad points", data: BAD, y: 108, c: "var(--div-cold)" },
  ];

  for (const t of [0, 25, 50, 75, 100]) {
    svg.appendChild(S("line", { class: "gridline", x1: x(t), x2: x(t), y1: T, y2: 136 }));
    const tx = S("text", { class: "ax-txt", x: x(t), y: 152, "text-anchor": "middle" });
    tx.textContent = t;
    svg.appendChild(tx);
  }
  svg.appendChild(S("line", { class: "ax-line", x1: L, x2: W - Rp, y1: 136, y2: 136 }));

  for (const r of rows) {
    const lb = S("text", { class: "ax-name", x: L - 12, y: r.y + 4, "text-anchor": "end" });
    lb.textContent = r.label;
    svg.appendChild(lb);

    r.data.forEach((v, i) => {
      const jy = r.y + ((i % 5) - 2) * 5.4;
      svg.appendChild(
        S("circle", { class: "dot", cx: x(v), cy: jy, r: 4.5, fill: r.c, "fill-opacity": 0.9 })
      );
      const hit = S("circle", { class: "dot-hit", cx: x(v), cy: jy, r: 12 });
      svg.appendChild(hit);
      hoverable(hit, `<div class="ctip-t">${r.label}</div>` + row("Score", v.toFixed(1), r.c));
    });

    const mean = r.data.reduce((a, b) => a + b, 0) / r.data.length;
    svg.appendChild(
      S("line", {
        class: "mean-mk",
        x1: x(mean),
        x2: x(mean),
        y1: r.y - 18,
        y2: r.y + 18,
        stroke: r.c,
      })
    );
    const ml = S("text", { class: "ax-txt", x: x(mean), y: r.y - 24, "text-anchor": "middle" });
    ml.setAttribute("fill", "var(--ink-2)");
    ml.textContent = mean.toFixed(1);
    svg.appendChild(ml);
  }

  // gap bracket between the two means
  const gm = x(BAD.reduce((a, b) => a + b, 0) / 10);
  const gg = x(GOOD.reduce((a, b) => a + b, 0) / 10);
  const by = 172;
  svg.appendChild(S("line", { class: "target-line", x1: gm, x2: gg, y1: by, y2: by }));
  svg.appendChild(S("line", { class: "target-line", x1: gm, x2: gm, y1: by - 4, y2: by + 4 }));
  svg.appendChild(S("line", { class: "target-line", x1: gg, x2: gg, y1: by - 4, y2: by + 4 }));
  const gl = S("text", { class: "target-txt", x: (gm + gg) / 2, y: by - 8, "text-anchor": "middle" });
  gl.textContent = `gap ${GAP} · target > 35`;
  svg.appendChild(gl);

  mount("card-sep", svg, tableFor(
    ["Set", "Score"],
    [...GOOD.map((v) => ["Known-good", v.toFixed(1)]), ...BAD.map((v) => ["Bad point", v.toFixed(1)])]
  ));
}

/* -------------------------------------------------------------------------
   Chart 3 — weight sensitivity: horizontal bars, one series
   Bars <=24px thick, square at the baseline, 4px rounded at the data end.
   ------------------------------------------------------------------------- */

function renderSensitivity() {
  const rowH = 27,
    W = 520,
    L = 124,
    Rp = 46,
    T = 10;
  const H = T + SENS.length * rowH + 34;
  const svg = S("svg", { viewBox: `0 0 ${W} ${H}`, width: "100%" });
  const max = 5.5;
  const x = (v) => L + (v / max) * (W - L - Rp);
  const base = H - 34;

  for (const t of [0, 1, 2, 3, 4, 5]) {
    svg.appendChild(S("line", { class: "gridline", x1: x(t), x2: x(t), y1: T, y2: base }));
    const tx = S("text", { class: "ax-txt", x: x(t), y: base + 15, "text-anchor": "middle" });
    tx.textContent = t;
    svg.appendChild(tx);
  }
  svg.appendChild(S("line", { class: "ax-line", x1: L, x2: W - Rp, y1: base, y2: base }));

  SENS.forEach((d, i) => {
    const y = T + i * rowH + (rowH - 12) / 2;
    const w = x(d.v) - L;
    // rect with a rounded end + a square patch at the baseline
    svg.appendChild(S("rect", { x: L, y, width: Math.max(w, 5), height: 12, rx: 4, fill: "var(--seq-3)" }));
    svg.appendChild(S("rect", { x: L, y, width: 4, height: 12, fill: "var(--seq-3)" }));

    const nm = S("text", { class: "ax-name", x: L - 12, y: y + 9, "text-anchor": "end" });
    nm.textContent = d.name;
    svg.appendChild(nm);

    // value at the bar tip
    const vl = S("text", { class: "ax-txt", x: x(d.v) + 8, y: y + 9.5 });
    vl.setAttribute("fill", "var(--ink)");
    vl.textContent = d.v.toFixed(1);
    svg.appendChild(vl);

    const hit = S("rect", { class: "dot-hit", x: L, y: y - 7, width: W - L - Rp, height: 26 });
    svg.appendChild(hit);
    hoverable(
      hit,
      `<div class="ctip-t">${d.name}</div>` +
        row("Mean |Δrank|", d.v.toFixed(1), "var(--seq-3)") +
        row("Perturbation", "±20%")
    );
  });

  svg.appendChild(
    S("line", { class: "target-line", x1: x(SENS_TARGET), x2: x(SENS_TARGET), y1: T, y2: base })
  );
  const tl = S("text", {
    class: "target-txt",
    x: x(SENS_TARGET) - 6,
    y: T + 11,
    "text-anchor": "end",
  });
  tl.textContent = "stability threshold";
  svg.appendChild(tl);

  const nx = S("text", { class: "ax-name", x: (L + W - Rp) / 2, y: H - 6, "text-anchor": "middle" });
  nx.textContent = "Mean absolute rank shift";
  svg.appendChild(nx);

  mount("card-sens", svg, tableFor(
    ["Layer", "Mean |Δrank|", "Within threshold"],
    SENS.map((d) => [d.name, d.v.toFixed(1), d.v <= SENS_TARGET ? "yes" : "no"])
  ));
}

/* -------------------------------------------------------------------------
   Chart 4 — top-10 overlap as a dumbbell: expert rank -> model rank.
   Before/after per item is a dumbbell, one hue in two shades.
   ------------------------------------------------------------------------- */

function renderP10() {
  const rowH = 22,
    W = 520,
    L = 78,
    Rp = 26,
    T = 20;
  const H = T + P10.length * rowH + 34;
  const svg = S("svg", { viewBox: `0 0 ${W} ${H}`, width: "100%" });
  const maxR = 24;
  const x = (v) => L + ((v - 1) / (maxR - 1)) * (W - L - Rp);
  const base = H - 34;

  for (const t of [1, 5, 10, 15, 20]) {
    svg.appendChild(S("line", { class: "gridline", x1: x(t), x2: x(t), y1: T - 8, y2: base }));
    const tx = S("text", { class: "ax-txt", x: x(t), y: base + 15, "text-anchor": "middle" });
    tx.textContent = t;
    svg.appendChild(tx);
  }
  svg.appendChild(S("line", { class: "ax-line", x1: L, x2: W - Rp, y1: base, y2: base }));

  // the top-10 cutoff is what the metric is actually about
  svg.appendChild(S("line", { class: "target-line", x1: x(10), x2: x(10), y1: T - 14, y2: base }));
  const cl = S("text", { class: "target-txt", x: x(10) + 6, y: T - 7 });
  cl.textContent = "top-10 cutoff";
  svg.appendChild(cl);

  P10.forEach(([er, mr], i) => {
    const y = T + i * rowH + 6;
    const hit = mr <= 10;

    svg.appendChild(
      S("line", {
        x1: x(er),
        x2: x(mr),
        y1: y,
        y2: y,
        stroke: hit ? "var(--seq-2)" : "var(--cat-other)",
        "stroke-width": 2,
        "stroke-linecap": "round",
      })
    );
    svg.appendChild(S("circle", { class: "dot", cx: x(er), cy: y, r: 4.5, fill: "var(--seq-5)" }));
    svg.appendChild(S("circle", { class: "dot", cx: x(mr), cy: y, r: 4.5, fill: "var(--seq-3)" }));

    const nm = S("text", { class: "ax-name", x: L - 12, y: y + 4, "text-anchor": "end" });
    nm.textContent = "Expert #" + er;
    svg.appendChild(nm);

    const hr = S("rect", { class: "dot-hit", x: L - 70, y: y - 11, width: W - L + 60, height: 22 });
    svg.appendChild(hr);
    hoverable(
      hr,
      `<div class="ctip-t">Expert rank #${er}</div>` +
        row("Expert rank", er, "var(--seq-5)") +
        row("Model rank", mr, "var(--seq-3)") +
        row("In model top-10", hit ? "yes" : "no")
    );
  });

  const nx = S("text", { class: "ax-name", x: (L + W - Rp) / 2, y: H - 6, "text-anchor": "middle" });
  nx.textContent = "Rank";
  svg.appendChild(nx);

  mount("card-p10", svg, tableFor(
    ["Expert rank", "Model rank", "In model top-10"],
    P10.map(([e, m]) => [e, m, m <= 10 ? "yes" : "no"])
  ));
}

/* -------------------------------------------------------------------------
   Rubric + per-criterion agreement
   ------------------------------------------------------------------------- */

function renderRubric() {
  $("#rubric").innerHTML = RUBRIC.map(
    ([title, desc, alpha], i) => `
    <div class="rub">
      <div class="rub-n">${i + 1}</div>
      <div>
        <div class="rub-t">${title}</div>
        <div class="rub-d">${desc}</div>
      </div>
      <div class="rub-a">
        <span class="num" style="font-size:12.5px">α ${alpha.toFixed(2)}</span>
        <span class="st ${alpha >= 0.7 ? "st-ok" : "st-warn"}" style="margin-left:6px">
          <svg width="10" height="10" viewBox="0 0 24 24">
            <use href="${alpha >= 0.7 ? "#i-check" : "#i-alert"}"/>
          </svg>${alpha >= 0.7 ? "ok" : "low"}
        </span>
        <div class="rub-bar"><i style="width:${(alpha * 100).toFixed(0)}%"></i></div>
      </div>
    </div>`
  ).join("");
}

/* -------------------------------------------------------------------------
   Plumbing: mount a chart + its table twin, wire the view toggle
   ------------------------------------------------------------------------- */

function tableFor(cols, rows) {
  return `
    <table class="dt is-pad">
      <thead><tr>${cols.map((c) => `<th>${c}</th>`).join("")}</tr></thead>
      <tbody>
        ${rows
          .map(
            (r) =>
              `<tr>${r.map((c, i) => `<td${i ? ' class="num"' : ""}>${c}</td>`).join("")}</tr>`
          )
          .join("")}
      </tbody>
    </table>`;
}

function mount(cardId, svg, tableHtml) {
  const card = document.getElementById(cardId);
  const plot = $(".vcard-plot", card);
  plot.innerHTML = "";
  plot.appendChild(svg);
  $(".vcard-table", card).innerHTML = tableHtml;
}

function wireTwins() {
  $$("[data-twin]").forEach((seg) => {
    const card = document.getElementById(seg.dataset.twin);
    $$("button", seg).forEach((b) =>
      b.addEventListener("click", () => {
        $$("button", seg).forEach((x) => x.classList.remove("is-on"));
        b.classList.add("is-on");
        card.classList.toggle("is-table", b.dataset.view === "table");
      })
    );
  });
}

/* -------------------------------------------------------------------------
   Boot
   ------------------------------------------------------------------------- */

renderKpis();
renderScatter();
renderSeparation();
renderSensitivity();
renderP10();
renderRubric();
wireTwins();
