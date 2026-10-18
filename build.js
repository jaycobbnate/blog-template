// 나만의 블로그 만들기 틀 — 이 파일은 고치지 않아도 됩니다.
// posts 폴더의 md 글을 읽어서, 최신 글이 맨 위에 오는 블로그(public 폴더)를 만듭니다.
// 설치할 것 없음(외부 패키지 0개). 버셀이 올릴 때마다 자동으로 실행합니다.

const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const POSTS_DIR = path.join(ROOT, "posts");
const OUT_DIR = path.join(ROOT, "public");
const SETTINGS_FILE = path.join(ROOT, "settings.md");

// ---------- 작은 도우미 ----------
const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const safeUrl = (u) => {
  const t = String(u || "").trim();
  if (/^(https?:|mailto:|#|\/|\.\/|\.\.\/)/i.test(t) || !/^[a-z][a-z0-9+.-]*:/i.test(t)) return t;
  return "#"; // javascript: 같은 위험한 주소는 막음
};

// ---------- 머리말(frontmatter) 읽기 ----------
function parseFrontmatter(raw) {
  const text = raw.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const m = text.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return { data: {}, body: text };
  const data = {};
  let lastKey = null;
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^([A-Za-z0-9_\-가-힣]+):\s*(.*)$/);
    if (kv) {
      lastKey = kv[1].trim().toLowerCase();
      let v = kv[2].trim();
      if (v.startsWith("[") && v.endsWith("]")) {
        v = v.slice(1, -1).split(",").map((x) => unquote(x.trim())).filter(Boolean);
      } else {
        v = unquote(v);
      }
      data[lastKey] = v === "" ? [] : v;
    } else {
      const item = line.match(/^\s*-\s+(.*)$/);
      if (item && lastKey) {
        if (!Array.isArray(data[lastKey])) data[lastKey] = data[lastKey] ? [data[lastKey]] : [];
        data[lastKey].push(unquote(item[1].trim()));
      }
    }
  }
  for (const k of Object.keys(data)) {
    if (Array.isArray(data[k]) && data[k].length === 0) data[k] = "";
  }
  return { data, body: text.slice(m[0].length) };
}
function unquote(v) {
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) return v.slice(1, -1);
  return v;
}

// ---------- 날짜 읽기 (date → created → published 순서로 찾음) ----------
function readDate(data) {
  for (const key of ["date", "created", "published", "날짜"]) {
    const v = Array.isArray(data[key]) ? data[key][0] : data[key];
    if (!v) continue;
    const str = String(v).replace(/(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일?/, "$1-$2-$3");
    const m = str.match(/(\d{4})[-./]\s*(\d{1,2})[-./]\s*(\d{1,2})(?:[ T]+(\d{1,2}):(\d{2}))?/);
    if (m) {
      const [, y, mo, d, h = "0", mi = "0"] = m;
      return {
        sort: Number(y) * 1e8 + Number(mo) * 1e6 + Number(d) * 1e4 + Number(h) * 100 + Number(mi),
        label: `${y}.${String(mo).padStart(2, "0")}.${String(d).padStart(2, "0")}`,
      };
    }
  }
  return { sort: 0, label: "" };
}

// ---------- 마크다운 → HTML (블로그에 필요한 만큼만) ----------
function inline(s) {
  // 옵시디언 그림 넣기 ![[그림.png]] 는 인터넷에 없으니 빼기
  s = s.replace(/!\[\[[^\]]*\]\]/g, "");
  const codes = [];
  s = s.replace(/`([^`]+)`/g, (_, c) => `\u0000${codes.push(c) - 1}\u0000`);
  s = esc(s);
  // 옵시디언 링크 [[글 제목|보이는 글자]] → 글자만
  s = s.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2").replace(/\[\[([^\]]+)\]\]/g, "$1");
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g, (_, alt, src) =>
    `<img src="${esc(safeUrl(src.replace(/&amp;/g, "&")))}" alt="${alt}" loading="lazy">`);
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g, (_, txt, href) =>
    `<a href="${esc(safeUrl(href.replace(/&amp;/g, "&")))}" target="_blank" rel="noopener">${txt}</a>`);
  s = s.replace(/(^|[\s(])(https?:\/\/[^\s<]+)/g, (_, pre, url) =>
    `${pre}<a href="${url}" target="_blank" rel="noopener">${url}</a>`);
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/__([^_]+)__/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>");
  s = s.replace(/~~([^~]+)~~/g, "<del>$1</del>");
  s = s.replace(/==([^=]+)==/g, "<mark>$1</mark>");
  s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${esc(codes[i])}</code>`);
  return s;
}

