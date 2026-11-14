/* v0.9 新导航页面：一级/二级导航对应的布局页。
   纯增量：所有既有 Quiz.pages 路由不改不删；账户中心为暂未开放，仅布局、控件禁用、不写入任何示例数据。 */
(function (global) {
  const Quiz = global.Quiz;
  const P = Quiz.pages, util = Quiz.util, store = Quiz.store;
  const e = v => util.esc(v == null ? '' : String(v));
  const EXAM_KEY = 'smartQuiz.exams.v1';

  /* 页面局部状态（内存，不写入题库主数据） */
  const S = Quiz.navState = {
    navOpen: {bankcenter: false, exam: false, account: false},
    tabs: {practiceRecords: 'data', account: 'info', trash: 'bank', examHistory: 'list'},
    mybanks: {menu: false, grid: false, kw: '', group: '', date: ''},
    examHistory: {menu: false, kw: ''},
    exam: {step: 1, picking: false, selectedBanks: [], byType: false, byBank: false, thousand: false,
           form: {name: '', desc: '', type: '模拟考试', qualify: '所有人都可以考试', method: '随机选题',
                  duration: 45, pass: 60, start: '', end: '', allowLate: true, people: 0}},
    rank: 'today'
  };

  /* ---------------- 通用小组件 ---------------- */
  function toDate(ts) {
    if (ts == null || ts === '') return null;
    let d = new Date(ts);
    if (isNaN(d.getTime())) d = new Date(String(ts).replace(/-/g, '/'));
    return isNaN(d.getTime()) ? null : d;
  }
  function fmt(ts) {
    const d = toDate(ts);
    if (!d) return e(ts == null ? '—' : String(ts));
    const p = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }
  function dayKey(ts) {
    const d = toDate(ts);
    if (!d) return '—';
    const p = n => String(n).padStart(2, '0');
    return p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  function dur(ms) {
    const t = Math.max(0, Math.round((Number(ms) || 0) / 1000));
    const p = n => String(n).padStart(2, '0');
    return p(Math.floor(t / 3600)) + ':' + p(Math.floor(t % 3600 / 60)) + ':' + p(t % 60);
  }
  function pct(n) { return (Math.round((Number(n) || 0) * 10) / 10) + '%'; }
  function reserve(text) {
    return '<div class="reserve">ⓘ ' + e(text || '该模块为暂未开放功能，此次更新仅优化布局，未启用任何业务功能。') + '</div>';
  }
  function emptyBox(text, ico) {
    return '<div class="empty"><div class="ico">' + (ico || '▤') + '</div><div>' + e(text || '暂无数据') + '</div></div>';
  }
  function tabs(group, items) {
    const cur = S.tabs[group];
    return '<div class="page-tabs">' + items.map(it =>
      '<button class="page-tab' + (cur === it[0] ? ' active' : '') + '" data-action="nav-tab" data-group="' + group + '" data-value="' + it[0] + '">' + e(it[1]) + '</button>'
    ).join('') + '</div>';
  }
  function tbl(cols, rows, emptyText, cls) {
    /* v1.5.1：cls 可选，用于给单个表格加专属排版类；不传时输出与旧版完全一致 */
    const tc = cls ? ' ' + cls : '', wc = cls ? ' ' + cls + '-wrap' : '';
    return '<div class="table-wrap' + wc + '"><table class="tbl' + tc + '"><thead><tr>' +
      cols.map(c => '<th>' + c + '</th>').join('') + '</tr></thead>' +
      (rows.length ? '<tbody>' + rows.map(r => '<tr>' + r.map(c => '<td>' + c + '</td>').join('') + '</tr>').join('') + '</tbody>' : '') +
      '</table></div>' + (rows.length ? '' : emptyBox(emptyText));
  }
  function sw(checked, action, key, disabled, label) {
    return '<label class="switch' + (disabled ? ' disabled' : '') + '"><input type="checkbox" data-action="' + action + '"' +
      (key ? ' data-key="' + key + '"' : '') + (checked ? ' checked' : '') + (disabled ? ' disabled' : '') +
      '><span class="track"></span>' + (label ? '<span>' + e(label) + '</span>' : '') + '</label>';
  }
  function radios(name, list, cur, action) {
    return '<div class="radio-row">' + list.map(v =>
      '<label><input type="radio" name="' + name + '" value="' + e(v) + '"' + (action ? ' data-action="' + action + '" data-key="' + name + '"' : '') +
      (v === cur ? ' checked' : '') + '> ' + e(v) + '</label>').join('') + '</div>';
  }
  function ops(list) { return '<span class="op">' + list.join(' · ') + '</span>'; }
  function goLink(route, label) { return '<a class="btn-link" href="#/' + route + '">' + e(label) + '</a>'; }
  function todo(label, danger) { return '<button class="btn-link' + (danger ? ' danger' : '') + '" data-action="nav-todo">' + e(label) + '</button>'; }
  function bankName(id) { const b = store.bank && store.bank(id); return (b && (b.name || b.bank_name)) || '未分类题库'; }
  function countInBanks(items, bankId) {
    if (bankId === 'ALL') return items.length;
    return items.filter(q => (q.bank_id || store.defaultBankId()) === bankId).length;
  }

  /* ---------------- 本地考试数据（独立 key，不污染题库主备份） ---------------- */
  function exams() {
    try { const v = JSON.parse((global.localStorage && global.localStorage.getItem(EXAM_KEY)) || '[]'); return Array.isArray(v) ? v : []; }
    catch (err) { return []; }
  }
  function saveExam(rec) {
    const list = exams(); list.unshift(rec);
    try { global.localStorage && global.localStorage.setItem(EXAM_KEY, JSON.stringify(list)); } catch (err) {}
    return rec;
  }
  function updateExam(id, patch) {
    const list = exams(), i = list.findIndex(x => x.exam_id === id);
    if (i < 0) return;
    Object.assign(list[i], patch);
    try { global.localStorage && global.localStorage.setItem(EXAM_KEY, JSON.stringify(list)); } catch (err) {}
  }
  Quiz.navExams = {all: exams, save: saveExam, update: updateExam};

  /* v1.1.1：按需求移除首页「全部功能」卡片；原 P.dashboard 保持不变 */

  /* ================= 题库中心 ① 我的题库 ================= */
  P.mybanks = function () {
    const BO = Quiz.bankOps;
    const banks = (store.banks && store.banks()) || [];
    const kw = String(S.mybanks.kw || '').trim();
    /* v1.5.2：按参考图移除分组/创建时间筛选控件与「类别 / 章节目录 / 任务方式」列。
       底层 bank_ops 配置仍保留，可在「更多操作 → 移动 / 编辑章节 / 练习设置」里维护。 */
    let list = banks.filter(b => !kw || String(b.name || '').indexOf(kw) >= 0);
    if (BO) list = BO.sorted(list);
    let h = '<div class="blank-panel pad-0">';
    /* v1.5.1：工具栏拆成「动作」与「筛选」两行，避免筛选下拉被挤成占满整行 */
    h += '<div class="toolbar bo-toolbar bo-toolbar-top" style="padding:14px 16px">' +
      '<a class="btn btn-sm btn-c-blue" href="#/import">上传题库</a>' +
      '<button class="btn btn-sm btn-c-cyan" data-action="ai-go-settings">AI 解析</button>' +
      '<a class="btn btn-sm btn-c-orange" href="#/bank">人工录入</a>' +
      '<button class="btn btn-sm btn-c-purple" data-action="ai-go-settings">智能解析</button>' +
      '<button class="btn btn-sm btn-c-blue" data-action="ai-go-settings">AI 出题</button>' +
      '<button class="btn btn-sm" data-action="nav-download-template">下载模板</button>' +
      '<div class="dropdown"><button class="btn btn-sm btn-c-soft" data-action="nav-menu" data-menu="mybanks">更多操作 ⌄</button>' +
        '<div class="dropdown-menu' + (S.mybanks.menu ? ' open' : '') + '">' +
          '<button data-action="bank-create">新建题库</button>' +
          '<button data-action="bo-merge">合并题库</button>' +
          '<button data-action="bo-share">批量分享我的题库</button>' +
        '</div></div>' +
      '<span class="grow"></span>' +
      '<input type="text" class="tb-search" id="mybanks-kw" placeholder="输入您想搜索的题库名称" value="' + e(kw) + '">' +
      '<button class="btn btn-sm" data-action="nav-search-go" data-target="mybanks">⌕</button>' +
      '</div>' +
      '<div class="bo-toolbar-bottom" style="display:none" aria-hidden="true"></div>';

    h += '<div style="padding:0 16px 16px">';
    const rows = list.map((b, i) => {
      const id = b.bank_id || b.id || '';
      const n = store.questionCount ? store.questionCount(id) : countInBanks(store.state().questions, id);
      return [
        '<input type="checkbox" class="nb-ck" value="' + e(id) + '">',
        String(i + 1),
        BO ? BO.nameCell(b) : e(b.name),
        '<span class="small muted">' + fmt(b.created_at) + '</span>',
        String(n),
        '<button class="btn-link" data-action="nav-todo" title="暂未开放">↗</button>',
        ops([goLink('bank', '添加试题'), goLink('bank', '试题管理'),
             '<a class="btn-link" href="#/bankGrid?bank=' + e(id) + '">编辑试题</a>',
             '<a class="btn-link" href="#/practiceHub?bank=' + e(id) + '">练习</a>']) +
        (BO ? BO.menuHtml(id) : todo('更多'))
      ];
    });
    h += tbl(['<input type="checkbox" data-action="nav-check-all" data-target="nb-ck">', '编号', '名称', '创建时间', '题目数量', '分享好友', '操作'], rows,
      kw ? '没有匹配的题库' : '还没有题库，可在「文档导入」上传或在「题库管理」新建', 'bo-tbl');
    h += '</div></div>';
    h += '<a class="bo-fab" href="#/import">↑ 上传题库</a>';
    h += '';
    return h;
  };

  /* ================= 题库中心 ② 全部错题 ================= */
  function grouped(records) {
    const s = store.state(), qs = {};
    s.questions.forEach(q => { qs[q.question_id] = q; });
    const map = {};
    records.forEach(r => {
      const q = qs[r.question_id];
      const id = (q && q.bank_id) || store.defaultBankId();
      map[id] = (map[id] || 0) + 1;
    });
    return Object.keys(map).map(id => ({id, name: bankName(id), count: map[id]})).sort((a, b) => b.count - a.count);
  }
  P.allwrong = function () {
    const groups = grouped(store.state().wrong || []);
    let h = '<div class="blank-panel pad-0" style="padding-top:14px">';
    h += '<div class="toolbar" style="padding:0 16px 12px">' +
      '<select style="width:150px" data-action="nav-todo"><option>全部练习</option></select></div>';
    const rows = groups.map((g, i) => [
      '<input type="checkbox" class="nb-ck">', String(i + 1), e(g.name), '本地用户', String(g.count),
      ops([goLink('wrong', '查看'), goLink('practice', '练习'), todo('导出'), todo('删除', true)])
    ]);
    h += tbl(['<input type="checkbox" data-action="nav-check-all" data-target="nb-ck">', '编号', '题库名称', '作者', '错题数量', '操作'], rows, '还没有错题记录');
    h += '</div><div class="small faint" style="margin-top:10px">按题库汇总错题数量。</div>';
    return h;
  };

  /* ================= 题库中心 ③ 全部收藏题 ================= */
  P.allfav = function () {
    const groups = grouped(store.state().favorites || []);
    let h = '<div class="blank-panel pad-0" style="padding-top:14px">';
    h += '<div class="toolbar" style="padding:0 16px 12px">' +
      '<select style="width:150px" data-action="nav-todo"><option>全部练习</option></select></div>';
    const rows = groups.map((g, i) => [
      '<input type="checkbox" class="nb-ck">', String(i + 1), e(g.name), '本地用户', String(g.count),
      ops([goLink('practice', '练习'), todo('导出'), todo('删除', true)])
    ]);
    h += tbl(['<input type="checkbox" data-action="nav-check-all" data-target="nb-ck">', '编号', '题库名称', '作者', '收藏数量', '操作'], rows, '还没有收藏题目');
    h += '</div><div class="small faint" style="margin-top:10px">按题库汇总本机收藏数量；收藏夹明细仍可在「我的收藏」查看。</div>';
    return h;
  };

  /* ================= 题库中心 ④ 练习记录 ================= */
  function daily() {
    /* v1.4.4：优先用逐题实时记录统计题数 / 答对 / 用时，答完一题立刻可见 */
    if (Quiz.recordsDiag && Quiz.recordsDiag.daily) return Quiz.recordsDiag.daily();
    /* v1.1.1 回退：合并已归档会话 + 进行中练习 + 本机模拟考试 */
    const sessions = (Quiz.hubPages && Quiz.hubPages.activity) ? Quiz.hubPages.activity() : (store.state().sessions || []);
    const by = {};
    sessions.forEach(x => {
      const d = dayKey(x.started_at);
      const o = by[d] || (by[d] = {date: d, sessions: 0, questions: 0, correct: 0, duration: 0});
      o.sessions++; o.questions += Number(x.question_count) || 0;
      o.correct += Number(x.correct_count) || 0; o.duration += Number(x.duration_ms) || 0;
    });
    return Object.keys(by).map(k => by[k]).sort((a, b) => b.date.localeCompare(a.date));
  }
  function weekBars(days) {
    const labels = [], pairs = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const p = n => String(n).padStart(2, '0');
      const key = p(d.getMonth() + 1) + '-' + p(d.getDate());
      const rec = days.find(x => x.date === key) || {questions: 0, sessions: 0};
      labels.push(key); pairs.push(rec);
    }
    const max = Math.max(1, ...pairs.map(x => Math.max(x.questions, x.sessions * 5)));
    return '<div class="bar-legend"><span><i style="background:#2f7bff"></i>练习题量</span><span><i style="background:#ffb020"></i>练习次数</span></div>' +
      '<div class="bars">' + pairs.map(x =>
        '<div class="bar-pair"><div class="bar" style="height:' + Math.round(x.questions / max * 100) + '%" title="' + x.questions + ' 题"></div>' +
        '<div class="bar alt" style="height:' + Math.round(x.sessions * 5 / max * 100) + '%" title="' + x.sessions + ' 次"></div></div>').join('') + '</div>' +
      '<div class="bar-labels">' + labels.map(l => '<span>' + l + '</span>').join('') + '</div>';
  }
  /* v1.4.2：记录为空时直接告诉用户「数据在哪」，而不是只显示一张空表 */
  /* v1.11.0：来源诊断卡已按需求移除 */
  P.practiceRecords = function () {
    const days = daily(), tab = S.tabs.practiceRecords;
    /* v1.11.0：按需求移除「答题记录·来源诊断与汇总」「全部答题记录」「逐题作答明细（实时）」展示 */
    let h = tabs('practiceRecords', [['data', '练习数据'], ['rank', '排行榜'], ['total', '累计练习']]);
    if (tab === 'data') {
      const today = dayKey(Date.now());
      const t = days.find(x => x.date === today) || {sessions: 0, questions: 0, correct: 0, duration: 0};
      const acc = t.questions ? t.correct / t.questions * 100 : 0;
      h += '<div class="grid g2 hub-split"><div class="blank-panel">' +
        '<div class="panel-h">当天练习 <span class="sub">' + e(today) + '</span></div>' +
        '<div class="metric-row hub-metrics">' +
        '<div class="metric"><div class="lb">练习次数</div><div class="vl">' + t.sessions + '</div></div>' +
        '<div class="metric"><div class="lb">练习时长</div><div class="vl" style="font-size:16px;padding-top:6px">' + dur(t.duration) + '</div></div>' +
        '<div class="metric"><div class="lb">练习题数</div><div class="vl">' + t.questions + '</div></div>' +
        '<div class="metric"><div class="lb">正确率</div><div class="vl">' + pct(acc) + '</div></div>' +
        '</div></div>' +
        '<div class="blank-panel"><div class="panel-h">最近一周练习题量 <span class="sub">含进行中练习与模拟考试</span></div>' + weekBars(days) + '</div></div>';
    } else if (tab === 'rank') {
      h += '<div class="notice-bar info">排行榜展示不同用户之间的练习记录对比；暂无跨用户数据，故列表为空。</div>';
      h += '<div class="blank-panel"><div class="toolbar">' +
        '<button class="btn btn-sm ' + (S.rank === 'today' ? 'btn-c-blue' : '') + '" data-action="nav-rank" data-value="today">今日排行</button>' +
        '<button class="btn btn-sm ' + (S.rank === 'week' ? 'btn-c-blue' : '') + '" data-action="nav-rank" data-value="week">本周排行</button></div>' +
        tbl(['排名', '用户昵称', '总练习次数', '练习题数', '练习时长'], [], '有跨用户数据后展示排行') + '</div>';
    } else {
      /* v1.4.4：累计口径与按日明细一致，取逐题实时记录，不再重复叠加会话汇总 */
      const totalQ = days.reduce((n, d) => n + (Number(d.questions) || 0), 0);
      const totalC = days.reduce((n, d) => n + (Number(d.correct) || 0), 0);
      const totalD = days.reduce((n, d) => n + (Number(d.duration) || 0), 0);
      const totalS = days.reduce((n, d) => n + (Number(d.sessions) || 0), 0);
      const bankCount = (store.banks && store.banks() || []).length;
      h += '<div class="blank-panel"><div class="toolbar"><input type="text" style="max-width:230px" placeholder="输入姓名 / 手机号" disabled><span class="small faint">用户检索</span></div>' +
        '<div class="section-title">累计练习</div><div class="kv-list">' +
        '<div>累计练习</div><div>' + days.length + ' 天</div>' +
        '<div>练习时长</div><div>' + dur(totalD) + '</div>' +
        '<div>练习次数</div><div>' + totalS + ' 次</div>' +
        '<div>练习题数</div><div>' + totalQ + ' 道</div>' +
        '<div>练习题库</div><div>' + bankCount + ' 个</div>' +
        '<div>正确率</div><div>' + pct(totalQ ? totalC / totalQ * 100 : 0) + '</div>' +
        '</div></div>';
    }
    return h;
  };

  /* ================= 考试管理 ① 新增考试（三步向导） ================= */
  function wiz(step) {
    const labels = ['创建考试', '试题设置', '考试设置'];
    return '<div class="wiz">' + labels.map((l, i) =>
      '<div class="wiz-node' + (i + 1 <= step ? ' done' : '') + '"><div class="circle">' + (i + 1) + '</div><div class="cap">' + l + '</div></div>'
    ).join('') + '</div>';
  }
  function fInput(key, value, placeholder, type) {
    return '<input type="' + (type || 'text') + '" data-exam-field="' + key + '" value="' + e(value) + '" placeholder="' + e(placeholder || '') + '">';
  }
  function formLine(label, control, required, hint) {
    return '<div class="form-line"><div class="fl' + (required ? ' req' : '') + '">' + e(label) + '</div><div class="fc">' + control +
      (hint ? '<div class="hint">' + e(hint) + '</div>' : '') + '</div></div>';
  }
  function secH(title) { return '<div class="sec-block"><div class="sec-h">' + e(title) + '</div>'; }
  function examStep1() {
    const f = S.exam.form;
    let h = wiz(1) + '<div class="blank-panel"><div class="form-sec">';
    h += formLine('试卷名称', fInput('name', f.name, '请输入考试名称'), true);
    h += formLine('考试说明', '<textarea style="min-height:62px" data-exam-field="desc" placeholder="请输入考试说明">' + e(f.desc) + '</textarea>');
    h += formLine('试题类型', radios('ex-type', ['模拟考试', '每日一练', '知识测验', '有奖答题'], f.type, 'exam-radio'));
    h += formLine('考试资格', radios('ex-qualify', ['所有人都可以考试', '指定考生', '微信授权实名'], f.qualify, 'exam-radio'), true);
    h += '<div class="form-line"><div class="fl">配置登录方式</div><div class="fc">' +
      tbl(['名称', '提示语', '操作'], [
        ['<span style="color:#25a35a">●</span> 姓名 *', '<span class="faint">请输入内容姓名</span>', ops([todo('编辑'), todo('下载'), todo('删除', true)])],
        ['<span style="color:#25a35a">●</span> 手机号 *', '<span class="faint">请输入内容手机号</span>', ops([todo('编辑'), todo('上移'), todo('删除', true)])]
      ]) + '<button class="btn btn-sm btn-c-soft" style="margin-top:10px" data-action="exam-add-field">+ 添加信息填写项</button></div></div>';
    h += formLine('考试时间', '<div class="row" style="flex-wrap:nowrap">' + fInput('start', f.start, '开始时间', 'text') + '<span class="faint">至</span>' + fInput('end', f.end, '结束时间', 'text') + '</div>');
    h += formLine('考试时长', '<div class="row" style="flex-wrap:nowrap"><input type="number" class="num-input" data-exam-field="duration" value="' + e(f.duration) + '"><span class="small muted">分钟</span>' +
      '<label class="check" style="margin-left:14px"><input type="checkbox" data-exam-field="allowLate"' + (f.allowLate ? ' checked' : '') + '> 允许在考试规定时间外答题</label></div>', true);
    h += formLine('及格分数', '<div class="row" style="flex-wrap:nowrap"><input type="number" class="num-input" data-exam-field="pass" value="' + e(f.pass) + '"><span class="small muted">分</span></div>', true);
    h += '</div></div><div class="row" style="justify-content:center"><button class="btn btn-primary" data-action="exam-step" data-value="2">下一步 →</button></div>';
    return h;
  }
  function examStep2() {
    const f = S.exam.form, ex = S.exam;
    const banks = (store.banks && store.banks()) || [];
    let h = wiz(2) + '<div class="blank-panel"><div class="form-sec">';
    h += formLine('组卷方式', radios('ex-method', ['随机选题', '顺序选题', '章节选题', '手动选题'], f.method || '随机选题', 'exam-radio'));
    h += '<div class="form-line"><div class="fl req">选择题库</div><div class="fc">' +
      '<button class="btn btn-sm btn-c-soft" data-action="exam-pick-banks">选择题库</button> ' +
      '<span class="small muted">已选择 ' + ex.selectedBanks.length + ' 个题库</span>' +
      (ex.picking ? '<div style="margin-top:10px;border:1px solid var(--border);border-radius:8px;padding:10px">' +
        (banks.length ? banks.map(b => {
          const id = b.bank_id || b.id || '';
          return '<label class="check" style="display:flex;margin:5px 0"><input type="checkbox" data-action="exam-bank-toggle" data-id="' + e(id) + '"' +
            (ex.selectedBanks.indexOf(id) >= 0 ? ' checked' : '') + '> ' + e(b.name) + '（' + (store.questionCount ? store.questionCount(id) : 0) + ' 题）</label>';
        }).join('') : '<div class="small faint">暂无题库</div>') + '</div>' : '') +
      '</div></div>';
    h += formLine('抽题设置', sw(ex.byType, 'exam-switch', 'byType', false, ''), false, '开启后按题型设置抽题数量与每题分值');
    h += formLine('试题数量', sw(ex.byBank, 'exam-switch', 'byBank', false, ''), true, '开启后按题库设置抽题数量与每题分值');
    h += formLine('千人千卷', sw(ex.thousand, 'exam-switch', 'thousand', false, ''), false, '开启后，每个考生将看到不同的试题，可规避考生作弊。关闭时，使用同一份试卷进行考试');

    if (ex.byType) {
      h += secH('试题数量（按题型）');
      const types = [['单选题', 'single'], ['多选题', 'multiple'], ['判断题', 'judge']];
      h += tbl(['题型', '抽题数量', '每题分值', '合计分值'], types.map(t => {
        const cnt = store.state().questions.filter(q => q.type === t[1]).length;
        return [t[0], '<input type="number" class="num-input" value="0" data-action="nav-todo"> <span class="faint">/ ' + cnt + ' 道</span>',
          '<input type="number" class="num-input" value="1.00"> <span class="faint">分</span>', '<span class="faint">0.00 分</span>'];
      }).concat([['<b>总计</b>', '0 题', '—', '<b>总分 0.00 分</b>']])) + '</div>';
    }
    if (ex.byBank) {
      h += secH('试题数量（按题库）');
      const chosen = ex.selectedBanks.length ? ex.selectedBanks : banks.slice(0, 1).map(b => b.bank_id || b.id || '');
      h += (chosen.length ? chosen.map(id =>
        '<div style="border:1px solid var(--border);border-radius:8px;margin-bottom:10px;padding:10px 12px">' +
        '<div class="small muted" style="margin-bottom:8px">单选题 · 已抽 0 题 · 合计分值 0 分</div>' +
        tbl(['题库名称', '抽题题数', '每题分值', '操作'], [[e(bankName(id)),
          '<input type="number" class="num-input" value="0"> <span class="faint">/ ' + countInBanks(store.state().questions, id) + '</span>',
          '<input type="number" class="num-input" value="1.00"> <span class="faint">分</span>', todo('删除', true)]]) + '</div>'
      ).join('') : '<div class="small faint">请先选择题库</div>');
      h += '<div class="small muted">试题共 0 题，总分 0 分。</div></div>';
    }
    h += '</div></div><div class="row" style="justify-content:center;gap:10px">' +
      '<button class="btn" data-action="exam-step" data-value="1">← 上一步</button>' +
      '<button class="btn btn-primary" data-action="exam-step" data-value="3">下一步 →</button></div>';
    return h;
  }
  function examStep3() {
    const f = S.exam.form;
    let h = wiz(3);
    h += '<div class="notice-bar">⚠ 考试配置建议：建议设置考试起止时间规范考生。考试中请勿刷新或修改考试结果。<button class="x" data-action="nav-todo">×</button></div>';
    h += '<div class="blank-panel">' + secH('考试信息') + '<div class="kv-list">' +
      '<div>试卷名称</div><div>' + e(f.name || '未填写') + '</div>' +
      '<div>试题类型</div><div>' + e(f.type) + '</div>' +
      '<div>考试时长</div><div>' + e(f.duration) + ' 分钟</div>' +
      '<div>及格分数</div><div>' + e(f.pass) + ' 分</div>' +
      '<div>组卷方式</div><div>' + e(f.method || '随机选题') + ' · 已选 ' + S.exam.selectedBanks.length + ' 个题库</div>' +
      '</div></div>';
    h += '</div>' + secH('考试规则') + '<div class="small muted">' +
      '<label class="check" style="display:block;margin:4px 0"><input type="checkbox" disabled checked> 允许查看答案解析</label>' +
      '<label class="check" style="display:block;margin:4px 0"><input type="checkbox" disabled> 试题乱序</label>' +
      '<label class="check" style="display:block;margin:4px 0"><input type="checkbox" disabled> 选项乱序</label>' +
      '<label class="check" style="display:block;margin:4px 0"><input type="checkbox" disabled checked> 交卷后允许查看成绩</label>' +
      '</div></div>';
    h += secH('考试封面') + '<div class="row" style="gap:14px"><div class="cover-thumb">▤</div>' +
      '<div><button class="btn btn-sm" data-action="nav-todo">编辑封面</button><div class="hint" style="margin-top:6px">封面上传暂未开放。</div></div></div></div>';
    h += secH('考试须知') + '<div class="notice-bar">⚠ 请在规定时间内完成作答，交卷后将无法修改。 <button class="btn-link" data-action="nav-todo">查看注意事项</button></div>' +
      '<div class="small muted" style="line-height:2">考试说明：' + e(f.desc || '—') + '<br>考试资格：' + e(f.qualify) +
      '<br>考试时间：' + e(f.start || '—') + ' 至 ' + e(f.end || '—') + '<br>登录信息项：姓名、手机号</div></div>';
    h += secH('考试方式') + '<div class="way-cards">' +
      '<div class="way-card"><div class="wt">电脑端考试</div><div class="qr">考试链接</div><button class="btn btn-sm btn-c-soft" data-action="nav-todo">复制链接</button> <button class="btn-link" data-action="nav-todo">预览考试</button></div>' +
      '<div class="way-card"><div class="wt">手机端考试</div><div class="qr">二维码</div><button class="btn btn-sm btn-c-soft" data-action="nav-todo">复制链接</button> <button class="btn-link" data-action="nav-todo">预览考试</button></div>' +
      '</div></div>';
    h += secH('考试人数') + '<div class="row" style="max-width:430px"><input type="number" class="num-input" data-exam-field="people" value="' + e(f.people) + '"><span class="small muted">参考考试人数 / 限制考试人数</span>' +
      '<button class="btn btn-sm btn-c-orange" data-action="nav-todo">开始练习</button></div><div class="hint" style="margin-top:8px">单人考试人数：一场考试可以参加考试的人数，即应参考考生人数，包含了已有考生，限制可参加考试的人数。</div></div>';
    h += secH('考试设置') + '<div class="small muted">及格分数 ' + e(f.pass) + ' 分 · 评分设置 · 成绩显示 · 主题背景等 <button class="btn btn-sm btn-c-soft" data-action="exam-step" data-value="1">编辑</button></div></div>';
    h += secH('附件设置') + '<div class="small muted">考试附件 <button class="btn btn-sm btn-c-soft" data-action="nav-todo">云视频</button></div></div>';
    h += '<div class="row" style="gap:10px"><button class="btn" data-action="exam-step" data-value="2">← 上一步</button>' +
      '<button class="btn btn-primary" data-action="exam-finish">完成考试创建</button></div>';
    return h;
  }
  P.examNew = function () {
    const step = S.exam.step;
    return (step === 1 ? examStep1() : step === 2 ? examStep2() : examStep3()) +
      '<div class="small faint" style="margin-top:14px">向导三步对应截图的创建考试 / 试题设置 / 考试设置；考试数据仅保存在本机，不产生任何示例考试。</div>';
  };

  /* ================= 考试管理 ② 考试历史 ================= */
  P.examHistory = function () {
    const kw = String(S.examHistory.kw || '').trim();
    const list = exams().filter(x => !kw || String(x.name || '').indexOf(kw) >= 0);
    let h = '<div class="notice-bar info">✦ 智能生成解析：可围绕试卷解析思路、试题分析、帮助考生巩固知识点、快速掌握。 <button class="btn-link" data-action="ai-go-settings">去看看</button><button class="x" data-action="nav-todo">×</button></div>';
    h += tabs('examHistory', [['list', '考试列表'], ['batchDel', '批量删除考试'], ['batchExport', '批量导出']]);
    h += '<div class="blank-panel pad-0"><div class="toolbar" style="padding:14px 16px">' +
      '<a class="btn btn-sm btn-c-blue" href="#/examNew">+ 新增考试</a><span class="grow"></span>' +
      '<input type="text" class="tb-search" id="examhis-kw" placeholder="输入考试名称" value="' + e(kw) + '">' +
      '<button class="btn btn-sm" data-action="nav-search-go" data-target="examHistory">⌕</button></div>';
    h += '<div style="padding:0 16px 16px">';
    const rows = list.map((x, i) => [
      '<input type="checkbox" class="nb-ck">', String(i + 1), e(x.name), e(x.total_score || '0.00'), e(x.duration) + ' 分钟',
      String(x.people || 0), fmt(x.created_at),
      sw(x.enabled !== false, 'exam-status', x.exam_id, false, ''),
      '<div class="dropdown">' + ops(['<button class="btn-link" data-action="exam-view" data-id="' + e(x.exam_id) + '">查看</button>', todo('编辑'), todo('链接'), todo('成绩'),
        '<button class="btn-link" data-action="nav-menu" data-menu="examHistory">显示</button>']) +
        '<div class="dropdown-menu' + (S.examHistory.menu ? ' open' : '') + '" style="left:auto;right:0">' +
        ['考试记录', '统计', '编辑记录', '导出考生', '复制考试'].map(t => '<button data-action="nav-todo">' + t + '</button>').join('') +
        '<button data-action="nav-todo" style="color:var(--danger)">删除考试</button></div></div>'
    ]);
    h += tbl(['<input type="checkbox" data-action="nav-check-all" data-target="nb-ck">', '编号', '考试名称', '总分', '考试时长', '考试人数', '更新时间', '状态', '操作'], rows,
      '还没有考试，点击「新增考试」创建');
    h += '</div></div>';
    return h;
  };

  /* ================= 一级预留页 ================= */
  function reservePage(title, desc) {
    return reserve(title + '为暂未开放的一级入口，此次更新只优化布局，未设置任何功能。') +
      '<div class="blank-panel"><div class="panel-h">' + e(title) + '</div>' +
      '<p class="small muted" style="margin:0 0 16px">' + e(desc) + '</p>' +
      '<div class="quick-links"><a href="#/dashboard">← 返回首页</a><a href="#/mybanks">前往题库中心</a><a href="#/examNew">前往考试管理</a></div></div>';
  }
  /* v1.11.0：资料库由 js/library.js 覆盖为真实上传 / 预览 / 下载页；此处仅作模块未加载时的兜底 */
  P.library = function () { return (Quiz.library && Quiz.library.html) ? Quiz.library.html() : reservePage('资料库', '上传与管理学习资料。'); };
  /* v1.6.0：群组功能已启用；模块未加载时仍回退到预留说明，保持向后兼容 */
  P.groups = function () {
    return (Quiz.groups && Quiz.groups.html) ? Quiz.groups.html()
      : reservePage('我的群组', '创建 / 加入群组、共享题库与组织练习。');
  };

  /* ================= 账户中心（本地账号 + 密码，其余扩展字段仍预留） ================= */
  const ACC = '<div class="notice-bar info">账号数据按账号隔离保存，可在「数据与设置」导出或导入备份。</div>';
  const DIS = 'disabled';
  function dLine(label, control, required) {
    return '<div class="form-line"><div class="fl' + (required ? ' req' : '') + '">' + e(label) + '</div><div class="fc">' + control + '</div></div>';
  }
  P.account = function () {
    const t = S.tabs.account;
    let h = ACC + tabs('account', [['info', '账号信息'], ['pwd', '修改密码'], ['phone', '修改绑定手机'], ['cancel', '账号注销']]);
    if (t === 'info') {
      h += '<div class="small faint" style="margin:14px 0 8px">以下为账号扩展字段，暂不启用。</div>';
    }
    h += '<div class="blank-panel disabled-form">';
    if (t === 'info') {
      h += '<div class="panel-h">账号信息</div><div class="form-sec">' +
        dLine('昵称', '<input type="text" ' + DIS + ' placeholder="请输入昵称">', true) +
        dLine('一句话介绍', '<textarea ' + DIS + ' placeholder="输入个人一句话介绍"></textarea>') +
        dLine('账号', '<div class="small muted">— <button class="btn-link" ' + DIS + '>查看记录</button></div>') +
        dLine('性别', '<div class="small muted">—</div>') +
        dLine('UID', '<div class="small muted">—</div>') +
        dLine('会员', '<div class="small muted">— <button class="btn btn-sm btn-c-soft" ' + DIS + '>续费</button></div>') +
        '<div class="form-line"><div class="fl"></div><div class="fc"><button class="btn btn-c-blue" ' + DIS + '>保存</button></div></div></div>';
    } else if (t === 'pwd') {
      h += '<div class="panel-h">修改密码</div><div class="form-sec">' +
        dLine('原密码', '<input type="password" ' + DIS + ' placeholder="请输入原密码">', true) +
        dLine('新密码', '<input type="password" ' + DIS + ' placeholder="请输入新密码">', true) +
        dLine('确认密码', '<input type="password" ' + DIS + ' placeholder="请再次输入新密码">') +
        '<div class="form-line"><div class="fl"></div><div class="fc"><button class="btn btn-c-blue" ' + DIS + '>保存</button></div></div></div>';
    } else if (t === 'phone') {
      h += '<div class="panel-h">修改绑定手机</div><div class="form-sec">' +
        '<p class="small muted" style="margin:0 0 14px">修改绑定手机后，需使用新的手机号/验证码登录，下次登录时须使用新手机号登录。</p>' +
        dLine('当前手机号码', '<div class="small muted">—</div>') +
        dLine('登录密码', '<input type="password" ' + DIS + ' placeholder="请输入登录密码"> <button class="btn-link" ' + DIS + '>获取验证码</button>') +
        dLine('', '<button class="btn-link" ' + DIS + '>获取短信验证</button>') +
        '<div class="form-line"><div class="fl"></div><div class="fc"><button class="btn btn-c-blue" ' + DIS + '>保存</button></div></div></div>';
    } else {
      h += '<div class="panel-h">账号注销</div><div class="form-sec">' +
        '<p class="small muted" style="margin:0 0 14px">注销后，账号下所有信息/考试记录将被全部清除，账号也将无法恢复，请谨慎操作。</p>' +
        dLine('登录密码', '<input type="password" ' + DIS + ' placeholder="请输入登录密码">', true) +
        dLine('输入图形', '<input type="text" ' + DIS + ' placeholder="请输入 9632 所示内容">') +
        '<div class="form-line"><div class="fl"></div><div class="fc"><button class="btn btn-c-blue" ' + DIS + '>保存</button></div></div></div>';
    }
    return h + '</div>';
  };
  P.orders = function () {
    return ACC + '<div class="blank-panel"><div class="panel-h">订单列表 <button class="btn-link" style="float:right" data-action="nav-todo">常见问题</button></div>' +
      tbl(['编号', '订单号', '商品名称', '数量', '作者', '购买时间', '支付金额', '支付方式', '状态', '操作'], [], '暂无订单') +
      '</div>';
  };
  P.reports = function () {
    return ACC + '<div class="blank-panel pad-0">' +
      '<div class="table-wrap"><table class="tbl"><thead><tr>' +
      ['编号', '题库', '问题类型', '报错时间', '联系方式', '问题描述', '错误截图', '状态', '操作'].map(c => '<th>' + c + '</th>').join('') +
      '</tr></thead></table></div>' + emptyBox('还没有数据', '▤') + '</div>';
  };
  P.messages = function () {
    /* v1.11.0：由 js/admin.js 覆盖为管理员通知列表；此处保留兜底 */
    if (Quiz.admin && Quiz.admin.messagesHtml) return Quiz.admin.messagesHtml();
    return '<div class="blank-panel"><div class="panel-h">消息通知</div><div class="empty"><span class="e-icon">▤</span>暂无通知</div></div>';
  };
  P.downloads = function () {
    return ACC + '<div class="blank-panel pad-0">' +
      '<div class="table-wrap"><table class="tbl"><thead><tr>' +
      ['编号', '文档名称', '创建时间', '文档大小', '文档类型', '操作'].map(c => '<th>' + c + '</th>').join('') +
      '</tr></thead></table></div>' + emptyBox('暂无下载', '▤') + '</div>';
  };
  P.trash = function () {
    const t = S.tabs.trash;
    let h = ACC + tabs('trash', [['bank', '题库'], ['exam', '考试']]);
    const cols = t === 'bank'
      ? ['编号', '名称', '删除时间', '单行数据', '操作']
      : ['编号', '考试名称', '总分', '考试时长', '考试人数', '开始时间', '结束时间', '操作'];
    h += '<div class="blank-panel pad-0"><div class="table-wrap"><table class="tbl"><thead><tr>' +
      cols.map(c => '<th>' + c + '</th>').join('') + '</tr></thead></table></div>' +
      emptyBox('回收站为空', '♲') +
      '<div class="pager">共 0 条 <button ' + DIS + '>‹</button><button class="on">1</button><button ' + DIS + '>›</button> 10 条/页</div></div>';
    return h;
  };

  /* 供自测与核查使用 */
  Quiz.navPages = {state: S, helpers: {tbl, tabs, reserve, fmt, weekBars, exams}};
})(typeof window !== 'undefined' ? window : globalThis);
