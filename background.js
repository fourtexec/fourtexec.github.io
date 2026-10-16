/* fourtexec — background layer.
   one fixed canvas behind everything: terminal glyphs ($ ~ / > *)
   and embers drifting up and twinkling, nudged away by the cursor.
   the grid + static glows underneath are plain css in style.css;
   this file also feeds the cursor-spotlight css variables.

   friendly by design: follows the dark/light theme, pauses while
   the tab is hidden, caps the particle count + pixel ratio, and
   draws a single still frame on prefers-reduced-motion. */

"use strict";

(function () {
  var canvas = document.getElementById("bg-canvas");
  if (!canvas || !canvas.getContext) return;
  var ctx = canvas.getContext("2d");
  if (!ctx) return;

  var GLYPHS = ["$", "~", "/", ">", "*", "+", "{", "}", ";", "0", "1", "#", "=", "_", "%"];
  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  var finePointer = window.matchMedia("(pointer: fine)");

  var W = 0, H = 0;
  var parts = [];
  var raf = null;
  var last = 0;
  var mouse = { x: -9999, y: -9999 };
  var colors = pickColors();

  function pickColors() {
    // "r, g, b" triplets — alpha gets tacked on per particle.
    // keep in sync with --acc / --tx / --mut in style.css.
    return document.documentElement.dataset.theme === "light"
      ? { acc: "184, 72, 13", ink: "111, 97, 82" }
      : { acc: "232, 118, 45", ink: "240, 231, 213" };
  }

  function spawn(anywhere) {
    var glyph = Math.random() < 0.62;
    return {
      glyph: glyph,
      ch: GLYPHS[(Math.random() * GLYPHS.length) | 0],
      x: Math.random() * W,
      y: anywhere ? Math.random() * H : H + 24,
      size: glyph ? 10 + Math.random() * 11 : 1 + Math.random() * 1.8,
      vy: 6 + Math.random() * 16, // px/s, drifting up
      sway: 4 + Math.random() * 10, // sideways wander, px
      phase: Math.random() * Math.PI * 2,
      tw: 0.4 + Math.random() * 0.9, // twinkle speed
      base: glyph ? 0.05 + Math.random() * 0.1 : 0.1 + Math.random() * 0.22,
      acc: Math.random() < 0.55, // accent orange vs. plain ink
      pushX: 0,
      pushY: 0,
    };
  }

  function build() {
    var cap = W < 640 ? 36 : 78;
    var n = Math.max(24, Math.min(cap, Math.round((W * H) / 24000)));
    parts = [];
    for (var i = 0; i < n; i++) parts.push(spawn(true));
  }

  function resize() {
    var dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    build();
    if (reduced.matches) draw(0);
  }

  function draw(t) {
    ctx.clearRect(0, 0, W, H);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      var x = p.x + p.pushX + Math.sin(t * 0.35 + p.phase) * p.sway;
      var y = p.y + p.pushY;
      var rgb = p.acc ? colors.acc : colors.ink;

      // brighten near the cursor
      var boost = 0;
      var dx = x - mouse.x, dy = y - mouse.y;
      var d2 = dx * dx + dy * dy;
      if (d2 < 16900) boost = (1 - Math.sqrt(d2) / 130) * 0.25;

      var a = p.base * (0.65 + 0.35 * Math.sin(t * p.tw + p.phase)) + boost;
      if (a <= 0.004) continue;

      if (p.glyph) {
        ctx.font = p.size + 'px "Courier New", ui-monospace, Menlo, Consolas, monospace';
        ctx.fillStyle = "rgba(" + rgb + ", " + a.toFixed(3) + ")";
        ctx.fillText(p.ch, x, y);
      } else {
        // ember: soft halo + hot little core
        ctx.beginPath();
        ctx.arc(x, y, p.size * 3, 0, 6.2832);
        ctx.fillStyle = "rgba(" + rgb + ", " + (a * 0.3).toFixed(3) + ")";
        ctx.fill();
        ctx.beginPath();
        ctx.arc(x, y, p.size, 0, 6.2832);
        ctx.fillStyle = "rgba(" + rgb + ", " + a.toFixed(3) + ")";
        ctx.fill();
      }
    }
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    var dt = Math.min((now - last) / 1000 || 0, 0.05);
    last = now;
    var t = now / 1000;
    var decay = Math.exp(-2.2 * dt);

    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      p.y -= p.vy * dt;

      // the cursor gently shoves nearby particles out of the way
      var dx = p.x + p.pushX - mouse.x, dy = p.y + p.pushY - mouse.y;
      var d = Math.sqrt(dx * dx + dy * dy);
      if (d > 0.01 && d < 130) {
        var force = (1 - d / 130) * 150 * dt;
        p.pushX += (dx / d) * force;
        p.pushY += (dy / d) * force;
      }
      p.pushX *= decay;
      p.pushY *= decay;

      if (p.y < -30) parts[i] = spawn(false); // recycle at the bottom
    }
    draw(t);
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

  /* cursor spotlight: feed --mx / --my to the body::after glow */
  var spotQueued = false;
  function onPointer(e) {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
    if (!finePointer.matches || spotQueued) return;
    spotQueued = true;
    requestAnimationFrame(function () {
      spotQueued = false;
      var s = document.documentElement.style;
      s.setProperty("--mx", mouse.x + "px");
      s.setProperty("--my", mouse.y + "px");
      s.setProperty("--spot", "1");
    });
  }

  window.addEventListener("pointermove", onPointer, { passive: true });
  document.documentElement.addEventListener("pointerleave", function () {
    mouse.x = -9999;
    mouse.y = -9999;
    document.documentElement.style.setProperty("--spot", "0");
  });

  var resizeTimer = null;
  window.addEventListener("resize", function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resize, 150);
  });

  document.addEventListener("visibilitychange", function () {
    if (document.hidden) stop();
    else start();
  });

  // theme toggle flips data-theme on <html> — re-tint to match
  if (window.MutationObserver) {
    new MutationObserver(function () {
      colors = pickColors();
      if (reduced.matches) draw(0);
    }).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
  }

  if (reduced.addEventListener) {
    reduced.addEventListener("change", function () {
      stop();
      if (reduced.matches) draw(0);
      else start();
    });
  }

  resize(); // also builds the field (and paints the still frame if reduced)
  start();
})();
