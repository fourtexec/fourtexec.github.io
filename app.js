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

/* Small helpers */

var SUN = '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.9 4.9 1.4 1.4"/><path d="m17.7 17.7 1.4 1.4"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.3 17.7-1.4 1.4"/><path d="m19.1 4.9-1.4 1.4"/>';
var MOON = '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>';

function themeIcon() {
  return '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    (currentTheme() === "dark" ? SUN : MOON) + "</svg>";
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

function socialLinks(list) {
  return (list || []).map(function (s) {
    return '<a href="' + esc(s.url || "#") + '" target="_blank" rel="noreferrer">' + esc(socialName(s)) + "</a>";
  }).join(" · ");
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
        '<button class="theme-btn" id="theme-btn" title="Switch theme" aria-label="Switch theme">' + themeIcon() + "</button>" +
      "</div>" +
    "</div>";

  document.getElementById("theme-btn").addEventListener("click", toggleTheme);
}

function renderFooter(cfg) {
  var year = cfg.footer.copyright || String(new Date().getFullYear());
  var links = socialLinks(cfg.socials);
  var email = cfg.site.email || cfg.join.email;
  if (email) links += (links ? " · " : "") + '<a href="mailto:' + esc(email) + '">' + esc(email) + "</a>";

  document.getElementById("site-footer").innerHTML =
    '<div class="wrap footer-in">' +
      "<span>© " + esc(year) + " " + esc(cfg.site.name) +
        (cfg.footer.note ? " · " + esc(cfg.footer.note) : "") + "</span>" +
      "<span>" + links + "</span>" +
    "</div>";
}

function projectItem(p) {
  var links = [];
  if (p.readme) links.push('<a href="#/projects/' + esc(p.slug) + '">Read more</a>');
  if (p.site) links.push('<a href="' + esc(p.site) + '" target="_blank" rel="noreferrer">Website</a>');
  if (p.link) links.push('<a href="' + esc(p.link) + '" target="_blank" rel="noreferrer">Source</a>');
  var title = p.readme
    ? '<a href="#/projects/' + esc(p.slug) + '">' + esc(p.name || "") + "</a>"
    : esc(p.name || "");

  return '<li class="project">' +
    "<h3>" + title + (p.status ? ' <span class="status">' + esc(p.status) + "</span>" : "") + "</h3>" +
    "<p>" + esc(p.description || "") + "</p>" +
    '<p class="project-meta">' +
      (p.tags.length ? "<span>" + esc(p.tags.join(", ")) + "</span>" : "") +
      (links.length ? "<span>" + links.join(" · ") + "</span>" : "") +
    "</p></li>";
}

var HOME_PROJECTS = 5;

function homePage(cfg) {
  var html = '<div class="wrap">' +
    '<section class="intro">' +
      logoHTML("intro-logo") +
      "<h1>" + esc(cfg.site.tagline || cfg.site.name) + "</h1>" +
      (cfg.site.description ? "<p>" + esc(cfg.site.description) + "</p>" : "") +
    "</section>";

  if (cfg.projects.length) {
    html += "<section><h2>Projects</h2>" +
      '<ul class="projects">' + cfg.projects.slice(0, HOME_PROJECTS).map(projectItem).join("") + "</ul>" +
      (cfg.projects.length > HOME_PROJECTS
        ? '<p><a href="#/projects">All ' + cfg.projects.length + " projects</a></p>"
        : "") +
      "</section>";
  }

  if (cfg.team.length) {
    html += "<section><h2>Team</h2>" +
      '<div class="people">' + cfg.team.map(function (m) {
        return '<a class="person" href="#/team">' + avatarHTML(m, "small") +
          "<span>" + esc(m.name || m.username || "") + "</span></a>";
      }).join("") + "</div></section>";
  }

  var email = cfg.join.email || cfg.site.email;
  html += "<section><h2>Contact</h2><p>" +
    (email ? 'Write to <a href="mailto:' + esc(email) + '">' + esc(email) + "</a>. " : "") +
    'If you want to work with us, see <a href="#/join">how to join</a>.</p>' +
    (cfg.socials.length ? "<p>" + socialLinks(cfg.socials) + "</p>" : "") +
    "</section></div>";

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
    filters = '<p class="filters">' + ["all"].concat(statuses).map(function (f) {
      return '<button type="button" data-filter="' + esc(f) + '"' + (state.filter === f ? ' class="on"' : "") + ">" +
        esc(cap(f)) + "</button>";
    }).join("") + "</p>";
  }

  var shown = cfg.projects.filter(function (p) {
    return state.filter === "all" || p.status === state.filter;
  });

  return '<div class="wrap"><section><h1>Projects</h1>' + filters +
    (shown.length
      ? '<ul class="projects">' + shown.map(projectItem).join("") + "</ul>"
      : '<p class="mut">Nothing here yet.</p>') +
    "</section></div>";
}

