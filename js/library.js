/* v1.11.0 资料库（纯增量）
   用户上传学习资料，支持表格 / 文本 / PDF / 图片 / Office 等常见格式。
   元数据 + 内容以 dataURL 存 smartQuiz.library.v1（已加入账号隔离 KEYS），单文件限 1MB。
   事件用 data-action^="lib-" + stopImmediatePropagation 隔离。 */
(function (global) {
  const Quiz = global.Quiz = global.Quiz || {};
  const util = Quiz.util, gate = Quiz.accountGate;
  const e = v => util.esc(v == null ? '' : String(v));
  const $ = id => global.document && global.document.getElementById(id);
  const KEY = 'smartQuiz.library.v1';
  const MAX = 1024 * 1024;                 // 单文件 1MB
  const S = Quiz.libraryState = {kw: '', preview: '', tab: 'mine', err: '', busy: false};

  const LS = () => { try { return global.localStorage || null; } catch (x) { return null; } };
  function read() {
    let o = null;
    try { o = JSON.parse((LS() && LS().getItem(KEY)) || '[]'); } catch (x) {}
    return Array.isArray(o) ? o : [];
  }
  function write(list) {
    try { LS() && LS().setItem(KEY, JSON.stringify(list)); } catch (x) {}
    /* v1.12.5：资料库写入后自动保存到当前账号快照 */
    try { if (Quiz.accountGate && Quiz.accountGate.touch) Quiz.accountGate.touch(); } catch (x) {}
  }
  function owner() { return (gate && gate.state && gate.state.activeId) || 'local'; }
  function ownerName() { return (gate && gate.currentName && gate.currentName()) || '本机用户'; }
  function isAdmin() { return !!(gate && gate.isAdmin && gate.isAdmin()); }

  const TYPES = [
    {ext: ['xlsx', 'xls'], label: '表格', icon: '▦', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'},
    {ext: ['csv', 'tsv'], label: '表格', icon: '▦', mime: 'text/csv'},
    {ext: ['txt', 'md', 'json'], label: '文本', icon: '≡', mime: 'text/plain'},
    {ext: ['pdf'], label: 'PDF', icon: '▤', mime: 'application/pdf'},
    {ext: ['docx', 'doc'], label: '文档', icon: '▤', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'},
    {ext: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'], label: '图片', icon: '▧', mime: 'image/*'},
    {ext: ['pptx', 'ppt'], label: '演示', icon: '▥', mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation'}
  ];
  const ACCEPT = '.xlsx,.xls,.csv,.tsv,.txt,.md,.json,.pdf,.doc,.docx,.png,.jpg,.jpeg,.gif,.webp,.svg,.pptx,.ppt';
  function extOf(name) {
    const m = String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/);
    return m ? m[1] : '';
  }
  function typeOf(name) {
    const x = extOf(name);
    return TYPES.filter(t => t.ext.indexOf(x) >= 0)[0] || {label: '文件', icon: '▤', mime: 'application/octet-stream'};
  }
  function sizeText(n) {
    n = Number(n) || 0;
    return n < 1024 ? n + ' B' : (n < 1024 * 1024 ? (n / 1024).toFixed(1) + ' KB' : (n / 1024 / 1024).toFixed(2) + ' MB');
  }
  function parseDataUrl(d) {
    const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(d || '');
    return m ? {mime: m[1] || 'text/plain', base64: !!m[2], body: m[3]} : null;
  }
  function dataUrlToBlob(d) {
    const p = parseDataUrl(d);
    if (!p) return null;
    try {
      const bin = p.base64 ? global.atob(p.body) : global.decodeURIComponent(p.body);
      const arr = new global.Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      return new global.Blob([arr], {type: p.mime});
    } catch (x) { return null; }
  }
  function textContent(item) {
    const p = parseDataUrl(item.data);
    if (!p) return '';
    try { return p.base64 ? global.decodeURIComponent(escape(global.atob(p.body))) : global.decodeURIComponent(p.body); }
    catch (x) { return p.base64 ? '' : p.body; }
  }

  /* ---------------- 对外 API ---------------- */
  function list(opts) {
    const all = read();
    if (!opts || !opts.all) return all.filter(x => x.owner === owner()).slice();
    return all.slice();
  }
  function add(fileObj) {
    const all = read();
    if (all.length >= 60) return {ok: false, msg: '资料数量已达上限（60 份）'};
    if (!fileObj || !fileObj.name || !fileObj.data) return {ok: false, msg: '文件无效'};
    if (fileObj.size > MAX) return {ok: false, msg: '单文件不能超过 1 MB'};
    const item = {
      id: util.uid('lib'), name: String(fileObj.name).slice(0, 120),
      ext: extOf(fileObj.name), type: typeOf(fileObj.name).label,
      size: Number(fileObj.size) || 0, mime: fileObj.mime || typeOf(fileObj.name).mime,
      at: util.now(), owner: owner(), ownerName: ownerName(), data: fileObj.data
    };
    all.unshift(item);
    try { write(all); } catch (x) { return {ok: false, msg: '浏览器存储空间不足，请删除部分资料后重试'}; }
    return {ok: true, item: item};
  }
  function remove(id) {
    const all = read(), item = all.filter(x => x.id === id)[0];
    if (!item) return {ok: false, msg: '资料不存在'};
    if (item.owner !== owner() && !isAdmin()) return {ok: false, msg: '只能删除自己的资料'};
    write(all.filter(x => x.id !== id));
    return {ok: true};
  }
  function readFiles(fileList, cb) {
    const files = Array.prototype.slice.call(fileList || []);
    if (!files.length) { cb && cb({ok: false, msg: '未选择文件'}); return; }
    let done = 0, ok = 0, errs = [];
    files.forEach(f => {
      if (f.size > MAX) { errs.push(f.name + ' 超过 1 MB'); done++; if (done === files.length) finish(); return; }
      const fr = new global.FileReader();
      fr.onload = function () {
        const r = add({name: f.name, size: f.size, mime: f.type, data: String(fr.result || '')});
        if (r.ok) ok++; else errs.push(f.name + '：' + r.msg);
        done++; if (done === files.length) finish();
      };
      fr.onerror = function () { errs.push(f.name + ' 读取失败'); done++; if (done === files.length) finish(); };
      try { fr.readAsDataURL(f); } catch (x) { errs.push(f.name + ' 读取失败'); done++; if (done === files.length) finish(); }
    });
    function finish() { cb && cb({ok: ok > 0, added: ok, errors: errs}); }
  }
  function count() { return list().length; }

  /* ---------------- 页面 ---------------- */
  function tabs() {
    const items = [['mine', '我的资料'], ['all', '全部资料']];
    return '<div class="tabs lib-tabs">' + items.map(x =>
      '<button class="tab' + (S.tab === x[0] ? ' on' : '') + '" data-action="lib-tab" data-tab="' + x[0] + '">' + x[1] + '</button>').join('') + '</div>';
  }
  function previewHtml(item) {
    const x = item.ext;
    let h = '<div class="blank-panel lib-preview"><div class="panel-h">' + e(item.name) +
      ' <span class="sub">' + e(typeOf(item.name).label) + ' · ' + sizeText(item.size) + '</span></div>';
    if (/^(png|jpg|jpeg|gif|webp|svg)$/.test(x)) {
      h += '<div class="lib-media"><img src="' + e(item.data) + '" alt="' + e(item.name) + '" style="max-width:100%;max-height:520px"></div>';
    } else if (x === 'pdf') {
      h += '<div class="lib-media"><iframe src="' + e(item.data) + '" title="' + e(item.name) + '" style="width:100%;height:520px;border:1px solid var(--border);border-radius:8px"></iframe></div>';
    } else if (/^(txt|md|json|csv|tsv)$/.test(x)) {
      const t = textContent(item);
      h += '<pre class="code lib-text">' + e(t.slice(0, 20000) || '（空文件）') + '</pre>' +
        (t.length > 20000 ? '<div class="small faint" style="margin-top:8px">仅显示前 20000 个字符，完整内容请下载</div>' : '');
    } else {
      h += '<div class="empty"><span class="e-icon">' + typeOf(item.name).icon + '</span>' +
        e(typeOf(item.name).label) + ' 文件请在浏览器中打开或下载后查看</div>' +
        '<div class="row" style="margin-top:12px"><button class="btn btn-sm" data-action="lib-open" data-id="' + e(item.id) + '">在新窗口打开</button></div>';
    }
    return h + '</div>';
  }
  function html() {
    const all = read(), mine = all.filter(x => x.owner === owner());
    const source = S.tab === 'all' ? all : mine;
    const kw = String(S.kw || '').trim();
    const rows = kw ? source.filter(x => x.name.indexOf(kw) >= 0) : source;
    let h = '<div class="lib-head"><h2>资料库</h2><p class="small muted">上传学习资料，支持表格、文本、PDF、文档与图片；单文件不超过 1 MB，按账号隔离保存。</p></div>';
    h += '<div class="blank-panel lib-upload"><div class="row">' +
      '<label class="btn btn-primary btn-sm" for="lib-file" style="cursor:pointer">上传资料</label>' +
      '<input type="file" id="lib-file" multiple accept="' + e(ACCEPT) + '" style="position:absolute;width:1px;height:1px;opacity:0">' +
      '<input type="text" class="tb-search" id="lib-kw" placeholder="搜索资料名称" value="' + e(S.kw) + '" style="max-width:240px">' +
      '<button class="btn btn-sm" data-action="lib-search">搜索</button>' +
      '<span class="spacer"></span><span class="small faint">已上传 ' + mine.length + ' 份' + (all.length !== mine.length ? ' · 全站 ' + all.length + ' 份' : '') + '</span></div>' +
      (S.err ? '<div class="notice-bar warn" style="margin-top:10px">' + e(S.err) + '</div>' : '') + '</div>';
    h += tabs();
    if (S.preview) {
      const item = all.filter(x => x.id === S.preview)[0];
      if (item) h += previewHtml(item) + '<div class="row" style="margin:10px 0"><button class="btn btn-sm" data-action="lib-close-preview">返回列表</button></div>';
    }
    h += '<div class="blank-panel"><div class="panel-h">' + (S.tab === 'all' ? '全部资料' : '我的资料') +
      ' <span class="sub">' + rows.length + ' 份</span></div>' +
      '<div class="table-wrap"><table class="tbl"><thead><tr><th>名称</th><th>类型</th><th>大小</th><th>上传者</th><th>上传时间</th><th>操作</th></tr></thead><tbody>';
    if (!rows.length) h += '<tr><td colspan="6" class="small muted">' + (kw ? '没有匹配的资料' : '还没有资料，点击「上传资料」添加') + '</td></tr>';
    rows.forEach(x => {
      h += '<tr><td><b>' + typeOf(x.name).icon + ' ' + e(x.name) + '</b></td>' +
        '<td>' + e(x.type || typeOf(x.name).label) + '</td><td class="mono">' + sizeText(x.size) + '</td>' +
        '<td>' + e(x.ownerName || '本机用户') + (x.owner === owner() ? '' : ' <span class="small faint">（他人）</span>') + '</td>' +
        '<td class="small muted nowrap">' + e(String(x.at || '').slice(0, 16).replace('T', ' ')) + '</td>' +
        '<td class="nowrap"><button class="btn btn-sm" data-action="lib-preview" data-id="' + e(x.id) + '">预览</button> ' +
        '<button class="btn btn-sm" data-action="lib-download" data-id="' + e(x.id) + '">下载</button> ' +
        (x.owner === owner() || isAdmin() ? '<button class="btn btn-sm btn-danger" data-action="lib-delete" data-id="' + e(x.id) + '">删除</button>' : '') +
        '</td></tr>';
    });
    h += '</tbody></table></div></div>';
    return h;
  }

  /* ---------------- 事件 ---------------- */
  function toast(m, bad) { if (Quiz.app && Quiz.app.toast) Quiz.app.toast(m, bad ? 'warn' : 'ok'); }
  function render() { if (Quiz.app && Quiz.app.render) Quiz.app.render(); }
  function current(id) { return read().filter(x => x.id === id)[0]; }
  function onAction(a, el, ev) {
    if (a === 'lib-tab') { S.tab = el.dataset.tab || 'mine'; S.preview = ''; render(); return true; }
    if (a === 'lib-search') { S.kw = String(($('lib-kw') && $('lib-kw').value) || '').trim().slice(0, 60); render(); return true; }
    if (a === 'lib-preview') { S.preview = el.dataset.id || ''; render(); return true; }
    if (a === 'lib-close-preview') { S.preview = ''; render(); return true; }
    if (a === 'lib-delete') {
      const x = current(el.dataset.id);
      if (x && (!global.confirm || global.confirm('确定删除资料「' + x.name + '」？'))) {
        const r = remove(el.dataset.id); if (!r.ok) { toast(r.msg, true); return true; }
        if (S.preview === el.dataset.id) S.preview = '';
        toast('资料已删除'); render();
      }
      return true;
    }
    if (a === 'lib-download' || a === 'lib-open') {
      const x = current(el.dataset.id);
      if (!x) return true;
      const p = parseDataUrl(x.data);
      if (!p) { toast('文件内容损坏', true); return true; }
      const blob = dataUrlToBlob(x.data);
      if (!blob) { toast('文件内容损坏', true); return true; }
      const url = global.URL && global.URL.createObjectURL ? global.URL.createObjectURL(blob) : x.data;
      if (a === 'lib-open') { if (global.open) global.open(url, '_blank', 'noopener'); }
      else if (util.downloadBytes) {
        const a2 = global.document.createElement('a');
        a2.href = x.data; a2.download = x.name;
        if (global.document.body && global.document.body.appendChild) {
          global.document.body.appendChild(a2); a2.click(); global.document.body.removeChild(a2);
        } else a2.click();
      }
      toast(a === 'lib-open' ? '已在新窗口打开' : '已开始下载');
      return true;
    }
    return false;
  }
  try {
    global.document.addEventListener('change', function (ev) {
      const el = ev.target;
      if (!el || el.id !== 'lib-file' || !el.files || !el.files.length) return;
      readFiles(el.files, function (r) {
        S.err = r.errors && r.errors.length ? r.errors.join('；') : '';
        if (r.added) toast('已上传 ' + r.added + ' 份资料');
        render();
      });
      if (ev.stopImmediatePropagation) ev.stopImmediatePropagation();
    });
    global.document.addEventListener('click', function (ev) {
      const el = ev.target && ev.target.closest && ev.target.closest('[data-action^="lib-"]');
      if (!el) return;
      if (!onAction(el.dataset.action, el, ev)) return;
      if (ev.stopImmediatePropagation) ev.stopImmediatePropagation();
    });
    global.document.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Enter' || !$('lib-kw') || !ev.target || ev.target.id !== 'lib-kw') return;
      S.kw = String($('lib-kw').value || '').trim(); render();
    });
  } catch (x) {}

  function mount() {
    const P = Quiz.pages = Quiz.pages || {};
    P.library = html;
  }
  if (Quiz.pages) mount();
  else if (global.document) {
    global.document.addEventListener('DOMContentLoaded', mount);
    try { global.setTimeout(function () { if (!(Quiz.pages && Quiz.pages.library)) mount(); }, 0); } catch (x) {}
  }

  Quiz.library = {state: S, KEY, MAX, ACCEPT, html, list, add, remove, read, write,
    readFiles, count, typeOf, extOf, sizeText, textContent, dataUrlToBlob, parseDataUrl, isAdmin};
  if (typeof module !== 'undefined' && module.exports) module.exports = Quiz.library;
})(typeof window !== 'undefined' ? window : globalThis);
