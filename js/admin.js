/* v1.11.0 管理后台（纯增量）
   仅首个注册账号（管理员）可用：账号管理、全站通知、数据概览、操作日志。
   数据存全局键 smartQuiz.admin.v1（不随账号快照隔离，所有账号可读通知）。
   事件用 data-action^="adm-" + stopImmediatePropagation 隔离。 */
(function (global) {
  const Quiz = global.Quiz = global.Quiz || {};
  const util = Quiz.util, gate = Quiz.accountGate;
  const e = v => util.esc(v == null ? '' : String(v));
  const $ = id => global.document && global.document.getElementById(id);
  const KEY = 'smartQuiz.admin.v1';
  const S = Quiz.adminState = {tab: 'users', kw: '', editId: '', noticeTitle: '', noticeBody: '', log: []};

  const LS = () => { try { return global.localStorage || null; } catch (x) { return null; } };
  function read() {
    let o = null;
    try { o = JSON.parse(LS() && LS().getItem(KEY) || 'null'); } catch (x) {}
    if (!o || typeof o !== 'object') o = {notices: [], logs: [], reads: {}};
    if (!Array.isArray(o.notices)) o.notices = [];
    if (!Array.isArray(o.logs)) o.logs = [];
    if (!o.reads || typeof o.reads !== 'object') o.reads = {};
    return o;
  }
  function write(o) { try { LS() && LS().setItem(KEY, JSON.stringify(o)); } catch (x) {} }

  /* ---------------- 对外 API ---------------- */
  function addLog(action, detail) {
    const o = read();
    o.logs.unshift({at: util.now(), by: gate && gate.currentName ? gate.currentName() : '', action, detail: String(detail || '')});
    o.logs = o.logs.slice(0, 100);
    write(o);
  }
  function notices() { return read().notices.slice(); }
  function unreadCount(uid) {
    const o = read();
    return o.notices.filter(n => !(o.reads[uid] || []).some(x => x === n.id)).length;
  }
  function markRead(uid, ids) {
    const o = read(), r = o.reads[uid] = o.reads[uid] || [];
    ids.forEach(id => { if (r.indexOf(id) < 0) r.push(id); });
    write(o);
  }
  function publish(title, body) {
    if (!gate || !gate.isAdmin || !gate.isAdmin()) return {ok: false, msg: '仅管理员可下发通知'};
    const t = String(title || '').trim().slice(0, 60), b = String(body || '').trim().slice(0, 1000);
    if (!t) return {ok: false, msg: '请填写通知标题'};
    if (!b) return {ok: false, msg: '请填写通知内容'};
    const o = read();
    o.notices.unshift({id: util.uid('notice'), title: t, body: b, at: util.now(),
      by: gate.currentName ? gate.currentName() : '管理员'});
    o.notices = o.notices.slice(0, 60);
    write(o);
    addLog('下发通知', t);
    return {ok: true};
  }
  function removeNotice(id) {
    if (!gate || !gate.isAdmin || !gate.isAdmin()) return {ok: false, msg: '仅管理员可删除通知'};
    const o = read();
    o.notices = o.notices.filter(n => n.id !== id);
    write(o);
    addLog('删除通知', id);
    return {ok: true};
  }
  function logs() { return read().logs.slice(); }

  /* 账号维度数据概览：直接读各账号快照，不切换当前登录态 */
  function accountStats(u) {
    const raw = gate && gate.readData ? gate.readData(u.id)['smartQuiz.v1'] : null;
    let q = 0, sessions = 0, records = 0, banks = 0, lib = 0;
    try {
      const st = JSON.parse(raw || 'null');
      if (st) {
        q = (st.questions || []).length; sessions = (st.sessions || []).length;
        records = (st.records || []).length; banks = (st.banks || []).length;
      }
    } catch (x) {}
    try { lib = (JSON.parse(gate.readData(u.id)['smartQuiz.library.v1'] || '[]') || []).length; } catch (x) {}
    return {questions: q, sessions: sessions, records: records, banks: banks, library: lib};
  }

  /* ---------------- 页面 ---------------- */
  function tabs() {
    const items = [['users', '账号管理'], ['notices', '通知下发'], ['overview', '数据概览'], ['logs', '操作日志']];
    return '<div class="tabs adm-tabs">' + items.map(x =>
      '<button class="tab' + (S.tab === x[0] ? ' on' : '') + '" data-action="adm-tab" data-tab="' + x[0] + '">' + x[1] + '</button>').join('') + '</div>';
  }
  function noPermission() {
    return '<section class="card"><h2>管理后台</h2><div class="notice-bar warn">仅管理员可访问此页面。首个注册的账号自动拥有管理员权限。</div></section>';
  }
  function usersHtml() {
    const all = gate.users().filter(u => !S.kw || u.name.indexOf(S.kw) >= 0);
    let h = '<div class="blank-panel"><div class="panel-h">注册账号 <span class="sub">共 ' + gate.users().length + ' 个</span></div>' +
      '<div class="toolbar adm-toolbar">' +
      '<input type="text" id="adm-kw" placeholder="搜索账号" value="' + e(S.kw) + '">' +
      '<button class="btn btn-sm" data-action="adm-search">搜索</button>' +
      '<span class="grow"></span><span class="small faint">管理员可编辑资料、重置密码、停用或删除账号</span></div>' +
      '<div class="table-wrap"><table class="tbl"><thead><tr><th>账号</th><th>角色</th><th>状态</th><th>注册时间</th><th>最近登录</th><th>题库</th><th>操作</th></tr></thead><tbody>';
    if (!all.length) h += '<tr><td colspan="7" class="small muted">没有匹配的账号</td></tr>';
    all.forEach(u => {
      const st = accountStats(u);
      h += '<tr><td><b>' + e(u.name) + '</b></td>' +
        '<td>' + (u.isAdmin ? '<span class="badge b-blue">管理员</span>' : '<span class="badge b-gray">普通用户</span>') + '</td>' +
        '<td>' + (u.disabled ? '<span class="badge b-red">已停用</span>' : '<span class="badge b-green">正常</span>') + '</td>' +
        '<td class="small muted nowrap">' + (u.createdAt ? e(String(u.createdAt).slice(0, 10)) : '—') + '</td>' +
        '<td class="small muted nowrap">' + (u.lastLoginAt ? e(String(u.lastLoginAt).slice(0, 10)) : '—') + '</td>' +
        '<td class="mono">' + st.questions + ' 题 / ' + st.library + ' 份资料</td>' +
        '<td class="nowrap"><button class="btn btn-sm" data-action="adm-edit" data-id="' + e(u.id) + '">编辑</button> ' +
        (u.isAdmin ? '' : '<button class="btn btn-sm" data-action="adm-toggle-admin" data-id="' + e(u.id) + '" data-on="' + (u.disabled ? '0' : '1') + '">' + (u.isAdmin ? '' : '设为管理员') + '</button> ') +
        '<button class="btn btn-sm" data-action="adm-toggle-disabled" data-id="' + e(u.id) + '">' + (u.disabled ? '启用' : '停用') + '</button> ' +
        (u.isAdmin ? '' : '<button class="btn btn-sm btn-danger" data-action="adm-delete" data-id="' + e(u.id) + '">删除</button>') +
        '</td></tr>';
      if (S.editId === u.id) {
        h += '<tr class="adm-edit-row"><td colspan="7"><div class="filters adm-edit-form">' +
          '<label class="field">账号名称<input type="text" id="adm-name" value="' + e(u.name) + '"></label>' +
          '<label class="field">重置密码（留空不改）<input type="text" id="adm-pass" placeholder="至少 4 位"></label>' +
          '<label class="field">角色<select id="adm-role"><option value="0"' + (u.isAdmin ? '' : ' selected') + '>普通用户</option><option value="1"' + (u.isAdmin ? ' selected' : '') + '>管理员</option></select></label>' +
          '<label class="field">状态<select id="adm-state"><option value="0"' + (u.disabled ? '' : ' selected') + '>正常</option><option value="1"' + (u.disabled ? ' selected' : '') + '>停用</option></select></label>' +
          '</div><div class="row"><button class="btn btn-sm btn-primary" data-action="adm-save" data-id="' + e(u.id) + '">保存</button>' +
          '<button class="btn btn-sm" data-action="adm-cancel">取消</button></div></td></tr>';
      }
    });
    h += '</tbody></table></div></div>';
    return h;
  }
  function noticesHtml() {
    const ns = notices();
    let h = '<div class="blank-panel"><div class="panel-h">下发全站通知</div>' +
      '<p class="small muted">通知对所有注册账号可见，显示在「账户中心 → 消息中心」。</p>' +
      '<div class="filters"><label class="field">标题<input type="text" id="adm-notice-title" placeholder="通知标题" value="' + e(S.noticeTitle) + '"></label>' +
      '<label class="field" style="grid-column:1/-1">内容<textarea id="adm-notice-body" placeholder="通知内容" style="min-height:80px">' + e(S.noticeBody) + '</textarea></label></div>' +
      '<div class="row" style="margin-top:8px"><button class="btn btn-primary btn-sm" data-action="adm-publish">发布通知</button></div></div>';
    h += '<div class="blank-panel"><div class="panel-h">已发布通知 <span class="sub">' + ns.length + ' 条</span></div>';
    if (!ns.length) h += '<div class="empty"><span class="e-icon">▤</span>还没有发布过通知</div>';
    ns.forEach(n => {
      h += '<div class="adm-notice"><div class="row"><b>' + e(n.title) + '</b><span class="spacer"></span>' +
        '<span class="small faint">' + e(String(n.at).slice(0, 16).replace('T', ' ')) + ' · ' + e(n.by) + '</span> ' +
        '<button class="btn btn-sm btn-danger" data-action="adm-notice-del" data-id="' + e(n.id) + '">删除</button></div>' +
        '<p class="small muted" style="white-space:pre-wrap;margin:8px 0 0">' + e(n.body) + '</p></div>';
    });
    return h + '</div>';
  }
  function logsHtml() {
    const ls = logs();
    return '<div class="blank-panel"><div class="panel-h">操作日志 <span class="sub">最近 100 条</span></div>' +
      (ls.length ? '<div class="table-wrap"><table class="tbl"><thead><tr><th>时间</th><th>操作人</th><th>动作</th><th>详情</th></tr></thead><tbody>' +
        ls.map(l => '<tr><td class="nowrap small muted">' + e(String(l.at).slice(0, 16).replace('T', ' ')) + '</td><td>' + e(l.by) + '</td><td>' + e(l.action) + '</td><td class="small">' + e(l.detail) + '</td></tr>').join('') +
        '</tbody></table></div>' : '<div class="empty"><span class="e-icon">▤</span>暂无操作记录</div>') + '</div>';
  }
  function html() {
    if (!gate || !gate.isAdmin || !gate.isAdmin()) return noPermission();
    let h = '<div class="adm-head"><h2>管理后台</h2><p class="small muted">账号、通知与全站数据由管理员统一管理</p></div>' + tabs();
    if (S.tab === 'users') h += usersHtml();
    else if (S.tab === 'notices') h += noticesHtml();
    else if (S.tab === 'overview') h += overviewHtml();
    else h += logsHtml();
    return h;
  }
  function overviewHtml() {
    const us = gate.users();
    let q = 0, s = 0, r = 0, lib = 0;
    us.forEach(u => { const st = accountStats(u); q += st.questions; s += st.sessions; r += st.records; lib += st.library; });
    let h = '<div class="grid g4"><div class="kpi"><div class="k-label">注册账号</div><div class="k-value">' + us.length + '</div><div class="k-sub">管理员 ' + us.filter(u => u.isAdmin).length + ' 个</div></div>' +
      '<div class="kpi"><div class="k-label">题目总数</div><div class="k-value">' + q + '</div><div class="k-sub">全部账号合计</div></div>' +
      '<div class="kpi"><div class="k-label">练习会话</div><div class="k-value">' + s + '</div><div class="k-sub">作答明细 ' + r + ' 条</div></div>' +
      '<div class="kpi"><div class="k-label">学习资料</div><div class="k-value">' + lib + '</div><div class="k-sub">资料库文件</div></div></div>';
    h += '<div class="blank-panel"><div class="panel-h">各账号数据</div><div class="table-wrap"><table class="tbl"><thead><tr><th>账号</th><th>题目</th><th>题库</th><th>练习会话</th><th>作答明细</th><th>资料</th></tr></thead><tbody>' +
      (us.length ? us.map(u => { const st = accountStats(u);
        return '<tr><td>' + e(u.name) + '</td><td class="mono">' + st.questions + '</td><td class="mono">' + st.banks + '</td>' +
          '<td class="mono">' + st.sessions + '</td><td class="mono">' + st.records + '</td><td class="mono">' + st.library + '</td></tr>'; }).join('')
        : '<tr><td colspan="6" class="small muted">暂无账号</td></tr>') +
      '</tbody></table></div></div>';
    return h;
  }

  /* ---------------- 消息中心（所有账号可见） ---------------- */
  function messagesHtml() {
    const uid = gate && gate.state ? gate.state.activeId : '';
    const ns = notices();
    if (uid && ns.length) markRead(uid, ns.map(n => n.id));
    if (!ns.length) return '<div class="blank-panel"><div class="panel-h">消息通知</div>' +
      '<div class="empty"><span class="e-icon">▤</span>暂无通知</div></div>';
    return '<div class="blank-panel"><div class="panel-h">消息通知 <span class="sub">' + ns.length + ' 条</span></div>' +
      ns.map(n => '<div class="adm-notice"><div class="row"><b>' + e(n.title) + '</b><span class="spacer"></span>' +
        '<span class="small faint">' + e(String(n.at).slice(0, 16).replace('T', ' ')) + ' · ' + e(n.by) + '</span></div>' +
        '<p class="small muted" style="white-space:pre-wrap;margin:6px 0 0">' + e(n.body) + '</p></div>').join('') + '</div>';
  }

  /* ---------------- 事件 ---------------- */
  function toast(m, bad) { if (Quiz.app && Quiz.app.toast) Quiz.app.toast(m, bad ? 'warn' : 'ok'); }
  function onAction(a, el, ev) {
    if (a === 'adm-tab') { S.tab = el.dataset.tab || 'users'; render(); return true; }
    if (!gate || !gate.isAdmin || !gate.isAdmin()) { toast('仅管理员可执行此操作', true); return true; }
    if (a === 'adm-search') {
      S.kw = String(($('adm-kw') && $('adm-kw').value) || '').trim().slice(0, 24); render(); return true;
    }
    if (a === 'adm-edit') { S.editId = el.dataset.id || ''; render(); return true; }
    if (a === 'adm-cancel') { S.editId = ''; render(); return true; }
    if (a === 'adm-save') {
      const id = el.dataset.id;
      const patch = {
        name: ($('adm-name') && $('adm-name').value) || '',
        pass: ($('adm-pass') && $('adm-pass').value) || '',
        isAdmin: ($('adm-role') && $('adm-role').value) === '1',
        disabled: ($('adm-state') && $('adm-state').value) === '1'
      };
      const before = gate.users().filter(u => u.id === id)[0];
      const r = gate.updateUser(id, {name: patch.name || (before && before.name), pass: patch.pass});
      if (!r.ok) { toast(r.msg, true); return true; }
      const r2 = gate.updateUser(id, {isAdmin: patch.isAdmin, disabled: patch.disabled});
      if (!r2.ok) { toast(r2.msg, true); return true; }
      S.editId = '';
      addLog('编辑账号', (before && before.name) + ' → ' + r.user.name + (patch.pass ? '（重置密码）' : '') + (patch.isAdmin ? ' [管理员]' : '') + (patch.disabled ? ' [停用]' : ''));
      toast('账号已更新'); render(); return true;
    }
    if (a === 'adm-toggle-admin' || a === 'adm-toggle-disabled' || a === 'adm-delete') {
      const id = el.dataset.id, u = gate.users().filter(x => x.id === id)[0];
      if (!u) return true;
      if (a === 'adm-delete') {
        if (!global.confirm || global.confirm('确定删除账号「' + u.name + '」及其全部数据？此操作不可恢复。')) {
          const r = gate.removeUser(id); if (!r.ok) { toast(r.msg, true); return true; }
          addLog('删除账号', u.name); toast('账号已删除');
        }
      } else if (a === 'adm-toggle-admin') {
        const r = gate.updateUser(id, {isAdmin: true}); if (!r.ok) { toast(r.msg, true); return true; }
        addLog('设为管理员', u.name); toast('已设为管理员');
      } else {
        const r = gate.updateUser(id, {disabled: !u.disabled}); if (!r.ok) { toast(r.msg, true); return true; }
        addLog(u.disabled ? '启用账号' : '停用账号', u.name); toast('状态已更新');
      }
      render(); return true;
    }
    if (a === 'adm-publish') {
      S.noticeTitle = ($('adm-notice-title') && $('adm-notice-title').value) || '';
      S.noticeBody = ($('adm-notice-body') && $('adm-notice-body').value) || '';
      const r = publish(S.noticeTitle, S.noticeBody);
      if (!r.ok) { toast(r.msg, true); return true; }
      S.noticeTitle = ''; S.noticeBody = '';
      toast('通知已发布'); render(); return true;
    }
    if (a === 'adm-notice-del') {
      const r = removeNotice(el.dataset.id); if (!r.ok) { toast(r.msg, true); return true; }
      toast('通知已删除'); render(); return true;
    }
    return false;
  }
  function render() { if (Quiz.app && Quiz.app.render) Quiz.app.render(); }

  try {
    global.document.addEventListener('click', function (ev) {
      const el = ev.target && ev.target.closest && ev.target.closest('[data-action^="adm-"]');
      if (!el) return;
      if (!onAction(el.dataset.action, el, ev)) return;
      if (ev.stopImmediatePropagation) ev.stopImmediatePropagation();
    });
    global.document.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Enter' || !$('adm-kw')) return;
      if (ev.target && ev.target.id !== 'adm-kw') return;
      S.kw = String($('adm-kw').value || '').trim(); render();
    });
  } catch (x) {}

  Quiz.admin = {state: S, html, messagesHtml, notices, unreadCount, markRead, publish, removeNotice, logs, addLog, accountStats};
  /* 挂载到视图表：由 index.html 在 pages.js 之后加载；若尚未创建则延迟到 DOMContentLoaded */
  function mount() {
    const P = Quiz.pages = Quiz.pages || {};
    P.admin = html;
    P.messages = function () {
      return '<div class="notice-bar info">管理员下发的通知对所有注册账号可见。</div>' + messagesHtml();
    };
  }
  if (Quiz.pages) mount();
  else if (global.document && global.document.readyState !== 'loading') {
    global.document.addEventListener('DOMContentLoaded', mount);
  } else { try { global.document.addEventListener('DOMContentLoaded', mount); } catch (x) {} }
  if (typeof global !== 'undefined' && typeof global.setTimeout === 'function') {
    global.setTimeout(function () { if (!(Quiz.pages && Quiz.pages.admin)) mount(); }, 0);
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = Quiz.admin;
})(typeof window !== 'undefined' ? window : globalThis);
