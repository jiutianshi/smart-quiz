/* v1.12.0 账号 + 密码登录 / 注册 + 内置管理员体系（纯增量）
   进入页面强制登录：本地账号门（账号 + 密码），新账号即注册、已注册则登录。
   内置管理员账号 admin / admin123 可管理所有注册账号与下发全站通知；其余账号均为普通用户。
   每个账号的题库 / 练习记录 / 群组 / 资料 / 设置按账号隔离保存（本机隔离，非服务端多租户）。
   数据仅存本机浏览器，跨设备请用「导出 JSON / 导入备份」迁移；
   未登录态底层不加载任何用户数据（__AUTH_GATE_LOCKED__ 拦截 seedIfEmpty）。 */
(function (global) {
  const Quiz = global.Quiz = global.Quiz || {};
  const util = Quiz.util;
  const e = v => util.esc(String(v == null ? '' : v));
  const DIR_KEY = 'smartQuiz.accounts.v1';
  const SESSION_KEY = 'smartQuiz.authSession.v1';
  const DATA_PREFIX = 'smartQuiz.acctData.';
  /* 所有业务数据键；账号目录 / 账号快照 / 登录会话不在此列 */
  const KEYS = [
    'smartQuiz.v1', 'smartQuiz.prefs.v1', 'smartQuiz.runtimeSession.v1',
    'smartQuiz.exams.v1', 'smartQuiz.hubExam.v1', 'smartQuiz.groupIdentity.v1',
    'smartQuiz.groups.v1', 'smartQuiz.lastResetAt.v1', 'smartQuiz.theme.v1',
    'smartQuiz.aiConfig.v1', 'smartQuiz.aiCache.v1', 'smartQuiz.aiUsage.v1',
    'smartQuiz.library.v1'
  ];
  const S = Quiz.accountGateState = {activeId: '', pendingLegacy: false, err: '', locked: false,
    mode: 'login'};
  const $ = id => global.document && global.document.getElementById(id);
  const LS = () => { try { return global.localStorage || null; } catch (x) { return null; } };
  const SS = () => { try { return global.sessionStorage || null; } catch (x) { return null; } };
  const get = (store, k) => { try { return store && store.getItem(k); } catch (x) { return null; } };
  const set = (store, k, v) => { try { if (store) store.setItem(k, v); } catch (x) {} };
  const del = (store, k) => { try { if (store) store.removeItem(k); } catch (x) {} };

  function readDir() {
    let o = null;
    try { o = JSON.parse(get(LS(), DIR_KEY) || 'null'); } catch (x) {}
    if (!o || !Array.isArray(o.users)) o = {version: 1, users: [], currentId: ''};
    return o;
  }
  function writeDir(d) { set(LS(), DIR_KEY, JSON.stringify(d)); }
  function dataKey(id) { return DATA_PREFIX + id + '.v1'; }
  function readData(id) {
    let o = null;
    try { o = JSON.parse(get(LS(), dataKey(id)) || 'null'); } catch (x) {}
    return (o && typeof o === 'object') ? o : {};
  }
  function writeData(id, obj) { set(LS(), dataKey(id), JSON.stringify(obj || {})); }
  function snapshot() {
    const s = LS(), out = {};
    KEYS.forEach(k => { const v = get(s, k); if (v != null) out[k] = v; });
    return out;
  }
  function clearActive() { const s = LS(); KEYS.forEach(k => del(s, k)); }
  function restore(obj) {
    const s = LS(); clearActive();
    Object.keys(obj || {}).forEach(k => { if (KEYS.indexOf(k) >= 0 && obj[k] != null) set(s, k, String(obj[k])); });
  }
  function hasMainData() { return !!get(LS(), 'smartQuiz.v1'); }

  /* ---------------- v1.12.0 管理员 / 账号管理 ----------------
     内置管理员固定为 admin / admin123；其余账号（含注册时间最早的账号）一律为普通用户。
     管理员仍可通过后台手动把某个账号设为管理员，但注册本身永不授予管理员权限。 */
  const BUILTIN_ADMIN_NAME = 'admin';
  const BUILTIN_ADMIN_PASS = 'admin123';
  const ADMIN_MIGRATED_KEY = 'smartQuiz.builtinAdmin.v1';
  function builtinAdminId() { return userId(BUILTIN_ADMIN_NAME); }
  function publicUser(u) {
    return {id: u.id, name: u.name, isAdmin: !!u.isAdmin, disabled: !!u.disabled,
      createdAt: u.createdAt || 0, lastLoginAt: u.lastLoginAt || 0};
  }
  function users() { return readDir().users.map(publicUser); }
  function isAdmin() {
    if (!S.activeId) return false;
    const u = readDir().users.filter(x => x.id === S.activeId)[0];
    return !!(u && u.isAdmin);
  }
  function requireAdmin() {
    if (!isAdmin()) return {ok: false, msg: '仅管理员可执行此操作'};
    return null;
  }
  /* 只允许管理员改账号；不可删除自己的管理员身份或删除自己；内置管理员受保护 */
  function updateUser(id, patch) {
    const denied = requireAdmin(); if (denied) return denied;
    const d = readDir(), u = d.users.filter(x => x.id === id)[0];
    if (!u) return {ok: false, msg: '账号不存在'};
    const isBuiltin = id === builtinAdminId();
    if (isBuiltin && typeof patch.name === 'string' && String(patch.name).trim().toLowerCase() !== BUILTIN_ADMIN_NAME)
      return {ok: false, msg: '内置管理员账号不可改名'};
    if (isBuiltin && patch.isAdmin === false) return {ok: false, msg: '内置管理员不可取消管理员身份'};
    if (isBuiltin && patch.disabled === true) return {ok: false, msg: '内置管理员不可停用'};
    if (typeof patch.name === 'string') {
      const n = String(patch.name).trim().slice(0, 24);
      if (!n) return {ok: false, msg: '账号不能为空'};
      const dup = d.users.filter(x => x.name === n && x.id !== id)[0];
      if (dup) return {ok: false, msg: '已有同名账号'};
      u.name = n;
    }
    if (typeof patch.pass === 'string' && patch.pass) {
      if (patch.pass.length < 4) return {ok: false, msg: '密码至少 4 位'};
      u.passHash = util.hash(patch.pass);
    }
    if (typeof patch.disabled === 'boolean') {
      if (id === S.activeId && patch.disabled) return {ok: false, msg: '不能停用当前登录的账号'};
      u.disabled = patch.disabled;
    }
    if (typeof patch.isAdmin === 'boolean') {
      if (id === S.activeId && !patch.isAdmin) return {ok: false, msg: '不能取消自己的管理员身份'};
      u.isAdmin = patch.isAdmin;
    }
    writeDir(d);
    return {ok: true, user: publicUser(u)};
  }
  function removeUser(id) {
    const denied = requireAdmin(); if (denied) return denied;
    if (id === builtinAdminId()) return {ok: false, msg: '内置管理员账号不可删除'};
    if (id === S.activeId) return {ok: false, msg: '不能删除当前登录的账号'};
    const d = readDir();
    if (!d.users.some(x => x.id === id)) return {ok: false, msg: '账号不存在'};
    d.users = d.users.filter(x => x.id !== id);
    writeDir(d);
    del(LS(), dataKey(id));
    return {ok: true};
  }
  /* v1.12.0：注入内置管理员 admin / admin123，并一次性撤销历史账号被误授予的管理员身份。
     只在真实站点由 app.js 启动调用（__BUILTIN_ADMIN__），Node 自测不改动账号目录。 */
  function ensureAdmin() {
    const d = readDir(), aid = builtinAdminId();
    const migrated = !get(LS(), ADMIN_MIGRATED_KEY);
    let a = d.users.filter(u => u.id === aid || String(u.name).toLowerCase() === BUILTIN_ADMIN_NAME)[0];
    if (!a) {
      a = {id: aid, name: BUILTIN_ADMIN_NAME, passHash: util.hash(BUILTIN_ADMIN_PASS),
        createdAt: util.now(), isAdmin: true, disabled: false};
      d.users.unshift(a);
    } else {
      a.id = aid; a.name = BUILTIN_ADMIN_NAME;
      if (migrated) a.passHash = util.hash(BUILTIN_ADMIN_PASS);
      a.isAdmin = true; a.disabled = false;
    }
    if (migrated) {
      d.users.forEach(u => { if (u !== a) u.isAdmin = false; });
      set(LS(), ADMIN_MIGRATED_KEY, '1');
    }
    writeDir(d);
    return migrated;
  }
  /* 一次性清理历史遗留的内置示例题（含各账号快照），不触碰用户自建题目 */
  function purgeLegacyDemo() {
    const flag = 'smartQuiz.demoPurged.v1';
    if (get(LS(), flag)) return 0;
    let removed = 0;
    const d = readDir();
    d.users.forEach(u => {
      const data = readData(u.id), raw = data['smartQuiz.v1'];
      if (!raw) return;
      try {
        const st = JSON.parse(raw);
        if (!st || !Array.isArray(st.questions)) return;
        const kept = st.questions.filter(q => q.source !== '内置示例');
        removed += st.questions.length - kept.length;
        st.questions = kept;
        (st.banks || []).forEach(b => { if (b.description && b.description.indexOf('内置示例') >= 0) b.description = '未指定归属的题目默认存放于此'; });
        data['smartQuiz.v1'] = JSON.stringify(st);
        writeData(u.id, data);
      } catch (x) {}
    });
    set(LS(), flag, '1');
    return removed;
  }
  function userId(name) { return 'acct_' + util.hash(String(name)).slice(0, 10); }
  function currentName() {
    const d = readDir(), u = d.users.filter(x => x.id === S.activeId)[0];
    return u ? u.name : '';
  }
  function reload() {
    try { if (global.location && global.location.reload) { global.location.reload(); return true; } } catch (x) {}
    return false;
  }

  /* ---------------- 登录门 UI（左右分栏：品牌面板 + 表单） ---------------- */
  function gateHtml() {
    const d = readDir();
    const users = d.users.map(u => '<button class="auth-user" data-action="auth-fill" data-name="' + e(u.name) + '">' + e(u.name) + '</button>').join('');
    const isReg = S.mode === 'register';
    const isLogin = !isReg;
    const heading = isReg ? '创建你的账号' : '登录到智能题库';
    const sub = isReg ? '设置一个账号与密码，数据只保存在这台浏览器并按账号隔离' : '每个账号的题库、练习记录与群组相互隔离';
    return '<div class="auth-gate" id="auth-gate">' +
      '<div class="auth-card">' +
        '<aside class="auth-aside">' +
          '<div class="auth-aside-mark">题</div>' +
          '<div class="auth-aside-name">智能题库</div>' +
          '<div class="auth-aside-tag">刷题 · 错题 · 模拟考</div>' +
          '<p class="auth-aside-desc">把题库、练习与群组按账号隔离保存，换设备也不丢。</p>' +
          '<div class="auth-aside-cards" aria-hidden="true">' +
            '<span class="qc qc1">Q</span><span class="qc qc2">A</span><span class="qc qc3">✓</span>' +
          '</div>' +
        '</aside>' +
        '<div class="auth-form">' +
          '<div class="auth-tabs">' +
            '<button class="auth-tab' + (isLogin ? ' on' : '') + '" data-action="auth-tab" data-mode="login">登录</button>' +
            '<button class="auth-tab' + (isReg ? ' on' : '') + '" data-action="auth-tab" data-mode="register">注册</button>' +
          '</div>' +
          '<h2>' + e(heading) + '</h2>' +
          '<p class="auth-sub">' + e(sub) + '</p>' +
          (S.pendingLegacy ? '<div class="notice-bar info">检测到本机已有数据。注册新账号后，这些数据会归入该账号，不会丢失。</div>' : '') +
          '<label class="field">账号<input type="text" id="auth-name" autocomplete="username" placeholder="请输入账号" value="' + e($('auth-name') ? $('auth-name').value : '') + '"></label>' +
          '<label class="field">密码<input type="password" id="auth-pass" autocomplete="' + (isReg ? 'new-password' : 'current-password') + '" placeholder="' + (isReg ? '至少 4 位，用于登录' : '请输入密码') + '"></label>' +
          (S.err ? '<div class="auth-err">' + e(S.err) + '</div>' : '') +
          '<button class="btn btn-primary auth-submit" data-action="auth-go">' + (isReg ? '注册并进入' : '登录') + '</button>' +
          (users && isLogin ? '<div class="auth-users"><span class="small faint">本机已有账号</span><div>' + users + '</div></div>' : '') +
        '</div>' +
      '</div></div>';
  }
  function showGate() {
    let root = $('auth-gate-root');
    if (!root && global.document && global.document.body) {
      root = global.document.createElement('div'); root.id = 'auth-gate-root';
      global.document.body.appendChild(root);
    }
    if (root) root.innerHTML = gateHtml();
  }
  function hideGate() { const r = $('auth-gate-root'); if (r) r.innerHTML = ''; }
  function mountChip() {
    try {
      const bar = global.document && global.document.querySelector('.topbar-right');
      if (!bar || $('auth-chip')) return;
      const b = global.document.createElement('button');
      b.id = 'auth-chip'; b.className = 'btn btn-ghost';
      b.setAttribute('data-action', 'auth-logout');
      b.title = '退出当前账号，切换到其他账号';
      b.textContent = '◉ ' + currentName() + ' · 退出';
      bar.insertBefore(b, bar.firstChild);
    } catch (x) {}
  }

  /* ---------------- 账号动作 ---------------- */
  function activate(id) {
    const d = readDir();
    d.currentId = id; writeDir(d);
    /* 切换账号时先存回原账号，再恢复目标账号快照；未登录态 activeId 为空，不会误保存 */
    if (S.activeId && S.activeId !== id) writeData(S.activeId, snapshot());
    restore(readData(id));
    set(SS(), SESSION_KEY, id);
    S.activeId = id; S.err = ''; S.locked = false;
    global.__AUTH_GATE_LOCKED__ = false;
    hideGate();
    if (!reload() && Quiz.app && Quiz.app.render) Quiz.app.render();
  }
  /* 登录（严格）：账号必须存在且密码正确 */
  function doLogin(name, pass) {
    const n = String(name || '').trim().slice(0, 24), p = String(pass || '');
    if (!n) { S.err = '请输入账号'; showGate(); return {ok: false, msg: S.err}; }
    if (!p) { S.err = '请输入密码'; showGate(); return {ok: false, msg: S.err}; }
    const d = readDir();
    const u = d.users.filter(x => x.name === n)[0];
    if (!u) { S.err = '账号不存在，请先注册'; S.mode = 'register'; showGate(); return {ok: false, msg: S.err}; }
    if (u.passHash !== util.hash(p)) { S.err = '密码不正确'; showGate(); return {ok: false, msg: S.err}; }
    if (u.disabled) { S.err = '该账号已被管理员停用'; showGate(); return {ok: false, msg: S.err}; }
    const dd = readDir(), me = dd.users.filter(x => x.id === u.id)[0];
    if (me) { me.lastLoginAt = util.now(); writeDir(dd); }
    activate(u.id);
    return {ok: true, id: u.id, name: u.name};
  }
  /* 注册（严格）：账号不存在才创建；已存在则引导去登录 */
  function doRegister(name, pass) {
    const n = String(name || '').trim().slice(0, 24), p = String(pass || '');
    if (!n) { S.err = '请输入账号'; showGate(); return {ok: false, msg: S.err}; }
    if (!p) { S.err = '请设置密码'; showGate(); return {ok: false, msg: S.err}; }
    if (p.length < 4) { S.err = '密码至少 4 位'; showGate(); return {ok: false, msg: S.err}; }
    if (n.toLowerCase() === BUILTIN_ADMIN_NAME) { S.err = '该账号为保留账号，请直接登录'; S.mode = 'login'; showGate(); return {ok: false, msg: S.err}; }
    const d = readDir();
    const id = userId(n);
    if (d.users.some(x => x.id === id)) { S.err = '该账号已注册，请登录'; S.mode = 'login'; showGate(); return {ok: false, msg: S.err}; }
    /* v1.12.0：新注册账号一律为用户模式，只有内置 admin 是管理员 */
    const u = {id, name: n, passHash: util.hash(p), createdAt: util.now(),
      isAdmin: false, disabled: false};
    d.users.push(u); writeDir(d);
    /* 首次注册：有历史数据则归入该账号，否则给一份干净的空空间 */
    writeData(id, S.pendingLegacy ? snapshot() : {});
    S.pendingLegacy = false;
    activate(u.id);
    return {ok: true, id: u.id, name: u.name};
  }
  /* 兼容旧调用：未指定模式时按「不存在即注册、存在即登录」处理 */
  function login(name, pass) {
    const n = String(name || '').trim().slice(0, 24);
    const d = readDir();
    return d.users.some(x => x.name === n) ? doLogin(name, pass) : doRegister(name, pass);
  }
  function submit() {
    const n = $('auth-name'), p = $('auth-pass');
    return S.mode === 'register' ? doRegister(n ? n.value : '', p ? p.value : '') : doLogin(n ? n.value : '', p ? p.value : '');
  }
  function logout() {
    if (S.activeId) writeData(S.activeId, snapshot());
    clearActive();
    del(SS(), SESSION_KEY);
    const d = readDir(); d.currentId = ''; writeDir(d);
    S.activeId = ''; S.err = ''; S.mode = 'login';
    global.__AUTH_GATE_LOCKED__ = true;
    showGate();
    if (!reload() && Quiz.app && Quiz.app.render) Quiz.app.render();
    return {ok: true};
  }
  function onAction(a, el) {
    if (a === 'auth-tab') {
      S.mode = (el && el.dataset.mode === 'register') ? 'register' : 'login';
      S.err = ''; showGate();
      return true;
    }
    if (a === 'auth-go') { submit(); return true; }
    if (a === 'auth-fill') {
      const n = $('auth-name'); if (n && el.dataset.name) n.value = el.dataset.name;
      const p = $('auth-pass'); if (p) p.focus();
      return true;
    }
    if (a === 'auth-logout') {
      if (!global.confirm || global.confirm('退出后需重新登录，当前账号数据会保留。确定退出？')) logout();
      return true;
    }
    return false;
  }

  /* ---------------- 启动：始终本地账号门 ---------------- */
  function boot() {
    const d = readDir(), ssStore = SS();
    const sid = get(ssStore, SESSION_KEY);
    S.activeId = '';
    /* 已登录（本机会话有效）：直接进入，挂载退出入口 */
    if (sid && d.users.some(u => u.id === sid)) {
      S.activeId = sid; S.locked = false;
      global.__AUTH_GATE_LOCKED__ = false;
      hideGate();
      mountChip();
      if (global.document && global.document.readyState === 'loading')
        global.document.addEventListener('DOMContentLoaded', mountChip);
      return {loggedIn: true, id: sid};
    }
    /* 未登录：先把活动数据存回上次账号，再清空；首次启用保留历史供认领 */
    if (d.currentId && hasMainData()) writeData(d.currentId, snapshot());
    S.pendingLegacy = d.users.length === 0 && hasMainData();
    if (!S.pendingLegacy) clearActive();
    S.locked = true;
    global.__AUTH_GATE_LOCKED__ = true;
    showGate();
    return {loggedIn: false, pendingLegacy: S.pendingLegacy};
  }
  try {
    global.document.addEventListener('click', function (ev) {
      const el = ev.target && ev.target.closest && ev.target.closest('[data-action^="auth-"]');
      if (!el) return;
      if (!onAction(el.dataset.action, el)) return;
      if (ev.stopImmediatePropagation) ev.stopImmediatePropagation();
    });
    global.document.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Enter' || !$('auth-gate')) return;
      if (ev.target && ev.target.id !== 'auth-name' && ev.target.id !== 'auth-pass') return;
      submit();
    });
  } catch (x) {}
  let bootResult = null;
  try { bootResult = boot(); } catch (x) { bootResult = {loggedIn: false, error: String(x && x.message || x)}; }

  Quiz.accountGate = {state: S, KEYS, DIR_KEY, SESSION_KEY, DATA_PREFIX, boot, bootResult,
    login, doLogin, doRegister, submit, logout, onAction, snapshot, restore, clearActive, readDir, writeDir, readData, writeData,
    gateHtml, showGate, hideGate, mountChip, userId, currentName, hasMainData,
    users, isAdmin, requireAdmin, updateUser, removeUser, purgeLegacyDemo, ensureAdmin, publicUser,
    BUILTIN_ADMIN_NAME, BUILTIN_ADMIN_PASS, builtinAdminId};
  if (typeof module !== 'undefined' && module.exports) module.exports = Quiz.accountGate;
})(typeof window !== 'undefined' ? window : globalThis);