function markdownToHtml(md) {
  const lines = md.split("\n");
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*$/.test(line)) { i++; continue; }

    const fence = line.match(/^\s*(```|~~~)/);
    if (fence) {
      const buf = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) buf.push(lines[i++]);
      i++;
      out.push(`<pre><code>${esc(buf.join("\n"))}</code></pre>`);
      continue;
    }
    const h = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (h) {
      const lv = Math.min(h[1].length + 1, 6); // 글 안의 # 은 h2부터 (h1은 글 제목)
      out.push(`<h${lv}>${inline(h[2])}</h${lv}>`);
      i++; continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { out.push("<hr>"); i++; continue; }

    if (/^\s*>/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ""));
      // 옵시디언 콜아웃 > [!note] 제목 → 제목만 굵게
      if (/^\[!\w+\]/.test(buf[0] || "")) buf[0] = buf[0].replace(/^\[!\w+\][+-]?\s*/, "**") + (buf[0].replace(/^\[!\w+\][+-]?\s*/, "") ? "**" : "");
      out.push(`<blockquote>${markdownToHtml(buf.join("\n"))}</blockquote>`);
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      const cells = (l) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => inline(c.trim()));
      const head = cells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(cells(lines[i++]));
      out.push(`<div class="table"><table><thead><tr>${head.map((c) => `<th>${c}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`);
      continue;
    }
    const listRe = /^\s*([-*+]|\d+[.)])\s+(.*)$/;
    if (listRe.test(line)) {
      const ordered = /^\s*\d/.test(line);
      const items = [];
      while (i < lines.length && listRe.test(lines[i])) {
        let t = lines[i].match(listRe)[2];
        t = t.replace(/^\[ \]\s*/, "☐ ").replace(/^\[[xX]\]\s*/, "☑ ");
        items.push(`<li>${inline(t)}</li>`);
        i++;
      }
      out.push(ordered ? `<ol>${items.join("")}</ol>` : `<ul>${items.join("")}</ul>`);
      continue;
    }
    const buf = [];
    while (
      i < lines.length && !/^\s*$/.test(lines[i]) && !/^(#{1,6})\s/.test(lines[i]) &&
      !/^\s*(```|~~~|>)/.test(lines[i]) && !listRe.test(lines[i]) && !/^\s*\|.*\|\s*$/.test(lines[i])
    ) buf.push(lines[i++]);
    out.push(`<p>${buf.map(inline).join("<br>")}</p>`);
  }
  return out.join("\n");
}

// ---------- 글 모으기 ----------
function firstHeading(body) {
  const m = body.match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : "";
}
function plainSummary(body, n = 90) {
  const t = body
    .replace(/^#.*$/gm, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/!\[\[[^\]]*\]\]/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\[\[([^\]|]+)\|?([^\]]*)\]\]/g, (_, a, b) => b || a)
    .replace(/[*_>`#|~=-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return t.length > n ? t.slice(0, n) + "…" : t;
}

function loadSettings() {
  const def = { blog_title: "나의 블로그", author: "", intro: "" };
  if (!fs.existsSync(SETTINGS_FILE)) return def;
  const { data } = parseFrontmatter(fs.readFileSync(SETTINGS_FILE, "utf8"));
  return { ...def, ...data };
}

function loadPosts() {
  if (!fs.existsSync(POSTS_DIR)) return [];
  const files = [];
  (function walk(dir) {
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      if (fs.statSync(p).isDirectory()) walk(p);
      else if (/\.md$/i.test(name)) files.push(p);
    }
  })(POSTS_DIR);

  const posts = [];
  for (const file of files) {
    const { data, body } = parseFrontmatter(fs.readFileSync(file, "utf8"));
    if (String(data.draft).toLowerCase() === "true" || data.공개 === "아니오") continue; // 숨길 글
    const base = path.basename(file, path.extname(file));
    let title = (Array.isArray(data.title) ? data.title.join(", ") : data.title) || firstHeading(body) || base;
    let content = body;
    // 본문 첫 줄의 # 제목이 글 제목과 같으면 한 번만 보이게
    const fh = firstHeading(body);
    if (fh && fh === title) content = body.replace(/^#\s+.+$/m, "");
    const date = readDate(data);
    const tags = [].concat(data.tags || []).flatMap((t) => String(t).split(/[,\s]+/)).map((t) => t.replace(/^#/, "")).filter(Boolean);
    const source = Array.isArray(data.source) ? data.source[0] : data.source || data.출처 || "";
    const summary = (Array.isArray(data.summary) ? data.summary.join(" ") : data.summary) || data.description || plainSummary(content);
    posts.push({ file: base, title, date, tags, source, summary, html: markdownToHtml(content) });
  }
  // 최신 글이 맨 위 (같은 날짜면 파일 이름 순)
  posts.sort((a, b) => b.date.sort - a.date.sort || a.file.localeCompare(b.file, "ko"));
  // 주소는 "날짜-파일이름표시"로 (한글 파일 이름이어도 안전, 글을 추가해도 주소가 안 바뀜)
  const used = new Set();
  posts.forEach((p) => {
    const d = p.date.label ? p.date.label.replace(/\./g, "") : "nodate";
    let h = 0;
    for (const ch of p.file) h = (h * 31 + ch.codePointAt(0)) >>> 0;
    let slug = `${d}-${h.toString(36)}`;
    while (used.has(slug)) slug += "x";
    used.add(slug);
    p.slug = slug;
  });
  return posts;
}

// ---------- 화면 모양 ----------
// 디자인은 style.css 파일에 있습니다. (없으면 아래 기본 디자인을 씁니다)
const DEFAULT_CSS = `:root{--bg:#fbfaf7;--card:#fff;--line:#e6e3dc;--text:#22211f;--muted:#6f6c66;--accent:#1e5aa8;--accent-soft:#e8f0fb}
@media (prefers-color-scheme:dark){:root{--bg:#161615;--card:#1f1f1d;--line:#34332f;--text:#ecebe6;--muted:#a3a19a;--accent:#7fb0f0;--accent-soft:#1d2a3b}}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--text);font-family:"Pretendard","Apple SD Gothic Neo","Malgun Gothic",system-ui,sans-serif;font-size:19px;line-height:1.75;word-break:keep-all;overflow-wrap:anywhere}
a{color:var(--accent)}
.wrap{max-width:760px;margin:0 auto;padding:0 18px}
header.site{border-bottom:1px solid var(--line);background:var(--card)}
header.site .wrap{padding-top:34px;padding-bottom:26px}
header.site h1{margin:0;font-size:30px;line-height:1.3}
header.site h1 a{color:inherit;text-decoration:none}
header.site p{margin:8px 0 0;color:var(--muted)}
main{padding:28px 0 60px}
.count{color:var(--muted);font-size:16px;margin:0 0 14px}
.card{display:block;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:20px 22px;margin:0 0 14px;color:inherit;text-decoration:none;transition:border-color .15s}
.card:hover{border-color:var(--accent)}
.card .meta{display:flex;gap:8px;align-items:center;flex-wrap:wrap;color:var(--muted);font-size:15px}
.new{background:var(--accent);color:#fff;border-radius:999px;padding:1px 10px;font-size:13px}
.card h2{margin:6px 0 6px;font-size:22px;line-height:1.4}
.card p{margin:0;color:var(--muted);font-size:17px}
.tag{background:var(--accent-soft);color:var(--accent);border-radius:999px;padding:0 9px;font-size:13px}
article{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:26px 24px}
article h1{font-size:28px;line-height:1.35;margin:4px 0 10px}
article .meta{color:var(--muted);font-size:15px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;border-bottom:1px solid var(--line);padding-bottom:14px;margin-bottom:8px}
article img{max-width:100%;height:auto;border-radius:10px}
article blockquote{margin:16px 0;padding:6px 18px;border-left:3px solid var(--accent);background:var(--accent-soft);border-radius:0}
article pre{background:var(--bg);border:1px solid var(--line);border-radius:10px;padding:14px;overflow:auto;font-size:15px}
article code{font-size:.9em}
.table{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:16px}th,td{border:1px solid var(--line);padding:6px 10px;text-align:left}
.source{margin-top:22px;padding:14px 16px;border:1px solid var(--line);border-radius:10px;font-size:16px}
.back{display:inline-block;margin:0 0 16px;text-decoration:none}
footer{color:var(--muted);font-size:14px;text-align:center;padding:0 18px 40px}
.empty{background:var(--card);border:1px dashed var(--line);border-radius:14px;padding:30px;text-align:center;color:var(--muted)}`;
const STYLE_FILE = path.join(ROOT, "style.css");
const IMAGES_DIR = path.join(ROOT, "images");
function loadCss() {
  return fs.existsSync(STYLE_FILE) ? fs.readFileSync(STYLE_FILE, "utf8") : DEFAULT_CSS;
}

function page({ title, settings, body, depth = 0 }) {
  const home = depth ? "../index.html" : "index.html"; // 내 PC에서 열어 봐도 목록으로 잘 돌아가게
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><meta name="description" content="${esc(settings.intro)}">
<link rel="stylesheet" href="${depth ? "../" : ""}style.css"></head>
<body><header class="site"><div class="wrap"><h1><a href="${home}">${esc(settings.blog_title)}</a></h1>${settings.intro ? `<p>${esc(settings.intro)}</p>` : ""}</div></header>
<main><div class="wrap">${body}</div></main>
<footer>${settings.author ? esc(settings.author) + " · " : ""}옵시디언에서 쓰고, 깃허브에 올리면, 버셀이 띄웁니다</footer>
</body></html>`;
}

function tagsHtml(tags) {
  return tags.map((t) => `<span class="tag">#${esc(t)}</span>`).join("");
}

function build() {
  const settings = loadSettings();
  const posts = loadPosts();
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(path.join(OUT_DIR, "post"), { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, "style.css"), loadCss());
  if (fs.existsSync(IMAGES_DIR)) fs.cpSync(IMAGES_DIR, path.join(OUT_DIR, "images"), { recursive: true });

  const list = posts.length
    ? `<p class="count">글 ${posts.length}편 · 최신 글이 맨 위</p>` +
      posts.map((p, i) => `<a class="card" href="post/${p.slug}.html">
<div class="meta">${i === 0 ? '<span class="new">최신</span>' : ""}${p.date.label ? `<span>${p.date.label}</span>` : "<span>날짜 없음</span>"}${tagsHtml(p.tags)}</div>
<h2>${esc(p.title)}</h2><p>${esc(p.summary)}</p></a>`).join("\n")
    : `<div class="empty">아직 글이 없습니다. posts 폴더에 md 글을 올려 보세요.</div>`;
  fs.writeFileSync(path.join(OUT_DIR, "index.html"), page({ title: settings.blog_title, settings, body: list }));

  for (const p of posts) {
    const body = `<a class="back" href="../index.html">← 글 목록</a><article>
<h1>${esc(p.title)}</h1>
<div class="meta">${p.date.label ? `<span>${p.date.label}</span>` : ""}${tagsHtml(p.tags)}</div>
${p.html}
${p.source ? `<div class="source">출처 · <a href="${esc(safeUrl(p.source))}" target="_blank" rel="noopener">${esc(p.source)}</a></div>` : ""}
</article>`;
    // 글 안의 내 그림(images/…)은 한 단계 위를 보게
    const fixed = body.replace(/src="(?!https?:|data:|\/)(?:\.\/)?/g, 'src="../');
    fs.writeFileSync(path.join(OUT_DIR, "post", `${p.slug}.html`), page({ title: `${p.title} · ${settings.blog_title}`, settings, body: fixed, depth: 1 }));
  }
  console.log(`블로그 완성: 글 ${posts.length}편 → public 폴더 (미리보기: public/index.html 더블클릭)`);
  posts.forEach((p, i) => console.log(`  ${i + 1}. [${p.date.label || "날짜 없음"}] ${p.title}`));
  return { settings, posts };
}

// ---------- 한 파일짜리 HTML (node build.js --single) ----------
// 파일 하나만 있으면 어디서든 열리는 블로그. 디자인은 파일 안에, 내 그림은 base64로 파일 안에 넣음.
const MIME = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml" };
function embedImages(html) {
  return html.replace(/src="(?!https?:|data:)(?:\.\/)?([^"]+)"/g, (m, rel) => {
    const f = path.join(ROOT, decodeURIComponent(rel));
    const mime = MIME[path.extname(f).toLowerCase()];
    if (!mime || !fs.existsSync(f)) return m;
    return `src="data:${mime};base64,${fs.readFileSync(f).toString("base64")}"`;
  });
}
function buildSingle({ settings, posts }) {
  const list = posts.length
    ? `<p class="count">글 ${posts.length}편 · 최신 글이 맨 위</p>` +
      posts.map((p, i) => `<a class="card" href="#${p.slug}">
<div class="meta">${i === 0 ? '<span class="new">최신</span>' : ""}${p.date.label ? `<span>${p.date.label}</span>` : "<span>날짜 없음</span>"}${tagsHtml(p.tags)}</div>
<h2>${esc(p.title)}</h2><p>${esc(p.summary)}</p></a>`).join("\n")
    : `<div class="empty">아직 글이 없습니다.</div>`;
  const articles = posts.map((p) => `<article id="${p.slug}" style="margin-top:28px">
<h1>${esc(p.title)}</h1>
<div class="meta">${p.date.label ? `<span>${p.date.label}</span>` : ""}${tagsHtml(p.tags)}</div>
${p.html}
${p.source ? `<div class="source">출처 · <a href="${esc(safeUrl(p.source))}" target="_blank" rel="noopener">${esc(p.source)}</a></div>` : ""}
<p style="margin-top:18px"><a href="#top">↑ 글 목록으로</a></p>
</article>`).join("\n");
  const html = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(settings.blog_title)}</title><style>${loadCss()}</style></head>
<body id="top"><header class="site"><div class="wrap"><h1>${esc(settings.blog_title)}</h1>${settings.intro ? `<p>${esc(settings.intro)}</p>` : ""}</div></header>
<main><div class="wrap">${list}${articles}</div></main>
<footer>${settings.author ? esc(settings.author) + " · " : ""}한 파일로 묶은 블로그</footer>
</body></html>`;
  const out = path.join(ROOT, "blog-single.html");
  fs.writeFileSync(out, embedImages(html));
  console.log(`한 파일 블로그 완성 → blog-single.html (이 파일 하나만 보내도 열립니다)`);
}

const result = build();
if (process.argv.includes("--single")) buildSingle(result);
