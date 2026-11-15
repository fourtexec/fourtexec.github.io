/* fourtexec.site
   Reads config.yaml and draws the pages: front page, projects,
   one page per project, team and join. The text of the site is in
   config.yaml and projects/*.md, not in this file. */

"use strict";

/* A small yaml reader. It handles what config.yaml uses: nested maps,
   lists of maps, folded and literal blocks (> and |), flow lists [a, b],
   quoted strings and comments. Anchors and multi-document files are
   not supported. */

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

/* Loading config.yaml and filling in defaults */

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

  var join = { title: "Join us", intro: "", email: "", subject: "", note: "" };
  Object.keys(joinIn).forEach(function (k) { join[k] = joinIn[k]; });
  join.steps = steps;

  var site = {
    name: "fourtexec", tagline: "", description: "", email: ""
  };
  Object.keys(siteIn).forEach(function (k) { site[k] = siteIn[k]; });

  var footer = { note: "", copyright: "" };
  Object.keys(footerIn).forEach(function (k) { footer[k] = footerIn[k]; });

  // accounts: the api + accounts site. on localhost they point at local dev servers
  var accIn = c.accounts || {};
  var accounts = {
    enabled: accIn.enabled !== false,
    api: String(accIn.api || "https://api.fourtexec.site").replace(/\/+$/, ""),
    url: String(accIn.url || "https://accounts.fourtexec.site").replace(/\/+$/, "")
  };
  if (typeof location !== "undefined" && /^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
    accounts.api = "http://" + location.hostname + ":8080";
    accounts.url = "http://" + location.hostname + ":8001";
  }

  return {
    site: site,
    socials: Array.isArray(c.socials) ? c.socials : [],
    team: Array.isArray(c.team) ? c.team : [],
    projects: projects,
    join: join,
    footer: footer,
    accounts: accounts
  };
}

function loadConfig() {
  return fetch(resolvePath("config.yaml") + "?v=" + Date.now())
    .then(function (res) {
      if (!res.ok) throw new Error("config.yaml: HTTP " + res.status);
      return res.text();
    })
    .then(function (text) { return normalizeConfig(parseYAML(text)); });
}

/* Markdown. Only the subset the project pages use.
   Text is escaped first, then the markup rules run on top. */

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
    if (code !== undefined) return "<code>" + code + "</code>";
    if (b1 !== undefined || b2 !== undefined) return "<strong>" + (b1 !== undefined ? b1 : b2) + "</strong>";
    if (del !== undefined) return "<s>" + del + "</s>";
    if (i1 !== undefined || i2 !== undefined) return "<em>" + (i1 !== undefined ? i1 : i2) + "</em>";
    return m;
  });
}

