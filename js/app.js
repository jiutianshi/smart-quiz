/* 应用框架：路由、事件委托、练习状态机、导入流程 */
(function (global) {
  const Quiz = global.Quiz;
  const util = Quiz.util, store = Quiz.store, scorer = Quiz.scorer, importer = Quiz.importer;
  const enhance = Quiz.enhance, ai = Quiz.ai;
  const esc = util.esc, now = util.now;
  const $ = id => document.getElementById(id);
  const val = id => { const e = $(id); return e ? e.value : ''; };

  const TITLES = {
    dashboard:['首页','题库、练习与学习档案总览'],
    stats:['学习统计','多维正确率、得分率与用时分析'],
    import:['文档导入','标准模板、字段校验与去重入库'],
    bank:['题库管理','先选择题库，再编辑该库内的试题'],
    practice:['开始刷题','抽题、判分、反馈与交卷'],
    wrong:['错题本','按科目/题型/时间重刷与掌握追踪'],
    favorites:['我的收藏','收藏夹分类与收藏练习'],
    records:['刷题记录','会话归档与逐题明细追溯'],
    settings:['数据与设置','判分配置、AI 模型、备份与恢复'],
    importReview:['文档导入校验','选择表单 / 表头行 / 字段匹配、题目预览与格式检查'],
    bankGrid:['试题表格编辑','先选题库，再在表格里直接改题、报错检测并保存'],
    /* v0.9 新导航 */
    mybanks:['我的题库','上传、新建与维护本机题库'],
    allwrong:['全部错题','按题库汇总错题数量'],
    allfav:['全部收藏题','按题库汇总收藏数量'],
    practiceRecords:['练习记录','练习数据、排行榜与累计练习'],
    examNew:['新增考试','创建考试 → 试题设置 → 考试设置'],
    examHistory:['考试历史','本机已创建考试列表'],
    library:['资料库','上传与管理学习资料'],
    groups:['我的群组','创建 / 按群号加入群组、组织题库练习'],
    account:['账户信息','账号资料与扩展字段'],
    orders:['我的订单','订单列表'],
    reports:['试题报错','试题问题反馈'],
    messages:['消息中心','管理员下发的全站通知'],
    downloads:['文档下载','资料与文档下载'],
    trash:['回收站','已删除内容'],
    admin:['管理后台','账号管理、通知下发与数据概览'],
    /* v1.0.0 题库练习模式 */
    practiceHub:['练习选择','题库练习模式：选择练习方式'],
    hubFavorites:['我的收藏','收藏分布与按题型练习'],
    hubMastered:['我的斩题','已掌握的题目'],
    hubNotes:['我的笔记','逐题笔记列表'],
    hubReview:['查看练习数据','正确率与本题库近 7 天练习量'],
    hubChapter:['章节练习','按章节生成练习'],
    hubType:['题型练习','按题型 / 判断题 / 难度单独练习'],
    hubExam:['模拟考试','试题配置 → 考试 → 成绩 → 错题明细']
  };

  /* v0.9 一级导航分组：二级路由 → 所属一级分组，用于高亮 */
  const NAV_GROUP = {
    mybanks:'bankcenter', allwrong:'bankcenter', allfav:'bankcenter', practiceRecords:'bankcenter', bankGrid:'bankcenter',
    practiceHub:'bankcenter', hubFavorites:'bankcenter', hubMastered:'bankcenter', hubNotes:'bankcenter',
    hubReview:'bankcenter', hubChapter:'bankcenter', hubType:'bankcenter', hubExam:'bankcenter',
    examNew:'exam', examHistory:'exam',
    account:'account', orders:'account', reports:'account', messages:'account', downloads:'account', trash:'account'
  };
  /* v1.11.0：管理后台只对管理员可见，普通用户访问路由时由页面本身给出无权限提示 */

  const app = Quiz.app = {
    route: 'dashboard',
    practice: null,
    result: null,
    ui: {
      stats: {range:'all', category:'', type:''},
      /* v1.12.0：tab 记住文档导入页当前标签；上传记录存独立键，不进账号业务 KEYS */
      imp: {policy:'skip', skipErrors:'0', text:'', report:null, review:[], batchId:'', bankId: Quiz.DEFAULT_BANK_ID,
        lastFileName:'', lastFileSize:0},
      bank: {kw:'', category:'', type:'', difficulty:'', status:'', tag:'', page:1, bankId: Quiz.DEFAULT_BANK_ID},
      /* v1.3.3 文档导入校验页：只存上次选择的源文件（内存），不进备份 */
      importReview: {file:null, fileName:''},
      practice: {mode:'normal', bank_id:Quiz.ALL_BANKS, category:'', type:'', difficulty:'', count:10, order:'random',
                 feedback_mode:'immediate', partial_mode:'proportional', allow_partial_with_wrong:false,
                 quota_mode:false, quota:{single:0, multiple:0, judge:0},
                 shuffle_options:true, auto_advance:false},
      wrong: {category:'', type:'', mastered:'no', range:'all'},
      favorites: {folder:'ALL'},
      /* v0.8 答题页设置面板：与组卷配置双向同步，独立持久化 */
      quiz: {settings_open:true, auto_advance:false, recite_mode:false, shuffle_options:true,
             ai_analysis:true, eye_care:false, group_size:10, mastery_threshold:2, font_size:'normal'},
      theme: 'system', resultFilter: 'all'
    },
    editingId: null,
    pickingQuestion: null
  };

  /* ---------- 界面偏好（组卷配置 / 导入选项 / 主题） ---------- */
  function restorePrefs() {
    const cfg = store.config(), pref = store.prefs.get();
    if (pref.practice && typeof pref.practice === 'object') {
      Object.keys(pref.practice).forEach(k => {
        if (Object.prototype.hasOwnProperty.call(app.ui.practice, k) && pref.practice[k] != null)
          app.ui.practice[k] = pref.practice[k];
      });
    } else {
      app.ui.practice.feedback_mode = cfg.feedback_mode;
      app.ui.practice.partial_mode = cfg.partial_mode;
      app.ui.practice.shuffle_options = !!cfg.shuffle_options;
      app.ui.practice.auto_advance = !!cfg.auto_advance;
      app.ui.practice.count = cfg.default_question_count;
    }
    if (pref.imp && typeof pref.imp === 'object') {
      Object.keys(pref.imp).forEach(k => {
        if (Object.prototype.hasOwnProperty.call(app.ui.imp, k) && pref.imp[k] != null) app.ui.imp[k] = pref.imp[k];
      });
    }
    if (pref.bankId && (pref.bankId === Quiz.ALL_BANKS || store.bank(pref.bankId))) app.ui.bank.bankId = pref.bankId;
    else app.ui.bank.bankId = store.defaultBankId();
    if (pref.impBankId && store.bank(pref.impBankId)) app.ui.imp.bankId = pref.impBankId;
    else app.ui.imp.bankId = store.defaultBankId();
    // v0.8 答题设置：有偏好读偏好，无偏好从既有 config 初始化（不重置用户原有设置）
    const q = pref.quiz;
    if (q && typeof q === 'object') {
      Object.keys(app.ui.quiz).forEach(k => { if (q[k] != null) app.ui.quiz[k] = q[k]; });
    } else {
      app.ui.quiz.auto_advance = !!cfg.auto_advance;
      app.ui.quiz.shuffle_options = !!cfg.shuffle_options;
      app.ui.quiz.group_size = cfg.default_question_count;
      app.ui.quiz.mastery_threshold = cfg.mastery_threshold;
    }
    app.ui.practice.auto_advance = !!app.ui.quiz.auto_advance;
    app.ui.practice.shuffle_options = !!app.ui.quiz.shuffle_options;
    app.ui.practice.count = Math.max(1, Number(app.ui.quiz.group_size) || 10);
    applyQuizDisplay();
    app.ui.theme = enhance.readTheme();
    enhance.applyTheme(app.ui.theme);
    enhance.watchTheme(t => { app.ui.theme = t.mode; render(); });
  }

  /* 护眼 / 字号：只写根元素属性，由 CSS 变量生效，不改变数据与任何判分逻辑 */
  function applyQuizDisplay() {
    try {
      const de = document.documentElement;
      if (!de || !de.setAttribute) return;
      de.setAttribute('data-eyecare', app.ui.quiz.eye_care ? 'on' : 'off');
      de.setAttribute('data-font', app.ui.quiz.font_size || 'normal');
    } catch (e) { /* DOM 桩 / 无 DOM 环境忽略 */ }
  }

  /* 答题设置统一落盘：同时同步组卷配置、全局 config 与当前进行中的会话 */
  function saveQuizPrefs() {
    const z = app.ui.quiz;
    z.group_size = Math.max(1, Math.min(200, parseInt(z.group_size, 10) || 10));
    z.mastery_threshold = Math.max(0, Math.min(99, parseInt(z.mastery_threshold, 10) || 0));
    app.ui.practice.auto_advance = !!z.auto_advance;
    app.ui.practice.shuffle_options = !!z.shuffle_options;
    app.ui.practice.count = z.group_size;
    store.setConfig({auto_advance: !!z.auto_advance, shuffle_options: !!z.shuffle_options,
                     default_question_count: z.group_size, mastery_threshold: z.mastery_threshold});
    store.prefs.set({quiz: Object.assign({}, z),
                     practice: Object.assign({}, store.prefs.get().practice || {}, {
                       auto_advance: !!z.auto_advance, shuffle_options: !!z.shuffle_options, count: z.group_size
                     })});
    if (app.practice && !app.practice.finished) {
      app.practice.config.auto_advance = !!z.auto_advance;
      app.practice.scope.shuffle_options = !!z.shuffle_options;
      persistPractice();
    }
    applyQuizDisplay();
  }
  app.saveQuizPrefs = saveQuizPrefs;

  /* 「选项乱序」实时生效：仅重排尚未作答的题目，已作答题目保留快照，保证成绩可复算 */
  function applyShuffleChange(enabled) {
    const p = app.practice;
    if (!p || p.finished) return;
    p.questions.forEach((q, i) => {
      if (p.answers[i]) return;
      p.questions[i] = enhance.setQuestionShuffle(q, enabled);
    });
    if (!p.answers[p.index] && p.drafts) delete p.drafts[p.index];  // 选项已变，旧草稿失效
    p.scope.shuffle_options = !!enabled;
    persistPractice();
  }
  function savePrefs() {
    const p = app.ui.practice;
    // 组卷配置页的改动同步回答题设置面板，两个入口永远一致
    app.ui.quiz.auto_advance = !!p.auto_advance;
    app.ui.quiz.shuffle_options = !!p.shuffle_options;
    app.ui.quiz.group_size = Math.max(1, Math.min(200, parseInt(p.count, 10) || 10));
    app.ui.quiz.mastery_threshold = store.config().mastery_threshold;
    return store.prefs.set({
      quiz: Object.assign({}, app.ui.quiz),
      bankId: app.currentBankId(),
      impBankId: app.ui.imp.bankId,
      practice: {mode:p.mode, bank_id:p.bank_id || Quiz.ALL_BANKS, category:p.category, type:p.type, difficulty:p.difficulty, count:p.count,
                 order:p.order, feedback_mode:p.feedback_mode, partial_mode:p.partial_mode,
                 allow_partial_with_wrong:p.allow_partial_with_wrong, quota_mode:p.quota_mode,
                 quota:Object.assign({}, p.quota), shuffle_options:p.shuffle_options, auto_advance:p.auto_advance},
      imp: {policy:app.ui.imp.policy, skipErrors:app.ui.imp.skipErrors}
    });
  }
  app.savePrefs = savePrefs;

  /* ---------- 通用 UI ---------- */
  function toast(msg, type) {
    const d = document.createElement('div');
    d.className = 'toast ' + (type || '');
    d.textContent = msg;
    $('toast-root').appendChild(d);
    setTimeout(() => d.remove(), 3200);
  }
  function modal(title, body, foot, cls) {
    $('modal-root').innerHTML = '<div class="modal-mask" data-action="modal-mask"><div class="modal' + (cls ? ' ' + cls : '') + '">' +
      '<div class="modal-head"><span>' + esc(title) + '</span><span class="x" data-action="close-modal">×</span></div>' +
      '<div class="modal-body" id="modal-body">' + body + '</div>' +
      '<div class="modal-foot" id="modal-foot">' + (foot || '<button class="btn" data-action="close-modal">关闭</button>') + '</div></div></div>';
  }
  function closeModal() { $('modal-root').innerHTML = ''; }
  app.toast = toast; app.modal = modal; app.closeModal = closeModal;
  /* v1.4.0：供试题表格编辑模块复用既有导入链与题目表单，不改原实现 */
  app.doImport = doImport; app.openQuestionForm = openQuestionForm;

  let timer = null, autoTimer = null;
  function stopTimer() { if (timer) { clearInterval(timer); timer = null; } }
  function clearAuto() { if (autoTimer) { clearTimeout(autoTimer); autoTimer = null; } }

  /* 重绘前保存当前题未提交的选择：跳题、收藏、切换页面都不会丢失草稿答案 */
  function captureDrafts() {
    const p = app.practice;
    if (!p || p.finished || p.answers[p.index]) return;
    // 翻页时 DOM 仍停留在上一题：若题号标记与当前 index 不符，说明草稿已由调用方按旧 index 保存过，避免误存到新题
    try {
      const box = document.querySelector && document.querySelector('.q-opts[data-qindex]');
      if (box && box.dataset && box.dataset.qindex != null && Number(box.dataset.qindex) !== p.index) return;
    } catch (e) { /* 无 DOM / DOM 桩环境忽略 */ }
    let inputs = [];
    try { inputs = Array.from(document.querySelectorAll('input[name="answer"]')); } catch (e) { return; }
    if (!inputs.length) return;                       // 不在答题页，保留已有草稿
    p.drafts = p.drafts || {};
    const picked = inputs.filter(i => i.checked).map(i => i.value);
    if (!picked.length) { delete p.drafts[p.index]; return; }
    const q = p.questions[p.index];
    if (!q) return;
    p.drafts[p.index] = q.type === 'judge' ? scorer.normalizeBool(picked[0])
      : (q.type === 'single' ? [picked[0]] : picked);
  }
  function startTimer() {
    stopTimer();
    if (!app.practice || app.practice.finished) return;
    const t0 = new Date(app.practice.session_started_at).getTime();
    const tick = () => { const e = $('quiz-timer'); if (e) e.textContent = util.fmtDur(Date.now() - t0); };
    tick(); timer = setInterval(tick, 1000);
  }

  /* ---------- v0.9 导航与新页面辅助 ---------- */
  function navState() { return Quiz.navState; }
  function applyNav() {
    const st = navState(); if (!st) return;
    try {
      document.querySelectorAll('[data-sub]').forEach(sub => {
        const g = sub.getAttribute('data-sub');
        sub.classList.toggle('is-collapsed', !st.navOpen[g]);
      });
      document.querySelectorAll('[data-action="nav-toggle"]').forEach(btn => {
        const g = btn.getAttribute('data-group');
        btn.setAttribute('aria-expanded', st.navOpen[g] ? 'true' : 'false');
      });
    } catch (err) {}
  }
  /* 切换向导步骤前，把当前步骤表单收回内存，避免重绘丢失输入 */
  function collectExam() {
    const st = navState(); if (!st) return;
    try {
      document.querySelectorAll('[data-exam-field]').forEach(inp => {
        const k = inp.getAttribute('data-exam-field');
        if (!k) return;
        st.exam.form[k] = inp.type === 'checkbox' ? !!inp.checked : inp.value;
      });
    } catch (err) {}
  }
  function navTodo(msg) { toast(msg || '该功能暂未开放', 'ok'); }
  function navSearch(target) {
    const st = navState(); if (!st || !st[target]) return;
    const id = target === 'examHistory' ? 'examhis-kw' : 'mybanks-kw';
    const el = $(id);
    st[target].kw = el ? el.value : '';
  }

  /* ---------- 渲染 ---------- */
  function syncUiFromDom() {
    const ui = app.ui;
    captureDrafts();
    if ($('imp-text')) ui.imp.text = val('imp-text');
    if ($('imp-policy')) ui.imp.policy = val('imp-policy');
    if ($('imp-skip')) ui.imp.skipErrors = val('imp-skip');
    if ($('imp-bank') && val('imp-bank')) ui.imp.bankId = val('imp-bank');
    if ($('st-range')) { ui.stats.range = val('st-range'); ui.stats.category = val('st-cat'); ui.stats.type = val('st-type'); }
    if ($('bank-cat')) {
      ui.bank.category = val('bank-cat'); ui.bank.type = val('bank-type');
      ui.bank.difficulty = val('bank-diff'); ui.bank.status = val('bank-status'); ui.bank.tag = val('bank-tag');
    }
    if ($('bank-kw')) ui.bank.kw = val('bank-kw');
    // 仅在刷题配置页读取组卷表单，避免其它页面的同名/空元素覆盖已保存的配置
    if (app.route === 'practice' && !app.practice && $('pr-cat')) {
      if ($('pr-bank')) ui.practice.bank_id = val('pr-bank') || Quiz.ALL_BANKS;
      ui.practice.category = val('pr-cat'); ui.practice.type = val('pr-type');
      ui.practice.difficulty = val('pr-diff'); ui.practice.order = val('pr-order');
      ui.practice.feedback_mode = val('pr-fb'); ui.practice.partial_mode = val('pr-partial');
      ui.practice.count = Math.max(1, Math.min(200, parseInt(val('pr-count'), 10) || 10));
      ui.practice.allow_partial_with_wrong = !!($('pr-wrong-partial') && $('pr-wrong-partial').checked);
      ui.practice.shuffle_options = !!($('pr-shuffle') && $('pr-shuffle').checked);
      ui.practice.auto_advance = !!($('pr-auto-advance') && $('pr-auto-advance').checked);
      ui.practice.quota_mode = !!($('pr-quota-mode') && $('pr-quota-mode').checked);
      if ($('pr-q-single')) ui.practice.quota = {
        single: Math.max(0, parseInt(val('pr-q-single'), 10) || 0),
        multiple: Math.max(0, parseInt(val('pr-q-multiple'), 10) || 0),
        judge: Math.max(0, parseInt(val('pr-q-judge'), 10) || 0)
      };
    }
    // 仅在对应页面读取该页筛选表单，避免其它页面的同名/空元素覆盖已保存的状态
    if (app.route === 'wrong' && $('wr-cat')) {
      ui.wrong.category = val('wr-cat'); ui.wrong.type = val('wr-type');
      ui.wrong.mastered = val('wr-mastered'); ui.wrong.range = val('wr-time');
    }
  }

  function render() {
    stopTimer(); clearAuto(); captureDrafts();
    applyQuizDisplay();
    // 设置面板的「答对自动下一题」对正在进行的会话即时生效（不改动已归档的历史配置）
    if (app.practice && !app.practice.finished)
      app.practice.config.auto_advance = !!app.ui.quiz.auto_advance;
    let route = (location.hash || '').replace(/^#\/?/, '').split('?')[0];
    if (!Quiz.pages[route]) route = 'dashboard';
    app.route = route;
    const t = TITLES[route];
    $('page-title').textContent = t[0]; $('page-desc').textContent = t[1];
    const themeBtn = $('theme-btn');
    if (themeBtn) themeBtn.textContent = ({system:'◐ 跟随系统', light:'☀ 浅色', dark:'☾ 深色'})[app.ui.theme] || '◐ 主题';
    const aiBtn = $('ai-status-btn');
    if (aiBtn) {
      const ac = ai.config(), on = ac.enabled && ac.configured;
      aiBtn.textContent = on ? '✦ AI 已启用 · ' + ac.model : '✦ AI 未启用';
      aiBtn.className = 'btn btn-ghost' + (on ? ' ai-on' : '');
    }
    document.querySelectorAll('[data-nav]').forEach(a => a.classList.toggle('active', a.dataset.nav === route));
    /* v1.11.0：管理后台入口仅管理员可见 */
    const adminNav = $('nav-admin');
    if (adminNav) {
      const isAdm = !!(Quiz.accountGate && Quiz.accountGate.isAdmin && Quiz.accountGate.isAdmin());
      adminNav.style.display = isAdm ? '' : 'none';
    }
    applyNav();
    try {
      document.querySelectorAll('[data-block]').forEach(b => {
        const root = b.querySelector && b.querySelector('.nav-root');
        if (root) root.classList.toggle('active', b.getAttribute('data-block') === NAV_GROUP[route]);
      });
    } catch (err) {}
    $('view').innerHTML = Quiz.pages[route](app);
    const s = store.state();
    $('side-count').textContent = s.questions.length + ' 题 · ' + s.records.length + ' 条作答记录';
    $('storage-dot').className = 'dot' + (store.isFallback() ? ' bad' : '');
    $('storage-text').textContent = store.isFallback() ? '内存模式（请导出备份）' : '数据已保存';
    if (route === 'practice' && app.practice && !app.practice.finished) startTimer();
    window.scrollTo({top:0, behavior:'auto'});
  }
  app.render = render;
  function go(route) {
    const hash = '#/' + route;
    if (location.hash === hash) render(); else location.hash = hash;
  }

  /* ---------- 查询辅助（供 pages 调用） ---------- */
  app.computeStats = function () {
    const s = store.state(), ui = app.ui.stats;
    const cut = ui.range === 'all' ? 0 : Date.now() - Number(ui.range) * 86400000;
    let records = s.records.filter(r => !cut || new Date(r.answered_at).getTime() >= cut);
    if (ui.category) records = records.filter(r => (r.question_snapshot.category || []).join('/') === ui.category);
    if (ui.type) records = records.filter(r => r.type === ui.type);
    const ids = new Set(records.map(r => r.session_id));
    return {records, sessions: s.sessions.filter(x => ids.has(x.session_id))};
  };
  app.dailyAccuracy = function (records, limit) {
    const map = {};
    (records || []).forEach(r => { const k = util.dayKey(r.answered_at); (map[k] = map[k] || []).push(r); });
    let keys = Object.keys(map).sort();
    if (limit) keys = keys.slice(-limit);
    return keys.map(k => ({label: k.slice(5), value: +(scorer.aggregate(map[k]).accuracy * 100).toFixed(1)}));
  };
  app.last7Accuracy = function () { return app.dailyAccuracy(store.state().records, 7); };
  /* 当前生效题库：选中的库被删除或备份不含该库时自动回退默认库；ALL 为跨库视图 */
  app.currentBankId = function () {
    const id = app.ui.bank.bankId;
    if (id === Quiz.ALL_BANKS) return id;
    return store.bank(id) ? id : store.defaultBankId();
  };
  app.formBankId = function () {
    const id = app.currentBankId();
    return id === Quiz.ALL_BANKS ? store.defaultBankId() : id;
  };
  app.filterQuestions = function () {
    const ui = app.ui.bank, kw = (ui.kw || '').trim().toLowerCase();
    const bid = app.currentBankId(), def = store.defaultBankId();
    return store.state().questions.filter(q => {
      if (bid !== Quiz.ALL_BANKS && (q.bank_id || def) !== bid) return false;
      if (ui.category && (q.category || []).join('/') !== ui.category) return false;
      if (ui.type && q.type !== ui.type) return false;
      if (ui.difficulty && String(q.difficulty) !== String(ui.difficulty)) return false;
      if (ui.status && q.status !== ui.status) return false;
      if (ui.tag && !(q.tags || []).includes(ui.tag)) return false;
      if (kw && !(q.stem + ' ' + q.question_id + ' ' + (q.tags || []).join(' ')).toLowerCase().includes(kw)) return false;
      return true;
    });
  };
  app.wrongRows = function () {
    const s = store.state(), ui = app.ui.wrong;
    const cut = ui.range === 'all' ? 0 : Date.now() - Number(ui.range) * 86400000;
    return s.wrong.filter(w => {
      if (ui.category && (w.category_snapshot || []).join('/') !== ui.category) return false;
      if (ui.type && w.type !== ui.type) return false;
      if (ui.mastered === 'no' && w.mastered) return false;
      if (ui.mastered === 'yes' && !w.mastered) return false;
      if (cut && new Date(w.first_wrong_at).getTime() < cut) return false;
      return true;
    }).sort((a,b) => String(b.last_wrong_at).localeCompare(String(a.last_wrong_at)));
  };
  function buildPool(mode, folder) {
    const s = store.state();
    let pool;
    if (mode === 'wrong_review') {
      const ids = new Set(s.wrong.filter(w => !w.mastered).map(w => w.question_id));
      pool = s.questions.filter(q => ids.has(q.question_id) && q.status === 'published');
    } else if (mode === 'favorite') {
      const ids = new Set(s.favorites.filter(f => folder === 'ALL' || f.folder_id === folder).map(f => f.question_id));
      pool = s.questions.filter(q => ids.has(q.question_id) && q.status === 'published');
    } else pool = s.questions.filter(q => q.status === 'published');
    const ui = app.ui.practice, bid = ui.bank_id || Quiz.ALL_BANKS, def = store.defaultBankId();
    return pool.filter(q => {
      if (bid !== Quiz.ALL_BANKS && (q.bank_id || def) !== bid) return false;
      if (ui.category && (q.category || []).join('/') !== ui.category) return false;
      if (ui.type && q.type !== ui.type) return false;
      if (ui.difficulty && String(q.difficulty) !== String(ui.difficulty)) return false;
      return true;
    });
  }
  app.availableCount = function () { return buildPool(app.ui.practice.mode, app.ui.favorites.folder).length; };
  app.quotaAvailable = function () { return enhance.quotaAvailable(buildPool(app.ui.practice.mode, app.ui.favorites.folder)); };

  /* ---------- 练习状态机 ---------- */
  app.startPractice = function (overrides) {
    overrides = overrides || {};
    const ui = app.ui.practice, cfg = store.config();
    const mode = overrides.mode || ui.mode;
    /* v1.5.0：题库级「练习设置 / 自定义题型 / 编辑章节」接入组卷；未配置过的题库保持原口径 */
    const BO = Quiz.bankOps;
    let bo = null, boBank = '';
    if (BO) {
      const hm = /[?&]bank=([^&]+)/.exec(String(location.hash || ''));
      boBank = overrides.bank_id || (hm ? decodeURIComponent(hm[1]) : '') || ui.bank_id || '';
      if (boBank && boBank !== Quiz.ALL_BANKS && BO.has(boBank)) bo = BO.get(boBank);
    }
    const useOrder = overrides.order || (bo && bo.practice && bo.practice.order) || ui.order;
    let pool = buildPool(mode, overrides.folder || app.ui.favorites.folder);
    if (overrides.forceIds) {
      const ids = new Set(overrides.forceIds);
      pool = store.state().questions.filter(q => ids.has(q.question_id) && q.status === 'published');
    }
    if (bo && !overrides.forceIds) {
      const t = bo.types || {}, chs = bo.chapters || [];
      pool = pool.filter(q => q.type === 'single' ? t.single !== false
        : q.type === 'multiple' ? t.multiple !== false : q.type === 'judge' ? t.judge !== false : true);
      if (chs.length) pool = pool.filter(q => {
        const cat = q.category || [];
        return cat.some(c => chs.indexOf(c) >= 0) || chs.indexOf(cat.join('/')) >= 0;
      });
    }
    if (!pool.length) { toast('没有可练习的题目，请检查筛选条件或题库状态', 'err'); return; }
    let picked;
    if (ui.quota_mode && !overrides.forceIds) {
      picked = enhance.quotaPick(pool, ui.quota, ui.order);
      if (!picked.length) { toast('题型配额全为 0，请至少指定一种题型的题数', 'err'); return; }
    } else {
      if (useOrder === 'random') pool = pool.slice().sort(() => Math.random() - 0.5);
      const count = overrides.count || (bo && bo.practice && bo.practice.count) || ui.count || cfg.default_question_count;
      picked = pool.slice(0, count);
    }
    const shuffleOn = overrides.shuffle_options != null ? overrides.shuffle_options
      : (bo && bo.practice ? !!bo.practice.shuffle_options : !!ui.shuffle_options);
    // 题目快照：选项随机后答案键同步重映射，option_map 随快照归档，历史成绩可复算
    const chosen = picked.map(q => enhance.shuffleQuestion(JSON.parse(JSON.stringify(q)), shuffleOn));
    const feedback = mode === 'exam' ? 'after_submit'
      : (bo && bo.practice && bo.practice.feedback_mode) || ui.feedback_mode || cfg.feedback_mode;
    const autoAdvance = bo && bo.practice ? !!bo.practice.auto_advance : !!ui.auto_advance;
    clearAuto();
    app.practice = {
      session_id: util.uid('SES'), mode,
      scope: {bank_id: boBank || ui.bank_id || Quiz.ALL_BANKS, category: ui.category, type: ui.type, difficulty: ui.difficulty, order: useOrder,
              count: chosen.length, source_mode: mode, quota_mode: !!ui.quota_mode,
              quota: Object.assign({}, ui.quota), shuffle_options: shuffleOn},
      config: {partial_mode: ui.partial_mode || cfg.partial_mode,
               allow_partial_with_wrong: !!ui.allow_partial_with_wrong,
               min_score_unit: 0.01, feedback_mode: feedback,
               auto_advance: autoAdvance, auto_advance_ms: Number(cfg.auto_advance_ms) || 1200},
      questions: chosen, index: 0, answers: [], drafts: {},
      current_started_at: Date.now(), session_started_at: now(), finished: false
    };
    app.result = null;
    persistPractice();
    go('practice');
    toast('已组卷 ' + chosen.length + ' 题 · ' + Quiz.pages.MODE_LABEL[mode] + (shuffleOn ? ' · 选项已随机' : ''), 'ok');
  };
  function persistPractice() { store.runtime.set(app.practice && !app.practice.finished ? app.practice : null); }

  function currentAnswer() {
    const p = app.practice, q = p.questions[p.index];
    if (!q) return null;
    let picked = [];
    try { picked = Array.from(document.querySelectorAll('input[name="answer"]:checked')).map(i => i.value); } catch (e) {}
    const raw = picked.length ? picked : (p.drafts && p.drafts[p.index]);
    if (raw == null || (Array.isArray(raw) && !raw.length)) return null;
    const arr = Array.isArray(raw) ? raw : [raw];
    if (q.type === 'judge') return scorer.normalizeBool(arr[0]);
    return q.type === 'single' ? [arr[0]] : arr;
  }
  /* v1.4.4：逐题实时落库。判分完成的那一刻就写入 store.records，
     不等交卷；未交卷、刷新、中途退出都不会丢，云同步随主 state 一起走。 */
  function makeRecord(p, ans) {
    const q = ans.question;
    return {
      record_id: ans.record_id || util.uid('REC'),
      session_id: p.session_id, user_id: store.config().user_id,
      question_id: q.question_id, question_version: q.version || 1,
      question_snapshot: q,
      user_answer: ans.raw, normalized_answer: ans.result.user_answer,
      status: ans.result.status, is_correct: ans.result.is_correct,
      score: ans.result.score, max_score: ans.result.max_score,
      duration_ms: ans.duration_ms, source: p.mode, type: q.type,
      analysis: q.analysis || '', answered_at: ans.answered_at,
      per_option: ans.result.per_option
    };
  }
  function recordAnswer(raw) {
    const p = app.practice, q = p.questions[p.index];
    const result = scorer.score(q, raw, p.config);
    const ans = {
      question: q, raw, result,
      record_id: util.uid('REC'),
      duration_ms: Math.max(0, Date.now() - p.current_started_at),
      answered_at: now()
    };
    p.answers[p.index] = ans;
    store.appendLiveAnswer(makeRecord(p, ans));
    persistPractice();
  }
  /* v0.8：练习模式下的「选完即判」仅适用于单选 / 判断题。
     多选题仍需手动「提交本题」；考试模式、交卷后统一反馈、背题模式均保持原有交互。 */
  function instantEligible() {
    const p = app.practice;
    if (!p || p.finished || app.result || app.route !== 'practice') return false;
    if (p.mode === 'exam' || p.config.feedback_mode === 'after_submit') return false;
    if (app.ui.quiz.recite_mode) return false;
    const q = p.questions[p.index];
    if (!q || p.answers[p.index]) return false;
    return q.type === 'single' || q.type === 'judge';
  }
  app.instantEligible = instantEligible;

  function submitCurrent() {
    const p = app.practice;
    if (!p || p.answers[p.index]) return;
    const raw = currentAnswer();
    if (raw === null) { toast('请先选择答案；若要跳过请点「跳过本题」', 'err'); return; }
    recordAnswer(raw);
    if (p.drafts) delete p.drafts[p.index];
    persistPractice();
    render();
    const r = p.answers[p.index].result;
    if (p.config.auto_advance && r.status === 'correct' && p.index < p.questions.length - 1) {
      toast('回答正确，即将进入下一题…', 'ok');
      autoTimer = setTimeout(() => { autoTimer = null; nextQuestion(); }, Number(p.config.auto_advance_ms) || 1200);
    }
  }
  function nextQuestion() {
    const p = app.practice;
    if (!p) return;
    clearAuto();
    // 跳题不再立即记为未作答：交卷时由 finishPractice 统一补齐，可跳回继续作答
    if (p.index < p.questions.length - 1) {
      p.index++; p.current_started_at = Date.now(); persistPractice(); render();
    } else confirmFinish();
  }
  function confirmFinish() {
    const p = app.practice;
    if (!p) return;
    const answered = p.answers.filter(Boolean).length;
    modal('确认交卷？',
      '<div class="small">已作答 <b>' + answered + '</b> / ' + p.questions.length +
      ' 题，未作答按 0 分计并归集到错题本。交卷后可回看全部题目、答案与解析。</div>',
      '<button class="btn" data-action="close-modal">继续作答</button>' +
      '<button class="btn btn-primary" data-action="practice-finish-yes">确认交卷</button>');
  }
  function gotoQuestion(i) {
    const p = app.practice;
    i = Number(i);
    if (!p || isNaN(i) || i < 0 || i >= p.questions.length || i === p.index) return;
    clearAuto();
    p.index = i; p.current_started_at = Date.now(); persistPractice(); render();
  }
  function skipQuestion() {
    const p = app.practice;
    if (!p || p.answers[p.index]) return;
    recordAnswer(null);
    if (p.drafts) delete p.drafts[p.index];
    persistPractice();
    nextQuestion();
  }
  app.submitCurrent = submitCurrent; app.nextQuestion = nextQuestion; app.gotoQuestion = gotoQuestion;
  function finishPractice() {
    const p = app.practice;
    if (!p) return;
    clearAuto();
    p.questions.forEach((q, i) => { if (!p.answers[i]) { p.answers[i] = {question:q, raw:null, result:scorer.score(q, null, p.config), duration_ms:0, answered_at:now()}; } });
    const a = scorer.aggregate(p.answers.map(x => ({status:x.result.status, score:x.result.score, max_score:x.result.max_score, duration_ms:x.duration_ms})));
    const session = {
      session_id: p.session_id, user_id: store.config().user_id, mode: p.mode,
      scope: p.scope, config: p.config,
      question_count: a.question_count, total_score: a.total_score, earned_score: a.earned_score,
      accuracy: a.accuracy, score_rate: a.score_rate,
      correct_count: a.counts.correct, partial_count: a.counts.partial,
      wrong_count: a.counts.wrong, unanswered_count: a.counts.unanswered,
      duration_ms: a.duration_ms,
      started_at: p.session_started_at, finished_at: now(), status: 'finished'
    };
    /* v1.4.4：复用答题时已实时落库的 record_id / answered_at，交卷不再重复写入 */
    const records = p.answers.map(x => makeRecord(p, x));
    store.finishSession(session, records);
    store.runtime.clear();
    app.result = {session, records};
    app.practice = null;
    render();
    toast('已交卷并归档，错题本与统计已更新', 'ok');
  }

  /* ---------- 导入 ---------- */
  /* v1.12.0：上传记录（参考图的「上传记录」表），独立键持久化最近 8 条，不随账号切换清空 */
  const IMP_HISTORY_KEY = 'smartQuiz.importHistory.v1';
  function importHistory() {
    try { const a = JSON.parse(global.localStorage.getItem(IMP_HISTORY_KEY) || '[]'); return Array.isArray(a) ? a : []; }
    catch (x) { return []; }
  }
  function pushImportHistory(rec) {
    const a = importHistory(); a.unshift(rec);
    try { global.localStorage.setItem(IMP_HISTORY_KEY, JSON.stringify(a.slice(0, 8))); } catch (x) {}
  }
  app.importHistory = importHistory;
  app.pushImportHistory = pushImportHistory;

  function doImport(textOverride, optsOverride) {
    /* v1.3.3：校验页确认时传入已匹配的 CSV 与导入页已保存的策略，复用同一条入库链 */
    const text = textOverride != null ? textOverride : val('imp-text');
    if (!text.trim()) { toast('请先粘贴内容或选择文件', 'err'); return; }
    const opts = optsOverride || {duplicate_policy: val('imp-policy') || 'skip', skip_error_rows: val('imp-skip') === '1'};
    app.ui.imp.policy = opts.duplicate_policy;
    app.ui.imp.skipErrors = opts.skip_error_rows ? '1' : '0';
    app.ui.imp.bankId = store.bank(val('imp-bank') || app.ui.imp.bankId) ? (val('imp-bank') || app.ui.imp.bankId) : store.defaultBankId();
    const r = importer.runImport(text, store.state().questions, opts);
    app.ui.imp.text = text;
    app.ui.imp.report = r.report;
    app.ui.imp.review = r.reviewQueue;
    app.ui.imp.batchId = util.uid('IMP');
    const err0 = (r.report.errors || [])[0];
    pushImportHistory({
      name: app.ui.imp.lastFileName || '粘贴内容',
      time: util.now(), timeText: new Date().toLocaleString('zh-CN', {hour12:false}),
      size: app.ui.imp.lastFileSize || text.length,
      sizeText: app.ui.imp.lastFileSize ? (app.ui.imp.lastFileSize / 1024).toFixed(1) + ' KB' : text.length + ' B',
      ok: !r.report.atomic_rollback, inserted: r.valid.length, code: err0 ? err0.code : ''
    });
    const targetBank = app.ui.imp.bankId;
    r.valid.forEach(q => { q.bank_id = targetBank; });
    r.reviewQueue.forEach(item => { if (item.question) item.question.bank_id = targetBank; });
    if (r.valid.length) {
      const n = r.valid.length;
      store.mutate(s => r.valid.forEach(q => {
        const i = s.questions.findIndex(x => x.question_id === q.question_id);
        if (i >= 0) s.questions[i] = q; else s.questions.push(q);
      }));
      toast('成功入库 ' + n + ' 题' + (r.reviewQueue.length ? '，' + r.reviewQueue.length + ' 题待人工确认' : ''), 'ok');
    } else {
      /* v1.4.1：不再用「没有可入库的新题目」掩盖真实原因，首条错误直接进 toast */
      const e0 = (r.report.errors || [])[0];
      const why = e0 ? e0.code + '：' + e0.message : (r.report.duplicated ? '内容指纹与库内题目重复，请在下方人工确认队列处理' : '请检查表头与题目内容');
      toast((r.report.atomic_rollback ? '校验未通过，整批已回滚' : '没有可入库的新题目') + ' · ' + why + '（详见导入报告）', 'err');
    }
    savePrefs();
    render();
  }
  async function readImportFile(file) {
    if (!file) return;
    /* v1.3.2：统一按文件内容分流，扩展名只作为兜底提示；
       修复「二进制 .xls 改名为 .xlsx」「HTML 表格另存为 .xls」等错配导致的解析失败 */
    const named = Quiz.office.detect(file.name);
    app.ui.imp.lastFileName = file.name;
    app.ui.imp.lastFileSize = file.size || 0;
    toast('正在本地解析 ' + file.name + (named === 'legacy' ? '（旧版格式）' : '') + ' …');
    try {
      const text = await Quiz.office.readAuto(file, file.name);
      const note = Quiz.office.notice; Quiz.office.clearNotice();
      if ($('imp-text')) $('imp-text').value = text;
      app.ui.imp.text = text;
      app.ui.importReview.file = file;
      app.ui.importReview.fileName = file.name;
      /* v1.12.1：单页布局，解析完成后把焦点交还输入区 */
      try { const ti = $('imp-text'); if (ti && ti.focus) ti.focus(); } catch (x) {}
      if (named === 'text') toast('已载入 ' + file.name + '，请核对后点击「校验并导入」', 'ok');
      else toast('已解析 ' + file.name + '（' + Math.max(0, text.split('\n').length - 1) + ' 行数据）' + (note ? '；' + note : '') + '，请核对后点击「校验并导入」', 'ok');
    } catch (e) {
      toast(file.name + ' 解析失败：' + e.message, 'err');
    }
  }

  /* ---------- 题目编辑 / 收藏 ---------- */
  function readQuestionForm() {
    const type = val('qf-type');
    const options = Array.from(document.querySelectorAll('.qf-opt')).map(i => ({key:i.dataset.key, text:i.value.trim()})).filter(o => o.text);
    let answer;
    if (type === 'judge') answer = {value: val('qf-answer') === 'T'};
    else answer = {keys: scorer.normalizeKeys(val('qf-answer'))};
    const stem = val('qf-stem').trim();
    return {
      question_id: val('qf-id').trim() || ('Q-' + util.hash(stem + '|' + type).slice(0, 10)),
      type, stem, options, answer, analysis: val('qf-analysis').trim(),
      category: (val('qf-cat').split('/').map(x => x.trim()).filter(Boolean)).length ? val('qf-cat').split('/').map(x => x.trim()).filter(Boolean) : ['未分类'],
      tags: val('qf-tags').split(/[;；]/).map(x => x.trim()).filter(Boolean).slice(0,10),
      difficulty: parseInt(val('qf-diff'), 10) || 3,
      score: Number(val('qf-score')) || 1,
      source: val('qf-source').trim(), status: val('qf-status'),
      bank_id: val('qf-bank') || app.formBankId(),
      fingerprint: util.fingerprint(stem, type, options),
      updated_at: now()
    };
  }
  function openQuestionForm(id) {
    app.editingId = id || null;
    const q = id ? store.question(id) : {bank_id: app.formBankId()};
    modal(id ? '编辑题目 · ' + id : '新增题目 · ' + (store.bank(q.bank_id) || {name:'未分类题库'}).name, Quiz.pages.questionForm(q),
      '<button class="btn" data-action="close-modal">取消</button><button class="btn btn-primary" data-action="question-save">保存题目</button>');
  }
  function refreshQuestionForm() {
    const partial = readQuestionForm();
    if (partial.type === 'judge') partial.answer = {value:true};
    else partial.answer = {keys: partial.type === 'multiple' ? ['A','B'] : ['A']};
    if ($('modal-body')) $('modal-body').innerHTML = Quiz.pages.questionForm(partial);
  }
  function saveQuestion() {
    const q = readQuestionForm();
    const errs = scorer.validate(q);
    if (!q.stem) errs.unshift('题干不能为空');
    if (errs.length) { toast(errs.join('；'), 'err'); return; }
    if (!store.bank(q.bank_id)) q.bank_id = store.defaultBankId();
    store.upsertQuestion(q);
    closeModal(); render(); toast('题目已保存：' + q.question_id, 'ok');
  }
  function openFavoritePicker(id) {
    app.pickingQuestion = id;
    modal('收藏题目 · ' + id, Quiz.pages.favoritePicker(id),
      '<button class="btn" data-action="close-modal">取消</button><button class="btn btn-primary" data-action="favorite-save">保存收藏</button>');
  }
  function saveFavoritePicker() {
    const id = app.pickingQuestion;
    const target = new Set(Array.from(document.querySelectorAll('.fav-ck:checked')).map(x => x.value));
    let changed = 0;
    store.state().folders.forEach(f => {
      const has = store.state().favorites.some(x => x.question_id === id && x.folder_id === f.folder_id);
      if (has !== target.has(f.folder_id)) { store.toggleFavorite(id, f.folder_id); changed++; }
    });
    closeModal(); render(); toast(changed ? '收藏已更新' : '收藏无变化', 'ok');
  }

  /* ---------- 可选 AI 能力（全部手动触发，失败不影响任何核心流程） ---------- */
  function aiNotReady(title, purpose) {
    modal(title,
      '<div class="small">' + purpose + ' 是可选功能，需先在「数据与设置 → AI 模型配置」填写 API 地址与模型名称、启用并保存。未配置不影响建库、导入、练习、判分等任何功能。</div>',
      '<button class="btn" data-action="close-modal">知道了</button>' +
      '<button class="btn btn-primary" data-action="ai-go-settings">去配置</button>');
  }
  function resolveAiQuestion(id) {
    const q = store.question(id);
    if (q) return q;
    const rec = store.state().records.find(x => x.question_id === id && x.question_snapshot);
    return rec ? Object.assign({}, rec.question_snapshot, {question_id: id}) : null;
  }
  function renderAiExplain(q, r) {
    const body = $('modal-body');
    if (!body) return;
    const typeLabel = ({single:'单选题', multiple:'多选题', judge:'判断题'})[q.type] || q.type;
    body.innerHTML = '<div class="ai-q"><div class="small faint">' + esc(q.question_id) + ' · ' + esc(typeLabel) +
      ' · 正确答案 ' + esc(ai.answerText(q)) + '</div><div class="ai-stem">' + esc(q.stem) + '</div></div>' +
      '<div class="row" style="margin:12px 0 8px"><span class="badge b-blue">' + (r.cached ? '本地缓存' : '新生成') + '</span>' +
      '<span class="small faint">模型 ' + esc(r.model || '') + ' · 仅供参考，以题库解析与判分为准</span></div>' +
      '<div class="ai-text">' + esc(r.text) + '</div>';
    const foot = $('modal-foot');
    if (foot) foot.innerHTML = '<button class="btn" data-action="close-modal">关闭</button>' +
      '<button class="btn btn-sm" data-action="ai-explain-force" data-id="' + esc(q.question_id) + '">重新生成</button>';
    toast(r.cached ? '已命中本地缓存，未产生调用' : '讲解已生成并缓存到本地', 'ok');
  }
  function openAiExplain(id, force) {
    const q = resolveAiQuestion(id);
    if (!q) { toast('找不到该题目（可能已删除且无历史快照）', 'err'); return; }
    if (!ai.isReady()) { aiNotReady('AI 讲解需要先配置模型', '逐题 AI 讲解'); return; }
    if (!force) {
      const hit = ai.getCache(ai.cacheKey(q, 'explain'), ai.config().model);
      if (hit) {
        modal('✦ AI 讲解', '', '<button class="btn" data-action="close-modal">关闭</button>');
        renderAiExplain(q, {text: hit.text, cached: true, model: hit.model});
        return;
      }
    }
    modal('✦ AI 讲解', '<div class="ai-loading">正在生成讲解…（可关闭弹窗，请求仍会继续）</div>',
      '<button class="btn" data-action="close-modal">关闭</button>');
    ai.explain(q, !!force).then(r => renderAiExplain(q, r)).catch(err => {
      const body = $('modal-body');
      if (body) body.innerHTML = '<div class="ai-error"><b>讲解生成失败</b><div class="small">' + esc(err.message) + '</div>' +
        '<div class="small faint" style="margin-top:8px">原有解析与判分不受影响，可在设置页检查模型配置与跨域设置。</div></div>';
      toast('AI 讲解失败：' + err.message, 'err');
    });
  }
  function aiParseImport() {
    const text = val('imp-text') || app.ui.imp.text || '';
    if (!text.trim()) { toast('请先在输入框粘贴待解析的题目原文', 'err'); return; }
    if (!ai.isReady()) { aiNotReady('AI 解析需要先配置模型', '导入 AI 兜底解析'); return; }
    modal('✦ AI 解析文本', '<div class="ai-loading">正在把原文转换为标准 CSV…（单次最多 ' + ai.MAX_BLOCK_CHARS + ' 字符）</div>',
      '<button class="btn" data-action="close-modal">关闭</button>');
    ai.parseQuestions(text).then(r => {
      closeModal();
      app.ui.imp.text = r.csv;
      if ($('imp-text')) $('imp-text').value = r.csv;
      toast('已转换 ' + r.count + ' 题，请核对后再点「校验并导入」' + (r.truncated ? '（原文超长，已截断）' : ''), 'ok');
      render();
    }).catch(err => {
      const body = $('modal-body');
      if (body) body.innerHTML = '<div class="ai-error"><b>AI 解析失败</b><div class="small">' + esc(err.message) + '</div>' +
        '<div class="small faint" style="margin-top:8px">可改用标准 CSV / Excel / Word 表格导入，核心导入功能不受影响。</div></div>';
      toast('AI 解析失败：' + err.message, 'err');
    });
  }

  /* ---------- v0.8 答题页设置面板辅助动作 ---------- */
  function quizViewData() {
    const p = app.practice;
    if (!p) return;
    const answered = p.answers.filter(Boolean);
    const a = scorer.aggregate(answered.map(x => ({status:x.result.status, score:x.result.score,
      max_score:x.result.max_score, duration_ms:x.duration_ms})));
    /* v1.1.1：按需求删除「查看本轮逐题明细」折叠区；主视图仅保留卡片 + 本轮实时徽标 */
    const card = (Quiz.hubPages && Quiz.hubPages.reviewCardHTML) ? Quiz.hubPages.reviewCardHTML() : '';
    const live = '<div class="row" style="margin:14px 0 0">' +
      '<span class="badge b-blue">本轮已作答 ' + answered.length + ' / ' + p.questions.length + '</span>' +
      '<span class="badge b-green">正确 ' + a.counts.correct + '</span>' +
      '<span class="badge b-orange">部分得分 ' + a.counts.partial + '</span>' +
      '<span class="badge b-red">错误 ' + a.counts.wrong + '</span>' +
      '<span class="badge b-gray">正确率 ' + util.pct(a.accuracy * 100) + '</span>' +
      '<span class="badge b-gray">得分 ' + a.earned_score + ' / ' + a.total_score + '</span></div>';
    modal('练习数据', card + live,
      '<button class="btn" data-action="close-modal">返回答题</button>',
      card ? 'modal-wide' : '');
  }
  function quizEditQuestion() {
    const p = app.practice;
    if (!p) return;
    const q = p.questions[p.index];
    if (!store.question(q.question_id)) { toast('题库原题已删除，无法编辑', 'err'); return; }
    openQuestionForm(q.question_id);
    toast('编辑的是题库原题；本次练习快照保持不变', 'ok');
  }
  function quizTagsModal(q) {
    modal('试题标签 · ' + q.question_id,
      '<label class="field">标签（逗号分隔）<input type="text" id="quiz-tags-input" value="' + esc((q.tags || []).join(',')) + '"></label>' +
      '<p class="small muted" style="margin-top:10px">标签写入题库原题，可用于题库管理与筛选；答题快照同步更新。</p>',
      '<button class="btn" data-action="close-modal">取消</button>' +
      '<button class="btn btn-primary" data-action="quiz-tags-save" data-id="' + esc(q.question_id) + '">保存标签</button>');
  }

  /* ---------- 事件委托 ---------- */
  document.addEventListener('click', function (e) {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const a = el.dataset.action, id = el.dataset.id;
    if (a === 'modal-mask') { if (e.target === el) closeModal(); return; }
    if (a === 'close-modal') { closeModal(); return; }
    const tag = e.target.tagName;
    if (tag === 'SELECT' || tag === 'OPTION' || tag === 'INPUT' || tag === 'TEXTAREA') return;
    syncUiFromDom();
    switch (a) {
      /* ---- v0.9 新导航交互 ---- */
      case 'nav-toggle': {
        const st = navState(); if (!st) break;
        const g = el.dataset.group || '';
        st.navOpen[g] = !st.navOpen[g];
        applyNav(); break;
      }
      case 'nav-collapse-all': {
        const st = navState(); if (!st) break;
        const anyOpen = Object.keys(st.navOpen).some(k => st.navOpen[k]);
        Object.keys(st.navOpen).forEach(k => { st.navOpen[k] = !anyOpen; });
        applyNav(); break;
      }
      case 'nav-tab': {
        const st = navState(); if (!st) break;
        st.tabs[el.dataset.group] = el.dataset.value;
        render(); break;
      }
      case 'nav-menu': {
        const st = navState(); if (!st) break;
        if (el.dataset.menu === 'mybanks') st.mybanks.menu = !st.mybanks.menu;
        else if (el.dataset.menu === 'examHistory') st.examHistory.menu = !st.examHistory.menu;
        render(); break;
      }
      case 'nav-search-go': navSearch(el.dataset.target); render(); break;
      case 'nav-rank': { const st = navState(); if (st) st.rank = el.dataset.value; render(); break; }
      case 'nav-todo': navTodo(); break;
      /* v1.0.1 自检修复：考试历史「查看」应只读展示该考试，而非跳到新增考试向导 */
      case 'exam-view': {
        const x = (Quiz.navExams ? Quiz.navExams.all() : []).find(v => v.exam_id === id);
        if (!x) { toast('考试不存在', 'err'); break; }
        modal('考试详情', '<div class="kv-list" style="max-width:none">' +
          '<div>考试名称</div><div>' + esc(x.name) + '</div>' +
          '<div>试题类型</div><div>' + esc(x.type || '模拟考试') + '</div>' +
          '<div>组卷方式</div><div>' + esc(x.method || '随机选题') + '</div>' +
          '<div>考试时长</div><div>' + esc(x.duration) + ' 分钟</div>' +
          '<div>及格分数</div><div>' + esc(x.pass) + ' 分</div>' +
          '<div>关联题库</div><div>' + (x.banks || []).length + ' 个</div>' +
          '<div>创建时间</div><div>' + esc(new Date(x.created_at).toLocaleString()) + '</div>' +
          '<div>状态</div><div>' + (x.enabled === false ? '已停用' : '已启用') + '</div>' +
          '</div>', '<button class="btn btn-primary" data-action="close-modal">关闭</button>');
        break;
      }
      case 'nav-download-template': {
        util.downloadBytes(Quiz.templateAssets.name('xlsx'),
          new Blob([Quiz.templateAssets.bytes('xlsx')], {type: Quiz.templateAssets.mime('xlsx')}));
        toast('已下载 ' + Quiz.templateAssets.name('xlsx'), 'ok'); break;
      }
      case 'exam-step': {
        const st = navState(); if (!st) break;
        collectExam();
        st.exam.step = Math.max(1, Math.min(3, Number(el.dataset.value) || 1));
        render(); break;
      }
      case 'exam-pick-banks': {
        const st = navState();
        if (st) { collectExam(); st.exam.picking = !st.exam.picking; render(); }
        break;
      }
      case 'exam-add-field': navTodo('自定义登录信息项暂未开放'); break;
      case 'exam-finish': {
        const st = navState(); if (!st) break;
        collectExam();
        const f = st.exam.form;
        if (!String(f.name || '').trim()) {
          st.exam.step = 1; render(); toast('请先在第 1 步填写试卷名称', 'err'); break;
        }
        Quiz.navExams.save({
          exam_id: 'EX-' + Date.now(), name: String(f.name).trim(), desc: f.desc || '',
          type: f.type || '模拟考试', qualify: f.qualify || '所有人都可以考试',
          method: f.method || '随机选题', duration: Number(f.duration) || 45,
          pass: Number(f.pass) || 60, total_score: '0.00', people: Number(f.people) || 0,
          start: f.start || '', end: f.end || '', banks: st.exam.selectedBanks.slice(),
          created_at: Date.now(), enabled: true
        });
        st.exam.step = 1; st.exam.picking = false;
        go('examHistory'); toast('考试已创建（仅保存在本机）', 'ok'); break;
      }
      case 'ai-go-settings': closeModal(); go('settings'); break;
      case 'ai-save': {
        try {
          ai.saveConfig({enabled: !!($('ai-enabled') && $('ai-enabled').checked),
                         baseUrl: val('ai-base'), model: val('ai-model'), apiKey: val('ai-key')});
          toast('AI 配置已保存（Key 不回显，且不随数据备份导出）', 'ok'); render();
        } catch (err) { toast('保存失败：' + err.message, 'err'); }
        break;
      }
      case 'ai-test': {
        const out0 = $('ai-test-result');
        if (out0) out0.textContent = '正在测试连接…';
        ai.testConnection().then(r => {
          const out = $('ai-test-result');
          if (out) out.textContent = '✓ 连接正常 · 模型 ' + r.model + ' 返回：' + r.text;
          toast('模型连接正常', 'ok');
        }).catch(err => {
          const out = $('ai-test-result');
          if (out) out.textContent = '✗ ' + err.message;
          toast('连接失败：' + err.message, 'err');
        });
        break;
      }
      case 'ai-clear-key':
        ai.saveConfig({clearKey: true}); render(); toast('已清除保存的 API Key（本地服务可留空）', 'ok'); break;
      case 'ai-clear-cache':
        if (confirm('清空全部 AI 讲解缓存？之后同题会重新生成并计费。')) { ai.clearCache(); render(); toast('讲解缓存已清空', 'ok'); }
        break;
      case 'ai-clear-usage':
        if (confirm('清空 AI 调用记录？')) { ai.clearUsage(); render(); toast('调用记录已清空', 'ok'); }
        break;
      case 'ai-explain': openAiExplain(id, false); break;
      case 'ai-explain-force': openAiExplain(id, true); break;
      case 'ai-parse': aiParseImport(); break;
      case 'theme-cycle': {
        const order = ['system','light','dark'];
        const next = order[(order.indexOf(app.ui.theme) + 1) % order.length];
        app.ui.theme = enhance.setTheme(next);
        render(); toast('主题：' + ({system:'跟随系统',light:'浅色',dark:'深色'})[next], 'ok'); break;
      }
      case 'export-json': case 'settings-export':
        util.download('智能题库备份_' + util.dayKey(now()) + '.json', store.exportText(), 'application/json');
        toast('备份已导出', 'ok'); break;
      case 'quick':
        app.ui.practice.mode = el.dataset.mode; app.result = null; go('practice'); break;
      case 'practice-mode':
        app.ui.practice.mode = el.dataset.mode; render(); break;
      case 'import-download-xlsx': case 'import-download-docx': {
        const kind = a === 'import-download-xlsx' ? 'xlsx' : 'docx';
        util.downloadBytes(Quiz.templateAssets.name(kind),
          new Blob([Quiz.templateAssets.bytes(kind)], {type: Quiz.templateAssets.mime(kind)}));
        toast('已下载 ' + Quiz.templateAssets.name(kind) + '，按表头填写后上传即可导入', 'ok'); break;
      }
      case 'import-run': doImport(); break;
      /* ---------- v1.3.3 文档导入校验页 ---------- */
      case 'import-review-open': {
        const t = val('imp-text') || app.ui.imp.text || '';
        if (!t.trim()) { toast('请先选择文件或粘贴内容，再打开校验页', 'err'); break; }
        app.ui.imp.text = t;
        Quiz.importReview.open(t, {
          file: app.ui.importReview.file, fileName: app.ui.importReview.fileName
        });
        go('importReview'); break;
      }
      case 'ir-picker': Quiz.importReview.openPicker(el.dataset.col); render(); break;
      case 'ir-picker-close': Quiz.importReview.closePicker(); render(); break;
      case 'ir-set': Quiz.importReview.setMap(el.dataset.col, el.dataset.key); render(); break;
      case 'ir-sheet': {
        const i = Number(el.dataset.index) || 0;
        Quiz.importReview.selectSheet(i).then(() => render());
        break;
      }
      case 'ir-sheet-cat': Quiz.importReview.setSheetAsCategory(!!(el && el.checked)); render(); break;
      case 'ir-cancel': Quiz.importReview.reset(); go('import'); toast('已取消导入，原内容仍保留在输入框', 'ok'); break;
      case 'ir-confirm': {
        const built = Quiz.importReview.buildCsv();
        if (!built.ok) { toast(built.message, 'err'); break; }
        app.ui.imp.text = built.csv;
        location.hash = '#/import';
        doImport(built.csv, {
          duplicate_policy: app.ui.imp.policy || 'skip',
          skip_error_rows: app.ui.imp.skipErrors === '1'
        });
        Quiz.importReview.reset();
        break;
      }
      case 'import-error-csv':
        util.download('导入错误明细.csv', importer.errorsCsv(app.ui.imp.report), 'text/csv'); break;
      /* v1.4.1 表头一键修复：只提取文本里明写的答案，不猜测题干；结果回填输入框供人工核对 */
      case 'import-repair': {
        const t = val('imp-text') || app.ui.imp.text || '';
        if (!t.trim()) { toast('请先选择文件或粘贴内容', 'err'); break; }
        const fix = importer.repairCsv(t);
        if (!fix.ok) { toast(fix.message, 'err'); break; }
        app.ui.imp.text = fix.csv;
        if ($('imp-text')) $('imp-text').value = fix.csv;
        app.ui.imp.report = null;
        toast(fix.message, fix.remaining && fix.remaining.length ? 'err' : 'ok');
        render(); break;
      }
      case 'import-confirm-review': {
        const i = Number(el.dataset.index), item = app.ui.imp.review[i];
        if (!item) return;
        if (!item.question.bank_id) item.question.bank_id = app.ui.imp.bankId || store.defaultBankId();
        store.mutate(s => {
          const k = s.questions.findIndex(x => x.question_id === item.question.question_id);
          if (k >= 0) s.questions[k] = item.question; else s.questions.push(item.question);
        });
        app.ui.imp.review.splice(i, 1);
        app.ui.imp.report.inserted++; app.ui.imp.report.duplicated--;
        toast('已确认入库：' + item.question.question_id, 'ok'); render(); break;
      }
      case 'bank-select':
        app.ui.bank.bankId = el.dataset.id || Quiz.ALL_BANKS;
        app.ui.bank.page = 1; savePrefs(); render(); break;
      case 'bank-create':
        modal('新建题库', Quiz.pages.bankForm(null),
          '<button class="btn" data-action="close-modal">取消</button><button class="btn btn-primary" data-action="bank-create-save">创建并选中</button>');
        break;
      case 'bank-create-save': {
        const b = store.addBank(val('bf-name'), val('bf-desc'));
        if (!b) { toast('题库名称不能为空', 'err'); return; }
        app.ui.bank.bankId = b.bank_id; app.ui.bank.page = 1;
        closeModal(); savePrefs(); render(); toast('已创建题库：' + b.name, 'ok'); break;
      }
      case 'bank-rename': {
        const rid = app.currentBankId(), rb = store.bank(rid);
        if (!rb || rid === Quiz.ALL_BANKS) { toast('请先选择一个具体题库', 'err'); break; }
        modal('重命名题库 · ' + rb.name, Quiz.pages.bankForm(rb),
          '<button class="btn" data-action="close-modal">取消</button><button class="btn btn-primary" data-action="bank-rename-save">保存</button>');
        break;
      }
      case 'bank-rename-save': {
        const rid = app.currentBankId();
        if (rid === Quiz.ALL_BANKS || !store.renameBank(rid, {name: val('bf-name'), description: val('bf-desc')})) {
          toast('题库不存在，请重新选择', 'err'); break;
        }
        closeModal(); render(); toast('题库已更新', 'ok'); break;
      }
      case 'bank-remove': {
        const rid = app.currentBankId(), rb = store.bank(rid);
        if (!rb || rb.is_default) { toast('默认题库不可删除', 'err'); break; }
        const n = store.questionCount(rid);
        if (!confirm('删除题库「' + rb.name + '」？其中 ' + n + ' 道题将变为未分类，题目与历史记录不会丢失。')) break;
        store.removeBank(rid);
        app.ui.bank.bankId = store.defaultBankId(); app.ui.bank.page = 1;
        savePrefs(); render(); toast('题库已删除，' + n + ' 题已变为未分类', 'ok'); break;
      }
      case 'bank-move': {
        const ids = Array.from(document.querySelectorAll('.bank-ck:checked')).map(x => x.value);
        if (!ids.length) { toast('请先勾选题目', 'err'); return; }
        const target = val('bank-move-to') || store.defaultBankId();
        const tb = store.bank(target);
        if (!tb) { toast('目标题库不存在', 'err'); return; }
        const n = store.moveQuestions(ids, target);
        app.ui.bank.page = 1; render(); toast('已移动 ' + n + ' 题到「' + tb.name + '」', 'ok'); break;
      }
      case 'bank-search': render(); break;
      case 'bank-page': app.ui.bank.page += Number(el.dataset.delta); render(); break;
      case 'bank-add': openQuestionForm(null); break;
      case 'bank-edit': openQuestionForm(id); break;
      case 'question-save': saveQuestion(); break;
      case 'bank-fav': openFavoritePicker(id); break;
      case 'favorite-save': saveFavoritePicker(); break;
      case 'bank-delete':
        if (confirm('删除题目 ' + id + '？历史作答记录中的题目快照会保留。')) { store.deleteQuestions([id]); render(); toast('已删除', 'ok'); }
        break;
      case 'bank-batch': {
        const ids = Array.from(document.querySelectorAll('.bank-ck:checked')).map(x => x.value);
        if (!ids.length) { toast('请先勾选题目', 'err'); return; }
        const op = el.dataset.op;
        if (op === 'delete') {
          if (!confirm('确认删除选中的 ' + ids.length + ' 题？此操作不可撤销。')) return;
          store.deleteQuestions(ids);
        } else store.mutate(s => s.questions.forEach(q => { if (ids.includes(q.question_id)) { q.status = op; q.updated_at = now(); } }));
        render(); toast('批量操作完成：' + ids.length + ' 题', 'ok'); break;
      }
      case 'practice-start': savePrefs(); app.startPractice(); break;
      /* ---------- v0.8 答题页设置面板 ---------- */
      case 'quiz-settings-toggle':
        app.ui.quiz.settings_open = !app.ui.quiz.settings_open;
        saveQuizPrefs(); render(); break;
      case 'quiz-set-font':
        app.ui.quiz.font_size = el.dataset.value || 'normal';
        saveQuizPrefs(); render();
        toast('字体大小：' + ({small:'较小', normal:'标准', large:'较大'})[app.ui.quiz.font_size], 'ok'); break;
      case 'quiz-set-step': {
        const key = el.dataset.key || 'mastery_threshold', d = Number(el.dataset.delta) || 0;
        app.ui.quiz[key] = Math.max(0, Math.min(99, (parseInt(app.ui.quiz[key], 10) || 0) + d));
        saveQuizPrefs(); render(); break;
      }
      case 'quiz-edit': quizEditQuestion(); break;
      case 'quiz-mark': {
        if (!app.practice) break;
        const on = store.toggleMark(app.practice.questions[app.practice.index].question_id);
        render(); toast(on ? '已标记本题' : '已取消标记', 'ok'); break;
      }
      case 'quiz-note-save': {
        if (!app.practice) break;
        store.saveNote(app.practice.questions[app.practice.index].question_id, val('quiz-note'));
        render(); toast('笔记已保存到本地', 'ok'); break;
      }
      case 'quiz-tags':
        if (app.practice) quizTagsModal(app.practice.questions[app.practice.index]);
        break;
      case 'quiz-tags-save': {
        const tags = store.setQuestionTags(id, val('quiz-tags-input'));
        if (app.practice) {
          const q = app.practice.questions[app.practice.index];
          if (q && q.question_id === id) q.tags = tags || [];
        }
        closeModal(); render(); toast('标签已保存', 'ok'); break;
      }
      case 'quiz-view-data': quizViewData(); break;
      case 'quiz-redo': {
        const p = app.practice;
        if (!p || !p.answers[p.index]) break;
        clearAuto();
        delete p.answers[p.index];
        if (p.drafts) delete p.drafts[p.index];
        try { document.querySelectorAll('input[name="answer"]').forEach(i => { i.checked = false; }); } catch (e) {}
        p.current_started_at = Date.now();
        persistPractice(); render(); toast('已清除本题作答，可重新选择', 'ok'); break;
      }
      case 'practice-submit': submitCurrent(); break;
      case 'practice-next': nextQuestion(); break;
      case 'practice-skip': skipQuestion(); break;
      case 'practice-goto': gotoQuestion(el.dataset.index); break;
      case 'practice-prev': gotoQuestion(app.practice ? app.practice.index - 1 : -1); break;
      case 'practice-fav': {
        if (!app.practice) break;
        const q = app.practice.questions[app.practice.index];
        const def = store.state().folders.find(f => f.is_default) || store.state().folders[0];
        if (!q || !def) break;
        const on = store.toggleFavorite(q.question_id, def.folder_id);
        render(); toast(on ? '已收藏本题' : '已取消收藏', 'ok'); break;
      }
      case 'practice-restart': {
        const src = app.practice || store.runtime.get();
        if (!src) break;
        const fresh = Object.assign({}, src, {
          session_id: util.uid('SES'), index: 0, answers: [], drafts: {},
          current_started_at: Date.now(), session_started_at: now(), finished: false
        });
        app.practice = fresh; app.result = null; persistPractice(); go('practice');
        toast('已重新开始本轮（题目与配置不变）', 'ok'); break;
      }
      case 'practice-finish': confirmFinish(); break;
      case 'practice-finish-yes': closeModal(); finishPractice(); break;
      case 'practice-abandon':
        if (confirm('退出本次练习？未交卷的作答不会归档。')) { clearAuto(); store.runtime.clear(); app.practice = null; render(); }
        break;
      case 'practice-resume': {
        const rt = store.runtime.get(); if (rt) { app.practice = rt; app.result = null; go('practice'); } break;
      }
      case 'practice-discard': store.runtime.clear(); render(); toast('已放弃未完成的练习'); break;
      case 'practice-again': app.startPractice({mode: app.result.session.mode}); break;
      case 'practice-new': app.result = null; render(); break;
      case 'practice-review-wrong': {
        const ids = app.result.records.filter(r => r.status !== 'correct').map(r => r.question_id);
        if (!ids.length) { toast('本次全部答对，无需重刷', 'ok'); return; }
        app.startPractice({mode:'wrong_review', forceIds:ids, count:ids.length}); break;
      }
      case 'wrong-start': app.startPractice({mode:'wrong_review', count:app.wrongRows().filter(x => !x.mastered).length || 10}); break;
      case 'wrong-single': app.startPractice({mode:'wrong_review', forceIds:[id], count:1}); break;
      case 'wrong-master': case 'wrong-reset':
        store.mutate(s => {
          const w = s.wrong.find(x => x.question_id === id); if (!w) return;
          if (a === 'wrong-master') { w.mastered = true; w.consecutive_correct = Math.max(w.consecutive_correct || 0, s.config.mastery_threshold); }
          else { w.mastered = false; w.consecutive_correct = 0; }
        });
        render(); toast(a === 'wrong-master' ? '已标记掌握' : '已重置', 'ok'); break;
      case 'fav-select': app.ui.favorites.folder = id; render(); break;
      case 'fav-new-folder': {
        const n = val('fav-new-name'); if (!n.trim()) { toast('请输入收藏夹名称', 'err'); return; }
        const f = store.addFolder(n); app.ui.favorites.folder = f.folder_id; render(); toast('收藏夹已创建', 'ok'); break;
      }
      case 'fav-del-folder':
        if (confirm('删除该收藏夹？夹内题目会移回「全部收藏」。')) { store.removeFolder(id); app.ui.favorites.folder = 'ALL'; render(); }
        break;
      case 'fav-remove':
        store.mutate(s => { s.favorites = s.favorites.filter(f => f.id !== id); }); render(); toast('已取消收藏', 'ok'); break;
      case 'fav-start': app.startPractice({mode:'favorite', count:200}); break;
      case 'records-detail': modal('练习明细 · ' + id, Quiz.pages.recordDetail(id)); break;
      case 'settings-save': {
        const fb = val('cfg-fb') || store.config().feedback_mode;
        const shuffle = !!($('cfg-shuffle') && $('cfg-shuffle').checked);
        const auto = !!($('cfg-auto') && $('cfg-auto').checked);
        const autoMs = Math.max(300, Math.min(10000, parseInt(val('cfg-auto-ms'), 10) || 1200));
        store.setConfig({feedback_mode: fb,
                         default_question_count: Math.max(1, parseInt(val('cfg-count'),10)||10),
                         mastery_threshold: Math.max(1, parseInt(val('cfg-threshold'),10)||2),
                         shuffle_options: shuffle, auto_advance: auto, auto_advance_ms: autoMs});
        app.ui.practice.feedback_mode = fb;
        app.ui.practice.shuffle_options = shuffle;
        app.ui.practice.auto_advance = auto;
        savePrefs(); render(); toast('设置已保存', 'ok'); break;
      }
      case 'settings-reset':
        if (confirm('⚠️ 将清空全部题目、练习记录、错题与收藏，且不可恢复。建议先导出备份。确认继续？')) {
          store.reset(); app.practice = null; app.result = null; app.ui.imp.report = null;
          location.hash = '#/dashboard'; render(); toast('数据已清空', 'ok');
        }
        break;
    }
  });

  document.addEventListener('change', function (e) {
    /* 选项选中态高亮（不改变任何判分逻辑） */
    if (e.target && e.target.name === 'answer') {
      try {
        document.querySelectorAll('label.opt').forEach(lab => {
          const inp = lab.querySelector && lab.querySelector('input');
          if (inp) lab.classList.toggle('sel', !!inp.checked);
        });
      } catch (err) {}
      // v0.8 练习模式：单选 / 判断选完即判；答对且开启自动前进才跳题，答错停留由用户手动翻页
      if (instantEligible()) submitCurrent();
      return;
    }
    const el = e.target.closest && e.target.closest('[data-action]');
    if (!el) return;
    const a = el.dataset.action;
    if (!a) return;   // 无业务动作的表单控件（如移动目标下拉）不触发重绘，避免丢失勾选与输入
    /* v1.3.3 导入校验页表单控件 */
    if (a === 'ir-header') { Quiz.importReview.setHeaderRow(Number(el.value)); render(); return; }
    if (a === 'ir-sheet-cat') { Quiz.importReview.setSheetAsCategory(!!(e.target && e.target.checked)); render(); return; }
    /* v0.9 新导航表单控件：独立处理，避免落到末尾通用 render */
    if (a === 'nav-grid-toggle') {
      const st = navState(); if (st) st.mybanks.grid = !!(e.target && e.target.checked);
      return;
    }
    if (a === 'nav-check-all') {
      const on = !!(e.target && e.target.checked), sel = '.' + (el.dataset.target || 'nb-ck');
      try { document.querySelectorAll(sel).forEach(x => { x.checked = on; }); } catch (err) {}
      return;
    }
    if (a === 'exam-radio') {
      const st = navState(); if (!st) return;
      const map = {'ex-type':'type', 'ex-qualify':'qualify', 'ex-method':'method'};
      st.exam.form[map[el.dataset.key] || el.dataset.key] = el.value;
      return;
    }
    if (a === 'exam-switch') {
      const st = navState(); if (!st) return;
      collectExam(); st.exam[el.dataset.key] = !!(e.target && e.target.checked);
      render(); return;
    }
    if (a === 'exam-bank-toggle') {
      const st = navState(); if (!st) return;
      collectExam();
      const bid = el.dataset.id || '', i = st.exam.selectedBanks.indexOf(bid), on = !!(e.target && e.target.checked);
      if (on && i < 0) st.exam.selectedBanks.push(bid);
      if (!on && i >= 0) st.exam.selectedBanks.splice(i, 1);
      render(); return;
    }
    if (a === 'exam-status') {
      Quiz.navExams.update(el.dataset.key, {enabled: !!(e.target && e.target.checked)});
      return;
    }
    if (a === 'quiz-set-toggle') {
      const key = el.dataset.key, on = !!(e.target && e.target.checked);
      app.ui.quiz[key] = on;
      if (key === 'shuffle_options') applyShuffleChange(on);
      saveQuizPrefs(); render();
      return;
    }
    if (a === 'quiz-set-select') {
      const key = el.dataset.key;
      app.ui.quiz[key] = key === 'group_size' ? (Math.max(1, Math.min(200, parseInt(e.target.value, 10) || 10))) : e.target.value;
      saveQuizPrefs(); render();
      toast('设置已更新', 'ok'); return;
    }
    if (a === 'ai-preset') {
      const p = ai.PRESETS[Number(el.value)];
      if (p) {
        if ($('ai-base')) $('ai-base').value = p.base;
        if ($('ai-model')) $('ai-model').value = p.model;
        toast('已填充「' + p.label + '」的地址与模型，请填写 Key 后点「保存 AI 配置」', 'ok');
      }
      return;   // 不重绘，避免丢失尚未保存的表单内容
    }
    if (a === 'theme-set') {
      app.ui.theme = enhance.setTheme(el.value);
      render(); toast('主题已切换', 'ok'); return;
    }
    if (a === 'result-filter') { app.ui.resultFilter = el.value; render(); return; }
    if (a === 'imp-file') { readImportFile(e.target.files[0]); return; }
    if (a === 'settings-file') {
      const f = e.target.files[0]; if (!f) return;
      const fr = new FileReader();
      fr.onload = () => {
        try { store.importText(String(fr.result).replace(/^\uFEFF/, '')); closeModal(); render(); toast('备份已导入，共 ' + store.state().questions.length + ' 题', 'ok'); }
        catch (err) { toast('导入失败：' + err.message, 'err'); }
      };
      fr.readAsText(f, 'UTF-8'); return;
    }
    if (a === 'qf-type-change') { refreshQuestionForm(); return; }
    if (a === 'bank-check-all') {
      document.querySelectorAll('.bank-ck').forEach(x => { x.checked = el.checked; }); return;
    }
    syncUiFromDom();
    if (a === 'bank-filter') app.ui.bank.page = 1;
    if (a === 'pr-quota-toggle' && app.ui.practice.quota_mode) {
      const av = app.quotaAvailable(), q = app.ui.practice.quota;
      if (!q.single && !q.multiple && !q.judge)
        app.ui.practice.quota = {single: Math.min(av.single, 5), multiple: Math.min(av.multiple, 3), judge: Math.min(av.judge, 2)};
    }
    render();
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { closeModal(); return; }
    if (e.key === 'Enter' && e.target && e.target.id === 'bank-kw') { syncUiFromDom(); render(); return; }
    const p = app.practice;
    if (!p || app.route !== 'practice' || app.result) return;
    const modalRoot = $('modal-root');
    const hasModal = !!(modalRoot && modalRoot.innerHTML);
    const q = p.questions[p.index];
    const s = enhance.shortcut(e, {
      hasModal, targetTag: e.target && e.target.tagName,
      done: !!p.answers[p.index], qType: q ? q.type : ''
    });
    if (!s) return;
    if (e.preventDefault) e.preventDefault();
    if (s.act === 'submit') submitCurrent();
    else if (s.act === 'next') nextQuestion();
    else if (s.act === 'prev') gotoQuestion(p.index - 1);
    else if (s.act === 'option') {
      let input = null;
      try { input = document.querySelector('input[name="answer"][value="' + s.key + '"]'); } catch (err) {}
      if (!input || input.disabled) return;
      if (input.type === 'checkbox') input.checked = !input.checked;
      else input.checked = true;
      try {
        const lab = input.closest && input.closest('.opt');
        if (lab) lab.classList.toggle('sel', !!input.checked);
      } catch (err) {}
      captureDrafts();
      if (instantEligible()) submitCurrent();   // 快捷键选择单选 / 判断同样选完即判
    }
  });
  global.addEventListener('hashchange', function () {
    // 从其它页面重新进入「开始刷题」时回到组卷配置，不滞留在上次成绩页
    const r = (location.hash || '').replace(/^#\/?/, '').split('?')[0];
    if (r === 'practice' && app.result && !app.practice) app.result = null;
    render();
  });

  /* ---------- 启动 ---------- */
  Quiz.seedIfEmpty();
  /* v1.11.0：仅真实站点（__NO_DEMO_DATA__）清理内置示例题；Node 自测保持原有种子数据 */
  if (global.__NO_DEMO_DATA__) {
    if (Quiz.purgeDemo) Quiz.purgeDemo();
    if (Quiz.accountGate && Quiz.accountGate.purgeLegacyDemo) Quiz.accountGate.purgeLegacyDemo();
  }
  /* v1.12.0：仅真实站点注入内置管理员并撤销历史误授的管理员；Node 自测不改动账号目录 */
  if (global.__BUILTIN_ADMIN__ && Quiz.accountGate && Quiz.accountGate.ensureAdmin) Quiz.accountGate.ensureAdmin();
  restorePrefs();
  render();
})(typeof window !== 'undefined' ? window : globalThis);
