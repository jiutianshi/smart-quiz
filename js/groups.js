/* v1.6.0 群组功能（纯增量，参考三张图）
   核心：用户可输入群号（群组 id）加入群组。
   群组目录挂在 store 主 state 的 groups，随导出备份一起保存；
   成员身份是本机可切换的「本机身份」，可模拟多人申请/审核；
   跨设备通过「导出 / 导入群组目录」共享群号，不虚构任何第三方服务端。
   事件用 data-action^="grp-" + stopImmediatePropagation 隔离，避免 app.js 通用 render 干扰。 */
(function (global) {
  const Quiz = global.Quiz = global.Quiz || {};
  const store = Quiz.store, util = Quiz.util;
  const e = v => util.esc(v == null ? '' : String(v));
  const ID_KEY = 'smartQuiz.groupIdentity.v1';
  const MODES = {open: '不限制', review: '审核后加入', password: '口令'};
  const COVERS = ['#3b5bdb', '#15803d', '#c2410c', '#7048b6', '#c62828', '#0f766e'];
  const S = Quiz.groupsState = {kw: '', drawer: false, open: {created: true, joined: true}, detail: '', pendingId: ''};

  const app = () => Quiz.app;
  const $ = id => global.document && global.document.getElementById(id);
  const v = id => { const x = $(id); return x ? String(x.value || '') : ''; };
  const ck = id => { const x = $(id); return !!(x && x.checked); };
  const toast = (m, t) => { const a = app(); if (a && a.toast) a.toast(m, t || 'ok'); };
  const render = () => { const a = app(); if (a && a.render) a.render(); };
  const modal = (title, body, foot) => { const a = app(); if (a && a.modal) a.modal(title, body, foot); };
  const close = () => { const a = app(); if (a && a.closeModal) a.closeModal(); };

  /* ---------------- 数据层 ---------------- */
  function raw() {
    const s = store.state();
    if (!Array.isArray(s.groups)) store.mutate(x => { x.groups = []; });
    return store.state().groups;
  }
  function save(fn) { return store.mutate(s => { if (!Array.isArray(s.groups)) s.groups = []; return fn(s.groups); }); }
  function identity() {
    try {
      const t = global.localStorage && global.localStorage.getItem(ID_KEY);
      const o = t ? JSON.parse(t) : null;
      if (o && o.user_id && o.name) return o;
    } catch (x) {}
    return {user_id: 'local', name: '本机用户'};
  }
  function switchIdentity(name) {
    const n = String(name || '').trim().slice(0, 20);
    const me = n && n !== '本机用户'
      ? {user_id: 'u_' + util.hash(n).slice(0, 10), name: n}
      : {user_id: 'local', name: '本机用户'};
    try { if (global.localStorage) global.localStorage.setItem(ID_KEY, JSON.stringify(me)); } catch (x) {}
    return me;
  }
  function nextId(list) {
    let max = 1059100;
    list.forEach(g => { const n = parseInt(g.group_id, 10); if (/^\d+$/.test(String(g.group_id)) && n > max) max = n; });
    return String(max + 1);
  }
  function find(id) { return raw().filter(g => String(g.group_id) === String(id))[0] || null; }
  function members(g) { return Array.isArray(g.members) ? g.members : (g.members = []); }
  function statusFor(g, me) {
    const uid = (me || identity()).user_id;
    if (g.owner_id === uid) return 'owner';
    const m = members(g).filter(x => x.user_id === uid)[0];
    return m ? (m.status === 'pending' ? 'pending' : 'active') : 'none';
  }
  function activeCount(g) { return members(g).filter(m => m.status !== 'pending').length; }
  function pendingOf(g) { return members(g).filter(m => m.status === 'pending'); }
  function create(data) {
    const name = String(data.name || '').trim().slice(0, 10);
    const intro = String(data.intro || '').trim().slice(0, 50);
    const mode = MODES[data.join_mode] ? data.join_mode : 'open';
    if (!name) return {ok: false, msg: '群组名称不能为空'};
    const pass = String(data.password || '').trim();
    if (mode === 'password' && !pass) return {ok: false, msg: '「口令」加入方式必须设置口令'};
    const me = identity(), id = nextId(raw());
    const g = {
      group_id: id, name, intro, owner_id: me.user_id, owner_name: me.name,
      cover: COVERS[raw().length % COVERS.length], icon: name.slice(0, 1),
      join_mode: mode, password_hash: mode === 'password' ? util.hash(pass) : '',
      bank_id: String(data.bank_id || ''), created_at: util.now(),
      members: [{user_id: me.user_id, name: me.name, role: 'owner', joined_at: util.now(), status: 'active'}]
    };
    save(list => list.push(g));
    return {ok: true, group: g, msg: '已创建群组，群号 ' + id};
  }
  function search(kw) {
    const k = String(kw || '').trim().toLowerCase();
    const list = raw().slice().sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    if (!k) return list;
    return list.filter(g => [g.group_id, g.name, g.intro, g.owner_name].some(x => String(x || '').toLowerCase().indexOf(k) >= 0));
  }
  function join(id, password) {
    const g = find(id);
    if (!g) return {ok: false, msg: '未找到群号 ' + e(id) + '，可先导入群组目录'};
    const me = identity(), st = statusFor(g, me);
    if (st === 'owner') return {ok: false, msg: '你是该群群主'};
    if (st === 'active') return {ok: false, msg: '你已加入该群组'};
    if (st === 'pending') return {ok: false, msg: '申请已提交，等待群主审核'};
    if (g.join_mode === 'review') {
      save(() => members(g).push({user_id: me.user_id, name: me.name, role: 'member', joined_at: util.now(), status: 'pending'}));
      return {ok: true, pending: true, msg: '申请已提交，等待群主审核'};
    }
    if (g.join_mode === 'password') {
      if (!password) return {ok: false, needPassword: true, msg: '该群需要加入口令'};
      if (util.hash(String(password)) !== g.password_hash) return {ok: false, needPassword: true, msg: '口令不正确'};
    }
    save(() => members(g).push({user_id: me.user_id, name: me.name, role: 'member', joined_at: util.now(), status: 'active'}));
    return {ok: true, msg: '已加入群组「' + g.name + '」'};
  }
  function approve(id, uid) {
    const g = find(id), me = identity();
    if (!g || g.owner_id !== me.user_id) return {ok: false, msg: '只有群主可以审核'};
    let done = false;
    save(() => members(g).forEach(m => { if (m.user_id === uid && m.status === 'pending') { m.status = 'active'; done = true; } }));
    return done ? {ok: true, msg: '已通过申请'} : {ok: false, msg: '未找到待审核申请'};
  }
  function reject(id, uid) {
    const g = find(id), me = identity();
    if (!g || g.owner_id !== me.user_id) return {ok: false, msg: '只有群主可以审核'};
    const before = members(g).length;
    save(() => { g.members = members(g).filter(m => !(m.user_id === uid && m.status === 'pending')); });
    return before > members(g).length ? {ok: true, msg: '已拒绝申请'} : {ok: false, msg: '未找到待审核申请'};
  }
  function leave(id) {
    const g = find(id), me = identity();
    if (!g || g.owner_id === me.user_id) return {ok: false, msg: '群主请改用「解散群组」'};
    const before = members(g).length;
    save(() => { g.members = members(g).filter(m => m.user_id !== me.user_id); });
    return before > members(g).length ? {ok: true, msg: '已退出群组'} : {ok: false, msg: '你不在该群'};
  }
  function dissolve(id) {
    const g = find(id), me = identity();
    if (!g) return {ok: false, msg: '群组不存在'};
    if (g.owner_id !== me.user_id) return {ok: false, msg: '只有群主可以解散'};
    save(list => { const i = list.indexOf(g); if (i >= 0) list.splice(i, 1); });
    return {ok: true, msg: '已解散群组'};
  }
  function update(id, patch) {
    const g = find(id), me = identity();
    if (!g || g.owner_id !== me.user_id) return {ok: false, msg: '只有群主可以修改'};
    save(() => Object.keys(patch || {}).forEach(k => { g[k] = patch[k]; }));
    return {ok: true, msg: '已更新群组设置'};
  }
  function mineCreated() { const uid = identity().user_id; return raw().filter(g => g.owner_id === uid); }
  function mineJoined() { const me = identity(); return raw().filter(g => statusFor(g, me) === 'active'); }
  function exportDir() { return JSON.stringify({type: 'smartQuiz.groups.v1', groups: raw()}, null, 2); }
  function importDir(text) {
    let arr;
    try {
      const o = JSON.parse(text);
      arr = Array.isArray(o) ? o : (o && Array.isArray(o.groups) ? o.groups : null);
    } catch (x) { return {ok: false, msg: 'JSON 格式不正确'}; }
    if (!arr) return {ok: false, msg: '未找到 groups 数组'};
    let added = 0, skipped = 0;
    save(list => arr.forEach(g => {
      const id = String((g && g.group_id) || '');
      if (!/^\d{6,8}$/.test(id) || !g.name || list.some(x => String(x.group_id) === id)) { skipped++; return; }
      list.push(Object.assign({}, g, {
        group_id: id, members: Array.isArray(g.members) ? g.members : [],
        join_mode: MODES[g.join_mode] ? g.join_mode : 'open'
      }));
      added++;
    }));
    return {ok: true, added, skipped, msg: '导入 ' + added + ' 个群组' + (skipped ? '，跳过 ' + skipped + ' 个' : '')};
  }

  /* ---------------- 页面渲染 ---------------- */
  const foot = (label, action, id) => '<button class="btn" data-action="close-modal">取消</button>' +
    '<button class="btn btn-primary" data-action="' + action + '"' + (id ? ' data-id="' + e(id) + '"' : '') + '>' + label + '</button>';
  function formRow(label, body) { return '<label class="field" style="margin-bottom:10px">' + label + body + '</label>'; }
  function bankOptions(cur) {
    const banks = (store.banks && store.banks()) || [];
    return '<option value="">不绑定（仅作群组）</option>' + banks.map(b =>
      '<option value="' + e(b.bank_id) + '"' + (String(cur || '') === String(b.bank_id) ? ' selected' : '') + '>' + e(b.name) + '</option>').join('');
  }
  function bankName(id) {
    const b = (store.bank && store.bank(id)) || ((store.banks && store.banks()) || []).filter(x => x.bank_id === id)[0];
    return b ? b.name : '未绑定';
  }
  function modeRadios(cur) {
    return Object.keys(MODES).map(k => '<label class="grp-radio"><input type="radio" name="grp-mode" value="' + k + '"' +
      ((cur || 'open') === k ? ' checked' : '') + '> ' + MODES[k] + '</label>').join('');
  }
  function card(g, mine) {
    const me = identity(), st = statusFor(g, me), owner = st === 'owner';
    const open = S.detail === g.group_id;
    let h = '<div class="grp-card' + (open ? ' open' : '') + '">' +
      '<div class="grp-card-h"><span class="grp-avatar" style="background:' + e(g.cover) + '">' + e(g.icon) + '</span>' +
        '<div class="grp-card-tx"><b>' + e(g.name) + '</b>' +
        '<span class="small muted">群号:' + e(g.group_id) + ' · ' + MODES[g.join_mode] + ' · ' + activeCount(g) + ' 人</span></div>' +
      (g.bank_id ? '<a class="btn-link" href="#/practiceHub?bank=' + e(g.bank_id) + '">练习</a>' : '') +
      '<button class="btn-link" data-action="grp-detail" data-id="' + e(g.group_id) + '">' + (open ? '收起' : '详情') + '</button></div>';
    if (!open) return h + '</div>';
    const pend = owner ? pendingOf(g) : [];
    h += '<div class="grp-card-b">' +
      '<div class="small muted" style="margin-bottom:8px">' + e(g.intro || '暂无简介') + '</div>' +
      '<div class="grp-kv"><span>创建者</span><b>' + e(g.owner_name) + '</b><span>创建时间</span><b>' + e(util.fmt(g.created_at)) + '</b>' +
      '<span>练习题库</span><b>' + e(bankName(g.bank_id)) + '</b><span>我的状态</span><b>' +
      ({owner: '群主', active: '已加入', pending: '待审核', none: '未加入'})[st] + '</b></div>';
    if (owner) {
      h += '<div class="row" style="gap:8px;margin:8px 0">' +
        '<label class="small muted">加入方式 <select class="grp-sel" data-action="grp-mode-change" data-id="' + e(g.group_id) + '">' +
          Object.keys(MODES).map(k => '<option value="' + k + '"' + (g.join_mode === k ? ' selected' : '') + '>' + MODES[k] + '</option>').join('') + '</select></label>' +
        '<label class="small muted">绑定题库 <select class="grp-sel" data-action="grp-bank" data-id="' + e(g.group_id) + '">' + bankOptions(g.bank_id) + '</select></label>' +
        '</div>';
      if (pend.length) {
        h += '<div class="grp-pending"><b class="small">待审核申请 ' + pend.length + '</b>' + pend.map(m =>
          '<div class="grp-req"><span>' + e(m.name) + '</span>' +
          '<button class="btn-link" data-action="grp-approve" data-id="' + e(g.group_id) + '" data-uid="' + e(m.user_id) + '">通过</button>' +
          '<button class="btn-link danger" data-action="grp-reject" data-id="' + e(g.group_id) + '" data-uid="' + e(m.user_id) + '">拒绝</button></div>').join('') + '</div>';
      }
    }
    h += '<div class="row" style="gap:8px;flex-wrap:wrap;margin-top:8px">' +
      '<button class="btn btn-sm" data-action="grp-copy" data-id="' + e(g.group_id) + '">复制群号</button>' +
      (g.bank_id ? '<a class="btn btn-sm btn-primary" href="#/practiceHub?bank=' + e(g.bank_id) + '">练习该群题库</a>' : '') +
      '<a class="btn btn-sm" href="#/practiceRecords">查看练习数据</a>' +
      (owner ? '<button class="btn btn-sm btn-link danger" data-action="grp-dissolve" data-id="' + e(g.group_id) + '">解散群组</button>'
             : '<button class="btn btn-sm" data-action="grp-leave" data-id="' + e(g.group_id) + '">退出群组</button>') +
      '</div></div></div>';
    return h;
  }
  function section(key, title, list) {
    const on = S.open[key];
    return '<div class="grp-sec"><button class="grp-sec-h" data-action="grp-toggle" data-key="' + key + '">' +
      '<span>' + (on ? '⌄' : '›') + ' ' + title + '</span><span class="grp-count">' + list.length + '</span></button>' +
      (on ? '<div class="grp-sec-b">' + (list.length ? list.map(g => card(g)).join('') :
        '<div class="small faint" style="padding:10px 2px">暂无群组，可创建或输入群号加入</div>') + '</div>' : '') + '</div>';
  }
  function resultsHtml() {
    const list = search(S.kw), me = identity();
    if (!list.length) return '<div class="empty"><div class="ico">▤</div><div>' +
      (S.kw ? '没有匹配的群组，可让对方导出群组目录后导入' : '本机还没有群组目录，先创建或导入') + '</div></div>';
    return list.map(g => {
      const st = statusFor(g, me);
      const btn = st === 'owner' ? '<span class="tag">我创建的</span>'
        : st === 'active' ? '<span class="tag">已加入</span>'
        : st === 'pending' ? '<span class="tag">待审核</span>'
        : '<button class="btn btn-sm btn-primary" data-action="grp-join" data-id="' + e(g.group_id) + '">加入群组</button>';
      return '<div class="grp-result"><span class="grp-avatar" style="background:' + e(g.cover) + '">' + e(g.icon) + '</span>' +
        '<div class="grp-result-tx"><b>' + e(g.name) + '</b>' +
        '<span class="small muted">' + e(g.owner_name) + ' · 群号:' + e(g.group_id) + ' · ' + MODES[g.join_mode] + ' · ' + activeCount(g) + ' 人</span>' +
        '<span class="small faint">' + e(g.intro || '暂无简介') + '</span></div>' + btn + '</div>';
    }).join('');
  }
  function html() {
    const me = identity(), created = mineCreated(), joined = mineJoined();
    let h = '<div class="grp-layout">';
    h += '<div class="blank-panel grp-left">' +
      '<div class="grp-search"><input type="text" id="grp-kw" data-action="grp-kw" placeholder="搜索群组名称或群号" value="' + e(S.kw) + '">' +
      '<button class="btn btn-sm btn-primary" data-action="grp-quick-join" title="输入群号直接加入">加入</button>' +
      '<button class="btn btn-sm" data-action="grp-search-open">搜索</button></div>' +
      '<button class="btn btn-primary grp-create" data-action="grp-create-open">＋ 创建群组</button>' +
      section('created', '我创建的群组', created) +
      section('joined', '我加入的群组', joined) +
      '<div class="row" style="gap:8px;margin-top:12px;flex-wrap:wrap">' +
        '<button class="btn btn-sm" data-action="grp-export">导出群组目录</button>' +
        '<button class="btn btn-sm" data-action="grp-import-open">导入群组目录</button></div>' +
      '</div>';
    h += '<div class="blank-panel grp-right">' +
      '<div class="panel-h">群组功能介绍</div>' +
      '<p class="small muted" style="margin:0 0 14px">创建或加入群组，可以和同伴一起练习指定题库，并查看每天练习数据。输入群号即可加入已存在的群组。</p>' +
      '<div class="panel-h">功能与权限说明</div>' +
      '<div class="table-wrap"><table class="tbl"><thead><tr><th>项目</th><th>说明</th></tr></thead><tbody>' +
      '<tr><td>创建群组</td><td>不限制，群号自动分配</td></tr>' +
      '<tr><td>成员来源</td><td>本机身份（可切换模拟多人）</td></tr>' +
      '<tr><td>加入方式</td><td>不限制 / 审核后加入 / 口令</td></tr>' +
      '<tr><td>练习数据</td><td>本机浏览器保存，按账号隔离</td></tr>' +
      '</tbody></table></div>' +
      '<div class="notice-bar info" style="margin-top:14px">跨设备共享群号：一方「导出群组目录」，另一方「导入群组目录」后即可按群号搜索加入。</div>' +
      '</div></div>';
    if (S.drawer) {
      h += '<div class="grp-drawer-mask" data-action="grp-search-close"></div>' +
        '<div class="grp-drawer"><div class="grp-drawer-h"><b>群组搜索</b>' +
        '<span class="x" data-action="grp-search-close">×</span></div>' +
        '<div class="grp-drawer-b"><input type="text" id="grp-drawer-kw" data-action="grp-drawer-kw" placeholder="搜索群组名称或群号" value="' + e(S.kw) + '">' +
        '<p class="small faint">输入 7 位群号可精确查找；点「加入群组」按该群设置处理。也可在左侧直接输入群号点「加入」。</p>' +
        '<div id="grp-results">' + resultsHtml() + '</div></div></div>';
    }
    return h;
  }

  /* ---------------- 弹窗 ---------------- */
  function openCreate() {
    modal('创建群组',
      '<div class="notice-bar info">创建后自动分配 7 位群号，其他成员输入群号即可加入。</div>' +
      formRow('＊ 群组名称（10 字以内）', '<input type="text" id="grp-name" maxlength="10" placeholder="请输入群组名称">') +
      formRow('＊ 群组介绍（50 字以内）', '<textarea id="grp-intro" maxlength="50" style="min-height:70px" placeholder="请输入群组介绍"></textarea>') +
      formRow('加入方式', '<div class="grp-radios">' + modeRadios('open') + '</div>') +
      formRow('加入口令（选择「口令」时必填）', '<input type="text" id="grp-pass" placeholder="仅本机校验，不明文保存">') +
      formRow('绑定练习题库（可选）', '<select id="grp-bank-new">' + bankOptions('') + '</select>'),
      foot('确定', 'grp-create-save'));
  }
  function openPassword(id) {
    S.pendingId = id;
    const g = find(id);
    modal('加入群组 · ' + (g ? g.name : id),
      '<p class="small muted">该群设置了加入口令，请输入群主提供的口令。</p>' +
      formRow('加入口令', '<input type="text" id="grp-pass-input" placeholder="请输入口令">'),
      foot('确定', 'grp-pass-save', id));
  }
  function openImport() {
    modal('导入群组目录',
      '<p class="small muted">粘贴对方导出的 JSON（含 groups 数组）。同名群号不会重复导入。</p>' +
      formRow('群组目录 JSON', '<textarea id="grp-import-text" style="min-height:160px" placeholder="{&quot;groups&quot;:[...]}"></textarea>'),
      foot('导入', 'grp-import-save'));
  }
  function refreshResults() { const box = $('grp-results'); if (box) box.innerHTML = resultsHtml(); }

  /* ---------------- 动作 ---------------- */
  function onAction(a, el) {
    const id = el.dataset.id || '', uid = el.dataset.uid || '';
    if (a === 'grp-search-open') {
      S.kw = v('grp-kw') || S.kw; S.drawer = true; render(); return true;
    }
    if (a === 'grp-search-close') { S.drawer = false; render(); return true; }
    if (a === 'grp-quick-join') { S.kw = v('grp-kw').trim(); doJoin(S.kw); return true; }
    if (a === 'grp-join') { doJoin(id); return true; }
    if (a === 'grp-create-open') { openCreate(); return true; }
    if (a === 'grp-create-save') {
      const mode = (function () {
        try { const r = global.document.querySelector('input[name="grp-mode"]:checked'); return r ? r.value : 'open'; }
        catch (x) { return 'open'; }
      })();
      const r = create({name: v('grp-name'), intro: v('grp-intro'), join_mode: mode,
                        password: v('grp-pass'), bank_id: v('grp-bank-new')});
      toast(r.msg, r.ok ? 'ok' : 'err');
      if (r.ok) { close(); render(); }
      return true;
    }
    if (a === 'grp-pass-save') {
      const r = join(id, v('grp-pass-input'));
      toast(r.msg, r.ok ? 'ok' : 'err');
      if (r.ok) { S.pendingId = ''; close(); render(); }
      return true;
    }
    if (a === 'grp-toggle') { const k = el.dataset.key; S.open[k] = !S.open[k]; render(); return true; }
    if (a === 'grp-detail') { S.detail = S.detail === id ? '' : id; render(); return true; }
    /* v1.11.0：身份选择按钮已移除，身份由账号自动确定 */
    if (a === 'grp-approve' || a === 'grp-reject') { const r = (a === 'grp-approve' ? approve : reject)(id, uid); toast(r.msg, r.ok ? 'ok' : 'err'); render(); return true; }
    if (a === 'grp-leave') { if (!global.confirm || global.confirm('确定退出该群组？')) { const r = leave(id); toast(r.msg, r.ok ? 'ok' : 'err'); S.detail = ''; render(); } return true; }
    if (a === 'grp-dissolve') { if (!global.confirm || global.confirm('确定解散该群组？成员记录会一并删除。')) { const r = dissolve(id); toast(r.msg, r.ok ? 'ok' : 'err'); S.detail = ''; render(); } return true; }
    if (a === 'grp-copy') {
      try { if (global.navigator && global.navigator.clipboard) global.navigator.clipboard.writeText(id); } catch (x) {}
      toast('群号 ' + id + ' 已复制（也可手动记录）'); return true;
    }
    if (a === 'grp-export') { util.download('群组目录.json', exportDir(), 'application/json'); toast('已导出群组目录'); return true; }
    if (a === 'grp-import-open') { openImport(); return true; }
    if (a === 'grp-import-save') {
      const r = importDir(v('grp-import-text'));
      toast(r.msg, r.ok ? 'ok' : 'err');
      if (r.ok) { close(); render(); }
      return true;
    }
    return false;
  }
  function doJoin(id) {
    if (!String(id || '').trim()) { toast('请输入群组名称或群号', 'err'); return; }
    const g = /^\d{6,8}$/.test(String(id).trim()) ? find(id) : null;
    const target = g || search(id)[0];
    const r = join(target ? target.group_id : id);
    if (r.needPassword) { openPassword(target ? target.group_id : id); return; }
    toast(r.msg, r.ok ? 'ok' : 'err');
    if (r.ok) { S.drawer = false; render(); }
  }
  function onChange(a, el, target) {
    if (a === 'grp-bank') { const r = update(el.dataset.id, {bank_id: target.value}); toast(r.msg, r.ok ? 'ok' : 'err'); render(); return true; }
    if (a === 'grp-mode-change') {
      const g = find(el.dataset.id);
      if (target.value === 'password' && g && !g.password_hash) { toast('请先在创建时设置口令；该群暂未设置口令', 'err'); return true; }
      const r = update(el.dataset.id, {join_mode: target.value}); toast(r.msg, r.ok ? 'ok' : 'err'); render(); return true;
    }
    return false;
  }
  function onInput(a, el) {
    if (a === 'grp-drawer-kw' || a === 'grp-kw') { S.kw = String(el.value || ''); refreshResults(); return true; }
    return false;
  }
  try {
    global.document.addEventListener('click', function (ev) {
      const el = ev.target && ev.target.closest && ev.target.closest('[data-action^="grp-"]');
      if (!el) return;
      if (!onAction(el.dataset.action, el)) return;
      if (ev.stopImmediatePropagation) ev.stopImmediatePropagation();
    });
    global.document.addEventListener('change', function (ev) {
      const el = ev.target && ev.target.closest && ev.target.closest('[data-action^="grp-"]');
      if (!el) return;
      if (!onChange(el.dataset.action, el, ev.target)) return;
      if (ev.stopImmediatePropagation) ev.stopImmediatePropagation();
    });
    global.document.addEventListener('input', function (ev) {
      const el = ev.target && ev.target.closest && ev.target.closest('[data-action^="grp-"]');
      if (!el) return;
      if (!onInput(el.dataset.action, el)) return;
      if (ev.stopImmediatePropagation) ev.stopImmediatePropagation();
    });
  } catch (x) {}

  Quiz.groups = {state: S, MODES, identity, switchIdentity, nextId, find, statusFor, activeCount,
    create, search, join, approve, reject, leave, dissolve, update, mineCreated, mineJoined,
    exportDir, importDir, html, resultsHtml, onAction, onChange, onInput, card};
  if (typeof module !== 'undefined' && module.exports) module.exports = Quiz.groups;
})(typeof window !== 'undefined' ? window : globalThis);
