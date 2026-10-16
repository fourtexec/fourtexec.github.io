/* fourtexec — the whole site in one hand-written file.
   no framework, no build step. it fetches config.yaml, parses it
   with the small yaml reader below, and renders five pages:
   home, projects, one page per project, team and join.
   content lives in config.yaml + projects/*.md — not in here. */

"use strict";

/* ================================================================
   tiny yaml reader
   ----------------------------------------------------------------
   covers the subset config.yaml actually uses: nested maps,
   lists of maps, folded/literal blocks (> and |), flow lists
   [a, b], quoted strings, comments. it is not a spec parser —
   if you need anchors or multi-doc files, you have outgrown it.
   ================================================================ */

function stripComment(s) {
  // removes a trailing " # comment" that sits outside any quotes
  var inS = false, inD = false;
  for (var i = 0; i < s.length; i++) {
    var c = s[i];
    if (inD) {
      if (c === "\\") i++;
      else if (c === '"') inD = false;
    } else if (inS) {
      if (c === "'") inS = false;
    } else if (c === '"') inD = true;
    else if (c === "'") inS = true;
    else if (c === "#" && (i === 0 || s[i - 1] === " " || s[i - 1] === "\t")) {
      return s.slice(0, i).replace(/\s+$/, "");
    }
  }
  return s;
}

function splitFlow(s) {
  // splits "a, b, [c, d]" on the commas that are actually top-level
  var parts = [], depth = 0, inS = false, inD = false, cur = "";
  for (var i = 0; i < s.length; i++) {
    var c = s[i];
    if (inD) {
      cur += c;
      if (c === "\\") { cur += s[++i] || ""; }
      else if (c === '"') inD = false;
    } else if (inS) {
      cur += c;
      if (c === "'") inS = false;
    } else if (c === '"') { inD = true; cur += c; }
    else if (c === "'") { inS = true; cur += c; }
    else if (c === "[" || c === "{") { depth++; cur += c; }
    else if (c === "]" || c === "}") { depth--; cur += c; }
    else if (c === "," && depth === 0) { parts.push(cur); cur = ""; }
    else cur += c;
  }
  if (cur.trim() !== "") parts.push(cur);
  return parts;
}

function parseScalar(raw) {
  var s = stripComment(String(raw)).trim();
  if (s === "") return null;
  if (s[0] === "[") {
    var inner = s.replace(/^\[/, "").replace(/\]$/, "");
    if (inner.trim() === "") return [];
    return splitFlow(inner).map(parseScalar);
  }
  if (s[0] === "{") {
    var body = s.replace(/^\{/, "").replace(/\}$/, ""), obj = {};
    if (body.trim() === "") return obj;
    splitFlow(body).forEach(function (pair) {
      var idx = pair.indexOf(":");
      if (idx === -1) return;
      obj[pair.slice(0, idx).trim()] = parseScalar(pair.slice(idx + 1));
    });
    return obj;
  }
  if (s[0] === '"' && s[s.length - 1] === '"') {
    try { return JSON.parse(s); } catch (e) { return s.slice(1, -1); }
  }
  if (s[0] === "'" && s[s.length - 1] === "'") {
    return s.slice(1, -1).replace(/''/g, "'");
  }
  s = stripComment(s).trim();
  if (s === "" || s === "~" || s === "null" || s === "Null" || s === "NULL") return null;
  if (s === "true" || s === "True") return true;
  if (s === "false" || s === "False") return false;
  if (/^-?\d+$/.test(s)) return parseInt(s, 10);
  if (/^-?\d*\.\d+$/.test(s)) return parseFloat(s);
  return s;
}

// finds the ": " that separates a key from its value (quotes ignored)
function keyColon(s) {
  var inS = false, inD = false;
  for (var i = 0; i < s.length; i++) {
    var c = s[i];
    if (inD) { if (c === "\\") i++; else if (c === '"') inD = false; }
    else if (inS) { if (c === "'") inS = false; }
    else if (c === '"') inD = true;
    else if (c === "'") inS = true;
    else if (c === ":" && (i === s.length - 1 || s[i + 1] === " ")) return i;
  }
  return -1;
}

function parseYAML(text) {
  var raw = String(text).replace(/\r\n?/g, "\n").split("\n");
  // working list of {indent, text}; blank/comment lines dropped,
  // block scalars read straight from `raw` via line numbers kept here
  var lines = [];
  raw.forEach(function (line, n) {
    var trimmed = line.trim();
    if (trimmed === "" || trimmed[0] === "#" || trimmed === "---" || trimmed === "...") return;
    var indent = line.length - line.replace(/^\s+/, "").length;
    lines.push({ indent: indent, text: line.slice(indent), no: n });
  });

  var pos = 0;

  function readBlockScalar(keyLine, header, parentIndent) {
    // header is ">" or "|" possibly with -/+ chomping
    var folded = header[0] === ">";
    var strip = header.indexOf("-") !== -1;
    var startLine = keyLine.no + 1;
    var collected = [];
    var blockIndent = -1;
    for (var i = startLine; i < raw.length; i++) {
      var line = raw[i];
      if (line.trim() === "") { collected.push(""); continue; }
      var ind = line.length - line.replace(/^\s+/, "").length;
      if (ind <= parentIndent) break;
      if (blockIndent === -1) blockIndent = ind;
      collected.push(line.slice(Math.min(blockIndent, ind)));
    }
    // step the line cursor past everything we just ate
    while (pos < lines.length && lines[pos].no < startLine + collected.length) pos++;
    // trailing blank lines belong to the chomping, not the text
    while (collected.length && collected[collected.length - 1] === "") collected.pop();
    var out;
    if (folded) {
      out = "";
      collected.forEach(function (l, i) {
        if (l === "") { out += "\n"; return; }
        if (i > 0 && collected[i - 1] !== "" && out !== "") out += " ";
        out += l;
      });
    } else {
      out = collected.join("\n");
    }
    return strip ? out : out + "\n";
  }

  function parseBlock(indent) {
    if (pos >= lines.length) return null;
    if (lines[pos].text === "-" || lines[pos].text.indexOf("- ") === 0) return parseList(indent);
    return parseMap(indent);
  }

  function parseMap(indent) {
    var obj = {};
    while (pos < lines.length) {
      var line = lines[pos];
      if (line.indent < indent) break;
      if (line.indent > indent) break; // stray deep line; let caller deal
      if (line.text === "-" || line.text.indexOf("- ") === 0) break;
      var ci = keyColon(line.text);
      if (ci === -1) { pos++; continue; }
      var key = line.text.slice(0, ci).trim();
      if ((key[0] === '"' && key[key.length - 1] === '"') ||
          (key[0] === "'" && key[key.length - 1] === "'")) {
        key = String(parseScalar(key));
      }
      var rest = line.text.slice(ci + 1).trim();
      pos++;
      var header = stripComment(rest).trim(); // ">" may carry a trailing comment
      if (/^[>|][+-]?$/.test(header)) {
        obj[key] = readBlockScalar(line, header, indent);
      } else if (rest !== "") {
        obj[key] = parseScalar(rest);
      } else if (pos < lines.length && lines[pos].indent > indent) {
        obj[key] = parseBlock(lines[pos].indent);
      } else if (pos < lines.length && lines[pos].indent === indent &&
                 (lines[pos].text === "-" || lines[pos].text.indexOf("- ") === 0)) {
        // yaml lets a list sit at the same indent as its key
        obj[key] = parseList(indent);
      } else {
        obj[key] = null;
      }
    }
    return obj;
  }

  function parseList(indent) {
    var arr = [];
    while (pos < lines.length) {
      var line = lines[pos];
      if (line.indent !== indent) break;
      if (!(line.text === "-" || line.text.indexOf("- ") === 0)) break;
      var itemIndent = indent + 2;
      var rest = line.text === "-" ? "" : line.text.slice(2);
      if (rest.trim() === "") {
        pos++;
        arr.push(pos < lines.length && lines[pos].indent >= itemIndent
          ? parseBlock(lines[pos].indent) : null);
        continue;
      }
      var ci = keyColon(rest);
      var firstWord = rest.trim().split(/\s+/)[0];
      if (ci !== -1 && /^[A-Za-z0-9_.-]+$/.test(firstWord.replace(/:$/, "")) && firstWord.indexOf("/") === -1 && firstWord.indexOf("#") === -1 && rest[0] !== '"' && rest[0] !== "'") {
        // "- name: x" — a map whose first pair lives on the dash line.
        // rewrite the line in place and parse it as a map.
        lines[pos] = { indent: itemIndent, text: rest, no: line.no };
        arr.push(parseMap(itemIndent));
      } else {
        arr.push(parseScalar(rest));
        pos++;
      }
    }
    return arr;
  }

  if (!lines.length) return {};
  return parseBlock(lines[0].indent);
}

