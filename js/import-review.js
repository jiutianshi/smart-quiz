/* v1.3.3 文档导入校验页（纯增量）
   参考图的三步流程：① 选择表单 ② 选择表头在第几行 ③ 点击蓝色框做字段匹配。
   确认前预览前 8 条并做格式检查；确认后复用 office.adaptRows → toCsv → importer.runImport，
   因此 E001–E010 校验、三级去重、人工确认队列、目标题库与既有导入完全一致。
   页面状态只存内存，不写 localStorage、不写入任何示例题目。 */
(function (global) {
  const Quiz = global.Quiz;
  const P = Quiz.pages, importer = Quiz.importer, util = Quiz.util;
  const e = v => util.esc(v == null ? '' : String(v));

  const FIELDS = [
    {k:'stem', label:'题干（必填）', req:true},
    {k:'type', label:'题型（必填）', req:true},
    {k:'option_a', label:'选项A'}, {k:'option_b', label:'选项B'},
    {k:'option_c', label:'选项C'}, {k:'option_d', label:'选项D'},
    {k:'option_e', label:'选项E'}, {k:'option_f', label:'选项F'},
    {k:'option_g', label:'选项G'}, {k:'option_h', label:'选项H'},
    {k:'answer', label:'正确答案（必填）', req:true},
    {k:'analysis', label:'解析'}, {k:'category', label:'章节'}, {k:'difficulty', label:'难度'},
    {k:'tags', label:'标签'}, {k:'score', label:'分值'}, {k:'source', label:'来源'},
    {k:'question_id', label:'题号'}, {k:'status', label:'状态'},
    {k:'', label:'这列不导入'}
  ];
  const LABEL = Object.fromEntries(FIELDS.map(f => [f.k, f.label.replace(/（必填）/, '（必选）')]));
  const KEYS = importer.COLS.map(c => c.key);
  const REQUIRED = importer.COLS.filter(c => c.required).map(c => c.key);
  const OPTION_KEYS = ['option_a','option_b','option_c','option_d','option_e','option_f','option_g','option_h'];
  const S = Quiz.importReviewState = {
    text:'', rows:[], headerRow:0, map:[], popupCol:-1, preview:8,
    sheetNames:[], sheetIndex:0, sheetAsCategory:false,
    file:null, fileName:'', note:''
  };

  /* ---------- 原始二维表（保留说明行，支持 CSV 引号与自动分隔符） ---------- */
  function splitRows(text) {
    const s = String(text || '').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const first = s.split('\n')[0] || '';
    const d = (first.split('\t').length - 1) > (first.split(',').length - 1) ? '\t' : ',';
    const rows = []; let row = [], cur = '', inQ = false;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (inQ) {
        if (c === '"') { if (s[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
        else cur += c;
      } else if (c === '"') inQ = true;
      else if (c === d) { row.push(cur); cur = ''; }
      else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
      else cur += c;
    }
    if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
    return rows.filter(r => r.some(x => String(x).trim() !== ''));
  }
  function detectHeader(rows) {
    for (let i = 0; i < Math.min(rows.length, 12); i++) {
      const h = rows[i].map(x => importer.normalizeHeader(x));
      if (h.includes('stem') && (h.includes('type') || h.includes('answer'))) return i;
    }
    return 0;
  }
  function autoMap(rows, h) {
    const used = new Set();
    return (rows[h] || []).map(cell => {
      const k = importer.normalizeHeader(cell);
      if (KEYS.includes(k) && !used.has(k)) { used.add(k); return k; }
      return '';
    });
  }
  function normalize() {
    S.rows = splitRows(S.text);
    if (S.headerRow >= S.rows.length) S.headerRow = 0;
    S.headerRow = detectHeader(S.rows);
    S.map = autoMap(S.rows, S.headerRow);
    S.popupCol = -1;
  }
  function open(text, meta) {
    meta = meta || {};
    S.text = String(text || '');
    S.file = meta.file || null;
    S.fileName = meta.fileName || '';
    S.sheetNames = (meta.sheets || []).slice();
    S.sheetIndex = 0;
    S.popupCol = -1;
    S.preview = 8;
    S.note = '';
    normalize();
    /* 异步补齐 xlsx 工作表名，不阻塞进入页面 */
    if (S.file && /\.xlsx$/i.test(S.fileName) && !S.sheetNames.length) {
      try {
        Quiz.office.xlsxSheetNames(S.file).then(list => {
          S.sheetNames = list.map(x => x.name);
          if (Quiz.app && Quiz.app.render) Quiz.app.render();
        }).catch(() => {});
      } catch (x) {}
    }
    return S;
  }
  function reset() {
    S.text = ''; S.rows = []; S.headerRow = 0; S.map = []; S.popupCol = -1;
    S.sheetNames = []; S.sheetIndex = 0; S.sheetAsCategory = false;
    S.file = null; S.fileName = ''; S.note = '';
  }
  function setHeaderRow(n) {
    const i = Math.max(0, Math.min(S.rows.length - 1, Number(n) || 0));
    S.headerRow = i; S.map = autoMap(S.rows, i); S.popupCol = -1;
    return S;
  }
  function setMap(col, key) {
    const c = Number(col);
    if (c < 0 || c >= S.map.length) return S;
    if (key && S.map.some((k, i) => i !== c && k === key)) S.map = S.map.map((k, i) => i !== c && k === key ? '' : k);
    S.map[c] = key || '';
    S.popupCol = -1;
    return S;
  }
  function openPicker(col) { S.popupCol = Number(col); return S; }
  function closePicker() { S.popupCol = -1; return S; }
  function setSheetAsCategory(on) { S.sheetAsCategory = !!on; return S; }
  function setPreview(n) { S.preview = Math.max(1, Math.min(200, Number(n) || 8)); return S; }
  function currentSheetName() { return S.sheetNames[S.sheetIndex] || (S.fileName || '').replace(/\.[^.]+$/, '') || 'Sheet1'; }
  async function selectSheet(i) {
    S.sheetIndex = Math.max(0, Math.min(Math.max(0, S.sheetNames.length - 1), Number(i) || 0));
    if (!S.file) return S;
    try {
      const csv = await Quiz.office.readXlsx(S.file, S.sheetIndex);
      S.text = csv; normalize();
      S.note = '已切换到表单「' + currentSheetName() + '」';
    } catch (err) { S.note = '切换表单失败：' + err.message; }
    return S;
  }

  /* ---------- 组装标准表：复用 office.adaptRows 全部既有规则 ---------- */
  function rawTable() {
    const head = S.map.slice();
    if (S.sheetAsCategory && !head.includes('category')) head.push('category');
    const out = [head];
    for (let i = S.headerRow + 1; i < S.rows.length; i++) {
      const r = S.rows[i];
      if (!r.some(x => String(x).trim() !== '')) continue;
      const line = S.map.map((_, c) => r[c] == null ? '' : String(r[c]));
      if (S.sheetAsCategory && !S.map.includes('category')) line.push(currentSheetName());
      out.push(line);
    }
    return out;
  }
  function buildCsv() {
    if (!S.rows.length) return {ok:false, message:'没有可校验的数据，请先选择文件或粘贴内容'};
    const raw = rawTable();
    const adapted = Quiz.office.adaptRows(raw, '文档导入校验');
    const head = adapted[0] || [];
    const missing = REQUIRED.filter(k => !head.includes(k));
    if (missing.length) {
      const names = {type:'题型', stem:'题干', answer:'正确答案'};
      return {ok:false, message:'必填字段未匹配：' + missing.map(k => names[k] || k).join('、') + '，请点击对应蓝色按钮设置'};
    }
    return {ok:true, csv: Quiz.office.toCsv(adapted), rows: adapted.length - 1, head,
      note: Quiz.office.notice, raw: adapted};
  }
  function stats() {
    const b = buildCsv();
    const total = Math.max(0, S.rows.length - S.headerRow - 1);
    const mapped = S.map.filter(Boolean);
    return {
      total, imported: b.ok ? b.rows : 0, skipped: b.ok ? Math.max(0, total - b.rows) : total,
      missing: b.ok ? [] : (b.message || '').replace('必填字段未匹配：', '').replace('，请点击对应蓝色按钮设置', ''),
      mappedCount: mapped.length, ok: b.ok, message: b.message || b.note || '', raw: b.raw || []
    };
  }
  function rowStatus(row) {
    const t = importer.normalizeType(row.type || '');
    if (!['single','multiple','judge'].includes(t)) return {cls:'ir-bad', text:'暂不支持'};
    if (!String(row.stem || '').trim()) return {cls:'ir-bad', text:'缺题干'};
    if (!String(row.answer || '').trim()) return {cls:'ir-warn', text:'缺答案'};
    return {cls:'ir-ok', text:'通过'};
  }

  /* ---------- 页面 ---------- */
  function fieldPopup() {
    if (S.popupCol < 0) return '';
    const col = S.popupCol, cur = S.map[col] || '';
    const raw = (S.rows[S.headerRow] || [])[col] || ('第 ' + (col + 1) + ' 列');
    return '<div class="ir-popup" style="left:' + Math.min(col * 116, 620) + 'px">' +
      '<div class="ir-popup-h">考试宝字段</div>' +
      '<div class="small muted">根据试题内容，选择对应的系统字段</div>' +
      '<div class="small faint ir-popup-col">当前列：' + e(String(raw).slice(0, 30)) + '</div>' +
      '<div class="ir-fields">' + FIELDS.filter(f => f.k !== '').map(f =>
        '<button class="ir-field' + (cur === f.k ? ' on' : '') + '" data-action="ir-set" data-col="' + col + '" data-key="' + f.k + '">' + e(f.label) + '</button>').join('') + '</div>' +
      '<div class="ir-popup-line"></div>' +
      '<div class="row"><button class="btn btn-sm" data-action="ir-set" data-col="' + col + '" data-key="">这列不导入</button>' +
      '<span class="spacer"></span><button class="btn btn-sm btn-primary" data-action="ir-picker-close">确定</button></div>' +
      '</div>';
  }
  function previewTable() {
    const b = buildCsv();
    if (!b.ok) return '<div class="notice-bar">' + e(b.message) + '</div>';
    const head = b.head, body = b.raw.slice(1);
    const cols = head.filter(k => k !== 'status');
    const shown = body.slice(0, S.preview);
    return '<div class="table-wrap"><table class="tbl ir-table"><thead><tr>' +
      cols.map(k => '<th>' + e(LABEL[k] || k) + '</th>').join('') + '<th>格式检查</th></tr></thead><tbody>' +
      shown.map(r => {
        const obj = {}; head.forEach((k, i) => { obj[k] = r[i] == null ? '' : r[i]; });
        const st = rowStatus(obj);
        return '<tr>' + cols.map(k => '<td><div class="ir-ellip" title="' + e(obj[k] || '') + '">' + e(obj[k] || '') + '</div></td>').join('') +
          '<td><span class="ir-badge ' + st.cls + '">' + e(st.text) + '</span></td></tr>';
      }).join('') + '</tbody></table></div>' +
      (body.length > S.preview ? '<div class="small faint" style="margin-top:8px">仅预览前 ' + S.preview + ' 条，确认导入时处理全部 ' + body.length + ' 条可入库数据。</div>' : '');
  }
  P.importReview = function () {
    const st = stats();
    const cols = S.map.length ? S.map : [''];
    let h = '<section class="card"><h2>文档导入校验</h2>' +
      '<p class="hint">按三步确认解析结果：选择表单 → 选择表头行 → 点击蓝色框设置字段匹配。确认前可预览题目与格式检查结果，原有「校验并导入」入口保持不变。</p>';

    /* 三步 */
    h += '<div class="ir-steps">' +
      '<div class="ir-step"><div class="ir-step-t">第一步：选择表单</div>' +
        '<div class="ir-sheets">' + (S.sheetNames.length ? S.sheetNames : ['Sheet1']).map((n, i) =>
          '<button class="ir-sheet' + (i === S.sheetIndex ? ' on' : '') + '" data-action="ir-sheet" data-index="' + i + '">' +
          '<i></i>' + e(n) + '</button>').join('') + '</div>' +
        '<div class="small faint">打开表格，左下角底部就是表单（Sheet）。' +
          (S.sheetNames.length > 1 ? '本文件共 ' + S.sheetNames.length + ' 个表单，点击切换。' : '当前版本自动读取第一个工作表。') + '</div>' +
        '<label class="check ir-check"><input type="checkbox" data-action="ir-sheet-cat"' + (S.sheetAsCategory ? ' checked' : '') + '> 将表单名称默认为章节名</label></div>' +
      '<div class="ir-step"><div class="ir-step-t">第二步：选择表头在第几行</div>' +
        '<select class="ir-select" data-action="ir-header">' +
        Array.from({length: Math.min(12, Math.max(1, S.rows.length))}, (_, i) =>
          '<option value="' + i + '"' + (i === S.headerRow ? ' selected' : '') + '>第 ' + (i + 1) + ' 行</option>').join('') +
        '</select>' +
        '<div class="small faint">表头含义：包含题目、题型、选项 ABCD、答案、解析、章节、分类等。若前面有填写说明行，请切换到真正的表头行；系统已自动识别第 ' + (S.headerRow + 1) + ' 行。</div></div>' +
      '<div class="ir-step"><div class="ir-step-t">第三步：点击蓝色框设置字段</div>' +
        '<div class="small faint">点击蓝色框按钮，把该列内容与系统字段对应上。题型、题干、正确答案为必选项；未匹配的列不会被导入。</div></div>' +
      '</div>';

    /* 字段匹配按钮行 + 弹窗 */
    h += '<div class="ir-mapbar"><div class="ir-cols">' + cols.map((k, i) => {
      const raw = (S.rows[S.headerRow] || [])[i] || '';
      const label = k ? (LABEL[k] || k) : '未匹配';
      return '<button class="ir-col' + (k ? '' : ' off') + '" data-action="ir-picker" data-col="' + i + '" title="' + e(raw) + '">' +
        e(label) + ' <span class="ir-caret">▾</span></button>';
    }).join('') + '</div>' + fieldPopup() + '</div>';

    /* 统计与预览 */
    h += '<div class="ir-summary">' +
      '<span class="badge b-blue">共 ' + st.total + ' 条数据</span>' +
      '<span class="badge b-green">可导入 ' + st.imported + ' 条</span>' +
      '<span class="badge b-orange">跳过 ' + st.skipped + ' 条</span>' +
      (st.ok ? '<span class="badge b-gray">已匹配 ' + st.mappedCount + ' 列</span>' : '<span class="badge b-red">' + e(st.message) + '</span>') +
      '</div>';
    h += previewTable();
    h += '<div class="small muted" style="margin-top:10px">文件中含有 ' + st.total + ' 条数据，当前只预览前 ' + Math.min(S.preview, st.imported) + ' 条' +
      (S.fileName ? ' · 来源：' + e(S.fileName) : '') + (S.note ? ' · ' + e(S.note) : '') + '</div>';
    h += '<div class="row" style="margin-top:12px">' +
      '<button class="btn btn-primary" data-action="ir-confirm">检查题目格式，完成数据匹配并开始导入</button>' +
      '<button class="btn" data-action="bg-from-review">▦ 打开纠错表格（先选题库，再改题）</button>' +
      '<button class="btn" data-action="ir-cancel">取消导入</button></div>';
    return h + '</section>';
  };

  Quiz.importReview = {state:S, FIELDS, LABEL, open, reset, splitRows, detectHeader, autoMap, normalize,
    setHeaderRow, setMap, openPicker, closePicker, setSheetAsCategory, setPreview, selectSheet,
    rawTable, buildCsv, stats, rowStatus, currentSheetName};
  if (typeof module !== 'undefined' && module.exports) module.exports = Quiz.importReview;
})(typeof window !== 'undefined' ? window : globalThis);
