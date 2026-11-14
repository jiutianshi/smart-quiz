/* v1.4.0 题库试题表格编辑（纯增量）
   流程：① 先选题库 → ② 在表格里直接改题干 / 选项 / 答案 / 解析 / 章节 / 难度
        → ③ 复用 importer.rowToQuestion 逐行报错检测 → ④ 只看报错 / 重新检测 → ⑤ 保存。
   两种来源：
     bank   题库内已有试题，保存时按 question_id 增量写回（仅变更行升版本，历史快照不动）；
     import 文档导入校验页生成的标准 CSV，保存时调用 app.doImport 复用 E001–E010 / 去重 / 人工确认链。
   状态只存内存，不写 localStorage、不写示例题目；不改动判分引擎与任何既有页面。 */
(function (global) {
  const Quiz = global.Quiz = global.Quiz || {};
  const util = Quiz.util, importer = Quiz.importer, store = Quiz.store;
  const e = v => util.esc(v == null ? '' : String(v));
  const P = Quiz.pages = Quiz.pages || {};

  const KEYS = importer.COLS.map(c => c.key);
  const OPT = ['option_a','option_b','option_c','option_d','option_e','option_f','option_g','option_h'];
  const TYPES = [{v:'single',l:'单选题'},{v:'multiple',l:'多选题'},{v:'judge',l:'判断题'}];
  const DIFFS = [{v:'1',l:'很容易'},{v:'2',l:'容易'},{v:'3',l:'中等'},{v:'4',l:'较难'},{v:'5',l:'很难'}];

  const S = Quiz.bankGridState = {
    mode:'bank', bankId:'', sourceName:'', sourceCsv:'',
    rows:[], original:[], onlyErrors:false, dirty:false, message:'', saved:0,
    afterImport:null   /* v1.12.4：文档导入成功后的提示态（{inserted, bankName}），供页面内横幅与「继续添加」 */
  };

  function toast(msg, type) { const t = Quiz.app && Quiz.app.toast; if (t) t(msg, type || ''); }
  function renderNow() { const a = Quiz.app; if (a && a.render) a.render(); }
  function go(route) {
    if (global.location) global.location.hash = '#/' + route;
    renderNow();
  }
  function ask(msg) { return !(global.confirm && !global.confirm(msg)); }
  function bankName(id) { const b = store.bank(id); return b ? b.name : '未分类题库'; }
  function safeBank(id) {
    return (id && id !== Quiz.ALL_BANKS && store.bank(id)) ? id : store.defaultBankId();
  }
  function defFolder() {
    const fs = store.state().folders || [];
    return (fs.find(f => f.is_default) || fs[0] || {folder_id:'F_DEFAULT'}).folder_id;
  }

  /* ---------- 行 <-> 题目 ---------- */
  function answerRaw(q) {
    if (q.type === 'judge') return q.answer && q.answer.value === true ? 'T' : 'F';
    return ((q.answer && q.answer.keys) || []).join(',');
  }
  function questionToRow(q) {
    const r = {
      question_id:q.question_id, type:q.type, stem:q.stem, answer:answerRaw(q),
      analysis:q.analysis || '', category:(q.category || []).join('/'),
      tags:(q.tags || []).join(';'), difficulty:q.difficulty || 3, score:q.score || 1,
      source:q.source || '', status:q.status || 'draft', bank_id:q.bank_id || store.defaultBankId(),
      _i:0, _deleted:false, _errors:[]
    };
    OPT.forEach(k => { r[k] = ''; });
    (q.options || []).forEach(o => { const k = 'option_' + String(o.key).toLowerCase(); if (OPT.indexOf(k) >= 0) r[k] = o.text; });
    return r;
  }
  function blankRow() {
    const r = {
      question_id:util.uid('Q').replace(/[^A-Za-z0-9_-]/g, ''), type:'single', stem:'',
      answer:'A', analysis:'', category:'未分类', tags:'', difficulty:3, score:1,
      source:'表格新增', status:'published', bank_id:S.bankId,
      _i:0, _deleted:false, _errors:[]
    };
    OPT.forEach(k => { r[k] = ''; });
    r.option_a = '选项一'; r.option_b = '选项二';
    return r;
  }
  function csvToRows(csv) {
    const p = importer.parseDelimited(csv);
    return p.rows.map((cells, i) => {
      const r = {_i:i, _deleted:false, _errors:[]};
      KEYS.forEach(k => { r[k] = ''; });
      p.headers.forEach((h, j) => { if (KEYS.indexOf(h) >= 0) r[h] = cells[j] == null ? '' : String(cells[j]); });
      r.bank_id = S.bankId;
      return r;
    });
  }
  function quote(v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; }
  function toCsv() {
    return [KEYS.map(quote).join(',')].concat(
      S.rows.filter(r => !r._deleted).map(r => KEYS.map(k => quote(r[k])).join(','))
    ).join('\n');
  }
  function snap(r) {
    return KEYS.map(k => String(r[k] == null ? '' : r[k])).join('\u0001') + '|' + (r._deleted ? '1' : '0');
  }
  function snapshot() { return S.rows.map(snap); }

  /* ---------- 校验：直接复用导入链同一套规则 ---------- */
  function validateRows() {
    const seen = {};
    S.rows.forEach((r, i) => {
      r._errors = [];
      if (r._deleted) return;
      const res = importer.rowToQuestion(r, i + 1);
      (res.errors || []).forEach(x => {
        let msg = x.message;
        /* 多选题只填一个答案：给出与截图一致的明确提示 */
        if (x.code === 'E004' && x.field === 'answer' && importer.normalizeType(r.type) === 'multiple' &&
            /^[A-H]$/.test(String(r.answer || '').trim())) msg = '至少有两个正确答案';
        r._errors.push({code:x.code, field:x.field, message:msg});
      });
      const id = String(r.question_id || '').trim();
      if (id) {
        if (seen[id] != null) r._errors.push({code:'E008', field:'question_id', message:'表格内题目ID重复（第 ' + (seen[id] + 1) + ' 行）'});
        else seen[id] = i;
      }
    });
    return S.rows.filter(r => !r._deleted && r._errors.length).length;
  }
  function stats() {
    const live = S.rows.filter(r => !r._deleted);
    const c = {total:live.length, single:0, multiple:0, judge:0, other:0, errors:0, deleted:S.rows.length - live.length};
    live.forEach(r => {
      const t = importer.normalizeType(r.type);
      if (t === 'single' || t === 'multiple' || t === 'judge') c[t]++; else c.other++;
      if (r._errors && r._errors.length) c.errors++;
    });
    return c;
  }
  function statsHtml() {
    const c = stats();
    return '<span>试题总数：<b>' + c.total + '</b></span>' +
      '<span>单选：<b class="bg-blue">' + c.single + '</b></span>' +
      '<span>多选：<b class="bg-blue">' + c.multiple + '</b></span>' +
      '<span>判断：<b class="bg-blue">' + c.judge + '</b></span>' +
      '<span>报错：<b class="' + (c.errors ? 'bg-red' : '') + '">' + c.errors + '</b></span>' +
      (c.deleted ? '<span>待删除：<b class="bg-red">' + c.deleted + '</b></span>' : '');
  }
  function dirtyText() { return S.dirty ? '● 有未保存的修改' : '○ 已保存（无改动）'; }
  function errHtml(r) {
    if (!r._errors || !r._errors.length) return '';
    return r._errors.map(x => '<div class="bg-err-item">' + e(x.code) + ' ' + e(x.message) + '</div>').join('');
  }

  /* ---------- 打开两种来源 ---------- */
  function openFromBank(bankId) {
    S.mode = 'bank'; S.bankId = safeBank(bankId); S.sourceName = ''; S.sourceCsv = ''; S.afterImport = null;
    const def = store.defaultBankId();
    S.rows = store.state().questions
      .filter(q => (q.bank_id || def) === S.bankId)
      .map(questionToRow);
    S.rows.forEach((r, i) => { r._i = i; r.bank_id = S.bankId; });
    S.original = snapshot(); S.dirty = false; S.onlyErrors = false; S.message = ''; S.saved = 0;
    validateRows();
    return S;
  }
  function openFromCsv(csv, meta) {
    meta = meta || {};
    S.mode = 'import'; S.afterImport = null;
    S.bankId = safeBank(meta.bankId || (Quiz.app && Quiz.app.ui && Quiz.app.ui.imp && Quiz.app.ui.imp.bankId));
    S.sourceName = meta.fileName || '';
    S.sourceCsv = csv;
    S.rows = csvToRows(csv);
    S.rows.forEach((r, i) => { r._i = i; });
    S.original = snapshot(); S.dirty = false; S.onlyErrors = false; S.message = ''; S.saved = 0;
    validateRows();
    return S;
  }
  function reload() {
    if (S.dirty && !ask('有未保存的修改，确定放弃并重新载入吗？')) return false;
    if (S.mode === 'import' && S.sourceCsv) openFromCsv(S.sourceCsv, {fileName:S.sourceName, bankId:S.bankId});
    else openFromBank(S.bankId);
    renderNow();
    return true;
  }
  function ensureState(app) {
    const hash = (global.location && global.location.hash) || '';
    const m = hash.match(/[?&]bank=([^&]+)/);
    const wanted = m ? decodeURIComponent(m[1]) : (app && app.ui && app.ui.bank && app.ui.bank.bankId);
    if (m && S.bankId !== wanted) openFromBank(wanted);
    else if (!S.rows.length && !S.sourceCsv) openFromBank(wanted);
  }

  /* ---------- 保存 ---------- */
  function saveBank() {
    const bad = validateRows();
    if (bad) {
      S.onlyErrors = true; renderNow();
      toast('还有 ' + bad + ' 行格式错误，已切换为「只看报错」，修正后再保存', 'err');
      return {ok:false, errors:bad};
    }
    const del = S.rows.filter(r => r._deleted && r.question_id).map(r => r.question_id);
    const orig = S.original;
    const changed = S.rows.filter((r, i) => !r._deleted && snap(r) !== orig[i]);
    const qs = changed.map(r => {
      const q = importer.rowToQuestion(r, 1).question;
      q.bank_id = S.bankId;
      return q;
    });
    const now = util.now();
    store.mutate(s => {
      qs.forEach(q => {
        const i = s.questions.findIndex(x => x.question_id === q.question_id);
        if (i >= 0) {
          q.version = (s.questions[i].version || 1) + 1;
          q.created_at = s.questions[i].created_at;
          q.bank_id = S.bankId; q.updated_at = now;
          s.questions[i] = q;
        } else {
          q.version = 1; q.created_at = now; q.updated_at = now; q.bank_id = S.bankId;
          s.questions.push(q);
        }
      });
      if (del.length) {
        s.questions = s.questions.filter(q => del.indexOf(q.question_id) < 0);
        s.favorites = s.favorites.filter(f => del.indexOf(f.question_id) < 0);
      }
    });
    S.original = snapshot(); S.dirty = false; S.saved = changed.length;
    S.message = '已保存 ' + changed.length + ' 处修改' + (del.length ? '，删除 ' + del.length + ' 题' : '');
    if (Quiz.app && Quiz.app.ui && Quiz.app.ui.bank) Quiz.app.ui.bank.bankId = S.bankId;
    toast(S.message, 'ok');
    renderNow();
    return {ok:true, changed:changed.length, deleted:del.length};
  }
  function saveImport() {
    const bad = validateRows();
    if (bad) {
      S.onlyErrors = true; renderNow();
      toast('还有 ' + bad + ' 行格式错误，已切换为「只看报错」，修正后再录入', 'err');
      return {ok:false, errors:bad};
    }
    const app = Quiz.app;
    if (!app || !app.doImport) return {ok:false, message:'导入链不可用'};
    const csv = toCsv();
    app.ui.imp.bankId = S.bankId;
    app.ui.imp.text = csv;
    const opts = {duplicate_policy:app.ui.imp.policy || 'skip', skip_error_rows:app.ui.imp.skipErrors === '1'};
    S.rows = []; S.dirty = false; S.sourceCsv = '';
    go('import');
    app.doImport(csv, opts);
    return {ok:true, csv:csv};
  }

  /* ---------- 表格单元 ---------- */
  function inp(i, k, v, dis) {
    return '<td><input class="bg-in" data-action="bg-edit" data-row="' + i + '" data-key="' + k + '" value="' + e(v) + '"' + (dis ? ' disabled' : '') + '></td>';
  }
  function area(i, k, v, rows, dis) {
    return '<td><textarea class="bg-in bg-ta" rows="' + (rows || 2) + '" data-action="bg-edit" data-row="' + i + '" data-key="' + k + '"' + (dis ? ' disabled' : '') + '>' + e(v) + '</textarea></td>';
  }
  function sel(i, k, v, list, dis) {
    return '<td><select class="bg-in bg-sel" data-action="bg-edit" data-row="' + i + '" data-key="' + k + '"' + (dis ? ' disabled' : '') + '>' +
      list.map(o => '<option value="' + e(o.v) + '"' + (String(v) === String(o.v) ? ' selected' : '') + '>' + e(o.l) + '</option>').join('') +
      '</select></td>';
  }
  function rowHtml(r, i) {
    const dis = !!r._deleted, cls = 'bg-row' + (dis ? ' is-del' : (r._errors && r._errors.length ? ' is-bad' : ''));
    const id = String(r.question_id || '');
    const ops = dis
      ? '<span class="link" data-action="bg-del" data-row="' + i + '">撤销删除</span>'
      : '<span class="link" data-action="bg-form" data-row="' + i + '">编辑</span> · ' +
        (id && store.question(id) ? '<span class="link" data-action="ai-explain" data-id="' + e(id) + '">✦ AI 讲解</span> · ' +
          '<span class="link" data-action="bg-fav" data-row="' + i + '">收藏</span> · ' : '') +
        '<span class="link" data-action="bg-del" data-row="' + i + '">删除</span>';
    return '<tr class="' + cls + '" data-row="' + i + '">' +
      '<td><div class="bg-no">' + (i + 1) + '</div><div class="bg-err" id="bg-err-' + i + '">' + (dis ? '<div class="bg-err-item">已标记删除</div>' : errHtml(r)) + '</div></td>' +
      sel(i, 'type', r.type, TYPES, dis) +
      area(i, 'stem', r.stem, 3, dis) +
      OPT.map(k => inp(i, k, r[k], dis)).join('') +
      inp(i, 'answer', r.answer, dis) +
      area(i, 'analysis', r.analysis, 2, dis) +
      inp(i, 'category', r.category, dis) +
      sel(i, 'difficulty', r.difficulty, DIFFS, dis) +
      '<td class="bg-ops">' + ops + '</td></tr>';
  }

  /* ---------- 页面 ---------- */
  P.bankGrid = function (app) {
    app = app || Quiz.app || {ui:{}};
    ensureState(app);
    const banks = store.banks(), c = stats();
    const visible = S.rows.map((r, i) => ({r, i})).filter(x => !S.onlyErrors || (!x.r._deleted && x.r._errors && x.r._errors.length));
    const back = S.mode === 'import' ? 'importReview' : 'bank';
    let h = '<section class="card bg-card"><h2>试题表格编辑</h2>' +
      '<p class="hint">第一步选择题库，第二步直接在表格里修改试题，第三步保存。报错行复用导入校验同一套 E001–E010 规则；未保存前不会写入题库。</p>';

    /* v1.12.4：文档导入成功后的横幅 —— 提示可直接编辑，并提供「继续添加」回到导入页并锁定本题库 */
    if (S.afterImport) h += '<div class="imp-after bg-after">✓ 导入成功：已入库 <b>' + S.afterImport.inserted + '</b> 题到题库「<b>' + e(S.afterImport.bankName) + '</b>」，可直接在下方表格中编辑，改完点「保存修改」' +
      '<button class="btn btn-sm btn-primary" data-action="bg-continue">✚ 继续添加</button>' +
      '<span class="small faint">点「继续添加」后，下次上传的文件将导入到本题库</span></div>';
    h += '<div class="bg-bar">' +
      '<a class="link bg-back" href="#/' + back + '">‹ 返回</a>' +
      '<label class="bg-bank-label">题库 <select id="bg-bank" data-action="bg-bank">' +
        banks.map(b => '<option value="' + e(b.bank_id) + '"' + (b.bank_id === S.bankId ? ' selected' : '') + '>' + e(b.name) + '</option>').join('') +
      '</select></label>' +
      '<div class="bg-stats" id="bg-stats">' + statsHtml() + '</div>' +
      '<button class="btn btn-sm' + (S.onlyErrors ? ' btn-primary' : '') + '" data-action="bg-only">' + (S.onlyErrors ? '显示全部' : '只看报错') + '</button>' +
      '<button class="btn btn-sm" data-action="bg-recheck">重新检测</button>' +
      '<button class="btn btn-sm" data-action="bg-add">＋ 新增试题</button>' +
      '<span class="bg-note">注意：点击表格单元格可直接修改，' + (S.mode === 'import' ? '确认无误后点「录入试题」' : '确认无误后点「保存修改」') + '</span>' +
      '</div>';

    h += '<div class="bg-meta">' +
      '<span>当前题库：<b>' + e(bankName(S.bankId)) + '</b></span>' +
      (S.sourceName ? '<span>来源：<b>' + e(S.sourceName) + '</b></span>' : '') +
      '<span id="bg-dirty" class="' + (S.dirty ? 'bg-red' : '') + '">' + dirtyText() + '</span>' +
      (S.message ? '<span class="bg-msg">' + e(S.message) + '</span>' : '') +
      '<span class="spacer"></span><span class="small muted">显示 ' + visible.length + ' / ' + c.total + ' 题</span></div>';

    if (!S.rows.length) {
      h += '<div class="empty"><span class="e-icon">▤</span>该题库暂无试题，可点「新增试题」或返回文档导入</div>';
    } else if (!visible.length) {
      h += '<div class="empty"><span class="e-icon">✓</span>' + (S.onlyErrors ? '没有报错行，全部题目格式检查通过' : '没有可显示的题目') + '</div>';
    } else {
      h += '<div class="bg-wrap"><table class="bg-table"><thead><tr>' +
        '<th style="width:56px">序号</th><th style="width:100px">题型</th><th style="min-width:230px">题干</th>' +
        OPT.map((k, n) => '<th style="min-width:110px">选项' + 'ABCDEFGH'[n] + '</th>').join('') +
        '<th style="min-width:96px">正确答案</th><th style="min-width:150px">解析</th><th style="min-width:110px">章节</th>' +
        '<th style="width:96px">难度</th><th style="width:168px">操作</th></tr></thead><tbody>' +
        visible.map(x => rowHtml(x.r, x.i)).join('') + '</tbody></table></div>';
    }

    h += '<div class="bg-foot">' +
      '<button class="btn" data-action="bg-download">下载表格</button>' +
      '<button class="btn btn-primary" data-action="' + (S.mode === 'import' ? 'bg-save-import' : 'bg-save') + '">' +
        (S.mode === 'import' ? '录入试题' : '保存修改') + '</button>' +
      '<button class="btn" data-action="bg-reload">重新载入</button>' +
      '<button class="btn" data-action="bg-reupload">重新上传</button>' +
      '<span class="small muted">删除为标记式，保存后才生效；隐藏字段（标签 / 分值 / 来源 / 状态）随行保留</span></div>';
    return h + '</section>';
  };

  /* ---------- 动作（脚本在 app.js 之前加载，拦截 bg-* 避免通用 change 整页重绘丢焦点） ---------- */
  function onAction(a, el) {
    const i = Number(el.dataset.row), r = S.rows[i];
    switch (a) {
      case 'bg-open': {
        const from = (Quiz.app && Quiz.app.currentBankId) ? Quiz.app.currentBankId() : store.defaultBankId();
        openFromBank(from);
        go('bankGrid');
        toast('已打开「' + bankName(S.bankId) + '」的试题表格', 'ok');
        return true;
      }
      case 'bg-from-review': {
        const rev = Quiz.importReview;
        if (!rev || !rev.buildCsv) { toast('导入校验模块不可用', 'err'); return true; }
        const built = rev.buildCsv();
        if (!built.ok) { toast(built.message || '请先完成字段匹配', 'err'); return true; }
        const fileName = (rev.state && rev.state.fileName) || '';
        openFromCsv(built.csv, {fileName, bankId:Quiz.app && Quiz.app.ui && Quiz.app.ui.imp && Quiz.app.ui.imp.bankId});
        go('bankGrid');
        toast('已载入 ' + S.rows.length + ' 条待录入试题，请先核对目标题库', 'ok');
        return true;
      }
      case 'bg-only': S.onlyErrors = !S.onlyErrors; renderNow(); return true;
      case 'bg-recheck': {
        const n = validateRows(); renderNow();
        toast(n ? '检测完成：' + n + ' 行有格式错误' : '检测完成：全部通过', n ? 'err' : 'ok');
        return true;
      }
      case 'bg-add': S.rows.push(blankRow()); S.rows[S.rows.length - 1]._i = S.rows.length - 1;
        S.dirty = true; validateRows(); renderNow(); toast('已追加一行，填写后保存', 'ok'); return true;
      case 'bg-download': util.download('题库试题表格.csv', toCsv(), 'text/csv'); toast('表格已下载', 'ok'); return true;
      case 'bg-reload': reload(); return true;
      case 'bg-reupload':
        if (S.dirty && !ask('有未保存的修改，确定离开并返回文档导入吗？')) return true;
        S.rows = []; S.dirty = false; S.sourceCsv = ''; S.afterImport = null; go('import'); return true;
      /* v1.12.4：继续添加 —— 锁定当前题库为后续导入目标，返回文档导入页 */
      case 'bg-continue': {
        if (Quiz.app && Quiz.app.ui && Quiz.app.ui.imp) Quiz.app.ui.imp.continueBankId = S.bankId;
        S.afterImport = null;
        go('import');
        toast('继续添加已开启：下次上传的文件将导入到题库「' + bankName(S.bankId) + '」', 'ok');
        return true;
      }
      case 'bg-save': saveBank(); return true;
      case 'bg-save-import': saveImport(); return true;
      case 'bg-del':
        if (!r) return true;
        r._deleted = !r._deleted; S.dirty = true; validateRows(); renderNow(); return true;
      case 'bg-fav': {
        if (!r) return true;
        const id = String(r.question_id || '');
        if (!id || !store.question(id)) { toast('该行尚未入库，保存后即可收藏', 'err'); return true; }
        const on = store.toggleFavorite(id, defFolder());
        toast(on ? '已加入默认收藏夹' : '已取消收藏', 'ok'); return true;
      }
      case 'bg-form': {
        if (!r) return true;
        const id = String(r.question_id || '');
        if (!id || !store.question(id)) { toast('该行尚未入库，请在表格里直接编辑或先保存', 'err'); return true; }
        if (Quiz.app && Quiz.app.openQuestionForm) { Quiz.app.openQuestionForm(id); return true; }
        return false;
      }
      default: return false;
    }
  }
  function onChange(a, el, target) {
    if (a === 'bg-bank') {
      const id = target.value;
      if (id === S.bankId) return true;
      if (S.mode === 'bank') {
        if (S.dirty && !ask('切换题库会放弃当前未保存的修改，确定继续吗？')) { target.value = S.bankId; return true; }
        openFromBank(id);
      } else {
        S.bankId = safeBank(id);
        if (Quiz.app && Quiz.app.ui && Quiz.app.ui.imp) Quiz.app.ui.imp.bankId = S.bankId;
      }
      renderNow(); return true;
    }
    if (a === 'bg-edit') {
      const i = Number(el.dataset.row), k = el.dataset.key, r = S.rows[i];
      if (!r || !k) return true;
      if (String(r[k]) !== String(target.value)) { r[k] = target.value; S.dirty = true; }
      validateRows();
      /* 局部刷新：只更新本行报错标注、行样式与顶部统计，避免整页重绘导致输入焦点丢失 */
      try {
        const box = global.document && global.document.getElementById('bg-err-' + i);
        if (box) box.innerHTML = r._deleted ? '<div class="bg-err-item">已标记删除</div>' : errHtml(r);
        const tr = el.closest && el.closest('tr');
        if (tr) tr.className = 'bg-row' + (r._deleted ? ' is-del' : (r._errors.length ? ' is-bad' : ''));
        const st = global.document && global.document.getElementById('bg-stats');
        if (st) st.innerHTML = statsHtml();
        const dt = global.document && global.document.getElementById('bg-dirty');
        if (dt) { dt.textContent = dirtyText(); dt.className = S.dirty ? 'bg-red' : ''; }
      } catch (err) {}
      return true;
    }
    return false;
  }
  try {
    global.document.addEventListener('click', function (ev) {
      const el = ev.target && ev.target.closest && ev.target.closest('[data-action^="bg-"]');
      if (!el) return;
      if (!onAction(el.dataset.action, el)) return;
      if (ev.stopImmediatePropagation) ev.stopImmediatePropagation();
    });
    global.document.addEventListener('change', function (ev) {
      const el = ev.target && ev.target.closest && ev.target.closest('[data-action^="bg-"]');
      if (!el) return;
      if (!onChange(el.dataset.action, el, ev.target)) return;
      if (ev.stopImmediatePropagation) ev.stopImmediatePropagation();
    });
  } catch (err) {}

  Quiz.bankGrid = {state:S, KEYS, OPT, openFromBank, openFromCsv, reload, validateRows, stats, statsHtml,
    errHtml, toCsv, csvToRows, questionToRow, blankRow, saveBank, saveImport, onAction, onChange};
  if (typeof module !== 'undefined' && module.exports) module.exports = Quiz.bankGrid;
})(typeof window !== 'undefined' ? window : globalThis);
