/* v1.0.0 题库练习模式：练习选择页 + 子页面 + 随机练习 + 模拟考试。
   纯增量：非考试练习全部复用既有 app.startPractice() 与 #/practice 通用答题页；
   模拟考试自包含（独立 localStorage 键），不改动主数据备份与既有状态机。 */
(function (global) {
  const Quiz = global.Quiz;
  const P = Quiz.pages, util = Quiz.util, store = Quiz.store, scorer = Quiz.scorer;
  const e = v => util.esc(v == null ? '' : String(v));
  const EXAM_KEY = 'smartQuiz.hubExam.v1';

  const S = Quiz.hub = {
    bankId: '', kw: '', randomOpen: false, randomSize: 200, randomCustom: '',
    exam: {
      phase: 'config', cfg: {single: 10, multiple: 5, judge: 5, singleScore: 1, multipleScore: 1, judgeScore: 1,
        duration: 45, pass: 60, feedback: 'after', partial: 'all_or_none', shuffle: false, pickOrder: 'type'},
      questions: [], answers: {}, index: 0, startedAt: 0, result: null, font: 'normal', history: []
    }
  };
  try {
    const h = JSON.parse((global.localStorage && global.localStorage.getItem(EXAM_KEY)) || '[]');
    if (Array.isArray(h)) S.exam.history = h;
  } catch (err) {}

  /* ---------------- 通用 ---------------- */
  function parseBank() {
    const m = /[?&]bank=([^&]+)/.exec(String(global.location && global.location.hash || ''));
    if (m) { try { S.bankId = decodeURIComponent(m[1]); } catch (err) { S.bankId = m[1]; } }
    return S.bankId;
  }
  function bankName() {
    parseBank();
    const b = S.bankId && store.bank && store.bank(S.bankId);
    return (b && b.name) || '默认题库';
  }
  function bankQuestions() {
    parseBank();
    const s = store.state(), def = store.defaultBankId();
    return s.questions.filter(q => q.status === 'published' &&
      (!S.bankId || S.bankId === Quiz.ALL_BANKS || (q.bank_id || def) === S.bankId));
  }
  function state() { return store.state(); }
  function typeCount(t, list) { return (list || bankQuestions()).filter(q => q.type === t).length; }
  function fmtTime(ts) {
    if (!ts) return '—';
    const d = new Date(ts);
    if (isNaN(d.getTime())) return e(String(ts));
    const p = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function fmtClock(sec) {
    const t = Math.max(0, Math.round(Number(sec) || 0)), p = n => String(n).padStart(2, '0');
    return p(Math.floor(t / 3600)) + ':' + p(Math.floor(t % 3600 / 60)) + ':' + p(t % 60);
  }
  function dayKey(ts) {
    const d = new Date(ts); if (isNaN(d.getTime())) return '—';
    const p = n => String(n).padStart(2, '0');
    return p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  function hubHref() {
    parseBank();
    return '#/practiceHub' + (S.bankId ? '?bank=' + encodeURIComponent(S.bankId) : '');
  }
  function crumb(cur) {
    return '<div class="hub-crumb"><a href="#/mybanks">我的题库</a> / <a href="' + hubHref() + '">练习</a>' +
      (cur ? ' / <span>' + e(cur) + '</span>' : '') + '</div>';
  }
  function empty(text, ico) {
    return '<div class="empty"><div class="ico">' + (ico || '▤') + '</div><div>' + e(text || '暂无数据') + '</div></div>';
  }
  function answerText(q) {
    if (!q) return '—';
    return q.type === 'judge' ? (q.answer && q.answer.value ? '正确' : '错误') : ((q.answer && q.answer.keys) || []).join('、');
  }
  function userText(q, raw) {
    if (raw == null || (Array.isArray(raw) && !raw.length)) return '未作答';
    return q.type === 'judge' ? (raw === 'T' || raw === true ? '正确' : '错误') : (Array.isArray(raw) ? raw : [raw]).join('、');
  }
  function shuffle(arr) { return arr.slice().sort(() => Math.random() - 0.5); }
  function toast(msg, type) { if (Quiz.app && Quiz.app.toast) Quiz.app.toast(msg, type || 'ok'); }
  function render() { if (Quiz.app && Quiz.app.render) Quiz.app.render(); }
  function launch(ids, opts) {
    if (!ids || !ids.length) { toast('该范围内暂无可练习的题目', 'err'); return; }
    Quiz.app.startPractice(Object.assign({mode: 'normal', forceIds: ids, count: ids.length,
      order: 'sequential', shuffle_options: false}, opts || {}));
  }

  /* ================= ① 练习选择页 ================= */
  const MY = [
    ['wrong', '我的错题', '重刷错题', 'r', 'hub-wrong'],
    ['fav', '我的收藏', '收藏题目', 'o', 'hub-fav'],
    ['clear', '清空收藏', '一键清空', 'r', 'hub-clear-fav'],
    ['mastered', '我的斩题', '已掌握题目', 'b', 'hub-mastered'],
    ['notes', '我的笔记', '逐题笔记', 'g', 'hub-notes']
  ];
  const SP = [
    ['sequential', '顺序练习', '按题库顺序练习', 'o', 'hub-sequential', '上次练习'],
    ['random', '随机练习', '自定义每组题量', 'b', 'hub-random-open', ''],
    ['exam', '模拟考试', '自定义试卷配置', 'g', 'hub-exam-open', ''],
    ['brief', '精简题', '甄选高频试题', 'r', 'hub-brief', 'NEW'],
    ['chapter', '章节练习', '按章节专项练习', 'b', 'hub-chapter-page', ''],
    ['type', '题型练习', '按题型分类练习', 'b', 'hub-type-page', ''],
    ['error', '易错题', '精选高频易错题', 'r', 'hub-error', 'VIP'],
    ['material', '学习资料', '考试学习相关信息', 'g', 'hub-material', '']
  ];
  function card(it, isMy) {
    const href = it[4] === 'hub-fav' ? '#/hubFavorites' :
      it[4] === 'hub-mastered' ? '#/hubMastered' :
      it[4] === 'hub-notes' ? '#/hubNotes' :
      it[4] === 'hub-chapter-page' ? '#/hubChapter' :
      it[4] === 'hub-type-page' ? '#/hubType' : null;
    const q = S.bankId ? '?bank=' + encodeURIComponent(S.bankId) : '';
    const full = href ? href + q : null;
    const inner = '<span class="hub-ico ' + it[3] + '">' + ({r:'✕', o:'★', b:'◈', g:'✎'}[it[3]] || '▤') + '</span>' +
      '<span class="hub-card-tx"><b>' + e(it[1]) + (it[5] ? ' <i class="hub-tag2 ' + (it[5]==='NEW'?'new':'vip') + '">' + e(it[5]) + '</i>' : '') + '</b>' +
      '<small>' + e(isMy ? it[2] + (it[0] === 'clear' ? '' : '（' + myCount(it[0]) + ' 道）') : it[2]) + '</small></span>';
    return full ? '<a class="hub-card" href="' + full + '">' + inner + '</a>' :
      '<button class="hub-card" data-action="' + it[4] + '">' + inner + '</button>';
  }
  function myCount(kind) {
    const s = state();
    if (kind === 'wrong') return (s.wrong || []).filter(w => !w.mastered).length;
    if (kind === 'fav') return (s.favorites || []).length;
    if (kind === 'mastered') return (s.wrong || []).filter(w => w.mastered).length;
    if (kind === 'notes') return (s.notes || []).length;
    return 0;
  }
  P.practiceHub = function () {
    parseBank();
    const s = state(), list = bankQuestions(), b = S.bankId && store.bank && store.bank(S.bankId);
    const kw = String(S.kw || '').trim();
    const preview = list.filter(q => !kw || String(q.stem || '').indexOf(kw) >= 0);
    let h = crumb('');
    h += '<div class="hub-banner"><div class="hub-banner-in">题库练习模式 · 选择练习方式</div></div>';
    h += '<div class="hub-bankinfo"><span class="hub-bank-ico">题</span><div class="hub-bank-meta">' +
      '<h2>' + e(bankName()) + '</h2><div class="small muted">创建时间 ' + fmtTime(b && b.created_at) +
      ' · 题目数量 ' + list.length + ' · 分类 ' + e((list[0] && (list[0].category || []).join('/')) || '—') +
      ' · 题库作者 本地用户 · 练习次数 ' + (s.sessions || []).length + '</div></div>' +
      '<div class="hub-bank-act"><button class="btn hub-green" data-action="hub-sequential">开始练习</button>' +
      '<a class="btn btn-sm" href="#/hubReview">查看练习</a></div></div>';
    h += '<section class="blank-panel"><div class="panel-h">我的练习</div><div class="hub-grid my">' +
      MY.map(it => card(it, true)).join('') + '</div></section>';
    h += '<section class="blank-panel"><div class="panel-h">专项练习</div><div class="hub-grid sp">' +
      SP.map(it => card(it, false)).join('') + '</div></section>';
    h += '<div class="hub-searchbar"><input type="text" id="hub-kw" placeholder="请输入您要搜索的试题" value="' + e(S.kw) + '">' +
      '<button class="btn hub-blue" data-action="hub-search">搜索</button></div>';
    h += '<section class="blank-panel"><div class="panel-h">题库预览 <span class="sub">共 ' + preview.length + ' 题（本机真实数据）</span></div>' +
      (preview.length ? '<div class="hub-preview">' + preview.slice(0, 30).map(q =>
        '<div class="hub-preview-row"><span class="hub-qtype t-' + e(q.type) + '">' +
        e(scorer.TYPE_LABEL[q.type] || q.type) + '</span><span class="hub-pv-stem">' + e(q.stem) + '</span></div>').join('') + '</div>' :
        empty('题库中还没有试题，可先到「文档导入」上传')) + '</section>';
    if (S.randomOpen) h += randomModal(list.length);
    return h;
  };
  function randomModal(total) {
    const sizes = [50, 100, 200, 300, 400, 500];
    return '<div class="hub-mask"><div class="hub-modal"><div class="hub-modal-h"><b>设置每组题的数量</b>' +
      '<button class="hub-modal-x" data-action="hub-random-close">×</button></div>' +
      '<div class="hub-modal-sub">首次设置后，可在练习设置页修改</div>' +
      '<div class="hub-sizes">' + sizes.map(n =>
        '<button class="hub-size' + (Number(S.randomSize) === n ? ' on' : '') + '" data-action="hub-random-size" data-value="' + n + '">' + n + '</button>').join('') +
      '</div><div class="hub-custom"><span>自定义题数</span><input type="number" id="hub-random-custom" min="1" max="200" value="' + e(S.randomCustom || S.randomSize) + '"></div>' +
      '<div class="small faint" style="text-align:center;margin:10px 0">当前题库共 ' + total + ' 题，超出时取全部</div>' +
      '<div class="row" style="justify-content:center"><button class="btn hub-blue" data-action="hub-random-start">立即练习</button></div></div></div>';
  }

  /* ================= ② 我的收藏 ================= */
  P.hubFavorites = function () {
    const s = state(), favs = s.favorites || [], qs = {};
    s.questions.forEach(q => { qs[q.question_id] = q; });
    const types = ['single', 'multiple', 'judge'];
    const counts = {}; types.forEach(t => { counts[t] = favs.filter(f => qs[f.question_id] && qs[f.question_id].type === t).length; });
    const today = favs.filter(f => dayKey(f.created_at || 0) === dayKey(Date.now())).length;
    const mastered = (s.wrong || []).filter(w => w.mastered).length;
    let h = crumb('我的收藏');
    h += '<div class="hub-statbar"><div><b>' + favs.length + '</b><span>全部收藏 ▸</span></div>' +
      '<div><b>' + today + '</b><span>今日收藏 ▸</span></div>' +
      '<div><b>' + mastered + '</b><span>累计斩题 ▸</span></div></div>';
    h += '<div class="blank-panel"><div class="panel-h">收藏及分布 <button class="btn-link" style="float:right" data-action="hub-clear-fav">清空收藏</button></div>' +
      '<div class="hub-dist">' + types.map(t =>
        '<div class="hub-dist-item"><span class="hub-ico ' + (t === 'single' ? 'b' : t === 'multiple' ? 'g' : 'o') + '">' +
        (t === 'single' ? '◉' : t === 'multiple' ? '☑' : '判') + '</span>' +
        '<div><b>' + e(scorer.TYPE_LABEL[t] || t) + '</b><small>' + counts[t] + ' 道</small></div>' +
        '<button class="btn btn-sm btn-c-soft" data-action="hub-type-start" data-type="' + t + '">练习</button></div>').join('') +
      '</div>' + (favs.length ? '' : empty('还没有收藏题目，可在答题页点「收藏本题」')) + '</div>';
    return h;
  };

  /* ================= ③ 我的斩题 ================= */
  P.hubMastered = function () {
    const s = state(), qs = {};
    s.questions.forEach(q => { qs[q.question_id] = q; });
    const rows = (s.wrong || []).filter(w => w.mastered);
    let h = crumb('我的斩题');
    h += '<div class="blank-panel"><div class="panel-h">已斩试题 <a class="btn btn-sm" style="float:right" href="#/wrong">斩题管理</a></div>' +
      (rows.length ? '<div class="table-wrap"><table class="tbl"><thead><tr><th>题目</th><th>题型</th><th>连续答对</th><th>最近错误</th></tr></thead><tbody>' +
        rows.map(w => { const q = qs[w.question_id]; return '<tr><td>' + e(q ? q.stem : w.question_id) +
          '</td><td>' + e(scorer.TYPE_LABEL[w.type] || w.type) + '</td><td>' + e(w.consecutive_correct || 0) +
          '</td><td>' + fmtTime(w.last_wrong_at) + '</td></tr>'; }).join('') + '</tbody></table></div>' : empty('暂无数据')) + '</div>';
    return h;
  };

  /* ================= ④ 我的笔记 ================= */
  P.hubNotes = function () {
    const s = state(), qs = {};
    s.questions.forEach(q => { qs[q.question_id] = q; });
    const notes = (s.notes || []).filter(n => String(n.text || '').trim()).slice().reverse();
    let h = crumb('我的笔记');
    h += '<div class="blank-panel">' + (notes.length ? notes.map(n => {
      const q = qs[n.question_id];
      return '<div class="hub-note-item"><div class="hub-note-q"><span class="hub-qtype t-' + e(q ? q.type : 'single') + '">【' +
        e(q ? (scorer.TYPE_LABEL[q.type] || q.type) : '题目') + '】</span> ' + e(q ? q.stem : n.question_id) + '</div>' +
        '<div class="hub-note-row"><span class="hub-note-body">笔记: ' + e(n.text) + '</span>' +
        '<span class="op"><button class="btn-link" data-action="hub-note-view" data-id="' + e(n.question_id) + '">查看</button>' +
        '<button class="btn-link danger" data-action="hub-note-del" data-id="' + e(n.question_id) + '">删除</button></span></div></div>';
    }).join('') : empty('还没有笔记，可在答题页写下本题易错点')) + '</div>';
    return h;
  };

  /* ===== v1.1.1 练习活动多源合并 =====
     已归档 sessions/records + 未交卷的进行中练习(runtime) + 本机模拟考试历史，
     避免「用户练习后练习记录仍显示 0」。全部取真实值，不造样例数据。 */
  function examHistory() {
    try {
      const v = JSON.parse((global.localStorage && global.localStorage.getItem(EXAM_KEY)) || '[]');
      return Array.isArray(v) ? v : [];
    } catch (err) { return []; }
  }
  function runningPractice() {
    try { return (store.runtime && store.runtime.get && store.runtime.get()) || null; }
    catch (err) { return null; }
  }
  function activity() {
    const list = (state().sessions || []).slice();
    const rt = runningPractice();
    if (rt && Array.isArray(rt.answers) && rt.answers.some(Boolean)) {
      const ans = rt.answers.filter(Boolean);
      list.push({session_id: rt.session_id || 'RUN', started_at: rt.session_started_at || Date.now(),
        question_count: ans.length,
        correct_count: ans.filter(x => x.result && x.result.status === 'correct').length,
        duration_ms: ans.reduce((n, x) => n + (Number(x.duration_ms) || 0), 0), _running: true});
    }
    examHistory().forEach(x => list.push({session_id: 'EX-' + x.at, started_at: x.at,
      question_count: Number(x.count) || 0, correct_count: Number(x.correct) || 0,
      duration_ms: (Number(x.used) || 0) * 1000, _exam: true}));
    return list;
  }
  function activityRecords() {
    /* v1.4.4：每题作答已实时写入 state.records，不再额外叠加 runtime 答案，避免重复计数 */
    return (state().records || []).map(r => ({status: r.status}));
  }

  /* ============ ⑤ 查看练习数据（图3 布局，答题页弹窗与 #/hubReview 共用） ============ */
  function reviewCardHTML() {
    const recs = activityRecords(), sessions = activity();
    const answered = recs.filter(r => r.status !== 'unanswered');
    let correct = recs.filter(r => r.status === 'correct').length;
    let wrong = recs.filter(r => r.status === 'wrong' || r.status === 'partial').length;
    const unanswered = recs.length - answered.length;
    let answeredCount = answered.length;
    /* 模拟考试历史只有汇总值，按真实汇总累加（不逐题造假） */
    examHistory().forEach(x => {
      const c = Number(x.correct) || 0, n = Number(x.count) || 0;
      correct += c; wrong += Math.max(0, n - c); answeredCount += n;
    });
    const rate = answeredCount ? Math.round(correct / answeredCount * 1000) / 10 : 0;
    const by = {};
    /* v1.4.4：近 7 天练习量改取逐题实时记录，未交卷也计入，且与会话汇总不重复 */
    if (Quiz.recordsDiag && Quiz.recordsDiag.daily) {
      Quiz.recordsDiag.daily().forEach(d => { by[d.date] = (by[d.date] || 0) + (Number(d.questions) || 0); });
    } else {
      sessions.forEach(x => { const d = dayKey(x.started_at); by[d] = (by[d] || 0) + (Number(x.question_count) || 0); });
    }
    const items = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const k = dayKey(d.getTime()), v = by[k] || 0;
      items.push({label: k, value: v, display: String(v)});
    }
    const hasData = items.some(x => x.value > 0);
    const chart = hasData
      ? Quiz.charts.barChart(items, {color: '#3b9cff'})
      : '<div class="hr-empty">暂无练习记录<small>完成一轮练习后展示近 7 天练习量</small></div>';
    const disc = '<div class="hub-rate-disc"><b>' + rate + '</b><i>%</i></div>';
    const legend = '<div class="hub-review-legend">' +
      '<div><span>答对</span><b class="g">' + correct + '</b><em>题</em></div>' +
      '<div><span>答错</span><b class="r">' + wrong + '</b><em>题</em></div>' +
      '<div><span>已答</span><b class="b">' + answeredCount + '</b><em>题</em></div>' +
      '<div><span>未答</span><b class="b">' + unanswered + '</b><em>题</em></div></div>';
    return '<div class="hub-review-card"><div class="hub-review-grid">' +
      '<div class="hub-review-left"><div class="hr-title">正确率</div>' +
        '<div class="hr-body">' + disc + legend + '</div></div>' +
      '<div class="hub-review-right"><div class="hr-title strong">本题库近7天练习量</div>' +
        '<div class="hr-chart">' + chart + '</div></div>' +
      '</div><div class="hub-review-actions">' +
        '<button class="btn hub-orange" data-action="hub-share">分享</button>' +
        '<button class="btn hub-blue" data-action="hub-app">APP做题</button>' +
      '</div></div>';
  }
  P.hubReview = function () {
    let h = crumb('查看练习数据');
    h += reviewCardHTML();
    /* v1.11.0：按需求移除「答题记录·来源诊断与汇总」「全部答题记录」「逐题作答明细（实时）」展示 */
    h += '<div class="row" style="justify-content:center;gap:10px;margin-top:14px">' +
      '<button class="btn btn-sm" data-action="hub-sequential">再练一次</button>' +
      '<a class="btn btn-sm" href="' + hubHref() + '">继续练习</a></div>';
    return h;
  };

  /* ================= ⑥ 章节练习 ================= */
  P.hubChapter = function () {
    const list = bankQuestions(), map = {};
    list.forEach(q => { const c = (q.category || []).join('/') || '未分章节'; (map[c] = map[c] || []).push(q); });
    const keys = Object.keys(map);
    let h = crumb('章节练习');
    h += '<div class="blank-panel"><div class="panel-h">章节练习</div>' +
      '<div class="hub-chapter-row"><span>开始生成章节练习试题</span><span class="small faint">' + keys.length + ' 个章节 · 共 ' + list.length + ' 题</span>' +
      '<button class="btn btn-sm hub-blue" data-action="hub-chapter-start" data-cat="">生成全部</button></div>' +
      (keys.length ? '<div class="hub-chapter-list">' + keys.map(c =>
        '<div class="hub-chapter-row"><span>' + e(c) + '</span><span class="small faint">' + map[c].length + ' 题</span>' +
        '<button class="btn btn-sm" data-action="hub-chapter-start" data-cat="' + e(c) + '">开始练习</button></div>').join('') + '</div>' :
        empty('题库中还没有章节信息（可在题目「分类」字段填写）')) + '</div>';
    /* v1.5.0：「编辑章节」配置的目录同步到章节练习 */
    const chapterBank = parseBank() || store.defaultBankId();
    const conf = Quiz.bankOps ? Quiz.bankOps.chaptersFor(chapterBank) : [];
    if (conf.length) h += '<div class="blank-panel" style="margin-top:14px"><div class="panel-h">题库章节目录（来自「更多 → 编辑章节」）</div>' +
      conf.map(c => {
        const qn = list.filter(q => (q.category || []).indexOf(c) >= 0 || (q.category || []).join('/') === c).length;
        return '<div class="hub-chapter-row"><span>' + e(c) + '</span><span class="small faint">' + qn + ' 题</span>' +
          '<button class="btn btn-sm" data-action="hub-chapter-start" data-cat="' + e(c) + '">开始练习</button></div>';
      }).join('') + '</div>';
    return h;
  };

  /* ================= ⑦ 题型练习 ================= */
  P.hubType = function () {
    const list = bankQuestions();
    const items = [
      ['all', '练习全部', '按顺序练习题库所有试题', 'o'],
      ['single', '单选题', typeCount('single', list) + ' 道', 'b'],
      ['multiple', '多选题', typeCount('multiple', list) + ' 道', 'g'],
      ['judge', '判断题', typeCount('judge', list) + ' 道', 'g']
    ];
    let h = crumb('题型练习');
    h += '<div class="blank-panel"><div class="panel-h">题型练习</div><div class="hub-grid sp">' +
      items.map(it => '<button class="hub-card" data-action="hub-type-start" data-type="' + it[0] + '">' +
        '<span class="hub-ico ' + it[3] + '">▤</span><span class="hub-card-tx"><b>' + e(it[1]) + '</b><small>' + e(it[2]) + '</small></span></button>').join('') +
      '</div></div>';
    /* v1.5.0：「自定义题型」关闭的题型不进入抽题池 */
    const typeBank = parseBank() || store.defaultBankId();
    if (Quiz.bankOps && Quiz.bankOps.has(typeBank)) {
      const t = Quiz.bankOps.get(typeBank).types;
      const on = ['single','multiple','judge'].filter(k => t[k] !== false).map(k => ({single:'单选',multiple:'多选',judge:'判断'})[k]);
      h += '<div class="notice-bar info">该题库「自定义题型」已开启：' + e(on.join(' / ') || '无') +
        (t.custom ? ' · 自定义标签：' + e(t.custom) : '') + '。关闭的题型不会进入抽题池。</div>';
    }
    h += '<div class="blank-panel"><div class="panel-h">判断题及判断练习</div><div class="hub-grid sp">' +
      [['T', '判断（正确）', 'b'], ['F', '判断（错误）', 'r']].map(it =>
        '<button class="hub-card" data-action="hub-judge-start" data-value="' + it[0] + '">' +
        '<span class="hub-ico ' + it[2] + '">' + (it[0] === 'T' ? '○' : '✕') + '</span><span class="hub-card-tx"><b>' + it[1] +
        '</b><small>' + list.filter(q => q.type === 'judge' && (!!q.answer.value === (it[0] === 'T'))).length + ' 道</small></span></button>').join('') +
      '</div></div>';
    h += '<div class="blank-panel"><div class="panel-h">试题分类难题练习</div><div class="hub-grid sp">' +
      [1, 2, 3, 4, 5].map(d => {
        const n = list.filter(q => Number(q.difficulty) === d).length;
        return '<button class="hub-card" data-action="hub-diff-start" data-value="' + d + '"><span class="hub-ico o">◈</span>' +
          '<span class="hub-card-tx"><b>' + ['', '易', '偏易', '适中', '偏难', '难'][d] + '</b><small>' + n + ' 道</small></span></button>';
      }).join('') + '</div></div>';
    return h;
  };

  /* ================= ⑧ 模拟考试：配置 / 考试 / 结果 / 错题明细 ================= */
  function examPool() {
    const list = bankQuestions(), cfg = S.exam.cfg;
    let out = [];
    [['single', cfg.single, cfg.singleScore], ['multiple', cfg.multiple, cfg.multipleScore], ['judge', cfg.judge, cfg.judgeScore]]
      .forEach(row => {
        let arr = list.filter(q => q.type === row[0]);
        if (cfg.shuffle) arr = shuffle(arr);
        if (cfg.pickOrder === 'unseen') {
          const w = {}; (state().wrong || []).forEach(x => { w[x.question_id] = x.wrong_count || 1; });
          arr.sort((a, b) => (w[a.question_id] || 0) - (w[b.question_id] || 0));
        }
        out = out.concat(arr.slice(0, Math.max(0, Number(row[1]) || 0))
          .map(q => Object.assign({}, q, {score: Number(row[2]) || 1})));
      });
    return out;
  }
  /* 改题数 / 分值时局部刷新合计，避免整页重绘丢失输入焦点 */
  function refreshExamTotal() {
    const c = S.exam.cfg, list = bankQuestions(), doc = global.document;
    if (!doc) return;
    const ks = ['single', 'multiple', 'judge'], sks = ['singleScore', 'multipleScore', 'judgeScore'];
    let n = 0, score = 0;
    ks.forEach((k, i) => {
      const cnt = Math.max(0, Number(c[k]) || 0), sc = Math.max(0, Number(c[sks[i]]) || 0);
      n += cnt; score += cnt * sc;
      const cell = doc.getElementById('hub-exam-row-' + k);
      if (cell) cell.innerHTML = '合计 <b>' + (cnt * sc).toFixed(2) + '</b> 分';
    });
    const t = doc.getElementById('hub-exam-total'), s = doc.getElementById('hub-exam-score');
    if (t) t.innerHTML = n + ' 道题 <span class="faint">（本机可用 ' + list.length + ' 题）</span>';
    if (s) s.innerHTML = '<b>共计 ' + score.toFixed(2) + ' 分</b>';
  }
  function cfgInput(key, value, cls) {
    return '<input type="number" class="' + (cls || 'num-input') + '" data-action="hub-exam-cfg" data-key="' + key + '" value="' + e(value) + '" min="0">';
  }
  function examConfig() {
    const cfg = S.exam.cfg, list = bankQuestions();
    const rows = [
      ['单选题', 'single', 'singleScore', typeCount('single', list)],
      ['多选题', 'multiple', 'multipleScore', typeCount('multiple', list)],
      ['判断题', 'judge', 'judgeScore', typeCount('judge', list)]
    ];
    let total = 0, totalScore = 0;
    const body = rows.map(r => {
      const n = Math.max(0, Number(cfg[r[1]]) || 0), sc = Number(cfg[r[2]]) || 0;
      total += n; totalScore += n * sc;
      return '<tr><td>' + r[0] + '</td><td>题数 ' + cfgInput(r[1], cfg[r[1]]) + ' <span class="faint">/ ' + r[3] + ' 道</span></td>' +
        '<td>分值 ' + cfgInput(r[2], cfg[r[2]]) + '</td><td id="hub-exam-row-' + r[1] + '">合计 <b>' + (n * sc).toFixed(2) + '</b> 分</td></tr>';
    }).join('');
    let h = crumb('模拟考试 · 试题配置');
    /* v1.5.0：题库「配置模拟考试模板」一键应用到试卷配置 */
    const tplBank = parseBank() || store.defaultBankId();
    const tpl = Quiz.bankOps && Quiz.bankOps.has(tplBank) ? Quiz.bankOps.get(tplBank).exam : null;
    if (tpl && tpl.enabled) h += '<div class="notice-bar info">该题库已配置模拟考试模板：' +
      tpl.duration + ' 分钟 · 及格 ' + tpl.pass + ' 分 · 单选 ' + tpl.single + ' / 多选 ' + tpl.multiple + ' / 判断 ' + tpl.judge +
      ' <button class="btn btn-sm" data-action="bo-exam-apply" data-id="' + e(tplBank) + '">应用模板</button></div>';
    h += '<div class="blank-panel"><div class="panel-h"><span class="hub-req">*</span> 试卷配置</div>' +
      '<div class="table-wrap"><table class="tbl"><thead><tr><th>题型</th><th>题数</th><th>每题分值</th><th>合计</th></tr></thead><tbody>' + body +
      '<tr><td><b>共计</b></td><td id="hub-exam-total">' + total + ' 道题 <span class="faint">（本机可用 ' + list.length + ' 题）</span></td>' +
      '<td>—</td><td id="hub-exam-score"><b>共计 ' + totalScore.toFixed(2) + ' 分</b></td></tr></tbody></table></div>';
    h += '<div class="form-sec" style="margin-top:20px">';
    h += '<div class="form-line"><div class="fl">考试时间</div><div class="fc"><div class="row" style="flex-wrap:nowrap">' +
      cfgInput('duration', cfg.duration) + '<span class="small muted">分钟</span></div></div></div>';
    h += '<div class="form-line"><div class="fl">设置及格分</div><div class="fc"><div class="row" style="flex-wrap:nowrap">' +
      cfgInput('pass', cfg.pass) + '<span class="small muted">分</span></div></div></div>';
    h += '<div class="form-line"><div class="fl">答题模式</div><div class="fc radio-row">' +
      [['after', '做完后，显示答案'], ['none', '不显示答案']].map(o =>
        '<label><input type="radio" name="hub-fb" value="' + o[0] + '" data-action="hub-exam-cfg" data-key="feedback"' +
        (cfg.feedback === o[0] ? ' checked' : '') + '> ' + o[1] + '</label>').join('') + '</div></div>';
    h += '<div class="form-line"><div class="fl">多选题得分模式</div><div class="fc radio-row">' +
      [['all_or_none', '全部选对，才得分'], ['proportional', '漏选，按正确选项数，算平均分']].map(o =>
        '<label><input type="radio" name="hub-partial" value="' + o[0] + '" data-action="hub-exam-cfg" data-key="partial"' +
        (cfg.partial === o[0] ? ' checked' : '') + '> ' + o[1] + '</label>').join('') + '</div></div>';
    h += '<div class="form-line"><div class="fl">选项顺序 <span class="hub-vip">VIP</span></div><div class="fc radio-row">' +
      [['1', '开启'], ['0', '关闭']].map(o =>
        '<label><input type="radio" name="hub-shuffle" value="' + o[0] + '" data-action="hub-exam-cfg" data-key="shuffle"' +
        ((cfg.shuffle ? '1' : '0') === o[0] ? ' checked' : '') + '> ' + o[1] + '</label>').join('') + '</div></div>';
    h += '<div class="form-line"><div class="fl">选题方式 <span class="hub-vip">VIP</span></div><div class="fc radio-row">' +
      [['type', '题型优先'], ['unseen', '未做题优先']].map(o =>
        '<label><input type="radio" name="hub-pick" value="' + o[0] + '" data-action="hub-exam-cfg" data-key="pickOrder"' +
        (cfg.pickOrder === o[0] ? ' checked' : '') + '> ' + o[1] + '</label>').join('') + '</div></div>';
    h += '</div><div class="notice-bar info">说明：<br>1. 模拟考试为随机从各题型中抽取试题进行自我测试。<br>' +
      '2. 仅使用当前账号题库，题数不足时按实际可用题量组卷。<br>' +
      '3. 多选题得分模式与每题分值可在上方调整，交卷后自动保存设置。<br>' +
      '4. 配置好试题和分值后，系统将自动保存设置。</div>';
    h += '<div class="row" style="justify-content:center;gap:10px"><a class="btn" href="' + hubHref() + '">放弃记录</a>' +
      '<button class="btn hub-blue" data-action="hub-exam-start">开始考试</button></div></div>';
    return h;
  }
  function examRun() {
    const ex = S.exam, qs = ex.questions, i = ex.index, q = qs[i];
    if (!q) return empty('试卷数据异常');
    const raw = ex.answers[i];
    const checked = key => {
      if (q.type === 'judge') return raw === key ? ' checked' : '';
      return Array.isArray(raw) && raw.indexOf(key) >= 0 ? ' checked' : '';
    };
    const sec = q.type === 'single' ? '一、单选题' : q.type === 'multiple' ? '二、多选题' : '三、判断题';
    const totalScore = qs.reduce((n, x) => n + (Number(x.score) || 0), 0);
    let h = '<div class="hub-exam-wrap" data-font="' + e(ex.font) + '"><div class="hub-exam-main">';
    h += '<h2 class="hub-exam-title">模拟考试</h2><div class="hub-exam-sub">考试题数：' + qs.length + ' 道 · 考试时间：' +
      e(ex.cfg.duration) + ' 分钟 · 满分：' + totalScore.toFixed(2) + ' 分 · 及格分：' + e(ex.cfg.pass) + ' 分</div>';
    h += '<div class="hub-exam-sec">' + sec + '（共 ' + qs.filter(x => x.type === q.type).length + ' 题）</div>';
    h += '<div class="hub-exam-q"><span class="hub-qnum">' + (i + 1) + '/' + qs.length + '</span> ' + e(q.stem) + ' （' + e(q.score) + '分）</div>';
    h += '<div class="hub-exam-opts">';
    if (q.type === 'judge') {
      [['T', '正确'], ['F', '错误']].forEach(o => {
        h += '<label class="hub-opt"><input type="radio" name="hub-answer" value="' + o[0] + '" data-action="hub-exam-answer"' + checked(o[0]) +
          '><span class="okey">' + o[0] + '</span><span>' + o[1] + '</span></label>';
      });
    } else {
      (q.options || []).forEach(o => {
        h += '<label class="hub-opt"><input type="' + (q.type === 'single' ? 'radio' : 'checkbox') + '" name="hub-answer" value="' + e(o.key) +
          '" data-action="hub-exam-answer"' + checked(o.key) + '><span class="okey">' + e(o.key) + '</span><span>' + e(o.text) + '</span></label>';
      });
    }
    h += '</div><div class="hub-exam-foot"><button class="btn-link" data-action="hub-exam-prev">← 上一题</button>' +
      '<button class="btn-link" data-action="hub-exam-next">下一题 →</button><span class="spacer"></span>' +
      '<button class="btn-link" data-action="hub-exam-mark">☆ 标记</button>' +
      '<button class="btn-link" data-action="hub-exam-fav">☆ 收藏</button></div></div>';
    /* 右栏：倒计时 + 答题卡 + 字号 + 交卷 */
    h += '<aside class="hub-exam-side"><div class="hub-exam-clock">◷ <b id="hub-exam-clock">' +
      fmtClock(ex.cfg.duration * 60 - Math.floor((Date.now() - ex.startedAt) / 1000)) + '</b> <span class="small muted">暂停</span></div>';
    h += '<div class="hub-exam-card">' + e(scorer.TYPE_LABEL[q.type] || q.type) + '</div><div class="hub-exam-grid">' + qs.map((_, n) =>
      '<button class="hub-ac' + (n === i ? ' cur' : '') + (ex.answers[n] != null ? ' done' : '') +
      '" data-action="hub-exam-goto" data-index="' + n + '">' + (n + 1) + '</button>').join('') + '</div>';
    h += '<div class="hub-exam-font">字号 <span>' + ['较小', '标准', '较大'].map((f, n) =>
      '<button class="' + (ex.font === ['small', 'normal', 'large'][n] ? 'on' : '') +
      '" data-action="hub-exam-font" data-value="' + ['small', 'normal', 'large'][n] + '">' + f + '</button>').join('') + '</span></div>';
    h += '<button class="btn hub-blue hub-submit" data-action="hub-exam-submit">交卷</button></aside></div>';
    return h;
  }
  function saveExamHistory(rec) {
    try { global.localStorage && global.localStorage.setItem(EXAM_KEY, JSON.stringify(S.exam.history.slice(0, 20))); } catch (err) {}
  }
  function submitExam() {
    const ex = S.exam;
    if (!ex.questions.length) return;
    const recs = ex.questions.map((q, i) => {
      const raw = ex.answers[i];
      let input;
      if (q.type === 'judge') input = raw == null ? null : raw;
      else if (Array.isArray(raw)) input = raw;
      else if (raw == null || raw === '') input = [];
      else input = [raw];
      let r;
      try { r = scorer.score(q, input, {partial_mode: ex.cfg.partial, allow_partial_with_wrong: false}); }
      catch (err) { r = {status: 'unanswered', score: 0, max_score: Number(q.score) || 1}; }
      return {q, raw, r};
    });
    const total = recs.reduce((n, x) => n + (Number(x.r.max_score) || 0), 0);
    const earned = recs.reduce((n, x) => n + (Number(x.r.score) || 0), 0);
    const correct = recs.filter(x => x.r.status === 'correct').length;
    const wrong = recs.filter(x => x.r.status === 'wrong' || x.r.status === 'unanswered').length;
    const used = Math.max(0, Math.round((Date.now() - ex.startedAt) / 1000));
    ex.result = {recs, total, earned, correct, wrong, rate: recs.length ? Math.round(correct / recs.length * 1000) / 10 : 0, used};
    ex.history.unshift({at: Date.now(), rate: ex.result.rate, score: earned,
      count: ex.result.recs.length, correct: ex.result.correct, used: ex.result.used});
    ex.history = ex.history.slice(0, 20); saveExamHistory();
    ex.phase = 'result'; render();
  }
  function examResult() {
    const r = S.exam.result;
    if (!r) return examConfig();
    const hist = S.exam.history.slice(0, 10).reverse().map((x, i) => ({label: String(i + 1), value: x.rate}));
    let h = '<div class="grid g2 hub-split"><div class="blank-panel"><div class="panel-h">客观题得分</div>' +
      '<div class="hub-ring-wrap"><div class="hub-ring big" style="--p:' + (r.total ? Math.round(r.earned / r.total * 100) : 0) + '"><span>' +
      r.earned.toFixed(2) + '<small>分</small></span></div><div class="hub-legend">' +
      '<div><i class="g"></i>答对 <b>' + r.correct + '</b> 题</div><div><i class="r"></i>答错 <b>' + r.wrong + '</b> 题</div>' +
      '<div>总题 <b>' + r.recs.length + '</b> 题</div><div>正确率 <b>' + r.rate + '%</b></div>' +
      '<div>考试用时 <b>' + fmtClock(r.used) + '</b></div></div></div></div>' +
      '<div class="blank-panel"><div class="panel-h">近 10 次模拟考试正确率</div>' +
      (hist.length > 1 ? Quiz.charts.lineChart(hist, {max: 100}) : '<div class="small faint" style="padding:40px 0;text-align:center">完成多次考试后显示趋势</div>') +
      '</div></div>';
    h += '<div class="row" style="justify-content:center;gap:10px"><button class="btn btn-c-soft" data-action="hub-exam-detail">查看错题明细</button>' +
      '<button class="btn hub-orange" data-action="hub-exam-again">重考</button>' +
      '<a class="btn hub-blue" href="' + hubHref() + '">返回练习</a></div>';
    return h;
  }
  function examDetail() {
    const r = S.exam.result;
    if (!r) return examConfig();
    const wrongs = r.recs.filter(x => x.r.status !== 'correct');
    let h = '<div class="hub-detail"><h3>' + e(bankName()) + '-' + fmtTime(S.exam.startedAt) + '的错题</h3>';
    h += wrongs.length ? wrongs.map((x, n) => {
      const q = x.q;
      return '<div class="hub-detail-item"><div class="hub-detail-stem">' + (n + 1) + '. ' + e(q.stem) + '</div>' +
        (q.type === 'judge' ? '<div class="hub-detail-opt">A. 正确<br>B. 错误</div>' :
          (q.options || []).map(o => '<div class="hub-detail-opt">' + e(o.key) + '. ' + e(o.text) + '</div>').join('')) +
        '<div class="hub-detail-kv">考生答案：<b>' + e(userText(q, x.raw)) + '</b></div>' +
        '<div class="hub-detail-kv">正确答案：<b>' + e(answerText(q)) + '</b></div>' +
        '<div class="hub-detail-kv">答案解析：' + e(q.analysis || x.r.analysis || '—') + '</div></div>';
    }).join('') : '<div class="small faint" style="text-align:center;padding:30px">本次考试没有错题</div>';
    h += '</div><div class="row" style="justify-content:center;margin-top:14px"><button class="btn" data-action="hub-exam-back-result">返回成绩</button>' +
      '<a class="btn hub-blue" href="' + hubHref() + '">返回练习</a></div>';
    return h;
  }
  P.hubExam = function () {
    const ph = S.exam.phase;
    /* 首次进入配置页：默认题数按本机可用题量收敛，避免出现「共计 20 题」却只组出 12 题 */
    if (ph === 'config' && !S.exam.cfgTouched) {
      const list = bankQuestions();
      ['single', 'multiple', 'judge'].forEach(k => {
        S.exam.cfg[k] = Math.min(Number(S.exam.cfg[k]) || 0, typeCount(k, list));
      });
      S.exam.cfgTouched = true;
    }
    return ph === 'run' ? examRun() : ph === 'result' ? crumb('模拟考试 · 成绩') + examResult() :
      ph === 'detail' ? crumb('模拟考试 · 错题明细') + examDetail() : examConfig();
  };

  /* ================= 事件处理（只改状态；由 app.js 统一重绘，另显式兜底重绘） ================= */
  function idsOf(pred) { return bankQuestions().filter(pred).map(q => q.question_id); }
  function onAction(a, el, target) {
    const app = Quiz.app;
    switch (a) {
      case 'hub-search': {
        const inp = global.document && global.document.getElementById('hub-kw');
        S.kw = inp ? inp.value : ''; render(); break;
      }
      case 'hub-sequential': launch(bankQuestions().map(q => q.question_id)); break;
      case 'hub-wrong': app.startPractice({mode: 'wrong_review', count: 200}); break;
      case 'hub-clear-fav':
        if (global.confirm && !global.confirm('确认清空全部收藏？该操作只影响本机收藏，不会删除题目。')) return;
        store.mutate(s => { s.favorites = []; });
        toast('已清空收藏', 'ok'); render(); break;
      case 'hub-random-open': S.randomOpen = true; render(); break;
      case 'hub-random-close': S.randomOpen = false; render(); break;
      case 'hub-random-size': S.randomSize = Number(el.dataset.value) || 200; S.randomCustom = ''; render(); break;
      case 'hub-random-start': {
        const c = global.document && global.document.getElementById('hub-random-custom');
        const n = Math.max(1, Math.min(200, Number(c && c.value) || Number(S.randomSize) || 200));
        S.randomSize = n; S.randomOpen = false;
        launch(shuffle(bankQuestions()).slice(0, n).map(q => q.question_id), {order: 'random'});
        break;
      }
      case 'hub-brief': {
        const list = bankQuestions(), hard = list.filter(q => Number(q.difficulty) >= 4);
        launch((hard.length ? hard : list.slice(0, Math.max(1, Math.ceil(list.length / 3)))).map(q => q.question_id)); break;
      }
      case 'hub-error': {
        const w = {}; (state().wrong || []).forEach(x => { w[x.question_id] = x.wrong_count || 1; });
        launch(bankQuestions().filter(q => (w[q.question_id] || 0) >= 2).map(q => q.question_id)); break;
      }
      case 'hub-material': global.location.hash = '#/downloads'; break;
      case 'hub-share': toast('分享暂未开放', 'ok'); break;
      case 'hub-app': toast('APP 做题暂未开放', 'ok'); break;
      case 'hub-chapter-start': {
        const cat = el.dataset.cat || '';
        launch(idsOf(q => !cat || (q.category || []).join('/') === cat || cat === '未分章节' && !(q.category || []).length));
        break;
      }
      case 'hub-type-start': {
        const t = el.dataset.type;
        launch(idsOf(q => t === 'all' || q.type === t)); break;
      }
      case 'hub-judge-start': {
        const want = el.dataset.value === 'T';
        launch(idsOf(q => q.type === 'judge' && !!(q.answer && q.answer.value) === want)); break;
      }
      case 'hub-diff-start': {
        const d = Number(el.dataset.value);
        launch(idsOf(q => Number(q.difficulty) === d)); break;
      }
      case 'hub-note-view': {
        const q = store.question(el.dataset.id), n = store.note(el.dataset.id);
        if (!q) { toast('题目已删除', 'err'); break; }
        const b = '<div class="small muted" style="margin-bottom:10px">' + e(scorer.TYPE_LABEL[q.type] || q.type) + ' · ' + e(q.question_id) + '</div>' +
          '<div style="font-size:13.5px;line-height:1.8;margin-bottom:10px">' + e(q.stem) + '</div>' +
          (q.type === 'judge' ? '<div class="small">A. 正确　B. 错误</div>' :
            (q.options || []).map(o => '<div class="small">' + e(o.key) + '. ' + e(o.text) + '</div>').join('')) +
          '<div class="small" style="margin-top:10px">正确答案：<b>' + e(answerText(q)) + '</b></div>' +
          '<div class="small">答案解析：' + e(q.analysis || '—') + '</div>' +
          '<div class="notice-bar info" style="margin-top:12px">我的笔记：' + e(n ? n.text : '') + '</div>';
        Quiz.app.modal('题目详情', b, '<button class="btn btn-primary" data-action="close-modal">关闭</button>');
        break;
      }
      case 'hub-note-del':
        if (global.confirm && !global.confirm('删除这条笔记？')) return;
        store.saveNote(el.dataset.id, ''); toast('笔记已删除', 'ok'); render(); break;
      /* ---- 模拟考试 ---- */
      case 'hub-exam-open':
        S.exam.phase = 'config'; S.exam.result = null;
        global.location.hash = '#/hubExam'; render(); break;
      case 'hub-exam-start': {
        const qs = examPool();
        if (!qs.length) { toast('没有可组卷的题目，请检查题数配置或题库', 'err'); return; }
        S.exam.questions = qs; S.exam.answers = {}; S.exam.index = 0;
        S.exam.startedAt = Date.now(); S.exam.result = null; S.exam.phase = 'run';
        render(); break;
      }
      case 'hub-exam-goto': S.exam.index = Math.max(0, Math.min(S.exam.questions.length - 1, Number(el.dataset.index) || 0)); render(); break;
      case 'hub-exam-prev': S.exam.index = Math.max(0, S.exam.index - 1); render(); break;
      case 'hub-exam-next': S.exam.index = Math.min(S.exam.questions.length - 1, S.exam.index + 1); render(); break;
      case 'hub-exam-font': S.exam.font = el.dataset.value || 'normal'; render(); break;
      case 'hub-exam-mark': case 'hub-exam-fav': {
        const q = S.exam.questions[S.exam.index];
        if (!q) return;
        if (a === 'hub-exam-mark') { store.toggleMark(q.question_id); toast('已更新本题标记', 'ok'); }
        else {
          const has = state().favorites.some(f => f.question_id === q.question_id);
          store.mutate(s => { s.favorites = has ? s.favorites.filter(f => f.question_id !== q.question_id)
            : s.favorites.concat([{id: util.uid('FAV'), question_id: q.question_id, folder_id: 'F_DEFAULT', created_at: util.now()}]); });
          toast(has ? '已取消收藏' : '已收藏本题', 'ok');
        }
        render(); break;
      }
      case 'hub-exam-submit':
        if (global.confirm && !global.confirm('确认交卷？交卷后不可修改作答。')) return;
        submitExam(); break;
      case 'hub-exam-detail': S.exam.phase = 'detail'; render(); break;
      case 'hub-exam-back-result': S.exam.phase = 'result'; render(); break;
      case 'hub-exam-again': S.exam.phase = 'config'; S.exam.result = null; render(); break;
      default: return false;
    }
    return true;
  }
  /* 配置表单 / 作答：change 事件 */
  function onChange(a, el, target) {
    if (a === 'hub-exam-cfg') {
      const k = el.dataset.key, v = target.value;
      if (k === 'shuffle') S.exam.cfg.shuffle = v === '1';
      else if (['single', 'multiple', 'judge', 'duration', 'pass'].indexOf(k) >= 0) S.exam.cfg[k] = Math.max(0, Number(v) || 0);
      else if (['singleScore', 'multipleScore', 'judgeScore'].indexOf(k) >= 0) S.exam.cfg[k] = Math.max(0, Number(v) || 0);
      else S.exam.cfg[k] = v;
      if (S.exam.phase === 'config') refreshExamTotal();
      return true;
    }
    if (a === 'hub-exam-answer') {
      const ex = S.exam, q = ex.questions[ex.index];
      if (!q) return true;
      const t = target, key = t.value;
      if (q.type === 'single') ex.answers[ex.index] = [key];
      else if (q.type === 'judge') ex.answers[ex.index] = key;
      else {
        const arr = Array.isArray(ex.answers[ex.index]) ? ex.answers[ex.index].slice() : [];
        const i = arr.indexOf(key);
        if (t.checked && i < 0) arr.push(key);
        if (!t.checked && i >= 0) arr.splice(i, 1);
        ex.answers[ex.index] = arr;
      }
      return true;   // 不重绘，保留其它选项勾选态
    }
    return false;
  }
  try {
    global.document.addEventListener('click', function (ev) {
      const el = ev.target && ev.target.closest && ev.target.closest('[data-action^="hub-"]');
      if (!el) return;
      const a = el.dataset.action;
      if (String(a).indexOf('hub-exam-answer') >= 0) return;
      if (!onAction(a, el, ev.target)) return;
      if (ev.stopImmediatePropagation) ev.stopImmediatePropagation();
    });
    global.document.addEventListener('change', function (ev) {
      const el = ev.target && ev.target.closest && ev.target.closest('[data-action^="hub-"]');
      if (!el) return;
      if (!onChange(el.dataset.action, el, ev.target)) return;
      if (ev.stopImmediatePropagation) ev.stopImmediatePropagation();
    });
  } catch (err) {}

  /* 倒计时：浏览器环境才启动，Node 自测不持有定时器 */
  if (typeof process === 'undefined' || !(process.versions && process.versions.node)) {
    try {
      setInterval(function () {
        const ex = S.exam;
        if (ex.phase !== 'run') return;
        const left = Math.max(0, (Number(ex.cfg.duration) || 0) * 60 - Math.floor((Date.now() - ex.startedAt) / 1000));
        const el = global.document && global.document.getElementById('hub-exam-clock');
        if (el) el.textContent = fmtClock(left);
        if (left <= 0) { ex.phase = 'run'; submitExam(); }
      }, 1000);
    } catch (err) {}
  }

  Quiz.hubPages = {state: S, submitExam, examPool, launch, bankQuestions, onAction, onChange,
    reviewCardHTML, activity, activityRecords, examHistory};
})(typeof window !== 'undefined' ? window : globalThis);