function teamPage(cfg) {
  var people = cfg.team.map(function (m) {
    var name = m.name || m.username || "";
    var nick = m.username && m.username !== name ? ' <span class="nick">' + esc(m.username) + "</span>" : "";
    var links = socialLinks(m.socials);
    return '<li class="member">' + avatarHTML(m, "large") +
      "<div><h3>" + esc(name) + nick + "</h3>" +
      (m.role ? '<p class="role">' + esc(m.role) + "</p>" : "") +
      (m.bio ? "<p>" + esc(m.bio) + "</p>" : "") +
      (links ? '<p class="member-links">' + links + "</p>" : "") +
      "</div></li>";
  }).join("");

  return '<div class="wrap"><section><h1>Team</h1>' +
    (people ? '<ul class="members">' + people + "</ul>" : '<p class="mut">Nobody is listed yet.</p>') +
    "</section></div>";
}

function joinPage(cfg) {
  var email = cfg.join.email || cfg.site.email || "";
  var mailto = "mailto:" + email + (cfg.join.subject ? "?subject=" + encodeURIComponent(cfg.join.subject) : "");
  var steps = (cfg.join.steps || []).map(function (s) { return "<li>" + esc(s) + "</li>"; }).join("");

  return '<div class="wrap"><section class="join"><h1>' + esc(cfg.join.title || "Join us") + "</h1>" +
    (cfg.join.intro ? "<p>" + esc(cfg.join.intro) + "</p>" : "") +
    (steps ? "<ol>" + steps + "</ol>" : "") +
    (email
      ? '<p class="mail-row"><a class="btn btn-solid" href="' + esc(mailto) + '">Email ' + esc(email) + "</a>" +
        '<button type="button" class="btn" id="copy-email">Copy address</button></p>'
      : "") +
    (cfg.join.note ? '<p class="mut">' + esc(cfg.join.note) + "</p>" : "") +
    (cfg.socials.length ? "<p>You can also find us here: " + socialLinks(cfg.socials) + "</p>" : "") +
    "</section></div>";
}

function projectPage(cfg, slug) {
  var p = null;
  cfg.projects.forEach(function (x) { if (x.slug === slug) p = x; });
  if (!p) return notFoundPage();

  var meta = [];
  if (p.status) meta.push(esc(cap(p.status)));
  if (p.tags.length) meta.push(esc(p.tags.join(", ")));

  var buttons = "";
  if (p.site) buttons += '<a class="btn btn-solid" href="' + esc(p.site) + '" target="_blank" rel="noreferrer">Website</a>';
  if (p.link) buttons += '<a class="btn" href="' + esc(p.link) + '" target="_blank" rel="noreferrer">Source code</a>';

  return '<div class="wrap"><section class="project-page">' +
    '<p class="back"><a href="#/projects">← All projects</a></p>' +
    "<h1>" + esc(p.name || "") + "</h1>" +
    '<p class="lead">' + esc(p.description || "") + "</p>" +
    (meta.length ? '<p class="project-meta"><span>' + meta.join(" · ") + "</span></p>" : "") +
    (buttons ? '<p class="mail-row">' + buttons + "</p>" : "") +
    '<article id="readme-body">' + (p.readme ? '<p class="mut">Loading…</p>' : "") + "</article>" +
    "</section></div>";
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
  return '<div class="wrap"><section><h1>Page not found</h1>' +
    '<p>There is nothing at this address. <a href="#/">Go to the front page</a>.</p></section></div>';
}

function errorScreen(msg) {
  document.getElementById("site-header").innerHTML = "";
  document.getElementById("site-footer").innerHTML = "";
  document.getElementById("app").innerHTML =
    '<div class="wrap"><section><h1>The site could not be loaded</h1>' +
    "<p>Something went wrong while reading the site settings. Try refreshing the page.</p>" +
    '<p class="mut">' + esc(msg) + "</p></section></div>";
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
