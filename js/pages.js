/* 视图层：所有页面渲染函数，输出 HTML 字符串，事件由 app.js 委托处理 */
(function (global) {
  const Quiz = global.Quiz = global.Quiz || {};
  const esc = Quiz.util.esc, fmt = Quiz.util.fmt, fmtDur = Quiz.util.fmtDur, pct = Quiz.util.pct;
  const TYPE_LABEL = Quiz.scorer.TYPE_LABEL, STATUS_LABEL = Quiz.scorer.STATUS_LABEL;
  const MODE_LABEL = {normal:'普通练习', wrong_review:'错题重刷', favorite:'收藏练习', exam:'考试模式'};
  const STATUS_BADGE = {correct:'b-green', partial:'b-orange', wrong:'b-red', unanswered:'b-gray'};
  const TYPE_BADGE = {single:'b-blue', multiple:'b-purple', judge:'b-green'};

  const card = (title, hint, body, extra) =>
    '<section class="card"><h2>' + title + '</h2>' + (hint ? '<p class="hint">' + hint + '</p>' : '') + body + (extra || '') + '</section>';
  const kpi = (label, value, sub, accent) =>
    '<div class="kpi' + (accent ? ' accent' : '') + '"><div class="k-label">' + label + '</div><div class="k-value">' + value + '</div><div class="k-sub">' + (sub || '') + '</div></div>';
  const empty = (text, icon) => '<div class="empty"><span class="e-icon">' + (icon || '▤') + '</span>' + text + '</div>';
  const badge = (text, cls) => '<span class="badge ' + cls + '">' + esc(text) + '</span>';
  const typeBadge = t => badge(TYPE_LABEL[t] || t, TYPE_BADGE[t] || 'b-gray');
  const statusBadge = s => badge(STATUS_LABEL[s] || s, STATUS_BADGE[s] || 'b-gray');
  const opts = (arr, cur, placeholder) => (placeholder ? '<option value="">' + placeholder + '</option>' : '') +
    arr.map(o => { const v = typeof o === 'object' ? o.v : o, l = typeof o === 'object' ? o.l : o;
      return '<option value="' + esc(v) + '"' + (String(cur) === String(v) ? ' selected' : '') + '>' + esc(l) + '</option>'; }).join('');
  const selHtml = (id, action, arr, cur, placeholder) =>
    '<select id="' + id + '" data-action="' + action + '">' + opts(arr, cur, placeholder) + '</select>';
  const diffLabel = d => ['', '很容易', '容易', '中等', '较难', '很难'][d] || String(d);
  /* 统一的 AI 讲解入口：只带题目 ID，由 app.js 解析题库题目或历史快照 */
  const aiLink = id => '<span class="link" data-action="ai-explain" data-id="' + esc(id) + '">✦ AI 讲解</span>';
  const answerText = q => q.type === 'judge' ? (q.answer.value ? '正确' : '错误') : (q.answer.keys || []).join('、');
  const userAnswerText = r => {
    if (r.question_snapshot.type === 'judge') return r.user_answer === true ? '正确' : (r.user_answer === false ? '错误' : '未作答');
    return (r.normalized_answer || []).join('、') || '未作答';
  };

  function distinct(s, field) {
    const set = new Set();
    s.questions.forEach(q => {
      if (field === 'category') set.add((q.category || []).join('/'));
      else if (field === 'tags') (q.tags || []).forEach(t => set.add(t));
      else if (field === 'difficulty') set.add(String(q.difficulty));
    });
    return Array.from(set).filter(Boolean).sort();
  }

  const P = Quiz.pages = {};

  /* ---------------- 概览 ---------------- */
  P.dashboard = function (app) {
    const s = Quiz.store.state();
    const a = Quiz.scorer.aggregate(s.records);
    const pending = s.wrong.filter(w => !w.mastered).length;
    const typeCount = Object.keys(TYPE_LABEL).map(t => ({label: TYPE_LABEL[t].replace('题',''), value: s.questions.filter(q => q.type === t).length}));
    const recent = s.sessions.slice(-5).reverse();
    let h = '<div class="grid g4">' +
      kpi('题库题目', s.questions.length, '已发布 ' + s.questions.filter(q => q.status === 'published').length + ' 题', true) +
      kpi('练习次数', s.sessions.length, '累计作答 ' + s.records.length + ' 题') +
      kpi('平均正确率', pct(a.accuracy * 100), '按 correct 题数 / 作答题数') +
      kpi('待攻克错题', pending, '掌握 ' + s.wrong.filter(w => w.mastered).length + ' 题') +
      '</div>';

    h += card('快速开始', '四种练习来源，均走同一判分引擎', '<div class="row">' +
      '<button class="btn btn-primary" data-action="quick" data-mode="normal">▶ 普通练习</button>' +
      '<button class="btn" data-action="quick" data-mode="wrong_review">↻ 错题重刷</button>' +
      '<button class="btn" data-action="quick" data-mode="favorite">☆ 收藏练习</button>' +
      '<button class="btn" data-action="quick" data-mode="exam">▤ 考试模式</button>' +
      '<span class="spacer"></span><a class="link" href="#/import">导入题目 →</a></div>');

    h += '<div class="grid g2">' +
      card('题型分布', '按当前题库统计', '<div class="chart-box">' + Quiz.charts.barChart(typeCount, {suffix:' 题'}) + '</div>');
    const lastDays = app.last7Accuracy();
    h += card('近 7 日正确率', '无练习数据的日期不计入', '<div class="chart-box">' + Quiz.charts.lineChart(lastDays) + '</div>') + '</div>';

    h += card('最近练习', '交卷后自动归档，点击可下钻到逐题明细',
      recent.length ? '<div class="table-wrap"><table><thead><tr><th>时间</th><th>模式</th><th>题数</th><th>正确率</th><th>得分率</th><th>用时</th><th></th></tr></thead><tbody>' +
        recent.map(x => '<tr><td class="nowrap">' + fmt(x.started_at) + '</td><td>' + badge(MODE_LABEL[x.mode] || x.mode, 'b-blue') + '</td><td>' + x.question_count + '</td><td>' + pct(x.accuracy*100) + '</td><td>' + pct(x.score_rate*100) + '</td><td>' + fmtDur(x.duration_ms) + '</td><td><span class="link" data-action="records-detail" data-id="' + x.session_id + '">查看明细</span></td></tr>').join('') +
        '</tbody></table></div>' : empty('还没有练习记录，先从「普通练习」开始', '◷'));
    return h;
  };

  /* ---------------- 统计 ---------------- */
  P.stats = function (app) {
    const s = Quiz.store.state(), ui = app.ui.stats;
    const r = app.computeStats();
    const cats = distinct(s, 'category');
    let h = card('统计维度', '正确率只统计 correct；得分率含 partial 部分得分；两者口径不同',
      '<div class="filters">' +
      '<label class="field">时间范围' + selHtml('st-range', 'stats-filter', [{v:'all',l:'全部'},{v:'7',l:'近 7 天'},{v:'30',l:'近 30 天'}], ui.range) + '</label>' +
      '<label class="field">分类' + selHtml('st-cat', 'stats-filter', cats.map(c => ({v:c,l:c})), ui.category, '全部分类') + '</label>' +
      '<label class="field">题型' + selHtml('st-type', 'stats-filter', Object.keys(TYPE_LABEL).map(t => ({v:t,l:TYPE_LABEL[t]})), ui.type, '全部题型') + '</label>' +
      '</div>');

    const a = Quiz.scorer.aggregate(r.records);
    h += '<div class="grid g4">' +
      kpi('练习次数', r.sessions.length, '筛选后会话数', true) +
      kpi('作答题数', a.question_count - a.counts.unanswered, '含 ' + a.counts.partial + ' 题部分得分') +
      kpi('正确率', pct(a.accuracy*100), '得分率 ' + pct(a.score_rate*100)) +
      kpi('平均单题用时', fmtDur(a.question_count ? a.duration_ms / a.question_count : 0), '总用时 ' + fmtDur(a.duration_ms)) +
      '</div>';

    const byType = Object.keys(TYPE_LABEL).map(t => {
      const rs = r.records.filter(x => x.type === t), ag = Quiz.scorer.aggregate(rs);
      return {label: TYPE_LABEL[t].replace('题',''), value: +(ag.accuracy*100).toFixed(1), display: pct(ag.accuracy*100), color: t === 'judge' ? Quiz.charts.COLORS.GREEN : (t === 'multiple' ? Quiz.charts.COLORS.ORANGE : Quiz.charts.COLORS.BLUE)};
    });
    const catRows = cats.map(c => {
      const rs = r.records.filter(x => (x.question_snapshot.category || []).join('/') === c);
      const ag = Quiz.scorer.aggregate(rs);
      return {c, n: rs.length, ag};
    }).filter(x => x.n);
    const byCat = catRows.map(x => ({label: x.c.split('/').pop(), value: x.n, display: x.n + ' 题'}));
    const days = app.dailyAccuracy(r.records);

    h += '<div class="grid g2">' +
      card('各题型正确率', '单位 %，按 correct 题数计算', '<div class="chart-box">' + Quiz.charts.barChart(byType, {suffix:'%'}) + '</div>') +
      card('各分类作答量', '单位：题', '<div class="chart-box">' + Quiz.charts.barChart(byCat, {suffix:' 题'}) + '</div>') +
      '</div>';
    h += card('每日正确率趋势', '仅显示有作答记录的日期（最多 14 个）', '<div class="chart-box">' + Quiz.charts.lineChart(days) + '</div>');

    h += card('明细聚合', '按分类展开，可核对每个维度',
      catRows.length ? '<div class="table-wrap"><table><thead><tr><th>分类</th><th>题数</th><th>正确</th><th>部分</th><th>错误</th><th>未答</th><th>正确率</th><th>得分率</th><th>平均用时</th></tr></thead><tbody>' +
        catRows.map(x => '<tr><td>' + esc(x.c) + '</td><td>' + x.n + '</td><td>' + x.ag.counts.correct + '</td><td>' + x.ag.counts.partial + '</td><td>' + x.ag.counts.wrong + '</td><td>' + x.ag.counts.unanswered + '</td><td>' + pct(x.ag.accuracy*100) + '</td><td>' + pct(x.ag.score_rate*100) + '</td><td>' + fmtDur(x.n ? x.ag.duration_ms/x.n : 0) + '</td></tr>').join('') +
        '</tbody></table></div>' : empty('当前筛选下暂无作答数据', '◷'));
    return h;
  };

  /* ---------------- 文档导入 ---------------- */
  P.import = function (app) {
    const ui = app.ui.imp;

    let h = card('标准导入模板', '考试宝 Excel / Word 模板：Excel 首行为填写说明、第二行为表头；Word 按题号 / 选项 / 答案分行书写',
      '<div class="row" style="margin-bottom:12px">' +
      '<button class="btn btn-primary btn-sm" data-action="import-download-xlsx">下载 Excel 模板</button>' +
      '<button class="btn btn-sm" data-action="import-download-docx">下载 Word 模板</button></div>' +
      '<p class="small muted" style="margin:0">模板内已含填写说明与示例题。支持中文表头、章节、难度与最多 8 个选项；仅单选 / 多选 / 判断可入库，填空题、问答题等自动跳过并在解析时提示。也支持 CSV / TSV 与从 Excel / Word 表格直接粘贴。</p>' +
      '<p class="small faint" style="margin:8px 0 0">新旧格式同时支持：<b>.xlsx / .xls</b>（Excel 97-2003 BIFF）、<b>.docx / .doc</b>（Word 97-2003）、CSV / TSV；旧版二进制文件在本机直接解析，无需另存为，也无需上传到服务器。</p>');

    h += card('导入数据', 'Excel / Word 在本地解析为 CSV 后填入输入框供核对；默认整批原子，指纹重复进人工确认队列',
      '<div class="filters">' +
      '<label class="field">重复题目策略' + selHtml('imp-policy', 'imp-filter', [{v:'skip',l:'跳过（默认）'},{v:'overwrite',l:'覆盖并升版本'},{v:'new_version',l:'另存新版本'}], ui.policy) + '</label>' +
      '<label class="field">错误处理' + selHtml('imp-skip', 'imp-filter', [{v:'0',l:'整批原子（默认）'},{v:'1',l:'跳过错误行入库'}], ui.skipErrors) + '</label>' +
      '<label class="field">导入目标题库' + selHtml('imp-bank', 'imp-filter', Quiz.store.banks().map(b => ({v:b.bank_id, l:b.name})), ui.bankId || Quiz.store.defaultBankId()) + '</label>' +
      '<label class="field">选择文件（Excel / Word 新旧版 / CSV）<input type="file" id="imp-file" data-action="imp-file" accept=".xlsx,.xls,.docx,.doc,.csv,.tsv,.txt"></label>' +
      '</div>' +
      '<label class="field" style="margin-bottom:10px">粘贴内容（CSV / TSV，或从 Excel、Word 表格复制）<textarea id="imp-text" placeholder="question_id,type,stem,option_a,...">' + esc(ui.text || '') + '</textarea></label>' +
      '<div class="row"><button class="btn btn-primary" data-action="import-run">校验并导入</button>' +
      '<button class="btn btn-sm" data-action="import-review-open">打开文档导入校验页</button>' +
      '<button class="btn btn-sm" data-action="ai-parse">✦ 用 AI 解析文本</button>' +
      '<span class="small muted">Excel / Word（含 .xls / .doc）/ CSV 走本地解析，不依赖外部服务；AI 解析为可选兜底</span></div>' +
      '<p class="small faint" style="margin:10px 0 0">导入校验页可先选表单、选表头行、逐列匹配字段并预览前 8 条与格式检查结果，确认后再入库；不写入任何示例数据。规则解析只认表格。若粘贴的是「1. 题干…A. …答案：C」这类非表格文本，可点「用 AI 解析文本」转成标准 CSV 后填入输入框；结果仍需人工核对，并照常点「校验并导入」走 E001–E010 校验。单次最多发送 ' + Quiz.ai.MAX_BLOCK_CHARS + ' 字符，需先在「数据与设置 → AI 模型配置」启用模型。</p>');

    /* v1.4.1：表头错误单独给醒目诊断，避免只看到「没有可入库的新题目」 */
    if (ui.report && ui.report.header_diagnosis) {
      const d = ui.report.header_diagnosis;
      const L = {type:'题型 (type)', stem:'题干 (stem)', answer:'正确答案 (answer)'};
      h += '<section class="card imp-diag"><h2>为什么导入不了 · 表头诊断</h2>' +
        '<p class="hint">E001 表头校验未通过，整批未入库。必填列固定为：题型 type、题干 stem、正确答案 answer。</p>' +
        '<div class="report-row"><span>当前表头（' + d.headers.length + ' 列）</span><span class="mono">' + esc(d.headers.join(', ')) + '</span></div>' +
        '<div class="report-row"><span>缺少必填列</span><b class="imp-diag-bad">' + esc(d.missing.map(k => L[k] || k).join('、') || '无') + '</b></div>' +
        (d.unknown.length ? '<div class="report-row"><span>未识别的列</span><span class="mono">' + esc(d.unknown.join(', ')) + '</span></div>' : '') +
        '<div class="report-row"><span>数据行数</span><b>' + d.rows + '</b></div>' +
        '<p class="small" style="margin:10px 0">常见原因：源文件列名与模板不一致导致题干列被丢弃；或「正确答案：C」写在解析文本里而非独立列。下方按钮可先尝试修复，结果会回填输入框供核对。</p>' +
        '<div class="row"><button class="btn btn-primary btn-sm" data-action="import-repair">✦ 提取答案并补齐表头</button>' +
        '<button class="btn btn-sm" data-action="import-review-open">打开文档导入校验页逐列匹配</button>' +
        '<button class="btn btn-sm" data-action="import-download-xlsx">下载标准 Excel 模板</button></div>' +
        '<p class="small faint" style="margin:10px 0 0">修复只提取文本里明写的答案，绝不猜测题干。若源文件本身没有题干列，需用校验页把题干所在列映射到 stem，或按模板重填后再导入。</p></section>';
    }

    if (ui.report) {
      const r = ui.report;
      h += card('导入报告', r.atomic_rollback ? '存在 E 级错误且开启整批原子，已回滚，未写入任何题目' : '批次 ' + esc(ui.batchId || '') + ' 已完成',
        '<div class="grid g2"><div>' +
        '<div class="report-row"><span>总行数</span><b>' + r.total + '</b></div>' +
        '<div class="report-row"><span>入库</span><b style="color:var(--success)">' + r.inserted + '</b></div>' +
        '<div class="report-row"><span>按 ID 跳过</span><b>' + r.skipped + '</b></div>' +
        '<div class="report-row"><span>覆盖升版本</span><b>' + (r.overwritten || 0) + '</b></div>' +
        '<div class="report-row"><span>疑似重复（待确认）</span><b style="color:var(--warn)">' + r.duplicated + '</b></div>' +
        '<div class="report-row"><span>错误 / 警告</span><b style="color:var(--danger)">' + r.failed + ' / ' + (r.warnings || []).length + '</b></div>' +
        '</div><div><h3 style="margin-top:0">错误明细</h3>' +
        (r.errors.concat(r.warnings || []).length ?
          '<div class="err-list">' + r.errors.concat(r.warnings || []).map(e => '<div class="report-row"><span class="mono">行 ' + e.row + ' · ' + e.field + '</span><span>' + badge(e.code, e.code[0] === 'E' ? 'b-red' : 'b-orange') + ' ' + esc(e.message) + '</span></div>').join('') + '</div>' +
          '<button class="btn btn-sm" style="margin-top:10px" data-action="import-error-csv">下载错误明细 CSV</button>'
          : '<div class="small muted">无错误</div>') +
        '</div></div>');

      if (ui.review && ui.review.length) {
        h += card('疑似重复队列（E009）', '内容指纹与库内题目一致，默认不自动合并；确认后才入库',
          '<div class="table-wrap"><table><thead><tr><th>CSV 行</th><th>题干</th><th>匹配题目</th><th></th></tr></thead><tbody>' +
          ui.review.map((x, i) => '<tr><td>' + x.row + '</td><td class="ellip">' + esc(x.question.stem) + '</td><td class="mono">' + esc(x.match_id || '同批次') + '</td><td><button class="btn btn-sm" data-action="import-confirm-review" data-index="' + i + '">确认入库</button></td></tr>').join('') +
          '</tbody></table></div>');
      }
    }
    return h;
  };

  /* ---------------- 题库管理：① 选择题库 → ② 编辑该库试题 ---------------- */
  P.bank = function (app) {
    const s = Quiz.store.state(), ui = app.ui.bank;
    const bid = app.currentBankId();
    ui.bankId = bid;
    const cur = bid === Quiz.ALL_BANKS ? null : s.banks.find(b => b.bank_id === bid);
    const curName = bid === Quiz.ALL_BANKS ? '全部题库' : (cur ? cur.name : '默认题库');
    const rows = app.filterQuestions();
    const per = 15, pages = Math.max(1, Math.ceil(rows.length / per));
    ui.page = Math.min(Math.max(1, ui.page), pages);
    const slice = rows.slice((ui.page - 1) * per, ui.page * per);
    const cats = distinct({questions: rows}, 'category'), tags = distinct({questions: rows}, 'tags');
    const bankName = id => { const b = s.banks.find(x => x.bank_id === id); return b ? b.name : '默认题库'; };

    /* ① 题库选择 */
    const allCard = '<div class="bank-card' + (bid === Quiz.ALL_BANKS ? ' active' : '') + '" data-action="bank-select" data-id="' + Quiz.ALL_BANKS + '">' +
      '<div class="b-top"><span class="b-name">全部题库</span>' + badge('跨库', 'b-blue') + '</div>' +
      '<div class="b-count">' + s.questions.length + ' 题</div>' +
      '<div class="b-desc">查看并编辑所有题库中的试题（原有全局视图）</div></div>';
    const bankCards = s.banks.map(b =>
      '<div class="bank-card' + (bid === b.bank_id ? ' active' : '') + '" data-action="bank-select" data-id="' + esc(b.bank_id) + '">' +
      '<div class="b-top"><span class="b-name">' + esc(b.name) + '</span>' + (b.is_default ? badge('默认', 'b-green') : '') + '</div>' +
      '<div class="b-count">' + s.questions.filter(q => q.bank_id === b.bank_id).length + ' 题</div>' +
      '<div class="b-desc">' + esc(b.description || '（无描述）') + '</div></div>').join('');

    let h = card('① 选择题库', '先选定一个题库，下方筛选、编辑与批量维护仅作用于该库；编辑题目时可改「所属题库」跨库移动',
      '<div class="bank-grid">' + allCard + bankCards + '</div>' +
      '<div class="row" style="margin-top:12px">' +
      '<button class="btn btn-primary btn-sm" data-action="bank-create">+ 新建题库</button>' +
      (bid !== Quiz.ALL_BANKS ? '<button class="btn btn-sm" data-action="bank-rename">重命名当前题库</button>' : '') +
      (cur && !cur.is_default ? '<button class="btn btn-danger btn-sm" data-action="bank-remove">删除当前题库（题目迁回默认库）</button>' : '') +
      '<span class="spacer"></span><span class="small muted">当前：<b>' + esc(curName) + '</b> · 共 ' + s.banks.length + ' 个题库</span></div>');

    /* ② 当前题库的筛选与批量维护 */
    h += card('② 筛选与批量维护 · ' + esc(curName), '仅 published 题目可被抽取进入练习；批量操作只作用于当前勾选的本题库题目',
      '<div class="filters">' +
      '<label class="field">关键词<input type="text" id="bank-kw" value="' + esc(ui.kw) + '" placeholder="题干 / ID / 标签"></label>' +
      '<label class="field">分类' + selHtml('bank-cat', 'bank-filter', cats.map(c => ({v:c,l:c})), ui.category, '全部分类') + '</label>' +
      '<label class="field">题型' + selHtml('bank-type', 'bank-filter', Object.keys(TYPE_LABEL).map(t => ({v:t,l:TYPE_LABEL[t]})), ui.type, '全部题型') + '</label>' +
      '<label class="field">难度' + selHtml('bank-diff', 'bank-filter', [1,2,3,4,5].map(d => ({v:d,l:diffLabel(d)})), ui.difficulty, '全部难度') + '</label>' +
      '<label class="field">状态' + selHtml('bank-status', 'bank-filter', [{v:'published',l:'已发布'},{v:'draft',l:'草稿'},{v:'disabled',l:'已停用'}], ui.status, '全部状态') + '</label>' +
      '<label class="field">标签' + selHtml('bank-tag', 'bank-filter', tags.map(t => ({v:t,l:t})), ui.tag, '全部标签') + '</label>' +
      '</div><div class="row"><button class="btn btn-primary btn-sm" data-action="bank-search">搜索</button>' +
      '<button class="btn btn-sm" data-action="bank-add">+ 新增题目</button>' +
      '<button class="btn btn-sm" data-action="bg-open">▦ 表格编辑本题库试题</button>' +
      '<span class="spacer"></span>' +
      '<button class="btn btn-sm" data-action="bank-batch" data-op="published">批量发布</button>' +
      '<button class="btn btn-sm" data-action="bank-batch" data-op="disabled">批量停用</button>' +
      '<label class="field" style="min-width:150px;margin:0">移动到' + selHtml('bank-move-to', '', s.banks.map(b => ({v:b.bank_id, l:b.name})), bid === Quiz.ALL_BANKS ? Quiz.store.defaultBankId() : bid) + '</label>' +
      '<button class="btn btn-sm" data-action="bank-move">批量移动</button>' +
      '<button class="btn btn-danger btn-sm" data-action="bank-batch" data-op="delete">批量删除</button></div>');

    h += card('题目列表 · ' + esc(curName), '共 ' + rows.length + ' 题 · 第 ' + ui.page + '/' + pages + ' 页',
      slice.length ? '<div class="table-wrap"><table><thead><tr><th style="width:28px"><input type="checkbox" data-action="bank-check-all"></th><th>ID / 题干</th>' +
        (bid === Quiz.ALL_BANKS ? '<th>所属题库</th>' : '') +
        '<th>题型</th><th>分类</th><th>难度</th><th>分值</th><th>状态</th><th>操作</th></tr></thead><tbody>' +
        slice.map(q => '<tr><td><input type="checkbox" class="bank-ck" value="' + esc(q.question_id) + '"></td>' +
          '<td><div class="mono faint">' + esc(q.question_id) + ' <span class="faint">v' + (q.version||1) + '</span></div><div class="ellip" style="max-width:360px">' + esc(q.stem) + '</div><div class="small faint">' + (q.tags||[]).map(t => '<span class="tag">' + esc(t) + '</span>').join('') + '</div></td>' +
          (bid === Quiz.ALL_BANKS ? '<td class="small">' + esc(bankName(q.bank_id)) + '</td>' : '') +
          '<td>' + typeBadge(q.type) + '</td><td class="small">' + esc((q.category||[]).join('/')) + '</td>' +
          '<td class="small">' + diffLabel(q.difficulty) + '</td><td>' + q.score + '</td>' +
          '<td>' + badge(q.status === 'published' ? '已发布' : (q.status === 'draft' ? '草稿' : '已停用'), q.status === 'published' ? 'b-green' : (q.status === 'draft' ? 'b-orange' : 'b-gray')) + '</td>' +
          '<td class="nowrap"><span class="link" data-action="bank-edit" data-id="' + esc(q.question_id) + '">编辑</span> · ' +
          '<span class="link" data-action="bank-fav" data-id="' + esc(q.question_id) + '">收藏</span> · ' +
          aiLink(q.question_id) + ' · ' +
          '<span class="link" data-action="bank-delete" data-id="' + esc(q.question_id) + '">删除</span></td></tr>').join('') +
        '</tbody></table></div>' : empty('该题库没有符合条件的题目，可切换题库或新增题目', '▤'),
      '<div class="row end" style="margin-top:12px"><button class="btn btn-sm" data-action="bank-page" data-delta="-1">上一页</button><span class="small muted">' + ui.page + ' / ' + pages + '</span><button class="btn btn-sm" data-action="bank-page" data-delta="1">下一页</button></div>');
    return h;
  };

  /* 新建 / 重命名题库的弹窗表单 */
  P.bankForm = function (b) {
    b = b || {};
    return '<label class="field" style="margin-bottom:10px">题库名称<input type="text" id="bf-name" value="' + esc(b.name || '') + '" placeholder="如：2026 春季期末 / 计算机网络专项"></label>' +
      '<label class="field">描述（选填）<textarea id="bf-desc" style="min-height:64px" placeholder="用于说明该题库的用途、来源或适用对象">' + esc(b.description || '') + '</textarea></label>' +
      '<p class="small faint" style="margin:10px 0 0">题目可通过编辑表单的「所属题库」或列表的「批量移动」自由调整归属；删除题库时题目会迁回默认题库，不会丢失。</p>';
  };

  /* ---------------- 刷题 ---------------- */
  P.practice = function (app) {
    if (app.result) return practiceResult(app);
    if (app.practice && !app.practice.finished) return practiceRun(app);
    return practiceSetup(app);
  };

  function practiceSetup(app) {
    const s = Quiz.store.state(), ui = app.ui.practice, cfg = s.config;
    const cats = distinct(s, 'category');
    const wrongN = s.wrong.filter(w => !w.mastered).length;
    const favN = new Set(s.favorites.map(f => f.question_id)).size;
    const modes = [
      {m:'normal', t:'普通练习', d:'从已发布题库按条件抽题', n:s.questions.filter(q => q.status === 'published').length},
      {m:'wrong_review', t:'错题重刷', d:'从未掌握错题中抽题', n:wrongN},
      {m:'favorite', t:'收藏练习', d:'从收藏题中抽题', n:favN},
      {m:'exam', t:'考试模式', d:'交卷后统一反馈与解析', n:s.questions.filter(q => q.status === 'published').length}
    ];
    let h = card('选择练习来源', '四种模式共用同一判分引擎，来源写入作答明细 source 字段',
      '<div class="grid g4">' + modes.map(x =>
        '<div class="kpi" style="cursor:pointer;outline:' + (ui.mode === x.m ? '2px solid var(--primary)' : 'none') + '" data-action="practice-mode" data-mode="' + x.m + '">' +
        '<div class="k-label">' + x.t + '</div><div class="k-value">' + x.n + '</div><div class="k-sub">' + x.d + '</div></div>').join('') + '</div>');

    const av = app.quotaAvailable();
    const quotaBox = ui.quota_mode ? '<div class="filters" style="margin-top:10px">' +
      [['single','单选题数','pr-q-single'],['multiple','多选题数','pr-q-multiple'],['judge','判断题数','pr-q-judge']].map(x =>
        '<label class="field">' + x[1] + '（可用 ' + av[x[0]] + '）<input type="number" id="' + x[2] + '" min="0" max="' + av[x[0]] + '" value="' + (ui.quota[x[0]] || 0) + '"></label>').join('') +
      '</div>' : '';

    h += card('抽题与判分配置', '会话级固化配置，保证历史成绩可复算；按当前筛选可用：单选 ' + av.single + ' / 多选 ' + av.multiple + ' / 判断 ' + av.judge + ' 题',
      '<div class="filters">' +
      '<label class="field">题库' + selHtml('pr-bank', 'practice-filter', s.banks.map(b => ({v:b.bank_id, l:b.name})), ui.bank_id || Quiz.ALL_BANKS, '全部题库') + '</label>' +
      '<label class="field">分类' + selHtml('pr-cat', 'practice-filter', cats.map(c => ({v:c,l:c})), ui.category, '全部分类') + '</label>' +
      '<label class="field">题型' + selHtml('pr-type', 'practice-filter', Object.keys(TYPE_LABEL).map(t => ({v:t,l:TYPE_LABEL[t]})), ui.type, '全部题型') + '</label>' +
      '<label class="field">难度' + selHtml('pr-diff', 'practice-filter', [1,2,3,4,5].map(d => ({v:d,l:diffLabel(d)})), ui.difficulty, '全部难度') + '</label>' +
      '<label class="field">题量<input type="number" id="pr-count" min="1" max="200" value="' + esc(ui.count || cfg.default_question_count) + '"></label>' +
      '<label class="field">抽题顺序' + selHtml('pr-order', 'practice-filter', [{v:'random',l:'随机'},{v:'sequential',l:'顺序'}], ui.order) + '</label>' +
      '<label class="field">反馈时机' + selHtml('pr-fb', 'practice-filter', [{v:'immediate',l:'逐题即时'},{v:'after_submit',l:'交卷后统一'}], ui.feedback_mode || cfg.feedback_mode) + '</label>' +
      '<label class="field">多选部分得分' + selHtml('pr-partial', 'practice-filter', [{v:'proportional',l:'按比例给分'},{v:'all_or_none',l:'漏选即 0 分'}], ui.partial_mode || cfg.partial_mode) + '</label>' +
      '</div>' +
      '<div class="row" style="gap:18px;margin-bottom:10px">' +
      '<label class="check"><input type="checkbox" id="pr-shuffle"' + (ui.shuffle_options ? ' checked' : '') + '> 随机打乱选项顺序（答案键同步重映射）</label>' +
      '<label class="check"><input type="checkbox" id="pr-auto-advance"' + (ui.auto_advance ? ' checked' : '') + '> 答对后自动进入下一题</label>' +
      '<label class="check"><input type="checkbox" id="pr-wrong-partial"' + (ui.allow_partial_with_wrong ? ' checked' : '') + '> 多选含错选仍给部分分（上限 50%）</label>' +
      '</div>' +
      '<label class="check"><input type="checkbox" id="pr-quota-mode" data-action="pr-quota-toggle"' + (ui.quota_mode ? ' checked' : '') + '> 启用题型配额组卷（分别指定单选 / 多选 / 判断的题数，0 表示不抽）</label>' +
      quotaBox +
      '<div class="row" style="margin-top:14px"><button class="btn btn-primary" data-action="practice-start">开始练习</button>' +
      '<span class="small muted">可选题目 ' + app.availableCount() + ' 题；不足时按实际数量组卷</span></div>');

    const rt = Quiz.store.runtime.get();
    if (rt && !rt.finished) {
      const doneN = (rt.answers || []).filter(Boolean).length;
      h = '<div class="resume-banner"><span>检测到上次未完成的练习：<b>' + MODE_LABEL[rt.mode] + '</b> · 第 ' + (rt.index + 1) + '/' + rt.questions.length + ' 题 · 已答 ' + doneN + ' 题</span>' +
        '<span class="spacer"></span><button class="btn btn-sm btn-primary" data-action="practice-resume">继续练习</button></div>' + h;
      h += card('未完成的练习', '进度、草稿答案与组卷配置均已保存，可继续、重开本轮或放弃',
        '<div class="row"><span class="small muted">' + MODE_LABEL[rt.mode] + ' · ' + rt.questions.length + ' 题 · 已作答 ' + doneN + ' 题' +
        (rt.scope && rt.scope.shuffle_options ? ' · 选项已随机' : '') + '</span><span class="spacer"></span>' +
        '<button class="btn btn-sm" data-action="practice-restart">重新开始本轮</button>' +
        '<button class="btn btn-sm" data-action="practice-discard">放弃</button></div>');
    }
    return h;
  }

  /* v0.8 答题页设置面板（右栏，可收起）；所有开关与 app.ui.quiz 双向绑定 */
  function quizSettingsPanel(app) {
    const z = app.ui.quiz;
    if (!z.settings_open) return '<div class="side-card set-card"><div class="side-head"><b>设置</b>' +
      '<button class="link" data-action="quiz-settings-toggle">展开 ⌄</button></div></div>';
    const sw = (key, label) => '<div class="set-row"><span>' + label + '</span><label class="sw">' +
      '<input type="checkbox" data-action="quiz-set-toggle" data-key="' + key + '"' + (z[key] ? ' checked' : '') +
      '><i></i></label></div>';
    const sizes = [10, 20, 30, 50, 100, 200];
    if (sizes.indexOf(Number(z.group_size)) < 0) sizes.push(Number(z.group_size));
    sizes.sort((a, b) => a - b);
    const fonts = [['small', 'A较小'], ['normal', 'A标准'], ['large', '较大']];
    return '<div class="side-card set-card"><div class="side-head"><b>设置</b></div>' +
      '<div class="set-row"><span>编辑试题</span><button class="set-edit" data-action="quiz-edit" title="编辑当前试题（题库原题）">✎</button></div>' +
      sw('auto_advance', '答对自动下一题') + sw('recite_mode', '背题模式') +
      sw('shuffle_options', '选项乱序') + sw('ai_analysis', '开启AI解析') + sw('eye_care', '护眼模式') +
      '<div class="set-row"><span>随机练习每组题数 <span class="q-help" title="下一轮组卷的题量，同时同步到组卷配置">?</span></span>' +
      '<select class="set-select" data-action="quiz-set-select" data-key="group_size">' +
      sizes.map(n => '<option value="' + n + '"' + (Number(z.group_size) === n ? ' selected' : '') + '>' + n + '</option>').join('') +
      '</select></div>' +
      '<div class="set-row"><span>连续做对</span><div class="stepper">' +
      '<button data-action="quiz-set-step" data-key="mastery_threshold" data-delta="-1" aria-label="减少">−</button>' +
      '<span class="step-val">' + esc(z.mastery_threshold) + '</span>' +
      '<button data-action="quiz-set-step" data-key="mastery_threshold" data-delta="1" aria-label="增加">+</button></div></div>' +
      '<div class="set-hint">自动移出错题集 / 0 代表永不移出</div>' +
      '<div class="set-row font-row"><span>字体大小</span><div class="fontsel">' +
      fonts.map(f => '<button class="font-btn' + (z.font_size === f[0] ? ' active' : '') +
        '" data-action="quiz-set-font" data-value="' + f[0] + '">' + f[1] + '</button>').join('') +
      '</div></div>' +
      '<button class="set-collapse" data-action="quiz-settings-toggle">收起 ⌃</button></div>';
  }

  function practiceRun(app) {
    const p = app.practice, q = p.questions[p.index], store = Quiz.store;
    if (!q) return empty('题目数据异常');
    const s = store.state(), z = app.ui.quiz;
    const done = p.answers[p.index];
    const showFb = done && p.config.feedback_mode !== 'after_submit';
    const recite = !!z.recite_mode && p.mode !== 'exam' && p.config.feedback_mode !== 'after_submit';
    const reveal = showFb || recite;              // 是否展示答案 / 解析
    const isLast = p.index === p.questions.length - 1;
    const drafts = p.drafts || {};
    const fav = s.favorites.some(f => f.question_id === q.question_id);
    const marked = store.isMarked(q.question_id);
    const note = store.note(q.question_id);
    const stats = store.questionStats(q.question_id);
    // 本轮当前题尚未归档，计入展示统计（交卷后由 records 接管，不会重复计数）
    if (done) {
      const good = done.result.status === 'correct';
      [stats.mine, stats.all].forEach(t => {
        t.count += 1;
        if (good) t.correct += 1;
        t.rate = Math.round(t.correct / t.count * 10000) / 100;
      });
    }
    const ro = done ? ' disabled' : '';
    const raw = done ? done.raw : drafts[p.index];
    const checked = key => {
      if (raw == null) return '';
      if (q.type === 'judge') {
        const v = Array.isArray(raw) ? Quiz.scorer.normalizeBool(raw[0]) : raw;
        return (v === true ? 'T' : v === false ? 'F' : '') === key ? ' checked' : '';
      }
      const arr = Array.isArray(raw) ? raw : [raw];
      return arr.indexOf(key) >= 0 ? ' checked' : '';
    };
    const hasDraft = i => drafts[i] != null && (!Array.isArray(drafts[i]) || drafts[i].length > 0);
    const cells = p.questions.map((_, i) => {
      const a = p.answers[i];
      const cls = a ? 'ac-' + a.result.status : (hasDraft(i) ? 'ac-draft' : '');
      return '<button class="ac-cell ' + cls + (i === p.index ? ' ac-cur' : '') +
        '" data-action="practice-goto" data-index="' + i + '" title="第 ' + (i+1) + ' 题">' + (i+1) + '</button>';
    }).join('');
    const answered = p.answers.filter(Boolean);
    const ag = Quiz.scorer.aggregate(answered.map(x => ({status:x.result.status, score:x.result.score,
      max_score:x.result.max_score, duration_ms:x.duration_ms})));
    const acRate = answered.length ? Math.round(ag.counts.correct / answered.length * 100) : 0;

    /* 选项着色：正确项绿 / 误选红 / 漏选橙；背题模式直接标出正确项 */
    const correctKeys = q.type === 'judge' ? [] : (q.answer.keys || []);
    const judgeCorrect = q.type === 'judge' ? (q.answer.value ? 'T' : 'F') : '';
    const po = showFb ? (done.result.per_option || []) : [];
    const optCls = key => {
      if (showFb) {
        const v = (po.find(x => x.key === key) || {}).verdict;
        if (v === 'hit') return ' opt-ok';
        if (v === 'wrong') return ' opt-bad';
        if (v === 'missed') return ' opt-miss';
      }
      if (q.type === 'judge' && reveal) {
        if (key === judgeCorrect) return ' opt-ok';
        if (done && done.result.user_answer !== null && key !== judgeCorrect &&
            (done.result.user_answer === true ? 'T' : 'F') === key) return ' opt-bad';
      }
      if (recite && correctKeys.indexOf(key) >= 0) return ' opt-ok';
      return '';
    };
    const verdictText = key => {
      if (!showFb) return '';
      const v = (po.find(x => x.key === key) || {}).verdict;
      const t = {hit:'命中', wrong:'误选', missed:'漏选'}[v] || '';
      return t ? '<span class="verdict ' + ({hit:'v-hit', wrong:'v-wrong', missed:'v-miss'}[v] || '') + '">' + t + '</span>' : '';
    };
    const optHtml = (key, text) => '<label class="opt' + (checked(key) ? ' sel' : '') + optCls(key) + (done ? ' readonly' : '') +
      '" data-opt="' + key + '"><span class="okey">' + key + '</span><span class="otext">' + esc(text) + '</span>' +
      '<input type="' + (q.type === 'multiple' ? 'checkbox' : 'radio') + '" name="answer" value="' + key + '"' + checked(key) + ro + '>' +
      verdictText(key) + '</label>';
    let optionsHtml;
    if (q.type === 'judge') optionsHtml = optHtml('T', '正确') + optHtml('F', '错误');
    else optionsHtml = q.options.map(o => optHtml(o.key, o.text)).join('');

    const userText = done ? (q.type === 'judge'
      ? (done.result.user_answer === true ? '正确' : done.result.user_answer === false ? '错误' : '未作答')
      : ((done.result.user_answer || []).join('、') || '未作答')) : '未作答';
    const rightText = answerText(q);
    const okCls = done && done.result.status === 'correct' ? ' ok' : (done ? ' bad' : '');
    const mapText = Quiz.enhance ? Quiz.enhance.optionMapText(q) : '';
    const stars = [1,2,3,4,5].map(i => '<span class="star' + (i <= (Number(q.difficulty) || 1) ? ' on' : '') + '">★</span>').join('');

    /* AI 解析（可选、手动触发；有缓存则内嵌展示，不自动消耗 API） */
    let aiBlock = '';
    if (z.ai_analysis && reveal) {
      const ac = Quiz.ai ? Quiz.ai.config() : null;
      const ready = !!(ac && ac.enabled && ac.configured);
      let cached = '';
      if (ready) {
        try {
          const hit = Quiz.ai.getCache(Quiz.ai.cacheKey(q, 'explain'), ac.model);
          if (hit) cached = String(hit.text || '');
        } catch (e) { /* 缓存不可用时忽略 */ }
      }
      aiBlock = '<div class="q-block ai-block"><div class="q-block-title">✦ AI 解析 <span class="ai-pro">PRO</span></div>' +
        (cached ? '<div class="ai-inline-text">' + esc(cached) + '</div>'
                : '<div class="small muted" style="margin:6px 0 10px">' +
                  (ready ? '点击生成 AI 逐题解析（仅在手动触发时调用模型）' : '尚未配置 AI 模型，可在「数据与设置」中启用') + '</div>') +
        '<div class="row"><button class="btn btn-sm" data-action="ai-explain" data-id="' + esc(q.question_id) + '">' +
        (cached ? '重新生成 / 查看完整解析' : (ready ? '✦ 生成 AI 解析' : '去配置 AI')) + '</button></div>' +
        '<div class="ai-disclaimer">本解析由 AI 生成，仅供参考，建议结合官方教材核对；若内容有误请关闭 AI 辅助功能。' +
        '<span class="link" data-action="ai-go-settings">设置 ›</span></div></div>';
    }

    const crumbCat = esc((q.category || []).join(' / ') || (s.banks.find(b => b.bank_id === q.bank_id) || {}).name || '题库');
    let h = '<div class="quiz-layout"><div class="quiz-main">' +
      '<div class="quiz-crumb"><a href="#/dashboard">首页</a> / <a href="#/bank">' + crumbCat + '</a> / <span>章节练习</span></div>' +
      '<div class="quiz-head"><div><div class="row">' + badge(MODE_LABEL[p.mode], 'b-blue') + typeBadge(q.type) +
      '<span class="small muted">' + esc((q.category||[]).join('/')) + ' · ' + diffLabel(q.difficulty) + ' · ' + q.score + ' 分</span></div>' +
      '<div class="small muted" style="margin-top:4px">题目 ' + (p.index+1) + ' / ' + p.questions.length + ' · 已答 ' + answered.length + ' 题' +
      (p.config.auto_advance ? ' · 答对自动前进' : '') + '</div></div>' +
      '<div class="row"><span class="small muted">用时 <b id="quiz-timer">—</b></span>' +
      '<button class="btn btn-sm" data-action="quiz-settings-toggle" title="展开 / 收起答题设置">⚙ 设置</button>' +
      '<button class="btn btn-sm" data-action="practice-restart">重开本轮</button>' +
      '<button class="btn btn-sm" data-action="practice-finish">交卷</button>' +
      '<button class="btn btn-sm" data-action="practice-abandon">退出</button></div></div>' +
      '<div class="progress"><div style="width:' + Math.round((p.index+1)/p.questions.length*100) + '%"></div></div>';

    h += '<section class="card q-panel"><div class="q-meta">' + typeBadge(q.type) +
      (q.option_map && q.option_map.shuffled ? badge('选项已随机', 'b-purple') : '') +
      (done ? badge('已作答 · 只读回看', 'b-gray') : '') +
      (recite ? badge('背题模式', 'b-orange') : '') +
      '<span class="small faint">' + esc((q.category||[]).join('/')) + ' · ' + diffLabel(q.difficulty) + ' · ' + q.score + ' 分</span></div>' +
      (recite ? '<div class="recite-banner">背题模式：已直接显示答案与解析，本题不自动判分；翻页继续背诵。</div>' : '') +
      '<div class="q-line"><span class="q-num">' + (p.index+1) + '/' + p.questions.length + '.</span>' +
      '<span class="q-stem">' + esc(q.stem) + '</span></div>' +
      '<div class="q-opts" data-qindex="' + p.index + '">' + optionsHtml + '</div>' +
      '<div class="q-navrow">' +
      (p.index > 0 ? '<button class="q-navlink" data-action="practice-prev">← 上一题</button>' : '<span class="q-navlink off">← 上一题</span>') +
      '<button class="q-navlink" data-action="practice-next">下一题 →</button>' +
      '<span class="spacer"></span>' +
      '<button class="q-tool' + (fav ? ' on' : '') + '" data-action="practice-fav">' + (fav ? '★ 已收藏' : '☆ 收藏') + '</button>' +
      '<button class="q-tool" data-action="quiz-tags" title="查看 / 编辑标签">▤ 标签</button>' +
      '<button class="q-tool' + (marked ? ' on' : '') + '" data-action="quiz-mark">' + (marked ? '⚑ 已标记' : '⚑ 标记') + '</button>' +
      '</div>';

    /* 答案结果条：正确答案 / 你选择 / 本人总答 / 全体作答 / 本题得分与判定 */
    h += '<div class="q-answerbar"><div class="ab-item"><span>正确答案</span><b class="ok">' +
      (reveal ? esc(rightText) : '作答后显示') + '</b></div>' +
      '<div class="ab-item"><span>你选择</span><b class="' + (okCls.trim() || 'muted') + '">' + esc(userText) +
      (done ? (done.result.status === 'correct' ? ' ✓' : ' ✗') : '') + '</b></div>' +
      '<div class="ab-item"><span>本人总答</span><b>' + stats.mine.count + ' 次 · 正确率 ' + Number(stats.mine.rate).toFixed(2) + '%</b></div>' +
      '<div class="ab-item" title="单机版：全体作答统计取本机全部归档记录"><span>全体作答</span><b>' +
      stats.all.count + ' 次 · 正确率 ' + Number(stats.all.rate).toFixed(2) + '%</b></div>' +
      (done ? '<div class="ab-item ab-score">' + statusBadge(done.result.status) +
        '<b>' + done.result.score + ' / ' + done.result.max_score + ' 分</b></div>' : '') + '</div>';

    /* 解析（保留原有解析与选项随机对照信息） */
    h += '<div class="q-block"><div class="q-block-title">解析</div><div class="q-block-body">' +
      (reveal ? esc(q.analysis || '本题暂无解析，可在题库管理中补充。') : '提交本题后查看解析。') + '</div>' +
      (mapText && reveal ? '<div class="small faint" style="margin-top:8px">选项随机对照（解析中的字母按原题库顺序）：' + esc(mapText) + '</div>' : '') +
      '</div>' + aiBlock;

    h += '<div class="q-meta-foot"><div class="mf-item"><span>难度</span><span class="stars">' + stars + '</span>' +
      '<span class="small faint">' + diffLabel(q.difficulty) + '</span></div>' +
      '<div class="mf-item"><span>来源</span><b>' + esc(q.source || '—') + '</b></div>' +
      ((q.tags || []).length ? '<div class="mf-item"><span>标签</span>' + q.tags.map(t => '<span class="tag">' + esc(t) + '</span>').join('') + '</div>' : '') +
      '</div>';

    h += '<div class="q-note"><textarea id="quiz-note" placeholder="请输入笔记，记录本题的易错点…">' + esc(note ? note.text : '') + '</textarea>' +
      '<div class="row" style="margin-top:8px"><span class="small faint">' +
      (note ? '上次保存：' + fmt(note.updated_at) : '笔记仅保存在本机，随备份一起导出') + '</span>' +
      '<span class="spacer"></span><button class="btn btn-sm btn-primary" data-action="quiz-note-save">提交</button></div></div>';

    /* 原有全部操作按钮：AI 讲解、重做、上一题、跳过、提交、暂存、下一题 */
    h += '<div class="row end q-actions" style="margin-top:18px">' +
      '<button class="btn btn-sm" data-action="ai-explain" data-id="' + esc(q.question_id) + '">✦ AI 讲解本题</button>' +
      (done ? '<button class="btn btn-sm" data-action="quiz-redo">↺ 重做本题</button>' : '') +
      '<span class="spacer"></span>' +
      (p.index > 0 ? '<button class="btn btn-sm" data-action="practice-prev">← 上一题</button>' : '') +
      (!done ? '<button class="btn btn-sm" data-action="practice-skip">跳过本题</button>' : '') +
      (!done || (done && !showFb) ?
        '<button class="btn btn-primary" data-action="practice-submit"' + (done ? ' disabled' : '') + '>' + (done ? '已作答' : '提交本题') + '</button>' : '') +
      (!done ? '<button class="btn btn-sm" data-action="practice-next">' + (isLast ? '暂存并交卷' : '暂存并下一题') + '</button>' : '') +
      (done ? '<button class="btn btn-primary" data-action="practice-next">' + (isLast ? '完成并交卷' : '下一题 →') + '</button>' : '') +
      '</div>' +
      '<p class="small faint" style="margin:12px 0 0">单选 / 判断题选完即判：答对且开启「答对自动下一题」时自动前进，答错停留由你手动翻页；多选题仍需点「提交本题」；' +
      '「暂存并下一题」保留草稿，可跳回继续作答；「跳过本题」明确记为 unanswered（0 分）并进入错题本；交卷时未作答统一补齐。</p></section></div>';

    /* ---------- 右栏：答题卡 + 设置 ---------- */
    h += '<aside class="quiz-side"><div class="side-card answer-card-wrap">' +
      '<div class="side-head"><b>答题卡</b><button class="btn btn-sm btn-c-soft" data-action="practice-restart">重新练习</button></div>' +
      '<div class="small muted">点击题号跳转，未提交的选项会保留为草稿</div>' +
      '<div class="answer-card">' + cells + '</div>' +
      '<div class="legend"><span><i style="background:var(--primary-soft)"></i>草稿</span>' +
      '<span><i style="background:var(--success-soft)"></i>正确</span>' +
      '<span><i style="background:var(--warn-soft)"></i>部分得分</span>' +
      '<span><i style="background:var(--danger-soft)"></i>错误 / 未作答</span></div>' +
      '<div class="ac-stats"><div>答对: <b class="ok">' + ag.counts.correct + '</b> 题　答错: <b class="bad">' +
      (ag.counts.wrong + ag.counts.unanswered + ag.counts.partial) + '</b> 错</div>' +
      '<div>正确率: <b>' + acRate + '</b> %</div></div>' +
      '<button class="btn btn-sm btn-outline" data-action="quiz-view-data">查看练习数据</button></div>' +
      quizSettingsPanel(app) + '</aside></div>';
    return h;
  }

  function practiceResult(app) {
    const r = app.result, session = r.session, records = r.records;
    const a = Quiz.scorer.aggregate(records);
    const sc = session.scope || {}, cf = session.config || {}, quota = sc.quota || {};
    const filter = app.ui.resultFilter || 'all';
    const rows = records.map((x,i) => ({x,i})).filter(o => filter === 'all' || o.x.status === filter);
    let h = '<div class="grid g4">' +
      kpi('总题数', a.question_count, MODE_LABEL[session.mode], true) +
      kpi('正确率', pct(a.accuracy*100), 'correct ' + a.counts.correct + ' / 作答 ' + (a.question_count - a.counts.unanswered)) +
      kpi('得分率', pct(a.score_rate*100), a.earned_score + ' / ' + a.total_score + ' 分（含部分得分）') +
      kpi('总用时', fmtDur(a.duration_ms), '平均 ' + fmtDur(a.question_count ? a.duration_ms/a.question_count : 0)) +
      '</div>';
    h += card('状态分布', 'correct / partial / wrong / unanswered 四态分别统计',
      '<div class="row">' + Object.keys(STATUS_LABEL).map(k => badge(STATUS_LABEL[k] + ' ' + a.counts[k], STATUS_BADGE[k])).join(' ') + '</div>');
    h += card('本次组卷配置', '会话创建时固化配置快照，历史成绩可复算',
      '<div class="row">' +
      badge('来源：' + MODE_LABEL[session.mode], 'b-blue') +
      badge(sc.shuffle_options ? '选项随机' : '选项原序', sc.shuffle_options ? 'b-purple' : 'b-gray') +
      badge(sc.quota_mode ? '题型配额' : '按题量抽题', 'b-blue') +
      badge(cf.feedback_mode === 'after_submit' ? '交卷后统一反馈' : '逐题即时反馈', 'b-gray') +
      badge(cf.auto_advance ? '答对自动前进' : '手动翻页', 'b-gray') +
      badge('多选：' + (cf.partial_mode === 'all_or_none' ? '漏选 0 分' : '按比例给分'), 'b-gray') +
      '</div>' +
      (sc.quota_mode ? '<div class="small faint" style="margin-top:8px">配额：单选 ' + (quota.single||0) + ' / 多选 ' + (quota.multiple||0) + ' / 判断 ' + (quota.judge||0) + ' 题</div>' : ''));
    h += card('逐题回顾', '含题目快照、作答、正确答案、解析与单题用时；可按判定结果筛选',
      '<div class="row" style="margin-bottom:12px"><label class="field" style="max-width:200px">按判定筛选' +
      selHtml('rs-filter', 'result-filter', [{v:'all',l:'全部题目'}].concat(Object.keys(STATUS_LABEL).map(k => ({v:k,l:STATUS_LABEL[k]}))), filter) + '</label>' +
      '<span class="small muted">显示 ' + rows.length + ' / ' + records.length + ' 题</span></div>' +
      '<div class="table-wrap"><table><thead><tr><th>#</th><th>题干</th><th>题型</th><th>你的作答</th><th>正确答案</th><th>判定</th><th>得分</th><th>用时</th></tr></thead><tbody>' +
      rows.map(o => {
        const x = o.x, q = x.question_snapshot;
        return '<tr><td>' + (o.i+1) + '</td><td><div class="ellip" style="max-width:340px">' + esc(q.stem) + '</div>' +
          (x.analysis ? '<div class="small faint">解析：' + esc(x.analysis) + '</div>' : '') +
          '<div style="margin-top:4px">' + aiLink(x.question_id) + '</div></td>' +
          '<td>' + typeBadge(q.type) + '</td><td class="mono">' + esc(userAnswerText(x)) + '</td><td class="mono">' + esc(answerText(q)) + '</td>' +
          '<td>' + statusBadge(x.status) + '</td><td>' + x.score + ' / ' + x.max_score + '</td><td>' + fmtDur(x.duration_ms) + '</td></tr>';
      }).join('') + '</tbody></table></div>',
      '<div class="row" style="margin-top:14px"><button class="btn btn-primary" data-action="practice-again">再来一组</button>' +
      '<button class="btn" data-action="practice-review-wrong">重刷本次错题</button>' +
      '<button class="btn" data-action="practice-new">返回组卷配置</button>' +
      '<a class="btn" href="#/records">查看刷题记录</a></div>');
    return h;
  }

  /* ---------------- 错题本 ---------------- */
  P.wrong = function (app) {
    const s = Quiz.store.state(), ui = app.ui.wrong;
    const rows = app.wrongRows();
    let h = card('错题筛选', '一题一条记录；连续答对达到阈值后置为「已掌握」，历史记录保留不删除',
      '<div class="filters">' +
      '<label class="field">科目/分类' + selHtml('wr-cat', 'wrong-filter', distinct(s,'category').map(c => ({v:c,l:c})), ui.category, '全部分类') + '</label>' +
      '<label class="field">题型' + selHtml('wr-type', 'wrong-filter', Object.keys(TYPE_LABEL).map(t => ({v:t,l:TYPE_LABEL[t]})), ui.type, '全部题型') + '</label>' +
      '<label class="field">掌握状态' + selHtml('wr-mastered', 'wrong-filter', [{v:'no',l:'未掌握'},{v:'yes',l:'已掌握'},{v:'all',l:'全部'}], ui.mastered) + '</label>' +
      '<label class="field">首次错误时间' + selHtml('wr-time', 'wrong-filter', [{v:'all',l:'全部'},{v:'7',l:'近 7 天'},{v:'30',l:'近 30 天'}], ui.range) + '</label>' +
      '</div><div class="row"><button class="btn btn-primary" data-action="wrong-start">开始错题重刷（' + rows.filter(x => !x.mastered).length + ' 题）</button>' +
      '<span class="small muted">重刷答对 ' + s.config.mastery_threshold + ' 次自动标记掌握（可在设置中调整）</span></div>');
    h += card('错题列表', '共 ' + rows.length + ' 题',
      rows.length ? '<div class="table-wrap"><table><thead><tr><th>题目</th><th>分类 / 题型</th><th>错误次数</th><th>连续答对</th><th>最近错误</th><th>状态</th><th>操作</th></tr></thead><tbody>' +
        rows.map(w => {
          const q = Quiz.store.question(w.question_id);
          return '<tr><td><div class="ellip" style="max-width:380px">' + esc(q ? q.stem : w.question_id) + '</div><div class="mono faint">' + esc(w.question_id) + '</div></td>' +
            '<td class="small">' + esc((w.category_snapshot||[]).join('/')) + '<br>' + typeBadge(w.type) + '</td>' +
            '<td><b>' + w.wrong_count + '</b></td><td>' + (w.consecutive_correct||0) + '</td><td class="small nowrap">' + fmt(w.last_wrong_at) + '</td>' +
            '<td>' + (w.mastered ? badge('已掌握','b-green') : badge('待攻克','b-red')) + '</td>' +
            '<td class="nowrap"><span class="link" data-action="wrong-single" data-id="' + esc(w.question_id) + '">单题重刷</span> · ' +
            '<span class="link" data-action="wrong-master" data-id="' + esc(w.question_id) + '">标记掌握</span> · ' +
            '<span class="link" data-action="wrong-reset" data-id="' + esc(w.question_id) + '">重置</span> · ' +
            aiLink(w.question_id) + '</td></tr>';
        }).join('') + '</tbody></table></div>' : empty('当前筛选下没有错题', '✓'));
    return h;
  };

  /* ---------------- 收藏 ---------------- */
  P.favorites = function (app) {
    const s = Quiz.store.state(), ui = app.ui.favorites;
    let h = '<div class="grid g2" style="grid-template-columns:260px minmax(0,1fr)">';
    h += card('收藏夹', '同一题可放入多个收藏夹',
      '<div class="row" style="margin-bottom:10px"><input type="text" id="fav-new-name" placeholder="新建收藏夹名称"><button class="btn btn-sm" data-action="fav-new-folder">新建</button></div>' +
      '<div class="report-row"><span class="link" data-action="fav-select" data-id="ALL" style="' + (ui.folder === 'ALL' ? 'font-weight:700;color:var(--primary)' : '') + '">▤ 全部收藏题目 <span class="faint">(' + s.favorites.length + ')</span></span></div>' +
      s.folders.map(f => '<div class="report-row"><span class="link" data-action="fav-select" data-id="' + esc(f.folder_id) + '" style="' + (ui.folder === f.folder_id ? 'font-weight:700;color:var(--primary)' : '') + '">☆ ' + esc(f.name) + ' <span class="faint">(' + s.favorites.filter(x => x.folder_id === f.folder_id).length + ')</span></span>' +
        (f.is_default ? '' : '<span class="link" data-action="fav-del-folder" data-id="' + esc(f.folder_id) + '">删除</span>') + '</div>') +
      '<div class="row" style="margin-top:14px"><button class="btn btn-primary btn-sm" data-action="fav-start">练习当前收藏夹</button></div>');

    const favs = s.favorites.filter(f => ui.folder === 'ALL' || f.folder_id === ui.folder);
    h += card('收藏题目', '共 ' + favs.length + ' 项',
      favs.length ? '<div class="table-wrap"><table><thead><tr><th>题目</th><th>题型</th><th>分类</th><th>收藏时间</th><th>操作</th></tr></thead><tbody>' +
        favs.map(f => {
          const q = Quiz.store.question(f.question_id);
          return '<tr><td><div class="ellip" style="max-width:320px">' + esc(q ? q.stem : f.question_id) + '</div><div class="mono faint">' + esc(f.question_id) + '</div></td>' +
            '<td>' + (q ? typeBadge(q.type) : '—') + '</td><td class="small">' + esc(q ? (q.category||[]).join('/') : '—') + '</td>' +
            '<td class="small nowrap">' + fmt(f.created_at) + '</td>' +
            '<td class="nowrap"><span class="link" data-action="fav-remove" data-id="' + esc(f.id) + '">取消收藏</span> · ' +
            aiLink(f.question_id) + '</td></tr>';
        }).join('') + '</tbody></table></div>' : empty('该收藏夹暂无题目，去题库管理点「收藏」', '☆'));
    h += '</div>';
    return h;
  };

  /* ---------------- 刷题记录 ---------------- */
  P.records = function (app) {
    const s = Quiz.store.state();
    const list = s.sessions.slice().reverse();
    /* v1.11.0：按需求移除「答题记录·来源诊断与汇总」「全部答题记录」「逐题作答明细（实时）」展示，
       仅保留已归档练习会话列表；底层作答数据仍照常记录，不影响统计与判分口径。 */
    let h = card('练习会话', '已交卷归档的练习会话，可下钻查看逐题明细',
      list.length ? '<div class="table-wrap"><table><thead><tr><th>时间</th><th>模式</th><th>题数</th><th>正确</th><th>部分</th><th>错误</th><th>正确率</th><th>得分率</th><th>用时</th><th></th></tr></thead><tbody>' +
        list.map(x => '<tr><td class="nowrap">' + fmt(x.started_at) + '</td><td>' + badge(MODE_LABEL[x.mode] || x.mode, 'b-blue') + '</td><td>' + x.question_count + '</td>' +
          '<td>' + x.correct_count + '</td><td>' + x.partial_count + '</td><td>' + x.wrong_count + '</td>' +
          '<td>' + pct(x.accuracy*100) + '</td><td>' + pct(x.score_rate*100) + '</td><td>' + fmtDur(x.duration_ms) + '</td>' +
          '<td><span class="link" data-action="records-detail" data-id="' + esc(x.session_id) + '">查看明细</span></td></tr>').join('') +
        '</tbody></table></div>' : '<div class="empty"><span class="e-icon">◷</span>还没有已交卷归档的练习会话</div>');
    return h;
  };

  P.recordDetail = function (sessionId) {
    const s = Quiz.store.state();
    const session = s.sessions.find(x => x.session_id === sessionId);
    const rs = s.records.filter(r => r.session_id === sessionId);
    /* v1.4.4：未交卷的逐题实时记录也能下钻，不再要求会话已归档 */
    const head = session
      ? MODE_LABEL[session.mode] + ' · ' + fmt(session.started_at) + ' · 抽题范围：' + esc(JSON.stringify(session.scope)) + ' · 判分配置：' + esc(JSON.stringify(session.config))
      : '进行中练习 · 逐题实时记录（尚未交卷） · 会话 ' + esc(sessionId);
    if (!session && !rs.length) return empty('会话不存在');
    return '<div class="small muted" style="margin-bottom:10px">' + head + '</div>' +
      '<div class="table-wrap"><table><thead><tr><th>#</th><th>题干（快照）</th><th>作答</th><th>正确答案</th><th>判定</th><th>得分</th><th>用时</th></tr></thead><tbody>' +
      rs.map((r,i) => '<tr><td>' + (i+1) + '</td><td><div class="ellip" style="max-width:300px">' + esc(r.question_snapshot.stem) + '</div><div class="small faint">' + esc((r.question_snapshot.options||[]).map(o => o.key + '.' + o.text).join('  ')) + '</div>' +
        '<div style="margin-top:4px">' + aiLink(r.question_id) + '</div></td>' +
        '<td class="mono">' + esc(userAnswerText(r)) + '</td><td class="mono">' + esc(answerText(r.question_snapshot)) + '</td>' +
        '<td>' + statusBadge(r.status) + '</td><td>' + r.score + '/' + r.max_score + '</td><td>' + fmtDur(r.duration_ms) + '</td></tr>').join('') +
      '</tbody></table></div>';
  };

  /* ---------------- 设置 ---------------- */
  P.settings = function (app) {
    const s = Quiz.store.state(), c = s.config;
    let h = card('判分与学习默认配置', '会话创建时固化配置快照，此处修改不影响历史成绩',
      '<div class="filters">' +
      '<label class="field">默认反馈时机' + selHtml('cfg-fb', '', [{v:'immediate',l:'逐题即时'},{v:'after_submit',l:'交卷后统一'}], c.feedback_mode) + '</label>' +
      '<label class="field">默认题量<input type="number" id="cfg-count" min="1" max="200" value="' + c.default_question_count + '"></label>' +
      '<label class="field">错题掌握阈值（连续答对次数）<input type="number" id="cfg-threshold" min="1" max="10" value="' + c.mastery_threshold + '"></label>' +
      '</div>' +
      '<div class="row" style="gap:18px;margin-bottom:12px">' +
      '<label class="check"><input type="checkbox" id="cfg-shuffle"' + (c.shuffle_options ? ' checked' : '') + '> 组卷默认随机打乱选项</label>' +
      '<label class="check"><input type="checkbox" id="cfg-auto"' + (c.auto_advance ? ' checked' : '') + '> 答对默认自动进入下一题</label>' +
      '</div>' +
      '<label class="field" style="max-width:240px">自动前进延迟（毫秒，300–10000）<input type="number" id="cfg-auto-ms" min="300" max="10000" value="' + (c.auto_advance_ms || 1200) + '"></label>' +
      '<div style="margin-top:12px"><button class="btn btn-primary" data-action="settings-save">保存设置</button></div>');

    /* ---------------- AI 模型配置（可选功能：未配置不影响任何核心功能） ---------------- */
    const AI = Quiz.ai, acfg = AI.config(), ast = AI.stats();
    const presetIdx = AI.PRESETS.findIndex(p => p.base === acfg.baseUrl);
    const presetSel = presetIdx < 0 ? String(AI.PRESETS.length - 1) : String(presetIdx);
    const kindLabel = {explain:'AI 讲解', parse:'导入解析', test:'连接测试'};
    const usageRows = AI.usage().slice(0, 8).map(u =>
      '<tr><td class="nowrap">' + fmt(u.at) + '</td><td>' + esc(kindLabel[u.kind] || u.kind) + '</td>' +
      '<td class="mono">' + esc(u.model) + '</td><td>' + (u.chars || 0) + '</td>' +
      '<td>' + (u.ok ? badge('成功','b-green') : badge('失败','b-red')) + '</td>' +
      (u.error ? '<td class="small faint ellip" style="max-width:180px" title="' + esc(u.error) + '">' + esc(u.error) + '</td>' : '<td>—</td>') + '</tr>').join('');

    h += card('AI 模型配置（可选）', '逐题 AI 讲解与导入兜底解析；完全手动触发，未配置或未启用时不影响建库、导入、练习等任何功能',
      '<div class="row" style="margin-bottom:12px">' +
      (acfg.enabled && acfg.configured ? badge('已启用 · ' + acfg.model, 'b-green') : badge('未启用', 'b-gray')) +
      (acfg.hasKey ? badge('Key ' + acfg.keyMask, 'b-blue') : badge('未保存 Key（本地服务可留空）', 'b-orange')) +
      '<span class="spacer"></span><span class="small muted">调用 ' + ast.calls + ' 次 · 成功 ' + ast.success + ' · 失败 ' + ast.failed + ' · 缓存 ' + ast.cached + ' 条</span></div>' +
      '<label class="check" style="margin-bottom:12px"><input type="checkbox" id="ai-enabled"' + (acfg.enabled ? ' checked' : '') + '> 启用 AI 功能（关闭后所有按钮只提示，不会发起任何请求）</label>' +
      '<div class="filters">' +
      '<label class="field">接口预设' + selHtml('ai-preset', 'ai-preset', AI.PRESETS.map((p, i) => ({v:String(i), l:p.label})), presetSel) + '</label>' +
      '<label class="field">API 地址（Base URL，OpenAI 兼容）<input type="text" id="ai-base" value="' + esc(acfg.baseUrl) + '" placeholder="https://api.deepseek.com/v1"></label>' +
      '<label class="field">模型名称<input type="text" id="ai-model" value="' + esc(acfg.model) + '" placeholder="deepseek-chat"></label>' +
      '<label class="field">API Key（留空 = 保留已存 Key）<input type="password" id="ai-key" value="" autocomplete="off" placeholder="' + (acfg.hasKey ? '已保存 ' + esc(acfg.keyMask) + '，留空不修改' : 'sk-…') + '"></label>' +
      '</div>' +
      '<div class="row" style="margin-top:4px"><button class="btn btn-primary btn-sm" data-action="ai-save">保存 AI 配置</button>' +
      '<button class="btn btn-sm" data-action="ai-test">测试连接</button>' +
      '<button class="btn btn-sm" data-action="ai-clear-key">清除已存 Key</button>' +
      '<button class="btn btn-sm" data-action="ai-clear-cache">清空讲解缓存</button>' +
      '<button class="btn btn-sm" data-action="ai-clear-usage">清空调用记录</button></div>' +
      '<div id="ai-test-result" class="small muted" style="margin-top:10px">预设仅自动填充地址与模型；云端服务商可能不允许浏览器直连（CORS），请先点「测试连接」确认；本地 Ollama 通常需设置 OLLAMA_ORIGINS 放行来源。</div>');

    return h;
  };

  /* ---------------- 弹窗内容 ---------------- */
  P.questionForm = function (q) {
    q = Object.assign({type:'single', options:[{key:'A',text:''},{key:'B',text:''},{key:'C',text:''},{key:'D',text:''}],
                       answer:{keys:['A']}, difficulty:3, score:1, status:'published',
                       category:[], tags:[], analysis:'', bank_id: Quiz.store.defaultBankId()}, q || {});
    const isNew = !q.question_id;
    let h = '<div class="filters">' +
      '<label class="field">题目ID<input type="text" id="qf-id" value="' + esc(q.question_id || '') + '"' + (isNew ? '' : ' readonly') + ' placeholder="留空自动生成"></label>' +
      '<label class="field">所属题库' + selHtml('qf-bank', '', Quiz.store.banks().map(b => ({v:b.bank_id, l:b.name})), q.bank_id || Quiz.store.defaultBankId()) + '</label>' +
      '<label class="field">题型' + selHtml('qf-type', 'qf-type-change', Object.keys(TYPE_LABEL).map(t => ({v:t,l:TYPE_LABEL[t]})), q.type) + '</label>' +
      '<label class="field">分类（/ 分隔）<input type="text" id="qf-cat" value="' + esc((q.category||[]).join('/')) + '"></label>' +
      '<label class="field">标签（; 分隔）<input type="text" id="qf-tags" value="' + esc((q.tags||[]).join(';')) + '"></label>' +
      '<label class="field">难度' + selHtml('qf-diff', '', [1,2,3,4,5].map(d => ({v:d,l:diffLabel(d)})), q.difficulty) + '</label>' +
      '<label class="field">分值<input type="number" id="qf-score" min="0.01" max="100" step="0.01" value="' + q.score + '"></label>' +
      '<label class="field">状态' + selHtml('qf-status', '', [{v:'published',l:'已发布'},{v:'draft',l:'草稿'},{v:'disabled',l:'已停用'}], q.status) + '</label>' +
      '<label class="field">来源<input type="text" id="qf-source" value="' + esc(q.source || '') + '"></label>' +
      '</div>' +
      '<label class="field" style="margin-bottom:10px">题干<textarea id="qf-stem" style="min-height:70px">' + esc(q.stem || '') + '</textarea></label>' +
      '<div id="qf-options">';
    if (q.type === 'judge') {
      h += '<label class="field">正确答案' + selHtml('qf-answer', '', [{v:'T',l:'正确'},{v:'F',l:'错误'}], q.answer && q.answer.value ? 'T' : 'F') + '</label>';
    } else {
      ['A','B','C','D','E','F'].forEach((k, i) => {
        const o = (q.options||[]).find(x => x.key === k);
        h += '<label class="field" style="margin-bottom:6px">选项 ' + k + '<input type="text" class="qf-opt" data-key="' + k + '" value="' + esc(o ? o.text : '') + '" placeholder="留空表示无此选项"></label>';
      });
      const keys = (q.answer && q.answer.keys || []).join(',');
      h += '<label class="field" style="margin-top:8px">正确答案（' + (q.type === 'multiple' ? '逗号分隔，如 A,C' : '单个字母') + '）<input type="text" id="qf-answer" value="' + esc(keys) + '"></label>';
    }
    h += '</div><label class="field" style="margin-top:10px">解析<textarea id="qf-analysis" style="min-height:60px">' + esc(q.analysis || '') + '</textarea></label>';
    return h;
  };

  P.favoritePicker = function (questionId) {
    const s = Quiz.store.state();
    return '<div class="small muted" style="margin-bottom:10px">选择要放入的收藏夹（可多选，同一题可入多夹）：</div>' +
      s.folders.map(f => '<label class="check" style="display:flex;padding:7px 0;border-bottom:1px dashed var(--border)"><input type="checkbox" class="fav-ck" value="' + esc(f.folder_id) + '"' +
        (s.favorites.some(x => x.question_id === questionId && x.folder_id === f.folder_id) ? ' checked' : '') + '> ' + esc(f.name) + '</label>').join('');
  };

  P.MODE_LABEL = MODE_LABEL;
  P.STATUS_BADGE = STATUS_BADGE;
  P.TYPE_BADGE = TYPE_BADGE;
  P.badge = badge;
  P.typeBadge = typeBadge;
  P.statusBadge = statusBadge;
  P.answerText = answerText;
  P.distinct = distinct;
  P.opts = opts;
  P.diffLabel = diffLabel;
})(typeof window !== 'undefined' ? window : globalThis);
