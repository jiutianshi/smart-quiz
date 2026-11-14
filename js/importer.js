/* 文档导入：CSV / TSV 解析、字段校验、错误码、三级去重（方案第 2 节） */
(function (global) {
  const Quiz = global.Quiz = global.Quiz || {};
  const util = Quiz.util;

  const COLS = [
    {key:'question_id', label:'题目ID', required:false, desc:'选填，无需手动编号；留空由系统按行自动生成'},
    {key:'type', label:'题型', required:true, desc:'single / multiple / judge，仅小写'},
    {key:'stem', label:'题干', required:true, desc:'纯题干，trim 后 1–1000 字符'},
    {key:'option_a', label:'选项A', required:false, desc:'单选/多选必填 ≥2；判断题留空'},
    {key:'option_b', label:'选项B', required:false, desc:'同上'},
    {key:'option_c', label:'选项C', required:false, desc:'同上'},
    {key:'option_d', label:'选项D', required:false, desc:'同上'},
    {key:'option_e', label:'选项E', required:false, desc:'同上'},
    {key:'option_f', label:'选项F', required:false, desc:'同上'},
    {key:'option_g', label:'选项G', required:false, desc:'考试宝模板扩展列，最多 8 个选项'},
    {key:'option_h', label:'选项H', required:false, desc:'考试宝模板扩展列，最多 8 个选项'},
    {key:'answer', label:'正确答案', required:true, desc:'单选单个字母；多选逗号分隔；判断 T/F/正确/错误'},
    {key:'analysis', label:'解析', required:false, desc:'≤2000 字符'},
    {key:'category', label:'分类', required:false, desc:'多级用 / 分隔，默认「未分类」'},
    {key:'tags', label:'标签', required:false, desc:'分号 ; 分隔，≤10 个'},
    {key:'difficulty', label:'难度', required:false, desc:'1–5 或 easy/medium/hard，默认 3'},
    {key:'score', label:'分值', required:false, desc:'(0,100]，默认 1'},
    {key:'source', label:'来源', required:false, desc:'批次/教材标识，用于追溯'},
    {key:'status', label:'状态', required:false, desc:'draft / published / disabled，默认 draft'}
  ];
  const KEYS = COLS.map(c => c.key);
  const REQUIRED = COLS.filter(c => c.required).map(c => c.key);
  const OPTION_KEYS = ['option_a','option_b','option_c','option_d','option_e','option_f','option_g','option_h'];

  /* 表头别名：Word / Excel 模板可用中文表头，英文大小写不敏感 */
  const HEADER_ALIASES = {
    '题目ID':'question_id', '题目id':'question_id', '题号':'question_id', '题目编号':'question_id', '编号':'question_id',
    '题型':'type', '题目类型':'type', '类型':'type',
    '题干':'stem', '题目':'stem', '题目内容':'stem',
    '试题':'stem', '试题内容':'stem', '题面':'stem', '问题':'stem', '题目名称':'stem', '题目描述':'stem',
    '选项A':'option_a','选项B':'option_b','选项C':'option_c','选项D':'option_d','选项E':'option_e','选项F':'option_f',
    '选项G':'option_g','选项H':'option_h',
    '选项a':'option_a','选项b':'option_b','选项c':'option_c','选项d':'option_d','选项e':'option_e','选项f':'option_f',
    '选项g':'option_g','选项h':'option_h',
    '正确答案':'answer', '答案':'answer', '正确答案(必填)':'answer',
    '参考答案':'answer', '标准答案':'answer', '正确选项':'answer', '答案选项':'answer',
    '解析':'analysis', '答案解析':'analysis', '解析说明':'analysis', '试题分析':'analysis',
    '分类':'category', '科目':'category', '知识点分类':'category', '章节':'category', '所属章节':'category',
    '标签':'tags', '难度':'difficulty', '难易度':'difficulty',
    '分值':'score', '分数':'score', '来源':'source', '状态':'status'
  };
  /* 考试宝表头含换行与「(必填)/(勿删)」等括注，先清洗再查别名 */
  function normalizeHeader(h) {
    const k = String(h || '')
      .replace(/[\r\n]+/g, '')
      .replace(/[（(][^）)]*[）)]/g, '')
      .replace(/[\/、:：,，\s]+$/g, '')
      .replace(/\s+/g, '')
      .trim();
    if (HEADER_ALIASES[k]) return HEADER_ALIASES[k];
    const lower = k.toLowerCase();
    if (HEADER_ALIASES[lower]) return HEADER_ALIASES[lower];
    return KEYS.includes(lower) ? lower : k;
  }

  /* 考试宝等中文模板的题型别名；未知值原样返回，由 E002 统一报错 */
  const TYPE_ALIASES = {
    '单选题':'single', '单选':'single', '单项选择':'single', '单项选择题':'single',
    '多选题':'multiple', '多选':'multiple', '多项选择':'multiple', '多项选择题':'multiple',
    '不定项选择题':'multiple', '不定项选择':'multiple', '不定项':'multiple',
    '判断题':'judge', '判断':'judge', '判断正误':'judge'
  };
  function normalizeType(raw) {
    const s = String(raw == null ? '' : raw).trim();
    return TYPE_ALIASES[s] || s.toLowerCase();
  }
  const DIFFICULTY_ALIASES = {easy:1, medium:3, hard:5, '易':1, '偏易':2, '适中':3, '偏难':4, '难':5, '简单':1, '中等':3, '困难':5};

  const SAMPLE_CSV = [
    'question_id,type,stem,option_a,option_b,option_c,option_d,option_e,option_f,answer,analysis,category,tags,difficulty,score,source,status',
    'Q001,single,下列哪个是 HTTP 协议的默认端口？,21,80,443,3306,,,B,"80 是 HTTP 默认端口；443 用于 HTTPS。",计算机网络/协议,基础;网络,1,2,2024题库V1,published',
    'Q002,multiple,以下属于关系型数据库的有？,MySQL,Redis,PostgreSQL,MongoDB,,,"A,C","MySQL 与 PostgreSQL 为关系型；Redis 为键值缓存，MongoDB 为文档型。",数据库/选型,"SQL;面试高频",3,4,2024题库V1,published',
    'Q003,judge,HTTP 协议本身是无状态的。,,,,,,,T,"无状态指服务端不保留上一次请求上下文。",计算机网络/协议,基础,1,1,2024题库V1,published'
  ].join('\n');

  const ERRORS = {
    E001:'表头缺失或含未知列', E002:'题型非法', E003:'题干为空或超长',
    E004:'答案格式非法', E005:'答案引用了不存在的选项', E006:'选项数量不足或为空',
    E007:'分值/难度越界', E008:'同文件内题目 ID 重复', E009:'内容指纹与库内重复',
    E010:'编码/解析失败', W001:'判断题填写了选项列（已丢弃）'
  };

  function norm(s) {
    return String(s == null ? '' : s)
      .replace(/[\uFF01-\uFF5E]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
      .replace(/\u3000/g, ' ').replace(/\s+/g, ' ').trim();
  }

  /* 支持引号包裹、双引号转义、引号内换行；自动识别逗号或制表符分隔 */
  function parseDelimited(text) {
    text = String(text || '').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const first = text.split('\n')[0] || '';
    const delim = (first.split('\t').length - 1) > (first.split(',').length - 1) ? '\t' : ',';
    const rows = []; let row = [], cur = '', inQ = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQ) {
        if (c === '"') { if (text[i+1] === '"') { cur += '"'; i++; } else inQ = false; }
        else cur += c;
      } else if (c === '"') inQ = true;
      else if (c === delim) { row.push(cur); cur = ''; }
      else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
      else cur += c;
    }
    if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
    if (!rows.length) throw new Error('E010：文件为空或无法解析');
    const headers = rows.shift().map(h => normalizeHeader(norm(h)));
    return {headers, rows: rows.filter(r => r.some(c => String(c).trim() !== '')), delim};
  }

  function parseAnswer(type, raw) {
    const s = norm(raw).toUpperCase();
    if (type === 'judge') {
      const map = {'T':true,'TRUE':true,'正确':true,'对':true,'是':true,'YES':true,'Y':true,'√':true,'A':true,
                   'F':false,'FALSE':false,'错误':false,'错':false,'否':false,'NO':false,'N':false,'×':false,'B':false};
      if (!(s in map)) return {error: 'E004'};
      return {answer: {value: map[s]}};
    }
    const tokens = s.split(/[,，;；、|｜\s]+/).filter(Boolean);
    // 非 A–H 字符属于格式错误 E004；合法字母但无对应选项属于 E005（由 rowToQuestion 判定）
    const letters = [];
    for (const t of tokens) {
      if (/^[A-H]$/.test(t)) letters.push(t);
      else if (/^[A-H]{2,}$/.test(t)) Array.prototype.push.apply(letters, t.split(''));  // 考试宝「ABCD」连写
      else return {error: 'E004'};
    }
    if (!letters.length) return {error: 'E004'};
    const keys = Array.from(new Set(letters)).sort();
    if (type === 'single' && keys.length !== 1) return {error: 'E004'};
    if (type === 'multiple' && keys.length < 2) return {error: 'E004'};
    return {answer: {keys}};
  }

  function rowToQuestion(row, index) {
    const errors = [], warnings = [];
    const get = k => norm(row[k] === undefined ? '' : row[k]);
    const push = (code, field, msg) => errors.push({row: index, field, code, message: msg || ERRORS[code]});

    const type = normalizeType(get('type'));
    if (!['single','multiple','judge'].includes(type)) push('E002', 'type');
    const stem = get('stem');
    if (!stem || stem.length > 1000) push('E003', 'stem');

    const options = [];
    OPTION_KEYS.forEach((k, i) => { const v = get(k); if (v) options.push({key: 'ABCDEFGH'[i], text: v}); });
    if (type !== 'judge' && options.length < 2) push('E006', 'option_a..option_f');
    if (type === 'judge' && options.length) warnings.push({row:index, field:'option_*', code:'W001', message: ERRORS.W001});

    const parsed = parseAnswer(type, get('answer'));
    if (parsed.error) push(parsed.error, 'answer');
    else if (type !== 'judge' && parsed.answer.keys.some(k => !options.some(o => o.key === k))) push('E005', 'answer');

    let difficulty = 3;
    const dRaw = get('difficulty').toLowerCase();
    if (dRaw) {
      const dm = DIFFICULTY_ALIASES;
      difficulty = dRaw in dm ? dm[dRaw] : parseInt(dRaw, 10);
      if (!Number.isInteger(difficulty) || difficulty < 1 || difficulty > 5) { push('E007', 'difficulty'); difficulty = 3; }
    }
    let score = 1;
    const sRaw = get('score');
    if (sRaw) {
      score = Number(sRaw);
      if (!Number.isFinite(score) || score <= 0 || score > 100 || Math.round(score*100)/100 !== score) { push('E007', 'score'); score = 1; }
    }
    const status = get('status') || 'draft';
    if (!['draft','published','disabled'].includes(status)) push('E007', 'status');
    const analysis = get('analysis');
    if (analysis.length > 2000) push('E007', 'analysis');
    const idRaw = get('question_id');
    if (idRaw && !/^[A-Za-z0-9_-]{1,64}$/.test(idRaw)) push('E007', 'question_id');
    const tags = get('tags').split(/[;；]/).map(x => x.trim()).filter(Boolean).slice(0, 10);
    const category = get('category').split('/').map(x => x.trim()).filter(Boolean);
    if (!category.length) category.push('未分类');

    if (errors.length) return {errors, warnings, question: null};
    const fpInput = {stem, type, options};
    const q = {
      /* v1.12.2：用户无需给题目单独设 ID；留空时按「题干 + 题型 + 行号」自动生成，
         同一文件里题干相同的两行也会得到不同 ID，不再触发 E008 整批回滚 */
      question_id: idRaw || ('Q-' + util.hash(stem + '|' + type + '|' + index).slice(0, 12)),
      type, stem, options,
      answer: parsed.answer, analysis,
      category, tags, difficulty, score,
      source: get('source') || '', status,
      fingerprint: util.fingerprint(fpInput.stem, fpInput.type, fpInput.options),
      version: 1, created_at: util.now(), updated_at: util.now()
    };
    const vErrs = Quiz.scorer.validate(q);
    if (vErrs.length) { vErrs.forEach(m => push('E006', 'answer', m)); return {errors, warnings, question: null}; }
    return {errors, warnings, question: q};
  }

  /* ---------- v1.4.1 表头诊断与有限自动修复 ---------- */
  const FIELD_LABEL = {type:'题型', stem:'题干', answer:'正确答案'};
  function csvCell(v) {
    const s = String(v == null ? '' : v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  /** 只读诊断：不改数据，供导入页显示「为什么导入不了」 */
  function headerDiagnosis(text) {
    let p;
    try { p = parseDelimited(text); } catch (e) { return {ok:false, message:e.message}; }
    const missing = REQUIRED.filter(k => !p.headers.includes(k));
    const unknown = p.headers.filter(h => !KEYS.includes(h));
    return {ok:true, headers:p.headers.slice(), missing, unknown, rows:p.rows.length,
      message: missing.length ? '表头缺少必填列：' + missing.map(k => FIELD_LABEL[k] || k).join('、')
        : (unknown.length ? '表头含系统不认识的列：' + unknown.join(', ') : '')};
  }
  /**
   * 从「正确答案：C（…）。解析…」这类题库导出文本中提取答案并补齐 answer 列。
   * 只做文本里明写的内容，不猜测题干；仍缺的列原样返回给调用方提示。
   */
  function repairCsv(text) {
    let p;
    try { p = parseDelimited(text); } catch (e) { return {ok:false, message:e.message}; }
    const headers = p.headers.slice();
    const missing = REQUIRED.filter(k => !headers.includes(k));
    if (!missing.length) return {ok:false, message:'表头已包含全部必填字段，无需修复'};
    const work = p.rows.map(cells => {
      const o = {};
      headers.forEach((h, j) => { o[h] = cells[j] == null ? '' : String(cells[j]); });
      return o;
    });
    const changes = [];
    if (missing.indexOf('answer') >= 0) {
      let n = 0;
      work.forEach(o => {
        if (String(o.answer || '').trim()) return;
        /* 优先解析列，其次其它长文本列 */
        const keys = Object.keys(o).sort((a, b) => (a === 'analysis' ? -1 : 0) - (b === 'analysis' ? -1 : 0));
        for (const k of keys) {
          const v = String(o[k] || '');
          const m = /正确\s*答案\s*[:：]?\s*([A-H]{1,8}(?:\s*[,，、和及|｜]\s*[A-H]{1,8})*|正确|错误|对|错|√|×|T|F)/i.exec(v);
          if (!m) continue;
          const raw = String(m[1]).toUpperCase();
          if (/^(正确|对|√|T)$/.test(raw)) o.answer = 'T';
          else if (/^(错误|错|×|F)$/.test(raw)) o.answer = 'F';
          else o.answer = raw.replace(/[^A-H]/g, '').split('').join(',');
          o[k] = v.replace(/^[\s\S]*?正确\s*答案\s*[:：]?\s*[A-H正确错误对错√×TF][^。；;！!]*[。；;！!]?\s*/i, '').trim();
          n++; break;
        }
      });
      if (n) { headers.push('answer'); changes.push('从文本提取 ' + n + ' 条「正确答案」并补齐 answer 列'); }
    }
    const remaining = REQUIRED.filter(k => !headers.includes(k));
    const csv = [headers.map(csvCell).join(',')]
      .concat(work.map(o => headers.map(h => csvCell(o[h] == null ? '' : o[h])).join(','))).join('\n');
    return {ok:true, csv, changes, remaining,
      message: (changes.length ? changes.join('；') + '。' : '未在文本中发现可提取的「正确答案」。') +
        (remaining.length ? '仍缺少：' + remaining.map(k => FIELD_LABEL[k] || k).join('、') +
          '，请用「打开文档导入校验页」逐列匹配字段，或下载标准模板重填。' : '可直接点「校验并导入」。')};
  }

  /* opts: {duplicate_policy: skip|overwrite|new_version, skip_error_rows: bool} */
  function runImport(text, existing, opts) {
    const o = Object.assign({duplicate_policy:'skip', skip_error_rows:false}, opts || {});
    let parsed;
    try { parsed = parseDelimited(text); }
    catch (e) { return {ok:false, valid:[], reviewQueue:[], report:{total:0, inserted:0, skipped:0, duplicated:0, failed:1, errors:[{row:0,field:'file',code:'E010',message:ERRORS.E010}], warnings:[]}}; }

    const {headers, rows} = parsed;
    const unknown = headers.filter(h => !KEYS.includes(h));
    const missing = REQUIRED.filter(k => !headers.includes(k));
    if (unknown.length || missing.length) {
      return {ok:false, valid:[], reviewQueue:[], report:{total:rows.length, inserted:0, skipped:0, duplicated:0, failed:rows.length,
        atomic_rollback:true, header_diagnosis:{headers:headers.slice(), missing, unknown, rows:rows.length},
        errors:[{row:1, field:'header', code:'E001', message: ERRORS.E001 + (missing.length ? '，缺少：' + missing.map(k => FIELD_LABEL[k] || k).join('、') : '') + (unknown.length ? '，未知列：' + unknown.join(', ') : '')}], warnings:[]}};
    }

    const errors = [], warnings = [], candidates = [];
    const seenIds = new Set();
    rows.forEach((cells, i) => {
      const row = {};
      headers.forEach((h, j) => { row[h] = cells[j] === undefined ? '' : cells[j]; });
      const r = rowToQuestion(row, i + 2);
      errors.push(...r.errors); warnings.push(...r.warnings);
      if (!r.question) return;
      /* v1.12.2：题目 ID 完全由系统负责。万一撞号（例如旧文件手动填了重复编号），
         自动加后缀继续入库，不再产生 E008、不再整批回滚；内容重复仍由 E009 指纹队列处理。 */
      let id = r.question.question_id;
      if (seenIds.has(id)) {
        let k = 2, next;
        do { next = id + '-' + k; k++; } while (seenIds.has(next));
        r.question.question_id = next; id = next;
      }
      seenIds.add(id);
      candidates.push({question: r.question, row: i + 2});
    });

    const byId = new Map((existing || []).map(q => [q.question_id, q]));
    const byFp = new Map((existing || []).map(q => [q.fingerprint, q]));
    const batchFp = new Set();
    const valid = [], reviewQueue = [];
    let skipped = 0, duplicated = 0, overwritten = 0;

    candidates.forEach(c => {
      const q = c.question;
      const hitId = byId.get(q.question_id);
      if (hitId) {
        if (o.duplicate_policy === 'skip') { skipped++; return; }
        if (o.duplicate_policy === 'new_version') { q.question_id = q.question_id + '-v' + ((hitId.version || 1) + 1); }
        else { q.version = (hitId.version || 1) + 1; q.created_at = hitId.created_at; overwritten++; }
      }
      if ((byFp.has(q.fingerprint) && !hitId) || batchFp.has(q.fingerprint)) {
        duplicated++;
        reviewQueue.push({row: c.row, question: q, code:'E009', message: ERRORS.E009, match_id: (byFp.get(q.fingerprint) || {}).question_id || ''});
        return;
      }
      batchFp.add(q.fingerprint);
      valid.push(q);
    });

    const fatal = errors.length > 0 && !o.skip_error_rows;
    const report = {
      total: rows.length,
      inserted: fatal ? 0 : valid.length,
      skipped: fatal ? 0 : skipped,
      duplicated, overwritten,
      failed: errors.length,
      errors, warnings,
      atomic_rollback: fatal
    };
    return {ok: !fatal, valid: fatal ? [] : valid, reviewQueue, report};
  }

  function errorsCsv(report) {
    const lines = ['row,field,code,message'];
    report.errors.concat(report.warnings || []).forEach(e => {
      lines.push([e.row, e.field, e.code, '"' + String(e.message).replace(/"/g,'""') + '"'].join(','));
    });
    return lines.join('\n');
  }

  Quiz.importer = {COLS, KEYS, HEADER_ALIASES, normalizeHeader, TYPE_ALIASES, normalizeType, DIFFICULTY_ALIASES,
                   SAMPLE_CSV, ERRORS, parseDelimited, parseAnswer, rowToQuestion, runImport, errorsCsv, norm,
                   headerDiagnosis, repairCsv};
  if (typeof module !== 'undefined' && module.exports) module.exports = Quiz.importer;
})(typeof window !== 'undefined' ? window : globalThis);