var codeBlocks = []; // fenced blocks of the page being rendered, for the copy buttons

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

    if (/^```/.test(line)) {
      var buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++; // closing fence
      var idx = codeBlocks.push(buf.join("\n")) - 1;
      out.push(
        '<div class="codeblock"><button type="button" class="copy-btn" data-copy="' + idx + '">Copy</button>' +
        "<pre><code>" + esc(buf.join("\n")) + "</code></pre></div>"
      );
      continue;
    }

    if (/^(---|\*\*\*|___)\s*$/.test(line)) { out.push("<hr>"); i++; continue; }

    var h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      var tag = "h" + Math.min(h[1].length, 4);
      out.push("<" + tag + ">" + inlineMd(h[2]) + "</" + tag + ">");
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
      var listTag = items[0].ordered ? "ol" : "ul";
      var lis = items.map(function (it) {
        var cls = it.indent >= 2 ? ["nested"] : [];
        var task = it.text.match(/^\[( |x)\]\s+(.*)$/);
        var body = it.text;
        var box = "";
        if (task) {
          cls.push("task");
          box = '<input type="checkbox" disabled' + (task[1] === "x" ? " checked" : "") + "> ";
          body = task[2];
        }
        return "<li" + (cls.length ? ' class="' + cls.join(" ") + '"' : "") + ">" + box + inlineMd(body) + "</li>";
      });
      out.push("<" + listTag + ">" + lis.join("") + "</" + listTag + ">");
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
        var cell = r === 0 ? "th" : "td";
        return "<tr>" + cells.map(function (c) {
          return "<" + cell + ">" + inlineMd(c) + "</" + cell + ">";
        }).join("") + "</tr>";
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

/* Icons and small helpers */

var BRAND_ICONS = {
  github: '<path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.55v-2.15c-3.2.7-3.87-1.36-3.87-1.36-.52-1.33-1.28-1.68-1.28-1.68-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.19 1.76 1.19 1.03 1.75 2.69 1.25 3.34.95.1-.75.4-1.25.73-1.54-2.55-.29-5.23-1.28-5.23-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11.1 11.1 0 0 1 5.78 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.41-2.69 5.38-5.25 5.67.41.36.78 1.06.78 2.14v3.17c0 .3.21.67.8.55A11.51 11.51 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5z"/>',
  telegram: '<path d="M21.9 4.6 18.8 19.3c-.23 1.03-.85 1.28-1.72.8l-4.76-3.51-2.3 2.21c-.25.26-.47.47-.96.47l.35-4.93 8.97-8.1c.39-.35-.08-.54-.6-.2L7.6 13.7 2.83 12.2c-1.04-.32-1.06-1.04.22-1.54l18.67-7.2c.86-.32 1.62.2 1.18 1.14z"/>',
  x: '<path d="M18.9 2.6h3.1l-6.8 7.8L23.2 21.4h-6.3l-4.9-6.4-5.6 6.4H3.3l7.3-8.3L2.8 2.6h6.4l4.4 5.9zm-1.1 16.9h1.7L8.4 4.4H6.6z"/>',
  discord: '<path d="M18.6 5.3A16 16 0 0 0 14.6 4l-.5 1a13 13 0 0 1 3.7 1.8 12.4 12.4 0 0 0-11.6 0A13 13 0 0 1 9.9 5L9.4 4a16 16 0 0 0-4 1.3C2.9 9.1 2.2 12.8 2.5 16.4a16 16 0 0 0 4.9 2.5l1-1.6a10 10 0 0 1-1.6-.8l.4-.3a11.4 11.4 0 0 0 9.6 0l.4.3c-.5.3-1 .6-1.6.8l1 1.6a16 16 0 0 0 4.9-2.5c.4-4.2-.7-7.9-2.9-11.1zM9.7 15.5c-.9 0-1.6-.8-1.6-1.8s.7-1.8 1.6-1.8 1.6.8 1.6 1.8-.7 1.8-1.6 1.8zm4.6 0c-.9 0-1.6-.8-1.6-1.8s.7-1.8 1.6-1.8 1.6.8 1.6 1.8-.7 1.8-1.6 1.8z"/>',
  youtube: '<path d="M23 7.5s-.2-1.6-.9-2.3c-.9-.9-1.9-.9-2.3-1C16.6 4 12 4 12 4s-4.6 0-7.8.2c-.4.1-1.4.1-2.3 1-.7.7-.9 2.3-.9 2.3S.8 9.4.8 11.3v1.4c0 1.9.2 3.8.2 3.8s.2 1.6.9 2.3c.9.9 2 .9 2.5 1 1.8.2 7.6.2 7.6.2s4.6 0 7.8-.3c.4-.1 1.4-.1 2.3-1 .7-.7.9-2.3.9-2.3s.2-1.9.2-3.8v-1.4c0-1.9-.2-3.8-.2-3.8zM9.8 15.1V8.4l6.2 3.4z"/>',
  twitch: '<path d="M4.3 2 2.6 6.4v15.1h5.3V24h3.1l2.5-2.5h3.9L22 16.9V2zm15.6 13.7-2.8 2.8h-4.6l-2.2 2.2v-2.2H5.2V4.2h14.7zM17 7.6h-1.9v5.3H17zm-5.1 0H10v5.3h1.9z"/>'
};

var LINE_ICONS = {
  instagram: '<rect x="2.5" y="2.5" width="19" height="19" rx="5"/><circle cx="12" cy="12" r="4"/>',
  linkedin: '<rect x="2.5" y="2.5" width="19" height="19" rx="4"/><path d="M7.5 10.5v6"/><path d="M11.5 16.5v-6"/><path d="M11.5 13.2a2.6 2.6 0 0 1 5.2 0v3.3"/>',
  mail: '<rect x="2.5" y="5" width="19" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  rss: '<path d="M4 11a9 9 0 0 1 9 9"/><path d="M4 4a16 16 0 0 1 16 16"/><circle cx="5" cy="19" r="1"/>',
  web: '<circle cx="12" cy="12" r="9.5"/><path d="M2.5 12h19"/><path d="M12 2.5c2.7 2.6 4 5.9 4 9.5s-1.3 6.9-4 9.5c-2.7-2.6-4-5.9-4-9.5s1.3-6.9 4-9.5z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.9 4.9 1.4 1.4"/><path d="m17.7 17.7 1.4 1.4"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.3 17.7-1.4 1.4"/><path d="m19.1 4.9-1.4 1.4"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  "arrow-right": '<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>',
  "arrow-left": '<path d="M19 12H5"/><path d="m11 18-6-6 6-6"/>',
  "arrow-up-right": '<path d="M7 17 17 7"/><path d="M8 7h9v9"/>'
};

function icon(name, size) {
  size = size || 16;
  var key = String(name || "").toLowerCase();
  if (key === "twitter") key = "x";
  if (key === "email") key = "mail";
  var filled = !!BRAND_ICONS[key];
  return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" ' +
    (filled ? 'fill="currentColor"' : 'fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"') +
    ' aria-hidden="true">' + (BRAND_ICONS[key] || LINE_ICONS[key] || LINE_ICONS.web) + "</svg>";
}

var PLATFORM_NAMES = {
  github: "GitHub", telegram: "Telegram", youtube: "YouTube", x: "X", twitter: "X",
  discord: "Discord", twitch: "Twitch", instagram: "Instagram", linkedin: "LinkedIn",
  mail: "Email", email: "Email", rss: "RSS", web: "Website"
};

function socialName(s) {
  var key = String(s.platform || "").toLowerCase();
  return s.label || PLATFORM_NAMES[key] || s.platform || "link";
}

// round icon buttons
function socialButtons(list) {
  return (list || []).map(function (s) {
    return '<a class="icon-btn" href="' + esc(s.url || "#") + '" target="_blank" rel="noreferrer" title="' +
      esc(socialName(s)) + '" aria-label="' + esc(socialName(s)) + '">' + icon(s.platform, 17) + "</a>";
  }).join("");
}

function currentTheme() {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

function logoFile() {
  return currentTheme() === "dark" ? "dlogo.png" : "logo.png";
}

// a missing logo file just disappears, the name next to it is enough
function logoHTML(cls) {
  return '<img class="' + cls + '" src="' + esc(resolvePath(logoFile())) +
    '" alt="" draggable="false" onerror="this.remove()">';
}

// the first letter sits under the photo and shows if the photo fails to load
function avatarHTML(member, cls) {
  var label = member.name || member.username || "";
  var letter = esc(String(label || "?").trim().charAt(0).toUpperCase() || "?");
  var src = member.avatar ? esc(resolvePath(member.avatar)) : "";
  return '<span class="avatar ' + cls + '"><span>' + letter + "</span>" +
    (src ? '<img src="' + src + '" alt="' + esc(label) + '" loading="lazy" draggable="false" onerror="this.remove()">' : "") +
    "</span>";
}

function cap(s) {
  s = String(s || "");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function pad2(n) { return String(n).padStart(2, "0"); }

function statusPill(status) {
  if (!status) return "";
  var kind = /^active/.test(status) ? "live" : /^archiv/.test(status) ? "off" : "wip";
  return '<span class="pill"><i class="dot ' + kind + '"></i>' + esc(status) + "</span>";
}

function tagsHTML(tags) {
  if (!tags || !tags.length) return "";
  return '<div class="tags">' + tags.map(function (t) { return "<span>" + esc(t) + "</span>"; }).join("") + "</div>";
}

function copyText(text, btn) {
  function done() {
    if (!btn) return;
    var old = btn.textContent;
    btn.textContent = "Copied";
    setTimeout(function () { btn.textContent = old; }, 1500);
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

/* Pages */

var NAV = [
  { to: "/projects", label: "Projects" },
  { to: "/team", label: "Team" },
  { to: "/join", label: "Join" }
];

function renderHeader(cfg, route) {
  var links = NAV.map(function (n) {
    return '<a href="#' + n.to + '"' + (route.indexOf(n.to) === 0 ? ' class="active"' : "") + ">" + n.label + "</a>";
  }).join("");

  document.getElementById("site-header").innerHTML =
    '<div class="wrap header-in">' +
      '<a class="brand" href="#/">' + logoHTML("brand-logo") + "<span>" + esc(cfg.site.name) + "</span></a>" +
      '<nav class="main-nav">' + links + "</nav>" +
      '<div class="header-actions">' + accountButtonHTML(cfg) +
        '<button class="icon-btn" id="theme-btn" title="Switch theme" aria-label="Switch theme">' +
          icon(currentTheme() === "dark" ? "sun" : "moon", 17) + "</button>" +
      "</div>" +
    "</div>";

  document.getElementById("theme-btn").addEventListener("click", toggleTheme);
}

function renderFooter(cfg) {
  var year = cfg.footer.copyright || String(new Date().getFullYear());
  var email = cfg.site.email || cfg.join.email;
  var nav = [{ to: "/", label: "Home" }].concat(NAV).map(function (n) {
    return '<a href="#' + n.to + '">' + n.label + "</a>";
  }).join("");
  var socials = cfg.socials.map(function (s) {
    return '<a href="' + esc(s.url || "#") + '" target="_blank" rel="noreferrer">' + icon(s.platform, 15) + esc(socialName(s)) + "</a>";
  }).join("");

  document.getElementById("site-footer").innerHTML =
    '<div class="wrap">' +
      '<div class="footer-grid">' +
        '<div class="footer-brand">' + logoHTML("footer-logo") +
          (cfg.site.tagline ? "<p>" + esc(cfg.site.tagline) + "</p>" : "") + "</div>" +
        '<div class="footer-col"><h4>Site</h4>' + nav + "</div>" +
        '<div class="footer-col"><h4>Find us</h4>' + socials +
          (email ? '<a href="mailto:' + esc(email) + '">' + icon("mail", 15) + esc(email) + "</a>" : "") + "</div>" +
      "</div>" +
      '<div class="footer-bottom">© ' + esc(year) + " " + esc(cfg.site.name) +
        (cfg.footer.note ? " · " + esc(cfg.footer.note) : "") + "</div>" +
    "</div>";
}

function projectCard(p, index) {
  var links = "";
  if (p.site) links += '<a href="' + esc(p.site) + '" target="_blank" rel="noreferrer">Website ' + icon("arrow-up-right", 14) + "</a>";
  if (p.link) links += '<a href="' + esc(p.link) + '" target="_blank" rel="noreferrer">Source ' + icon("arrow-up-right", 14) + "</a>";
  var name = p.readme
    ? '<a class="stretch" href="#/projects/' + esc(p.slug) + '">' + esc(p.name || "") + "</a>"
    : esc(p.name || "");

  return '<article class="card project-card">' +
    '<div class="pc-top"><span class="num">' + pad2(index + 1) + "</span>" + statusPill(p.status) + "</div>" +
    "<h3>" + name + "</h3>" +
    "<p>" + esc(p.description || "") + "</p>" +
    tagsHTML(p.tags) +
    '<div class="pc-foot">' + links +
      (p.readme ? '<span class="pc-go">' + icon("arrow-right", 18) + "</span>" : "") + "</div>" +
    "</article>";
}

function sectionHead(title, linkTo, linkText) {
  return '<div class="sec-head"><h2>' + esc(title) + "</h2>" +
    (linkTo ? '<a href="#' + linkTo + '">' + esc(linkText) + " " + icon("arrow-right", 15) + "</a>" : "") + "</div>";
}

var HOME_PROJECTS = 4;

function plural(n, word) { return n + " " + word + (n === 1 ? "" : "s"); }

function homePage(cfg) {
  var email = cfg.join.email || cfg.site.email;

  var html = '<section class="hero"><div class="wrap hero-in">' +
    '<div class="hero-text">' +
      '<p class="eyebrow"><i class="dot live"></i>' +
        plural(cfg.projects.length, "project") + " · " + plural(cfg.team.length, "person").replace("persons", "people") + "</p>" +
      "<h1>" + esc(cfg.site.tagline || cfg.site.name) + "</h1>" +
      (cfg.site.description ? '<p class="lead">' + esc(cfg.site.description) + "</p>" : "") +
      '<div class="actions">' +
        '<a class="btn btn-solid" href="#/projects">See the projects ' + icon("arrow-right", 16) + "</a>" +
        '<a class="btn" href="#/join">Join us</a>' +
      "</div>" +
    "</div>" +
    '<div class="hero-art">' + logoHTML("hero-logo") + "</div>" +
    "</div></section>";

  if (cfg.projects.length) {
    var more = cfg.projects.length > HOME_PROJECTS;
    html += '<section><div class="wrap">' +
      sectionHead("Projects", more ? "/projects" : "", "All " + cfg.projects.length) +
      '<div class="grid two">' + cfg.projects.slice(0, HOME_PROJECTS).map(projectCard).join("") + "</div>" +
      "</div></section>";
  }

  if (cfg.team.length) {
    html += '<section><div class="wrap">' +
      sectionHead("Team", "/team", "Meet the team") +
      '<div class="grid three">' + cfg.team.map(function (m) {
        return '<a class="card person" href="#/team">' + avatarHTML(m, "mid") +
          "<span><strong>" + esc(m.name || m.username || "") + "</strong>" +
          (m.role ? "<small>" + esc(m.role) + "</small>" : "") + "</span></a>";
      }).join("") + "</div></div></section>";
  }

  html += '<section><div class="wrap"><div class="cta">' +
    "<div><h2>Want to work with us?</h2>" +
    "<p>Show us something you have made" +
      (email ? ', or write to <a href="mailto:' + esc(email) + '">' + esc(email) + "</a>" : "") + ".</p></div>" +
    '<a class="btn btn-invert" href="#/join">How to join ' + icon("arrow-right", 16) + "</a>" +
    "</div></div></section>";

  return html;
}

function projectsPage(cfg) {
  var statuses = [];
  cfg.projects.forEach(function (p) {
    if (p.status && statuses.indexOf(p.status) === -1) statuses.push(p.status);
  });
  if (state.filter !== "all" && statuses.indexOf(state.filter) === -1) state.filter = "all";

  var filters = "";
  if (statuses.length > 1) {
    filters = '<div class="filters">' + ["all"].concat(statuses).map(function (f) {
      return '<button type="button" data-filter="' + esc(f) + '"' + (state.filter === f ? ' class="on"' : "") + ">" +
        esc(cap(f)) + "</button>";
    }).join("") + "</div>";
  }

  var shown = cfg.projects.filter(function (p) {
    return state.filter === "all" || p.status === state.filter;
  });

  return '<section class="page"><div class="wrap">' +
    '<div class="page-head"><h1>Projects</h1><p class="lead">Everything we are working on. All of it is open source.</p></div>' +
    filters +
    (shown.length
      ? '<div class="grid two">' + shown.map(function (p) { return projectCard(p, cfg.projects.indexOf(p)); }).join("") + "</div>"
      : '<p class="mut">Nothing here yet.</p>') +
    "</div></section>";
}

function teamPage(cfg) {
  var people = cfg.team.map(function (m) {
    var name = m.name || m.username || "";
    return '<article class="card member">' + avatarHTML(m, "large") +
      "<h3>" + esc(name) + "</h3>" +
      (m.username && m.username !== name ? '<p class="nick">@' + esc(m.username) + "</p>" : "") +
      (m.role ? '<p class="role">' + esc(m.role) + "</p>" : "") +
      (m.bio ? '<p class="bio">' + esc(m.bio) + "</p>" : "") +
      '<div class="socials">' + socialButtons(m.socials) + "</div>" +
      "</article>";
  }).join("");

  return '<section class="page"><div class="wrap">' +
    '<div class="page-head"><h1>Team</h1><p class="lead">The people behind ' + esc(cfg.site.name) + ".</p></div>" +
    (people ? '<div class="grid three">' + people + "</div>" : '<p class="mut">Nobody is listed yet.</p>') +
    "</div></section>";
}

function joinPage(cfg) {
  var email = cfg.join.email || cfg.site.email || "";
  var mailto = "mailto:" + email + (cfg.join.subject ? "?subject=" + encodeURIComponent(cfg.join.subject) : "");
  var steps = (cfg.join.steps || []).map(function (s, i) {
    return '<li><span class="num">' + pad2(i + 1) + "</span><p>" + esc(s) + "</p></li>";
  }).join("");

  return '<section class="page"><div class="wrap">' +
    '<div class="page-head"><h1>' + esc(cfg.join.title || "Join us") + "</h1>" +
      (cfg.join.intro ? '<p class="lead">' + esc(cfg.join.intro) + "</p>" : "") + "</div>" +
    '<div class="join-grid">' +
      "<div>" + (steps ? '<ol class="steps">' + steps + "</ol>" : "") +
        (cfg.join.note ? '<p class="note">' + esc(cfg.join.note) + "</p>" : "") + "</div>" +
      '<aside class="card join-side">' +
        "<h3>Write to us</h3>" +
        (email
          ? '<p class="join-mail">' + esc(email) + "</p>" +
            '<a class="btn btn-solid wide" href="' + esc(mailto) + '">Open in mail app</a>' +
            '<button type="button" class="btn wide" id="copy-email">Copy address</button>'
          : "") +
        (cfg.socials.length ? '<p class="mut small">Or find us here</p><div class="socials">' + socialButtons(cfg.socials) + "</div>" : "") +
      "</aside>" +
    "</div></div></section>";
}

function projectPage(cfg, slug) {
  var p = null;
  cfg.projects.forEach(function (x) { if (x.slug === slug) p = x; });
  if (!p) return notFoundPage();

  var buttons = "";
  if (p.site) buttons += '<a class="btn btn-solid" href="' + esc(p.site) + '" target="_blank" rel="noreferrer">Website ' + icon("arrow-up-right", 15) + "</a>";
  if (p.link) buttons += '<a class="btn" href="' + esc(p.link) + '" target="_blank" rel="noreferrer">' + icon("github", 16) + " Source code</a>";

  return '<section class="page"><div class="wrap narrow">' +
    '<a class="back" href="#/projects">' + icon("arrow-left", 15) + " All projects</a>" +
    '<div class="page-head">' + statusPill(p.status) +
      "<h1>" + esc(p.name || "") + "</h1>" +
      '<p class="lead">' + esc(p.description || "") + "</p>" +
      tagsHTML(p.tags) +
      (buttons ? '<div class="actions">' + buttons + "</div>" : "") +
    "</div>" +
    '<article class="card prose" id="readme-body">' + (p.readme ? '<p class="mut">Loading…</p>' : "") + "</article>" +
    "</div></section>";
}

// the page already has the project name as its heading, so drop the readme's own
function dropTitle(text) {
  var lines = String(text).replace(/\r/g, "").split("\n");
  for (var i = 0; i < lines.length; i++) {
    if (lines[i].trim() === "" || /^\s*<!--/.test(lines[i])) continue;
    if (/^#\s/.test(lines[i])) lines.splice(i, 1);
    break;
  }
  return lines.join("\n");
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
      if (document.getElementById("readme-body") !== body) return;
      body.innerHTML = renderMarkdown(dropTitle(text));
      wireCopyButtons(body);
    })
    .catch(function () {
      if (document.getElementById("readme-body") !== body) return;
      body.innerHTML = '<p class="mut">The description for this project could not be loaded.' +
        (p.link ? ' It is also on <a href="' + esc(p.link) + '" target="_blank" rel="noreferrer">the project page</a>.' : "") +
        "</p>";
    });
}

function notFoundPage() {
  return '<section class="page"><div class="wrap narrow lost">' +
    '<p class="big">404</p><h1>Page not found</h1>' +
    '<p class="lead">There is nothing at this address.</p>' +
    '<div class="actions"><a class="btn btn-solid" href="#/">Go to the front page</a></div></div></section>';
}

function errorScreen(msg) {
  document.getElementById("site-header").innerHTML = "";
  document.getElementById("site-footer").innerHTML = "";
  document.getElementById("app").innerHTML =
    '<section class="page"><div class="wrap narrow lost"><h1>The site could not be loaded</h1>' +
    '<p class="lead">Something went wrong while reading the site settings. Try refreshing the page.</p>' +
    '<p class="mut small">' + esc(msg) + "</p></div></section>";
}

/* Accounts: who is signed in, and announcements from the api.
   All of it is optional. If the api is down the site renders
   without the sign in button and without banners. */

function accountButtonHTML(cfg) {
  if (!cfg.accounts.enabled || state.account === undefined) return "";
  var me = state.account;
  if (me) {
    var letter = esc((me.displayName || me.username || "?").charAt(0).toUpperCase());
    var img = me.avatarUrl ? '<img src="' + esc(me.avatarUrl) + '" alt="" referrerpolicy="no-referrer" onerror="this.remove()">' : "";
    return '<a class="account-btn" href="' + esc(cfg.accounts.url) + '/#/" title="Your account">' +
      '<span class="account-ava">' + letter + img + '</span><span class="account-name">' + esc(me.username) + "</span></a>";
  }
  var next = encodeURIComponent(window.location.href);
  return '<a class="account-btn" href="' + esc(cfg.accounts.url) + "/#/login?next=" + next + '">Sign in</a>';
}

function dismissed() {
  try { return JSON.parse(localStorage.getItem("fourtexec-dismissed") || "[]"); } catch (e) { return []; }
}

function renderBanners() {
  var el = document.getElementById("site-banners");
  if (!el) return;
  var hidden = dismissed();
  var html = "";
  if (state.maintenance) {
    html += '<div class="site-banner warning"><div class="wrap banner-in"><span>' + esc(state.maintenance) + "</span></div></div>";
  }
  (state.announcements || []).forEach(function (a) {
    if (hidden.indexOf(a.id) !== -1) return;
    html += '<div class="site-banner ' + esc(a.level) + '"><div class="wrap banner-in">' +
      "<span><b>" + esc(a.title) + "</b>" + (a.body ? ": " + esc(a.body) : "") +
      (a.linkUrl ? ' <a href="' + esc(a.linkUrl) + '" target="_blank" rel="noreferrer">' + esc(a.linkLabel || "More") + "</a>" : "") +
      '</span><button class="banner-x" data-dismiss="' + esc(a.id) + '" aria-label="Dismiss">×</button></div></div>';
  });
  el.innerHTML = html;
  el.querySelectorAll("[data-dismiss]").forEach(function (b) {
    b.addEventListener("click", function () {
      var list = dismissed();
      list.push(b.getAttribute("data-dismiss"));
      try { localStorage.setItem("fourtexec-dismissed", JSON.stringify(list.slice(-50))); } catch (e) {}
      renderBanners();
    });
  });
}

function loadAccount(cfg) {
  if (!cfg.accounts.enabled || typeof fetch === "undefined") return;
  var base = cfg.accounts.api;
  var get = function (path) {
    return fetch(base + path, { credentials: "include" }).then(function (r) {
      if (r.status === 401) return null;
      if (!r.ok) throw new Error("api " + r.status);
      return r.json();
    });
  };
  get("/v1/me").then(function (res) {
    state.account = res ? res.user : null;
    renderHeader(state.config, state.route);
  }).catch(function () { /* api offline: keep the header as is */ });
  get("/v1/public/announcements").then(function (res) {
    state.announcements = (res && res.items) || [];
    renderBanners();
  }).catch(function () {});
  get("/v1/public/config").then(function (res) {
    state.maintenance = (res && res.maintenanceMessage) || "";
    renderBanners();
  }).catch(function () {});
}

/* State, routing, theme */

var state = {
  config: null,
  route: "/",
  filter: "all",
  account: undefined,      // undefined = unknown, null = signed out
  announcements: [],
  maintenance: ""
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
  var title = "";

  if (route === "/") app.innerHTML = homePage(cfg);
  else if (route === "/projects" || route === "/projects/") { app.innerHTML = projectsPage(cfg); title = "Projects"; }
  else if (m) {
    app.innerHTML = projectPage(cfg, m[1]);
    cfg.projects.forEach(function (x) { if (x.slug === m[1]) detailProject = x; });
    title = detailProject ? detailProject.name : "Page not found";
  }
  else if (route === "/team" || route === "/team/") { app.innerHTML = teamPage(cfg); title = "Team"; }
  else if (route === "/join" || route === "/join/") { app.innerHTML = joinPage(cfg); title = cfg.join.title || "Join us"; }
  else { app.innerHTML = notFoundPage(); title = "Page not found"; }

  document.title = (title ? title + " · " : "") + cfg.site.name;
  renderHeader(cfg, route);
  renderFooter(cfg);

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
  if (detailProject) loadReadme(detailProject);
}

function toggleTheme() {
  var next = currentTheme() === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem("fourtexec-theme", next); } catch (e) {}
  // the logo and the button icon follow the theme
  if (state.config) render();
}

function boot() {
  loadConfig()
    .then(function (cfg) {
      state.config = cfg;
      state.route = parseRoute();
      render();
      loadAccount(cfg);
    })
    .catch(function (err) {
      errorScreen(err.message || String(err));
    });

  window.addEventListener("hashchange", function () {
    if (!state.config) return;
    state.route = parseRoute();
    window.scrollTo(0, 0);
    render();
  });
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
}

// lets node require() the pure parts for testing; browsers ignore this
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