/* ================================================================
   config loading — fetch, then sort it into the shape pages want
   ================================================================ */

var KNOWN_STATUS = ["active", "beta", "archived"];

function slugify(name) {
  return String(name || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function resolvePath(p) {
  if (!p) return "";
  p = String(p);
  if (/^(https?:)?\/\//.test(p) || p.indexOf("data:") === 0) return p;
  return "./" + p.replace(/^\.\//, "").replace(/^\//, "");
}

function normalizeConfig(c) {
  c = c || {};
  var siteIn = c.site || {};
  var joinIn = c.join || {};
  var footerIn = c.footer || {};

  var projects = (Array.isArray(c.projects) ? c.projects : []).map(function (f) {
    f = f || {};
    var status = KNOWN_STATUS.indexOf(f.status || "") !== -1
      ? f.status
      : (f.status != null ? f.status : "active");
    var out = { tags: [] };
    Object.keys(f).forEach(function (k) { out[k] = f[k]; });
    out.slug = slugify(f.name);
    out.status = status;
    if (!Array.isArray(out.tags)) out.tags = [];
    return out;
  });

  var steps = (Array.isArray(joinIn.steps) ? joinIn.steps : []).map(function (f) {
    if (typeof f === "string") return f;
    if (f && typeof f === "object") {
      return Object.keys(f).map(function (k) { return k + ": " + f[k]; }).join(" — ");
    }
    return String(f == null ? "" : f);
  });

  var join = { title: "join the crew", intro: "", email: "", subject: "", note: "" };
  Object.keys(joinIn).forEach(function (k) { join[k] = joinIn[k]; });
  join.steps = steps;

  var site = {
    name: "fourtexec", tagline: "", description: "",
    command: "cat ./manifesto.txt", status: "nominal", email: ""
  };
  Object.keys(siteIn).forEach(function (k) { site[k] = siteIn[k]; });

  var footer = { note: "", copyright: "" };
  Object.keys(footerIn).forEach(function (k) { footer[k] = footerIn[k]; });

  return {
    site: site,
    socials: Array.isArray(c.socials) ? c.socials : [],
    team: Array.isArray(c.team) ? c.team : [],
    projects: projects,
    join: join,
    footer: footer
  };
}

function loadConfig() {
  return fetch(resolvePath("config.yaml") + "?v=" + Date.now())
    .then(function (res) {
      if (!res.ok) throw new Error("config.yaml → HTTP " + res.status);
      return res.text();
    })
    .then(function (text) { return normalizeConfig(parseYAML(text)); });
}

/* ================================================================
   markdown — the small subset the project pages use.
   html is escaped first, then the markup rules run on top.
   ================================================================ */

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

var INLINE_RE = /(!\[([^\]]*)\]\(([^\s)]+)\))|(\[([^\]]+)\]\(([^\s)]+)\))|(`([^`]+)`)|(\*\*([^*]+)\*\*)|(__([^_]+)__)|(~~([^~]+)~~)|(\*([^*\n]+)\*)|(_([^_\n]+)_)/g;

function inlineMd(text) {
  return esc(text).replace(INLINE_RE, function (m, _img, alt, imgSrc, _link, linkText, linkHref, _code, code, _b1, b1, _b2, b2, _del, del, _i1, i1, _i2, i2) {
    if (imgSrc !== undefined) return '<img src="' + imgSrc + '" alt="' + alt + '" loading="lazy">';
    if (linkHref !== undefined) return '<a href="' + linkHref + '" target="_blank" rel="noreferrer">' + linkText + "</a>";
    if (code !== undefined) return '<code class="ic">' + code + "</code>";
    if (b1 !== undefined || b2 !== undefined) return "<strong>" + (b1 !== undefined ? b1 : b2) + "</strong>";
    if (del !== undefined) return '<s class="del">' + del + "</s>";
    if (i1 !== undefined || i2 !== undefined) return "<em>" + (i1 !== undefined ? i1 : i2) + "</em>";
    return m;
  });
}

var codeBlocks = []; // fenced blocks of the page being rendered, for copy buttons

function renderMarkdown(src) {
  codeBlocks = [];
  var lines = String(src || "").replace(/\r/g, "").split("\n");
  var out = [];
  var i = 0;

  function isBlockStart(l) {
    return /^#{1,6}\s/.test(l) || /^```/.test(l) ||
      /^\s*([-*+]|\d+\.)\s+/.test(l) || /^>\s?/.test(l) ||
      /^(---|\*\*\*|___)\s*$/.test(l);
  }

  while (i < lines.length) {
    var line = lines[i];

    if (line.trim() === "" || /^\s*<!--/.test(line)) { i++; continue; }

    var fence = line.match(/^```(\w*)/);
    if (fence) {
      var buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++; // closing fence
      var idx = codeBlocks.push(buf.join("\n")) - 1;
      out.push(
        '<div class="codeblock"><div class="codeblock-head">' +
        '<span class="code-lang"><span class="status-dot"></span>' + esc(fence[1] || "text") + "</span>" +
        '<button type="button" class="copy-btn" data-copy="' + idx + '">copy</button></div>' +
        "<pre>" + esc(buf.join("\n")) + "</pre></div>"
      );
      continue;
    }

    if (/^(---|\*\*\*|___)\s*$/.test(line)) { out.push("<hr>"); i++; continue; }

    var h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      var lvl = h[1].length;
      var tag = lvl === 1 ? "h1" : lvl === 2 ? "h2" : lvl === 3 ? "h3" : "h4";
      out.push("<" + tag + '><span class="hash">' + h[1] + "</span>" + inlineMd(h[2]) + "</" + tag + ">");
      i++;
      continue;
    }

    if (/^>\s?/.test(line)) {
      var quote = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) quote.push(lines[i++].replace(/^>\s?/, ""));
      out.push("<blockquote>" + quote.map(inlineMd).join("<br>") + "</blockquote>");
      continue;
    }

    if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
      var items = [];
      while (i < lines.length) {
        var m = lines[i].match(/^(\s*)([-*+]|\d+\.)\s+(.*)$/);
        if (!m) break;
        items.push({ indent: m[1].length, ordered: /^\d/.test(m[2]), text: m[3] });
        i++;
      }
      var orderedList = items[0].ordered;
      var lis = items.map(function (it, n) {
        var task = it.text.match(/^\[( |x)\]\s+(.*)$/);
        var marker, body;
        if (task) {
          marker = '<span class="taskbox' + (task[1] === "x" ? " done" : "") + '">' + (task[1] === "x" ? "✓" : "·") + "</span>";
          body = task[2];
        } else if (orderedList) {
          marker = '<span class="li-num">' + String(n + 1).padStart(2, "0") + ".</span>";
        } else {
          marker = '<span class="li-num">»</span>';
        }
        return '<li' + (it.indent >= 2 ? ' class="nested"' : "") + ">" + marker + "<span>" + inlineMd(body || it.text) + "</span></li>";
      });
      out.push("<" + (orderedList ? "ol" : "ul") + ">" + lis.join("") + "</" + (orderedList ? "ol" : "ul") + ">");
      continue;
    }

    if (/^\|.*\|\s*$/.test(line.trim())) {
      var rows = [];
      while (i < lines.length && /^\|.*\|\s*$/.test(lines[i].trim())) {
        var cells = lines[i].trim().slice(1, -1).split("|").map(function (c) { return c.trim(); });
        var isSep = cells.every(function (c) { return /^:?-{2,}:?$/.test(c); });
        if (!isSep) rows.push(cells);
        i++;
      }
      var trs = rows.map(function (cells, r) {
        var tds = cells.map(function (c, ci) {
          return '<td' + (ci ? ' class="sep"' : "") + ">" + inlineMd(c) + "</td>";
        }).join("");
        return '<tr' + (r === 0 ? ' class="head-row"' : "") + ">" + tds + "</tr>";
      }).join("");
      out.push('<div class="table-wrap"><table><tbody>' + trs + "</tbody></table></div>");
      continue;
    }

    var para = [];
    while (i < lines.length && lines[i].trim() !== "" && !isBlockStart(lines[i])) para.push(lines[i++]);
    if (para.length) out.push("<p>" + inlineMd(para.join(" ")) + "</p>");
    else i++;
  }

  return '<div class="md">' + out.join("") + "</div>";
}

/* ================================================================
   icons — small inline svgs, drawn once, reused everywhere
   ================================================================ */

function svgWrap(size, inner, filled) {
  return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" ' +
    (filled ? 'fill="currentColor"' : 'fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"') +
    ' aria-hidden="true">' + inner + "</svg>";
}

var BRAND_ICONS = {
  github: '<path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.55v-2.15c-3.2.7-3.87-1.36-3.87-1.36-.52-1.33-1.28-1.68-1.28-1.68-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.19 1.76 1.19 1.03 1.75 2.69 1.25 1.34-.75.4-1.25 1.03-1.54-2.55-.29-5.23-1.28-5.23-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11.1 11.1 0 0 1 5.78 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.41-2.69 5.38-5.25 1.28 1.06.83 1.06 2.18v3.23c0 .3.21.67.8.55A11.51 11.51 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5z"/>',
  telegram: '<path d="M21.9 4.6 18.8 19.3c-.23 1.03-.85 1.28-1.72.8l-4.76-3.51-2.3 2.21c-.25.26-.47.47-.96.47l.35-4.93 8.97-8.1c.39-.35-.08-.54-.6-.2L7.6 13.7 2.83 12.2c-1.04-.32-1.06-1.04.22-1.54l18.67-7.2c.86-.32 1.62.2 1.18 1.14z"/>',
  x: '<path d="M18.9 2.6h3.1l-6.8 7.8L23.2 21.4h-6.3l-4.9-6.4-5.6 6.4H3.3l7.3-8.3L2.8 2.6h6.4l4.4 5.9zm-1.1 16.9h1.7L8.4 4.4H6.6z"/>',
  discord: '<path d="M18.6 5.3A16 16 0 0 0 14.6 4l-.5 1a13 13 0 0 1 3.7 1.8 12.4 12.4 0 0 0-11.6 0A13 13 0 0 1 9.9 5L9.4 4a16 16 0 0 0-4 1.3C2.9 9.1 2.2 12.8 2.5 16.4a16 16 0 0 0 4.9 2.5l1-1.6a10 10 0 0 1-1.6-.8l.4-.3a11.4 11.4 0 0 0 9.6 0l.4.3c-.5.3-1 .6-1.6.8l1 1.6a16 16 0 0 0 4.9-2.5c.4-4.2-.7-7.9-2.9-11.1zM9.7 15.5c-.9 0-1.6-.8-1.6-1.8s.7-1.8 1.6-1.8 1.6.8 1.6 1.8-.7 1.8-1.6 1.8zm4.6 0c-.9 0-1.6-.8-1.6-1.8s.7-1.8 1.6-1.8 1.6.8 1.6 1.8-.7 1.8-1.6 1.8z"/>',
  youtube: '<path d="M23 7.5s-.2-1.6-.9-2.3c-.9-.9-1.9-.9-2.3-1C16.6 4 12 4 12 4s-4.6 0-7.8.2c-.4.1-1.4.1-2.3 1-.7.7-.9 2.3-.9 2.3S.8 9.4.8 11.3v1.4c0 1.9.2 3.8.2 3.8s.2 1.6.9 2.3c.9.9 2 .9 2.5 1 1.8.2 7.6.2 7.6.2s4.6 0 7.8-.3c.4-.1 1.4-.1 2.3-1 .7-.7.9-2.3.9-2.3s.2-1.9.2-3.8v-1.4c0-1.9-.2-3.8-.2-3.8zM9.8 15.1V8.4l6.2 3.4z"/>',
  twitch: '<path d="M4.3 2 2.6 6.4v15.1h5.3V24h3.1l2.5-2.5h3.9L22 16.9V2zm15.6 13.7-2.8 2.8h-4.6l-2.2 2.2v-2.2H5.2V4.2h14.7zM17 7.6h-1.9v5.3H17zm-5.1 0H10v5.3h1.9z"/>'
};

var LINE_ICONS = {
  instagram: '<rect x="2.5" y="2.5" width="19" height="19" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.4" cy="6.6" r="0.6" fill="currentColor" stroke="none"/>',
  linkedin: '<rect x="2.5" y="2.5" width="19" height="19" rx="4"/><path d="M7.5 10.5v6"/><path d="M7.5 7.4v.2"/><path d="M11.5 16.5v-6"/><path d="M11.5 13.2a2.6 2.6 0 0 1 5.2 0v3.3"/>',
  mail: '<rect x="2.5" y="5" width="19" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  rss: '<path d="M4 11a9 9 0 0 1 9 9"/><path d="M4 4a16 16 0 0 1 16 16"/><circle cx="5" cy="19" r="1" fill="currentColor"/>',
  web: '<circle cx="12" cy="12" r="9.5"/><path d="M2.5 12h19"/><path d="M12 2.5c2.7 2.6 4 5.9 4 9.5s-1.3 6.9-4 9.5c-2.7-2.6-4-5.9-4-9.5s1.3-6.9 4-9.5z"/>',
  send: '<path d="m22 2-11 11"/><path d="M22 2 15 22l-4-9-9-4z"/>',
  game: '<path d="M6 9h12a4 4 0 0 1 4 4.4c0 2.5-2 4.6-4.4 4.6-1.4 0-2.7-.7-3.5-1.8H9.9C9.1 17.3 7.8 18 6.4 18 4 18 2 15.9 2 13.4A4.4 4.4 0 0 1 6 9z"/><path d="M7 12v4"/><path d="M5 14h4"/><circle cx="16" cy="13" r="0.6" fill="currentColor" stroke="none"/><circle cx="18" cy="15" r="0.6" fill="currentColor" stroke="none"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.9 4.9 1.4 1.4"/><path d="m17.7 17.7 1.4 1.4"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.3 17.7-1.4 1.4"/><path d="m19.1 4.9-1.4 1.4"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  menu: '<path d="M4 7h16"/><path d="M4 12h16"/><path d="M4 17h16"/>',
  xclose: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  "arrow-right": '<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>',
  "arrow-up-right": '<path d="M7 17 17 7"/><path d="M8 7h9v9"/>',
  "arrow-left": '<path d="M19 12H5"/><path d="m11 18-6-6 6-6"/>',
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V4a2 2 0 0 0-2-2H6.5A2.5 2.5 0 0 0 4 4.5z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  terminal: '<path d="m4 17 6-5-6-5"/><path d="M12 19h8"/>',
  spinner: '<path d="M21 12a9 9 0 1 1-6.2-8.56"/>',
  alert: '<circle cx="12" cy="12" r="9.5"/><path d="M12 8v5"/><path d="M12 16.5v.2"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M9 13h6"/><path d="M9 17h6"/>'
};

function icon(name, size) {
  size = size || 16;
  var key = String(name || "").toLowerCase();
  if (BRAND_ICONS[key]) return svgWrap(size, BRAND_ICONS[key], true);
  if (key === "twitter") key = "x";
  if (key === "email") key = "mail";
  return svgWrap(size, LINE_ICONS[key] || LINE_ICONS.web, false);
}

function lineIcon(name, size) {
  return svgWrap(size || 16, LINE_ICONS[name] || "", false);
}

/* ================================================================
   small ui helpers
   ================================================================ */

var ASCII_LOGO =
  "█▀▀ █▀█ █ █ █▀█ ▀█▀ █▀▀ ▀▄▀ █▀▀ █▀▀\n" +
  "█▀  █▄█ █▄█ █▀▄  █  ██▄ █ █ ██▄ █▄▄";

function currentTheme() {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

function logoFile() {
  return currentTheme() === "dark" ? "dlogo.png" : "logo.png";
}

// header/footer logo; if the image is missing we fall back to a >_ tile
function logoHTML(sizeClass) {
  return '<img class="logo-img ' + (sizeClass || "") + '" src="' + esc(resolvePath(logoFile())) +
    '" alt="logo" draggable="false" onerror="logoFailed(this)">';
}
function logoFailed(img) {
  var d = document.createElement("span");
  d.className = "logo-fallback" + (img.classList.contains("big") ? " big" : "");
  d.textContent = ">_";
  img.replaceWith(d);
}

// avatars get the same treatment: broken image -> first letter tile
function avatarHTML(member, cls) {
  var letter = esc(String(member.username || "?").trim().charAt(0).toUpperCase() || "?");
  var src = member.avatar ? esc(resolvePath(member.avatar)) : "";
  return '<span class="avatar-wrap ' + cls + '"><span class="avatar-letter">' + letter + "</span>" +
    (src ? '<img src="' + src + '" alt="' + esc(member.username || "") + '" loading="lazy" draggable="false" onerror="this.remove()">' : "") +
    "</span>";
}

function promptLine(cmd) {
  return '<div class="prompt-line"><span class="prompt-host">' + lineIcon("terminal", 13) +
    ' ~/fourtexec</span> <span>❯</span> <span class="tx" data-type="' + esc(cmd) + '"></span></div>';
}

function sectionHead(no, title, sub, prompt) {
  return '<div class="rv section-head">' +
    (prompt ? promptLine(prompt) : "") +
    '<div class="section-head-row"><h2><span class="sec-no">/' + esc(no) + "</span>" + esc(title) + "</h2>" +
    (sub ? '<p class="sec-sub">' + esc(sub) + "</p>" : "") +
    "</div></div>";
}

function pad2(n) { return String(n).padStart(2, "0"); }

function statusColor(status) {
  if (status === "active") return "var(--acc)";
  if (status === "beta") return "var(--acc2)";
  return "var(--fnt)";
}

function startTypewriters(root) {
  root.querySelectorAll("[data-type]").forEach(function (el) {
    var text = el.getAttribute("data-type");
    var i = 0;
    el.textContent = "";
    el.classList.add("caret");
    var timer = setInterval(function () {
      i++;
      el.textContent = text.slice(0, i);
      if (i >= text.length) {
        clearInterval(timer);
        // leave the caret blinking on the hero command, drop it elsewhere
        if (!el.closest(".hero")) el.classList.remove("caret");
      }
    }, 22);
  });
}

var revealObserver = null;
function startReveals(root) {
  var els = root.querySelectorAll(".rv");
  if (!("IntersectionObserver" in window)) {
    els.forEach(function (el) { el.classList.add("on"); });
    return;
  }
  if (!revealObserver) {
    revealObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          e.target.classList.add("on");
          revealObserver.unobserve(e.target);
        }
      });
    }, { threshold: 0.12 });
  }
  els.forEach(function (el) { revealObserver.observe(el); });
}

function copyText(text, btn) {
  function done() {
    if (!btn) return;
    var old = btn.innerHTML;
    btn.innerHTML = lineIcon("check", 13) + " copied";
    btn.classList.add("copied");
    setTimeout(function () { btn.innerHTML = old; btn.classList.remove("copied"); }, 1500);
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done, done);
  } else {
    var ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); } catch (e) {}
    ta.remove();
    done();
  }
}

/* ================================================================
   pages
   ================================================================ */

var NAV = [
  { to: "/", label: "home" },
  { to: "/projects", label: "projects" },
  { to: "/team", label: "team" },
  { to: "/join", label: "join" }
];

function isActive(route, to) {
  return to === "/" ? route === "/" : route.indexOf(to) === 0;
}

function renderHeader(cfg, route, mobileOpen) {
  var links = NAV.map(function (n) {
    return '<a href="#' + n.to + '" class="' + (isActive(route, n.to) ? "active" : "") + '">' +
      '<span class="tilde">~/</span>' + n.label + "</a>";
  }).join("");
  var mobile = NAV.map(function (n) {
    return '<a href="#' + n.to + '" class="' + (isActive(route, n.to) ? "active" : "") + '">~/ ' + n.label + "</a>";
  }).join("");

  document.getElementById("site-header").innerHTML =
    '<div class="wrap header-in">' +
      '<a class="brand" href="#/">' + logoHTML() +
        '<span class="brand-name">' + esc(cfg.site.name) + "</span></a>" +
      '<nav class="main-nav">' + links + "</nav>" +
      '<div class="header-actions">' +
        '<button class="icon-btn" id="theme-btn" title="toggle theme" aria-label="toggle theme">' +
          lineIcon(currentTheme() === "dark" ? "sun" : "moon", 16) + "</button>" +
        '<button class="icon-btn burger" id="burger-btn" aria-label="menu">' +
          lineIcon(mobileOpen ? "xclose" : "menu", 16) + "</button>" +
      "</div>" +
    "</div>" +
    (mobileOpen ? '<div class="mobile-nav">' + mobile + "</div>" : "");

  document.getElementById("theme-btn").addEventListener("click", toggleTheme);
  document.getElementById("burger-btn").addEventListener("click", function () {
    state.mobileOpen = !state.mobileOpen;
    renderHeader(state.config, state.route, state.mobileOpen);
  });
}

function renderFooter(cfg) {
  var year = cfg.footer.copyright || String(new Date().getFullYear());
  var index = NAV.map(function (n) {
    return '<a href="#' + n.to + '"><span class="fnt">~/</span>' + n.label + "</a>";
  }).join("");
  var channels = cfg.socials.map(function (s) {
    return '<a href="' + esc(s.url || "#") + '" target="_blank" rel="noreferrer">' +
      icon(s.platform, 14) + esc(s.label || s.platform || "") + "</a>";
  }).join("");

  document.getElementById("site-footer").innerHTML =
    '<div class="wrap">' +
      '<div class="footer-grid">' +
        "<div>" +
          '<div class="footer-brand">' + logoHTML() +
            '<span class="brand-name">' + esc(cfg.site.name) + "</span></div>" +
          (cfg.footer.note
            ? '<p class="footer-note"><span class="acc">// </span>' + esc(cfg.footer.note) + "</p>"
            : "") +
        "</div>" +
        '<div><div class="footer-head">index</div><div class="footer-links">' + index + "</div></div>" +
        '<div><div class="footer-head">channels</div><div class="footer-links">' + channels + "</div></div>" +
      "</div>" +
      '<div class="footer-bottom">' +
        "<span>© " + esc(year) + " " + esc(cfg.site.name) + " · all rights reversed</span>" +
        '<span class="status-line"><span class="status-dot"></span>' + esc(cfg.site.status || "") + "</span>" +
      "</div>" +
    "</div>";
}

function projectCard(p, index) {
  var links = "";
  if (p.readme) {
    links += '<a class="card-link main" href="#/projects/' + esc(p.slug) + '">' + lineIcon("book", 13) + "read docs</a>";
  }
  if (p.site) {
    links += '<a class="card-link" href="' + esc(p.site) + '" target="_blank" rel="noreferrer">site ' + lineIcon("arrow-up-right", 13) + "</a>";
  }
  if (p.link) {
    links += '<a class="card-link push" href="' + esc(p.link) + '" target="_blank" rel="noreferrer">open ' + lineIcon("arrow-up-right", 13) + "</a>";
  }
  var tags = (p.tags || []).map(function (t) {
    return '<span class="tag">#' + esc(t) + "</span>";
  }).join("");

  return '<article class="card proj-card">' +
    '<span class="card-num">' + pad2(index + 1) + "</span>" +
    '<div class="proj-top">' +
      '<span class="chip"><span class="status-dot" style="background:' + statusColor(p.status) + '"></span>' + esc(p.status || "") + "</span>" +
      '<span class="proj-slug">./' + esc(p.slug) + "</span>" +
    "</div>" +
    '<h3><span class="cc">::</span>' + esc(p.name || "") + "</h3>" +
    '<p class="proj-desc">' + esc(p.description || "") + "</p>" +
    (tags ? '<div class="tags">' + tags + "</div>" : "") +
    (links ? '<div class="proj-links">' + links + "</div>" : "") +
    "</article>";
}

function homePage(cfg) {
  var featured = cfg.projects.slice(0, 3);
  var stats = [
    [pad2(cfg.projects.length), "projects shipped"],
    [pad2(cfg.team.length), "humans on the roster"],
    [pad2(cfg.socials.length), "open channels"],
    ["00", "meetings held"]
  ].map(function (s) {
    return '<div class="stat"><div class="stat-num">' + s[0] + '</div><div class="stat-label">' + s[1] + "</div></div>";
  }).join("");

  var html = '<section class="hero"><div class="wrap">' +
    '<div class="rv">' + promptLine(cfg.site.command || "cat ./manifesto.txt") + "</div>" +
    '<pre class="ascii rv" style="transition-delay:120ms">' + esc(ASCII_LOGO) + "</pre>" +
    '<div class="rv" style="transition-delay:220ms">' +
      '<p class="hero-kicker"><span class="status-dot"></span>' + esc(cfg.site.name) + " · engineering crew</p>" +
      '<h1>' + esc(cfg.site.tagline || "") + '<span class="acc">.</span></h1>' +
      '<p class="hero-desc">' + esc(cfg.site.description || "") + "</p>" +
    "</div>" +
    '<div class="rv hero-actions" style="transition-delay:320ms">' +
      '<a class="btn btn-solid" href="#/projects">see the work ' + lineIcon("arrow-right", 15) + "</a>" +
      '<a class="btn btn-ghost" href="#/join">join.exe ' + lineIcon("arrow-up-right", 15) + "</a>" +
      (cfg.site.status
        ? '<span class="hero-status"><span class="status-dot"></span> status: ' + esc(cfg.site.status) + "</span>"
        : "") +
    "</div>" +
    '<div class="rv stats" style="transition-delay:420ms">' + stats + "</div>" +
    "</div></section>";

  if (featured.length) {
    html += '<section><div class="wrap">' +
      sectionHead("01", "featured builds", cfg.projects.length + " total in the index", "ls ./projects --featured --limit 3") +
      '<div class="grid grid-3">' +
      featured.map(function (p, i) {
        return '<div class="rv" style="transition-delay:' + i * 110 + 'ms">' + projectCard(p, i) + "</div>";
      }).join("") +
      "</div>" +
      '<div class="rv index-line-wrap"><a class="index-line" href="#/projects">full index ' + lineIcon("arrow-right", 14) + "</a></div>" +
      "</div></section>";
  }

  if (cfg.team.length) {
    var stack = cfg.team.map(function (m) { return avatarHTML(m, "stacked"); }).join("");
    var names = cfg.team.map(function (m) { return m.username; }).join(" · ");
    html += '<section><div class="wrap">' +
      sectionHead("02", "the humans", "whois --all", "whois ./team/*") +
      '<div class="rv card humans-card">' +
        '<div class="avatar-stack">' + stack + "</div>" +
        '<div class="humans-text"><p class="humans-names">' + esc(names) + "</p>" +
        "<p>four seats, four obsessions — systems, interfaces, security and bots. every line we ship traces back to one of these avatars.</p></div>" +
        '<a class="btn btn-solid" href="#/team">meet them ' + lineIcon("arrow-right", 15) + "</a>" +
      "</div>" +
      "</div></section>";
  }

  var socialBtns = cfg.socials.slice(0, 3).map(function (s) {
    return '<a class="icon-btn" href="' + esc(s.url || "#") + '" target="_blank" rel="noreferrer" title="' +
      esc(s.label || s.platform || "") + '">' + icon(s.platform, 16) + "</a>";
  }).join("");

  html += '<section><div class="wrap">' +
    '<div class="rv card cta-card">' +
      '<p class="cta-kicker">// there is a fifth chair</p>' +
      "<h3>think you can out-ship us?</h3>" +
      (cfg.join.email
        ? '<a class="cta-mail" href="mailto:' + esc(cfg.join.email) + '">' + lineIcon("mail", 17) + esc(cfg.join.email) + "</a>"
        : "") +
      '<div class="cta-actions">' +
        '<a class="btn btn-solid" href="#/join">how to get in ' + lineIcon("arrow-right", 15) + "</a>" +
        socialBtns +
      "</div>" +
    "</div>" +
    "</div></section>";

  return html;
}

function projectsPage(cfg) {
  var filters = ["all", "active", "beta", "archived"];
  var counts = {};
  filters.forEach(function (f) {
    counts[f] = f === "all"
      ? cfg.projects.length
      : cfg.projects.filter(function (p) { return p.status === f; }).length;
  });
  var chips = filters.filter(function (f) { return counts[f] > 0; }).map(function (f) {
    return '<button type="button" class="chip filter-chip' + (state.filter === f ? " on" : "") +
      '" data-filter="' + f + '">' + f + " · " + counts[f] + "</button>";
  }).join("");

  var shown = cfg.projects.filter(function (p) {
    return state.filter === "all" || p.status === state.filter;
  });

  var grid;
  if (!shown.length) {
    grid = '<div class="card empty-box"><span class="acc">$</span> ls ./projects — ' +
      '<span class="caret-line">no results. add entries to config.yaml → projects[] to fill this grid</span></div>';
  } else {
    grid = '<div class="grid grid-3">' + shown.map(function (p) {
      var i = cfg.projects.indexOf(p);
      return '<div class="rv" style="transition-delay:' + (shown.indexOf(p) % 3) * 90 + 'ms">' + projectCard(p, i) + "</div>";
    }).join("") + "</div>";
  }

  return '<section><div class="wrap page-head">' +
    sectionHead("p", "project index", cfg.projects.length + " entries parsed from config.projects[]", "ls ./projects --long --status") +
    '<div class="rv filters">' + chips + "</div>" +
    grid +
    "</div></section>";
}

function teamCard(m, i) {
  var socials = (m.socials || []).map(function (s) {
    return '<a class="icon-btn small" href="' + esc(s.url || "#") + '" target="_blank" rel="noreferrer" title="' +
      esc(s.platform || "") + '">' + icon(s.platform, 14) + "</a>";
  }).join("");

  return '<article class="card team-card">' +
    '<div class="team-photo">' + avatarHTML(m, "team") +
      '<span class="online-dot"></span></div>' +
    '<div class="team-info">' +
      '<h3><span class="acc">@</span>' + esc(m.username || "") + "</h3>" +
      (m.role ? '<p class="team-role">' + esc(m.role) + "</p>" : "") +
      (m.name ? '<p class="team-aka">aka ' + esc(m.name) + "</p>" : "") +
      (m.bio ? '<p class="team-bio">' + esc(m.bio) + "</p>" : "") +
      '<div class="team-links">' + socials +
        '<span class="uid">uid=10' + pad2(i) + "(" + esc(m.username || "") + ")</span></div>" +
    "</div></article>";
}

function teamPage(cfg) {
  var body;
  if (!cfg.team.length) {
    body = '<div class="card empty-box"><span class="acc">$</span> whois * — empty result. add members to ' +
      '<span class="tx">config.yaml → team[]</span></div>';
  } else {
    body = '<div class="grid grid-2">' + cfg.team.map(function (m, i) {
      return '<div class="rv" style="transition-delay:' + i * 100 + 'ms">' + teamCard(m, i) + "</div>";
    }).join("") + "</div>";
  }

  return '<section><div class="wrap page-head">' +
    sectionHead("t", "the humans", cfg.team.length + " entries from config.team[]", "whois --all") +
    body +
    '<div class="rv card2 roster-note"><span class="acc">//</span><span>roster is parsed from ' +
    '<span class="tx">config.yaml → team[]</span> — username, avatar link and socials per member. edit the file, this grid rebuilds.</span>' +
    '<span class="caret"></span></div>' +
    "</div></section>";
}

function joinPage(cfg) {
  var email = cfg.join.email || cfg.site.email || "";
  var mailto = email
    ? "mailto:" + email + (cfg.join.subject ? "?subject=" + encodeURIComponent(cfg.join.subject) : "")
    : "#";

  var steps = (cfg.join.steps || []).map(function (s, i) {
    return '<div class="rv" style="transition-delay:' + i * 110 + 'ms"><div class="card step-card">' +
      '<span class="step-num">' + pad2(i + 1) + '</span><p>' + esc(s) + "</p></div></div>";
  }).join("");

  var side;
  if (email) {
    side = '<div class="card2 email-box">' + lineIcon("mail", 15) +
        '<span class="email-addr">' + esc(email) + "</span>" +
        '<button type="button" class="copy-btn" id="copy-email" title="copy email">' + lineIcon("copy", 14) + "</button></div>" +
      '<a class="btn btn-solid wide" href="' + esc(mailto) + '">open mail client ' + lineIcon("send", 14) + "</a>" +
      (cfg.join.subject
        ? '<p class="subject-note">subject pre-fills as «' + esc(cfg.join.subject) + "»</p>"
        : "");
  } else {
    side = '<p class="no-email">no email set — add <span class="tx">join.email</span> to config.yaml.</p>';
  }
  if (cfg.socials.length) {
    side += '<div class="ping"><p class="ping-label">or ping us anywhere</p><div class="ping-row">' +
      cfg.socials.map(function (s) {
        return '<a class="icon-btn" href="' + esc(s.url || "#") + '" target="_blank" rel="noreferrer" title="' +
          esc(s.label || s.platform || "") + '">' + icon(s.platform, 15) + "</a>";
      }).join("") + "</div></div>";
  }

  return '<section><div class="wrap page-head">' +
    sectionHead("j", cfg.join.title || "join the crew", "recruitment pipeline: 1 inbox", "open ./JOINING.md --render") +
    '<div class="join-grid"><div>' +
      (cfg.join.intro ? '<div class="rv"><p class="join-intro">' + esc(cfg.join.intro) + "</p></div>" : "") +
      '<div class="steps">' + steps + "</div>" +
      (cfg.join.note
        ? '<div class="rv card2 roster-note"><div><p class="note-head">// fine print</p><p>' + esc(cfg.join.note) + "</p></div></div>"
        : "") +
    "</div>" +
    '<div class="rv" style="transition-delay:150ms"><aside class="card join-side">' +
      '<p class="side-kicker">step ∞ · press send</p>' +
      '<h3>one email<span class="acc">.</span><br>that\'s the gate<span class="acc">.</span></h3>' +
      side +
    "</aside></div>" +
    "</div></div></section>";
}

function projectPage(cfg, slug) {
  var p = null;
  cfg.projects.forEach(function (x) { if (x.slug === slug) p = x; });

  if (!p) {
    return '<section><div class="wrap narrow page-head"><div class="card term-card">' +
      '<p><span class="acc">$</span> cat ./projects/' + esc(slug) + ".md</p>" +
      '<p><span class="acc">error:</span> file not found — no project matches this slug. check <span class="tx">config.yaml → projects[]</span>.</p>' +
      '<p class="term-actions"><a class="btn btn-ghost" href="#/projects">' + lineIcon("arrow-left", 14) + " back to index</a></p>" +
      "</div></div></section>";
  }

  var tags = (p.tags || []).map(function (t) {
    return '<span class="tag">#' + esc(t) + "</span>";
  }).join("");

  var buttons = "";
  if (p.link) {
    buttons += '<a class="btn btn-solid wide" href="' + esc(p.link) + '" target="_blank" rel="noreferrer">open project ' + lineIcon("arrow-up-right", 14) + "</a>";
  }
  if (p.site) {
    buttons += '<a class="btn btn-ghost wide" href="' + esc(p.site) + '" target="_blank" rel="noreferrer">visit site ' + lineIcon("arrow-up-right", 14) + "</a>";
  }

  return '<section><div class="wrap page-head">' +
    '<div class="rv"><a class="back-link" href="#/projects">' + lineIcon("arrow-left", 13) + " ~/projects</a>" +
    promptLine("cat ./projects/" + p.slug + ".md --render") + "</div>" +
    '<div class="detail-grid">' +
      '<div class="rv"><aside class="card detail-side">' +
        '<p class="side-label">package</p>' +
        '<h1><span class="cc">::</span>' + esc(p.name || "") + "</h1>" +
        '<p class="detail-desc">' + esc(p.description || "") + "</p>" +
        '<div class="meta-rows">' +
          '<div class="meta-row"><span>status</span><span class="chip">' + esc(p.status || "") + "</span></div>" +
          (p.readme ? '<div class="meta-row"><span>file</span><span class="meta-file">' + esc(p.readme) + "</span></div>" : "") +
          '<div class="meta-row"><span>source</span><span>config.yaml</span></div>' +
        "</div>" +
        (tags ? '<div class="tags">' + tags + "</div>" : "") +
        buttons +
      "</aside></div>" +
      '<div class="rv" style="transition-delay:90ms"><article class="card detail-body" id="readme-body">' +
        readmeStateHTML(p, { kind: p.readme ? "loading" : "none" }) +
      "</article></div>" +
    "</div></div></section>";
}

function readmeStateHTML(p, st) {
  if (st.kind === "loading") {
    return '<div class="readme-state"><span class="spin">' + lineIcon("spinner", 16) + "</span>streaming " + esc(p.readme) + " …</div>";
  }
  if (st.kind === "err") {
    return '<div class="readme-state col">' + lineIcon("alert", 18) +
      '<p><span class="acc">error:</span> could not load <span class="tx">' + esc(p.readme) + "</span> (" + esc(st.msg) + ")<br>" +
      "make sure the file exists next to config.yaml.</p></div>";
  }
  if (st.kind === "ok") return renderMarkdown(st.text);
  return '<div class="readme-state col">' + lineIcon("file", 18) +
    '<p>no <span class="tx">readme</span> field set for this project — add one in config.yaml and the full docs will render here.</p></div>';
}

function loadReadme(p) {
  var body = document.getElementById("readme-body");
  if (!body || !p.readme) return;
  fetch(resolvePath(p.readme) + "?v=" + Date.now())
    .then(function (res) {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.text();
    })
    .then(function (text) {
      if (!document.getElementById("readme-body")) return;
      body.innerHTML = readmeStateHTML(p, { kind: "ok", text: text });
      wireCopyButtons(body);
    })
    .catch(function (err) {
      if (!document.getElementById("readme-body")) return;
      body.innerHTML = readmeStateHTML(p, { kind: "err", msg: err.message });
    });
}

function notFoundPage(route) {
  return '<section><div class="wrap narrow page-head"><div class="card term-card">' +
    '<div class="big-404">404</div>' +
    '<p><span class="acc">$</span> resolve ' + esc(route) + "</p>" +
    '<p><span class="acc">error:</span> no such route — this page exists in neither <span class="tx">config.yaml</span> nor reality.</p>' +
    '<p>suggestion: <a class="acc" href="#/">cd ~/</a> and try again.<span class="caret"></span></p>' +
    "</div></div></section>";
}

function loadingScreen() {
  document.getElementById("site-header").innerHTML = "";
  document.getElementById("site-footer").innerHTML = "";
  document.getElementById("app").innerHTML =
    '<div class="loading"><span class="logo-fallback big">&gt;_</span>' +
    '<p class="loading-text"><span class="status-dot"></span>reading config.yaml</p></div>';
}

function errorScreen(msg) {
  document.getElementById("site-header").innerHTML = "";
  document.getElementById("site-footer").innerHTML = "";
  document.getElementById("app").innerHTML =
    '<div class="error-screen"><div class="card term-card">' +
    '<p class="error-head">// config error</p>' +
    '<p><span class="acc">error:</span> couldn\'t parse <u>./config.yaml</u></p>' +
    '<p class="mut">' + esc(msg) + "</p>" +
    '<p class="fnt">— every page on this site is driven by that file. fix the yaml, refresh, and everything rebuilds.</p>' +
    "</div></div>";
}

/* ================================================================
   app state, routing, theme
   ================================================================ */

var state = {
  config: null,
  route: "/",
  filter: "all",
  mobileOpen: false
};

function parseRoute() {
  var h = window.location.hash.replace(/^#/, "");
  return h === "" ? "/" : h;
}

function wireCopyButtons(root) {
  root.querySelectorAll("[data-copy]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var code = codeBlocks[Number(btn.getAttribute("data-copy"))];
      if (code != null) copyText(code, btn);
    });
  });
}

function render() {
  var cfg = state.config;
  var route = state.route;
  var app = document.getElementById("app");
  var m = route.match(/^\/projects\/([a-z0-9-]+)\/?$/);
  var detailProject = null;

  if (route === "/") app.innerHTML = homePage(cfg);
  else if (route === "/projects" || route === "/projects/") app.innerHTML = projectsPage(cfg);
  else if (m) {
    app.innerHTML = projectPage(cfg, m[1]);
    cfg.projects.forEach(function (x) { if (x.slug === m[1]) detailProject = x; });
  }
  else if (route === "/team" || route === "/team/") app.innerHTML = teamPage(cfg);
  else if (route === "/join" || route === "/join/") app.innerHTML = joinPage(cfg);
  else app.innerHTML = notFoundPage(route);

  renderHeader(cfg, route, state.mobileOpen);
  renderFooter(cfg);

  // per-page wiring
  app.querySelectorAll("[data-filter]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      state.filter = btn.getAttribute("data-filter");
      render();
    });
  });
  var copyEmail = document.getElementById("copy-email");
  if (copyEmail) {
    copyEmail.addEventListener("click", function () {
      copyText(cfg.join.email || cfg.site.email || "", copyEmail);
    });
  }
  wireCopyButtons(app);
  startTypewriters(app);
  startReveals(app);
  if (detailProject) loadReadme(detailProject);
}

function toggleTheme() {
  var next = currentTheme() === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem("fourtexec-theme", next); } catch (e) {}
  // logo + toggle icon follow the theme
  if (state.config) renderHeader(state.config, state.route, state.mobileOpen);
}

function boot() {
  loadingScreen();
  loadConfig()
    .then(function (cfg) {
      state.config = cfg;
      state.route = parseRoute();
      render();
    })
    .catch(function (err) {
      errorScreen(err.message || String(err));
    });

  window.addEventListener("hashchange", function () {
    if (!state.config) return;
    state.route = parseRoute();
    state.mobileOpen = false;
    window.scrollTo({ top: 0, behavior: "instant" });
    render();
  });
}

// logoFailed is called from inline onerror attributes
if (typeof window !== "undefined") window.logoFailed = logoFailed;

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
}

// let node require() the pure parts for testing; browsers ignore this
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    parseYAML: parseYAML,
    normalizeConfig: normalizeConfig,
    renderMarkdown: renderMarkdown,
    slugify: slugify,
    pages: {
      home: homePage,
      projects: projectsPage,
      team: teamPage,
      join: joinPage,
      project: projectPage,
      notFound: notFoundPage
    }
  };
}
