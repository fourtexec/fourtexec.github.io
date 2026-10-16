/* fourtexec — background layer: real content, drifting.
   ----------------------------------------------------------------
   the page background is made of the crew's own material, not
   decoration. it streams four kinds of line, all of it real:

     COMMIT    subjects pulled live from github (api.github.com)
     REPO      the repo ledger: name, stars, language, last push
     CREW      names + roles straight out of config.yaml
     UXAORO    feature lines from uxaoro/news/news.md
     MANIFESTO the tagline and description from config.yaml
     UPTIME    a live counter since the org's first commit

   it drifts upward in columns. anything overlapping the centred
   content column is dimmed so it never fights the text you came
   to read. hover a line and the stream pauses so you can read it;
   click it and you go to the commit / repo on github.

   the api is public and unauthenticated (60 requests an hour per
   ip), so responses are cached in localStorage for 15 minutes and
   everything degrades quietly: no network, rate limited, or
   offline just means fewer lines, drawn from what's already here.

   below 900px the streams switch off — drifting text behind a
   phone-width column hurts readability, so embers take over.
*/

"use strict";

(function () {
  var canvas = document.getElementById("bg-canvas");
  if (!canvas || !canvas.getContext) return;
  var ctx = canvas.getContext("2d");
  if (!ctx) return;

  /* ── tunables ───────────────────────────────────────────────── */
  var OWNER = "fourtexec";
  var REPOS_URL =
    "https://api.github.com/orgs/" + OWNER + "/repos?per_page=100&sort=pushed";
  var COMMITS_URL = function (repo) {
    return "https://api.github.com/repos/" + OWNER + "/" + repo + "/commits?per_page=3";
  };
  var MAX_REPOS = 4; // how many repos we pull commits for
  var LOCAL_FILES = ["config.yaml", "uxaoro/news/news.md"];
  var CACHE_KEY = "fourtexec-bg-v1";
  var TTL = 15 * 60 * 1000; // 15 minutes, keeps us well inside the rate limit

  var TEXT_MIN_W = 900; // narrower than this: embers only
  var CONTENT_W = 920; // must match .wrap in style.css
  var COL_W = 240;
  var PITCH = 84; // vertical distance between lines; more air = calmer
  var SPEED = 11; // px per second, upward
  var MONO = '"Courier New", ui-monospace, Menlo, Consolas, monospace';
  var F_TEXT = 11;
  var F_META = 9;

  // one-character marker per kind, drawn in the accent colour
  var MARK = {
    commit: "\u203A",
    repo: "\u25C6",
    about: "\u00B7",
    crew: "@",
    project: "\u25B8",
    quote: "\u201C",
    step: "\u00B7",
    fact: "\u00B7",
    uptime: "\u2191"
  };
  var LABEL = {
    commit: "commit",
    repo: "repo",
    about: "about",
    crew: "crew",
    project: "shipped",
    quote: "manifesto",
    step: "how to join",
    fact: "uxaoro",
    uptime: "uptime"
  };
  // used only if both the network and the local files are unavailable
  var FALLBACK = [
    { kind: "quote", text: "one terminal and zero meetings" },
    { kind: "crew", text: "four humans, four keyboards" },
    {
      kind: "project",
      text: "uxaoro",
      meta: "beta",
      url: "https://github.com/fourtexec/uxaoro"
    },
    { kind: "fact", text: "end-to-end encrypted wire \u2014 AES-256-GCM + RSA-OAEP-2048" }
  ];

  /* ── state ──────────────────────────────────────────────────── */
  var W = 0, H = 0;
  var colors = pickColors();
  var items = [];
  var cols = [];
  var embers = [];
  var hit = []; // clickable boxes rebuilt every frame
  var showText = false;
  var hovered = null; // {data}
  var mx = -9999, my = -9999;
  var mouse = { x: -9999, y: -9999 };
  var raf = null, last = 0;
  var since = null; // first commit date, drives the uptime line
  var reduced = mq("(prefers-reduced-motion: reduce)");
  var fine = mq("(pointer: fine)");

  function mq(q) {
    return window.matchMedia
      ? window.matchMedia(q)
      : { matches: false, addEventListener: function () {} };
  }
  function pickColors() {
    // rgb triplets; alpha gets added per line. keep in sync with style.css
    return document.documentElement.dataset.theme === "light"
      ? { acc: "184, 72, 13", ink: "34, 27, 18", fnt: "111, 97, 82" }
      : { acc: "232, 118, 45", ink: "240, 231, 213", fnt: "126, 112, 89" };
  }
  function rgba(rgb, a) {
    return "rgba(" + rgb + ", " + (a > 1 ? 1 : a < 0 ? 0 : a).toFixed(3) + ")";
  }

  /* ── small helpers ──────────────────────────────────────────── */
  function pad2(n) {
    return (n < 10 ? "0" : "") + n;
  }
  function firstLine(s) {
    return String(s == null ? "" : s).split("\n")[0].replace(/\s+/g, " ").trim();
  }
  function shortName(full) {
    var i = String(full || "").indexOf("/");
    return i > -1 ? full.slice(i + 1) : full;
  }
  function relTime(iso) {
    var t = Date.parse(iso);
    if (!t) return "";
    var s = (Date.now() - t) / 1000;
    if (s < 90) return "just now";
    var m = Math.round(s / 60);
    if (m < 60) return m + "m ago";
    var h = Math.round(m / 60);
    if (h < 24) return h + "h ago";
    var d = Math.round(h / 24);
    if (d < 30) return d + "d ago";
    var mo = Math.round(d / 30);
    return mo < 12 ? mo + "mo ago" : Math.round(mo / 12) + "y ago";
  }
  function uptimeText() {
    if (!since) return "up ?";
    var t = Date.parse(since);
    if (!t) return "up ?";
    var s = Math.max(0, (Date.now() - t) / 1000);
    var d = Math.floor(s / 86400);
    s -= d * 86400;
    var h = Math.floor(s / 3600);
    s -= h * 3600;
    var m = Math.floor(s / 60);
    return "up " + d + "d " + pad2(h) + ":" + pad2(m) + ":" + pad2(Math.floor(s % 60));
  }

  /* ── content: fetching ──────────────────────────────────────── */
  function getJSON(url) {
    return fetch(url, {
      headers: { Accept: "application/vnd.github+json" }
    }).then(function (r) {
      if (!r.ok) throw new Error("http " + r.status);
      return r.json();
    });
  }
  function getText(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error("http " + r.status);
      return r.text();
    });
  }
  function readCache() {
    try {
      var raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      var o = JSON.parse(raw);
      if (!o || !o.t || Date.now() - o.t > TTL) return null;
      return o;
    } catch (e) {
      return null;
    }
  }
  function writeCache(o) {
    try {
      o.t = Date.now();
      localStorage.setItem(CACHE_KEY, JSON.stringify(o));
    } catch (e) {}
  }

  /* ── content: parsing ───────────────────────────────────────── */
  function parseRepos(repos, out) {
    (repos || []).forEach(function (r) {
      if (!r || !r.name) return;
      if (r.created_at && (!since || r.created_at < since)) since = r.created_at;
      if (r.fork) return;
      out.push({
        kind: "repo",
        text: r.name,
        meta: "\u2605" + r.stargazers_count + " \u00B7 " + (r.language || "\u2014"),
        when: relTime(r.pushed_at),
        url: r.html_url
      });
      if (r.description) {
        out.push({ kind: "about", text: firstLine(r.description), meta: r.name });
      }
    });
  }

  function parseCommits(repo, list, out) {
    (list || []).forEach(function (c) {
      if (!c || !c.commit) return;
      var msg = firstLine(c.commit.message);
      if (!msg) return;
      var who = c.commit.author ? c.commit.author.name : "";
      out.push({
        kind: "commit",
        text: msg,
        meta: (c.sha || "").slice(0, 7) + (who ? " \u00B7 " + who : ""),
        when: relTime(c.commit.author ? c.commit.author.date : ""),
        url: "https://github.com/" + OWNER + "/" + repo + "/commit/" + c.sha
      });
    });
  }

  // config.yaml is already fetched by app.js, so this is a cache hit.
  // we reuse app.js's yaml reader when it's there rather than guess again.
  function parseConfig(text, out) {
    if (!text) return;
    var cfg = null;
    try {
      cfg = window.parseYAML ? window.parseYAML(text) : null;
    } catch (e) {
      cfg = null;
    }
    if (!cfg) return;
    if (cfg.site && cfg.site.tagline) {
      out.push({ kind: "quote", text: firstLine(cfg.site.tagline) });
    }
    if (cfg.site && cfg.site.description) {
      // split into sentences. deliberately no regex lookbehind here:
      // (?<=...) is a hard syntax error on older safari and would take
      // the whole file down with it.
      var sentences =
        String(cfg.site.description)
          .replace(/\s+/g, " ")
          .match(/[^.!?]+[.!?]?/g) || [];
      sentences.forEach(function (s) {
        s = s.trim();
        if (s.length > 18 && s.length < 130) out.push({ kind: "quote", text: s });
      });
    }
    (cfg.team || []).forEach(function (m) {
      if (m && m.name) {
        out.push({ kind: "crew", text: m.name + (m.role ? " \u2014 " + m.role : "") });
      }
    });
    (cfg.projects || []).forEach(function (p) {
      if (!p || !p.name) return;
      out.push({
        kind: "project",
        text: p.name,
        meta: (p.tags || []).join(" \u00B7 "),
        url: p.link
      });
    });
    (cfg.join && cfg.join.steps ? cfg.join.steps : []).forEach(function (s) {
      var t = firstLine(s);
      if (t.length > 12) out.push({ kind: "step", text: t });
    });
  }

  function parseNews(text, out) {
    if (!text) return;
    text.split("\n").forEach(function (raw) {
      var line = raw.trim();
      var m = /^[-*]\s+\*\*(.+?)\*\*\s*:?\s*(.*)$/.exec(line);
      if (!m) return;
      var head = m[1].replace(/\*\*/g, "").trim();
      var rest = m[2].replace(/\*\*/g, "").replace(/\s+/g, " ").trim();
      if (!head) return;
      out.push({ kind: "fact", text: rest ? head + " \u2014 " + rest : head });
    });
  }

  function dedupe(list) {
    var seen = Object.create(null), out = [];
    list.forEach(function (it) {
      if (!it.text) return;
      var k = it.kind + "|" + it.text.toLowerCase();
      if (seen[k]) return;
      seen[k] = 1;
      out.push(it);
    });
    return out;
  }

  /* ── content: assembling ────────────────────────────────────── */
  function loadGitHub() {
    var cached = readCache();
    if (cached) return Promise.resolve(cached);
    return getJSON(REPOS_URL)
      .catch(function () {
        return [];
      })
      .then(function (repos) {
        var names = (repos || [])
          .filter(function (r) {
            return r && !r.fork && r.name;
          })
          .slice(0, MAX_REPOS)
          .map(function (r) {
            return r.name;
          });
        // one request per repo, all in parallel; a 403 or an offline
        // tab just yields an empty list and we carry on with local content
        return Promise.all(
          names.map(function (n) {
            return getJSON(COMMITS_URL(n)).catch(function () {
              return [];
            });
          })
        ).then(function (lists) {
          var data = { repos: repos || [], commits: {} };
          names.forEach(function (n, i) {
            data.commits[n] = lists[i] || [];
          });
          if (data.repos.length) writeCache(data);
          return data;
        });
      });
  }

  function buildItems() {
    return loadGitHub().then(function (data) {
      var out = [];
      parseRepos(data.repos, out);
      Object.keys(data.commits || {}).forEach(function (name) {
        parseCommits(name, data.commits[name], out);
      });
      // local files fill the rest, and still work with no network at all
      return Promise.all(
        LOCAL_FILES.map(function (f) {
          return getText(f).catch(function () {
            return "";
          });
        })
      ).then(function (texts) {
        parseConfig(texts[0], out);
        parseNews(texts[1], out);
        var list = dedupe(out);
        if (!list.length) list = FALLBACK.slice();
        if (since) list.push({ kind: "uptime", text: uptimeText(), meta: "since first commit" });
        return list;
      });
    });
  }

  /* ── layout ─────────────────────────────────────────────────── */
  function fit(s, maxW) {
    s = String(s == null ? "" : s).replace(/\s+/g, " ").trim();
    if (!s) return "";
    if (ctx.measureText(s).width <= maxW) return s;
    var lo = 0, hi = s.length;
    while (lo < hi) {
      var mid = (lo + hi + 1) >> 1;
      if (ctx.measureText(s.slice(0, mid) + "\u2026").width <= maxW) lo = mid;
      else hi = mid - 1;
    }
    return lo > 0 ? s.slice(0, lo).replace(/\s+$/, "") + "\u2026" : "";
  }

  function metaOf(d) {
    var p = [LABEL[d.kind] || d.kind];
    if (d.meta) p.push(d.meta);
    if (d.when) p.push(d.when);
    return p.join(" \u00B7 ");
  }

  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = (Math.random() * (i + 1)) | 0;
      var t = a[i];
      a[i] = a[j];
      a[j] = t;
    }
    return a;
  }

  function makeColumn(x, dim) {
    var pool = shuffle(items.slice());
    var list = [], top = 0, i = 0;
    // repeat the pool until the column is taller than the viewport,
    // so the wrap-around never shows a gap
    while (top < H + PITCH * 2 && i < 500) {
      list.push({ data: pool[i % pool.length], t1: "", t2: "", top: top });
      top += PITCH;
      i++;
    }
    var col = { x: x, dim: dim, list: list, total: top || 1, offset: Math.random() * (top || 1) };
    prepColumn(col);
    return col;
  }

  function prepColumn(col) {
    ctx.font = F_TEXT + "px " + MONO;
    col.list.forEach(function (it) {
      var raw = it.data.kind === "uptime" ? uptimeText() : it.data.text;
      it.t1 = fit(raw, COL_W - 16);
    });
    ctx.font = F_META + "px " + MONO;
    col.list.forEach(function (it) {
      it.t2 = fit(metaOf(it.data), COL_W - 16);
    });
  }

  function buildEmbers(n) {
    embers = [];
    for (var i = 0; i < n; i++) {
      embers.push({
        x: Math.random() * W,
        y: Math.random() * H,
        r: 1 + Math.random() * 1.7,
        vy: 6 + Math.random() * 16,
        sway: 4 + Math.random() * 10,
        phase: Math.random() * 6.283,
        tw: 0.4 + Math.random() * 0.9,
        base: 0.1 + Math.random() * 0.22,
        acc: Math.random() < 0.55,
        px: 0,
        py: 0
      });
    }
  }

  function layout() {
    showText = W >= TEXT_MIN_W && items.length > 0;
    cols = [];
    hit = [];
    hovered = null;
    if (!showText) {
      buildEmbers(W < 640 ? 20 : 30);
      return;
    }
    // ~3 columns at laptop width, 4-5 on a big screen. fewer is calmer:
    // this is a background, not a wall of text.
    var n = Math.max(2, Math.min(5, Math.floor(W / 420)));
    var span = Math.max(0, W - 32 - COL_W);
    var bandL = (W - CONTENT_W) / 2;
    var bandR = bandL + CONTENT_W;
    for (var i = 0; i < n; i++) {
      var x = 16 + (n === 1 ? 0 : (span * i) / (n - 1));
      // dim by how much of the column sits behind the article text
      var ov = Math.max(0, Math.min(x + COL_W, bandR) - Math.max(x, bandL));
      var dim = 1 - 0.72 * (ov / COL_W);
      cols.push(makeColumn(x, dim));
    }
    buildEmbers(14); // a little warmth in the gaps
  }

  /* ── drawing ────────────────────────────────────────────────── */
  function edgeFade(y) {
    // fade lines in at the top of the viewport and out at the bottom
    var f = 1;
    if (y < 70) f = Math.max(0, y + 20) / 90;
    if (y > H - 110) f = Math.min(f, Math.max(0, H - y + 10) / 120);
    return f;
  }

  function drawEmbers(t, dt) {
    for (var i = 0; i < embers.length; i++) {
      var e = embers[i];
      if (dt) {
        e.y -= e.vy * dt;
        var dx = e.x + e.px - mouse.x, dy = e.y + e.py - mouse.y;
        var d = Math.sqrt(dx * dx + dy * dy);
        if (d > 0.01 && d < 130) {
          var f = (1 - d / 130) * 150 * dt;
          e.px += (dx / d) * f;
          e.py += (dy / d) * f;
        }
        var decay = Math.exp(-2.2 * dt);
        e.px *= decay;
        e.py *= decay;
        if (e.y < -20) {
          e.y = H + 16;
          e.x = Math.random() * W;
        }
      }
      var x = e.x + e.px + Math.sin(t * 0.35 + e.phase) * e.sway;
      var y = e.y + e.py;
      var rgb = e.acc ? colors.acc : colors.ink;
      var a = e.base * (0.65 + 0.35 * Math.sin(t * e.tw + e.phase));
      if (a <= 0.004) continue;
      ctx.beginPath();
      ctx.arc(x, y, e.r * 3, 0, 6.2832);
      ctx.fillStyle = rgba(rgb, a * 0.3);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x, y, e.r, 0, 6.2832);
      ctx.fillStyle = rgba(rgb, a);
      ctx.fill();
    }
  }

  function drawItem(col, it, y) {
    var d = it.data;
    var hot = hovered && hovered === d;
    var fade = edgeFade(y);
    var a = (hot ? 0.95 : 0.4 * col.dim) * fade;
    if (a <= 0.012) return;

    var txt = d.kind === "uptime" ? uptimeText() : it.t1;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";

    ctx.font = F_TEXT + "px " + MONO;
    ctx.fillStyle = rgba(colors.acc, hot ? Math.min(1, a + 0.35) : a * 1.15);
    ctx.fillText(MARK[d.kind] || "\u00B7", col.x, y);

    ctx.fillStyle = rgba(colors.ink, a);
    ctx.fillText(txt, col.x + 12, y);

    ctx.font = F_META + "px " + MONO;
    ctx.fillStyle = rgba(colors.fnt, hot ? 0.85 : a * 0.8);
    ctx.fillText(it.t2, col.x + 12, y + 15);

    hit.push({ x: col.x - 4, y: y - 5, w: COL_W, h: 34, data: d });
  }

  function draw(t, dt) {
    ctx.clearRect(0, 0, W, H);
    drawEmbers(t, dt);
    if (!showText) return;
    hit.length = 0;
    for (var c = 0; c < cols.length; c++) {
      var col = cols[c];
      var off = col.offset % col.total;
      for (var i = 0; i < col.list.length; i++) {
        var it = col.list[i];
        var y = it.top - off;
        if (y + PITCH < 0) y += col.total;
        else if (y > H) y -= col.total;
        if (y > H || y + PITCH < 0) continue;
        drawItem(col, it, y);
      }
    }
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    var dt = Math.min(((now - last) / 1000) || 0, 0.05);
    last = now;
    var t = now / 1000;
    // paused while a line is hovered, so it can actually be read
    var moving = !reduced.matches && !hovered;
    if (moving) {
      for (var c = 0; c < cols.length; c++) {
        cols[c].offset = (cols[c].offset + SPEED * dt) % cols[c].total;
      }
    }
    draw(t, moving ? dt : 0);
  }

  function requestDraw() {
    if (reduced.matches && raf === null) draw(performance.now() / 1000, 0);
  }

  /* ── hover, tooltip, click ──────────────────────────────────── */
  var tip = null;
  function tipEl() {
    if (tip) return tip;
    tip = document.createElement("div");
    tip.id = "bg-tip";
    tip.setAttribute("aria-hidden", "true");
    tip.className = "mono";
    document.body.appendChild(tip);
    return tip;
  }

  function renderTip(d) {
    var el = tipEl();
    el.textContent = ""; // commit text is untrusted, so never innerHTML
    var k = document.createElement("span");
    k.className = "tip-kind";
    k.textContent = (LABEL[d.kind] || d.kind).toUpperCase();
    var p = document.createElement("p");
    p.className = "tip-text";
    p.textContent = d.text;
    el.appendChild(k);
    el.appendChild(p);
    if (d.meta || d.when) {
      var m = document.createElement("span");
      m.className = "tip-meta";
      m.textContent = [d.meta, d.when].filter(Boolean).join(" \u00B7 ");
      el.appendChild(m);
    }
    if (d.url) {
      var g = document.createElement("span");
      g.className = "tip-go";
      g.textContent = "click to open \u2197";
      el.appendChild(g);
    }
    el.classList.add("on");
    placeTip();
  }

  function placeTip() {
    if (!tip || !tip.classList.contains("on")) return;
    var w = tip.offsetWidth || 300, h = tip.offsetHeight || 90;
    var x = mx + 16, y = my + 20;
    if (x + w > W - 10) x = mx - w - 16;
    if (x < 10) x = 10;
    if (y + h > H - 10) y = Math.max(10, my - h - 18);
    tip.style.left = Math.round(x) + "px";
    tip.style.top = Math.round(y) + "px";
  }

  function hideTip() {
    if (tip) tip.classList.remove("on");
  }

  function findHit() {
    for (var i = hit.length - 1; i >= 0; i--) {
      var b = hit[i];
      if (mx >= b.x && mx <= b.x + b.w && my >= b.y && my <= b.y + b.h) return b;
    }
    return null;
  }

  function updateHover() {
    if (!showText) return;
    var b = findHit();
    var d = b ? b.data : null;
    if (d === hovered) {
      placeTip();
      return;
    }
    hovered = d;
    if (d) renderTip(d);
    else hideTip();
    canvas.style.cursor = d && d.url ? "pointer" : "default";
    requestDraw();
  }

  canvas.addEventListener("pointermove", function (e) {
    var r = canvas.getBoundingClientRect();
    mx = e.clientX - r.left;
    my = e.clientY - r.top;
    updateHover();
  });
  canvas.addEventListener("pointerleave", function () {
    mx = my = -9999;
    hovered = null;
    hideTip();
    canvas.style.cursor = "default";
    requestDraw();
  });
  canvas.addEventListener("click", function () {
    if (hovered && hovered.url) {
      window.open(hovered.url, "_blank", "noopener,noreferrer");
    }
  });
  // keyboard users can't reach the canvas; esc closes nothing, but
  // leaving the window shouldn't leave a tooltip stranded
  window.addEventListener("blur", function () {
    hovered = null;
    hideTip();
  });

  /* ── cursor spotlight (css side, see style.css) ─────────────── */
  var spotQueued = false;
  window.addEventListener(
    "pointermove",
    function (e) {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
      if (!fine.matches || spotQueued) return;
      spotQueued = true;
      requestAnimationFrame(function () {
        spotQueued = false;
        var s = document.documentElement.style;
        s.setProperty("--mx", mouse.x + "px");
        s.setProperty("--my", mouse.y + "px");
        s.setProperty("--spot", "1");
      });
    },
    { passive: true }
  );
  document.documentElement.addEventListener("pointerleave", function () {
    mouse.x = mouse.y = -9999;
    document.documentElement.style.setProperty("--spot", "0");
  });

  /* ── plumbing ───────────────────────────────────────────────── */
  function resize() {
    var dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    layout();
    requestDraw();
  }

  function start() {
    if (raf !== null || reduced.matches) return;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }
  function stop() {
    if (raf !== null) cancelAnimationFrame(raf);
    raf = null;
  }

  var resizeTimer = null;
  window.addEventListener("resize", function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resize, 150);
  });
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) stop();
    else start();
  });

  if (window.MutationObserver) {
    new MutationObserver(function () {
      colors = pickColors();
      requestDraw();
    }).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"]
    });
  }
  if (reduced.addEventListener) {
    reduced.addEventListener("change", function () {
      stop();
      requestDraw();
      start();
    });
  }

  /* ── go ─────────────────────────────────────────────────────── */
  resize();
  start();
  buildItems()
    .then(function (list) {
      items = list;
      layout();
      requestDraw();
    })
    .catch(function () {
      // nothing loaded at all — the embers from resize() are already up
    });
})();
