/* 数据层：本地持久化（localStorage），字段与《功能方案》第 3/4 节一致 */
(function (global) {
  const Quiz = global.Quiz = global.Quiz || {};
  const KEY = 'smartQuiz.v1';
  const SESSION_KEY = 'smartQuiz.runtimeSession.v1';
  const PREFS_KEY = 'smartQuiz.prefs.v1';
  const DEFAULT_BANK_ID = 'B_DEFAULT';
  const ALL_BANKS = 'ALL';

  const DEFAULT_CONFIG = {
    user_id: 'local_user',
    partial_mode: 'proportional',        // proportional | all_or_none
    allow_partial_with_wrong: false,
    min_score_unit: 0.01,
    mastery_threshold: 2,                // 错题重刷连续答对次数
    feedback_mode: 'immediate',          // immediate | after_submit
    default_question_count: 10,
    shuffle_options: true,               // 组卷时随机打乱选项（答案键同步重映射）
    auto_advance: false,                 // 答对后自动进入下一题
    auto_advance_ms: 1200                // 自动前进延迟
  };

  const now = () => new Date().toISOString();
  const util = Quiz.util = {
    now,
    esc(s) {
      return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    },
    fmt(ts) {
      if (!ts) return '—';
      const d = new Date(ts);
      const p = n => String(n).padStart(2, '0');
      return d.getFullYear() + '-' + p(d.getMonth()+1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
    },
    dayKey(ts) {
      const d = new Date(ts); const p = n => String(n).padStart(2, '0');
      return d.getFullYear() + '-' + p(d.getMonth()+1) + '-' + p(d.getDate());
    },
    fmtDur(ms) {
      ms = Math.max(0, Number(ms) || 0);
      const s = Math.round(ms / 1000);
      if (s < 60) return s + ' 秒';
      const m = Math.floor(s / 60);
      return m + ' 分 ' + String(s % 60).padStart(2, '0') + ' 秒';
    },
    hash(str) {
      let h = 0x811c9dc5;
      for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
      return ('00000000' + h.toString(16)).slice(-8) + ('00000000' + ((h >>> 7) ^ (h >>> 19)).toString(16)).slice(-8);
    },
    fingerprint(stem, type, options) {
      const s = String(stem).replace(/\s+/g, ' ').trim() + '|' + type + '|' +
        (options || []).slice().sort((a,b) => a.key.localeCompare(b.key)).map(o => o.key + ':' + o.text.replace(/\s+/g,' ').trim()).join('|');
      return 'fnv1a:' + util.hash(s);
    },
    uid(prefix) { return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7); },
    download(filename, text, mime) {
      util.downloadBytes(filename, new Blob(['\uFEFF' + text], {type: (mime || 'text/plain') + ';charset=utf-8'}), mime);
    },
    downloadBytes(filename, blob) {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = filename;
      document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    },
    pct(x) { return (Number(x) || 0).toFixed(1) + '%'; }
  };

  function defaultBanks() {
    const t = now();
    return [{bank_id: DEFAULT_BANK_ID, name: '默认题库', description: '未指定归属的题目默认存放于此',
             is_default: true, created_at: t, updated_at: t}];
  }

  function emptyState() {
    return {
      version: 3,
      /* v1.12.0：真实站点不再预置默认题库；Node 自测保留原有默认库造数据 */
      banks: global.__NO_DEMO_DATA__ ? [] : defaultBanks(),
      questions: [], sessions: [], records: [], wrong: [],
      folders: [{folder_id: 'F_DEFAULT', name: '全部收藏', is_default: true, created_at: now()}],
      favorites: [],
      notes: [],      // v0.8 逐题笔记：{question_id, user_id, text, created_at, updated_at}
      marks: [],      // v0.8 逐题标记：{question_id, user_id, created_at}
      bank_ops: {},   // v1.5.0 题库扩展：置顶 / 分组 / 封面 / 章节 / 题型 / 练习设置 / 模拟考试模板
      bank_groups: [],// v1.5.0 题库分组（「移动」目标）
      groups: [],     // v1.6.0 群组目录：群号 / 加入方式 / 成员 / 绑定题库，随备份与云同步
      config: Object.assign({}, DEFAULT_CONFIG),
      created_at: now()
    };
  }

  let seq = 0;
  let memoryFallback = false;
  let cache = null;

  function read() {
    if (cache) return cache;
    try {
      const raw = global.localStorage.getItem(KEY);
      cache = raw ? JSON.parse(raw) : emptyState();
    } catch (e) { cache = emptyState(); memoryFallback = true; }
    // 兼容旧数据缺字段
    const d = emptyState();
    for (const k of Object.keys(d)) if (cache[k] == null) cache[k] = d[k];
    for (const k of Object.keys(DEFAULT_CONFIG)) if (cache.config[k] == null) cache.config[k] = DEFAULT_CONFIG[k];
    return normalizeBanks(cache);
  }

  /* 兼容旧备份/旧数据：补齐题库实体、默认库，并把无归属或指向已删库的题目归到默认库 */
  function normalizeBanks(s) {
    /* v1.12.0：真实站点删除默认题库。每次读 / 写都会剔除 is_default 与 B_DEFAULT，
       并把指向已删题库的题目改为「未分类」（bank_id 为空串），题目本身不丢失。 */
    if (global.__NO_DEMO_DATA__) {
      if (!Array.isArray(s.banks)) s.banks = [];
      const seen = new Set();
      s.banks = s.banks.filter(b => {
        if (!b || !b.bank_id || b.is_default || b.bank_id === DEFAULT_BANK_ID || seen.has(b.bank_id)) return false;
        seen.add(b.bank_id);
        return true;
      });
      const valid = new Set(s.banks.map(b => b.bank_id));
      (Array.isArray(s.questions) ? s.questions : []).forEach(q => {
        if (!valid.has(q.bank_id)) q.bank_id = '';
      });
      return s;
    }
    if (!Array.isArray(s.banks) || !s.banks.length) s.banks = defaultBanks();
    const seen = new Set();
    s.banks = s.banks.filter(b => {
      if (!b || !b.bank_id || seen.has(b.bank_id)) return false;
      seen.add(b.bank_id);
      return true;
    });
    let def = s.banks.find(b => b.is_default) || s.banks.find(b => b.bank_id === DEFAULT_BANK_ID);
    if (!def) { def = defaultBanks()[0]; s.banks.unshift(def); }
    def.is_default = true;
    if (!s.banks.some(b => b.bank_id === def.bank_id)) s.banks.unshift(def);
    const valid = new Set(s.banks.map(b => b.bank_id));
    s.questions.forEach(q => { if (!q.bank_id || !valid.has(q.bank_id)) q.bank_id = def.bank_id; });
    return s;
  }

  function save() {
    /* v1.12.5：任何题库写入都触发账号快照自动保存（未登录态由 accountGate 自行忽略） */
    try {
      global.localStorage.setItem(KEY, JSON.stringify(cache)); memoryFallback = false;
      try { if (Quiz.accountGate && Quiz.accountGate.touch) Quiz.accountGate.touch(); } catch (e2) {}
      return true;
    }
    catch (e) { memoryFallback = true; return false; }
  }

  /* v1.4.4 逐题实时记录：复合去重键与错题增量更新（供 appendLiveAnswer / finishSession 共用） */
  function answerKey(r) {
    return String((r && r.session_id) || '') + '|' + String((r && r.question_id) || '') + '|' + String((r && r.answered_at) || '');
  }
  function applyWrong(s, r, threshold) {
    const key = r.user_id + '|' + r.question_id;
    let w = s.wrong.find(x => (x.user_id + '|' + x.question_id) === key);
    const isCorrect = r.status === 'correct';
    if (!w) {
      if (isCorrect) return;
      w = {user_id: r.user_id, question_id: r.question_id, first_wrong_at: r.answered_at,
           last_wrong_at: r.answered_at, wrong_count: 1, consecutive_correct: 0,
           mastered: false, last_session_id: r.session_id,
           category_snapshot: (r.question_snapshot.category || []), type: r.question_snapshot.type};
      s.wrong.push(w);
    } else if (isCorrect) {
      w.consecutive_correct = (w.consecutive_correct || 0) + 1;
      // v0.8：面板「连续做对」设为 0 时代表永不自动移出错题集（仍可手动标记掌握）
      if (threshold > 0 && w.consecutive_correct >= threshold) w.mastered = true;
    } else {
      w.wrong_count = (w.wrong_count || 0) + 1;
      w.last_wrong_at = r.answered_at;
      w.last_session_id = r.session_id;
      w.consecutive_correct = 0;
      w.mastered = false;
    }
  }

  const store = Quiz.store = {
    state: read,
    /* v1.8.0：账号切换后丢弃内存缓存，重新从当前 localStorage 读取 */
    reload() { cache = null; return read(); },
    isFallback: () => memoryFallback,
    save,
    mutate(fn) { const r = fn(read()); save(); return r; },
    config() { return read().config; },
    setConfig(patch) { return store.mutate(s => Object.assign(s.config, patch)); },
    reset() { cache = emptyState(); save(); try { global.localStorage.removeItem(SESSION_KEY); } catch(e){} },
    exportText() { return JSON.stringify(read(), null, 2); },
    importText(text) {
      const obj = JSON.parse(text);
      if (!obj || !Array.isArray(obj.questions) || !Array.isArray(obj.records)) throw new Error('不是有效的题库备份文件');
      const base = emptyState();
      cache = Object.assign(base, obj);
      cache.config = Object.assign({}, DEFAULT_CONFIG, obj.config || {});
      normalizeBanks(cache);
      save(); return cache;
    },
    runtime: {
      get() { try { const t = global.localStorage.getItem(SESSION_KEY); return t ? JSON.parse(t) : null; } catch(e) { return null; } },
      set(v) { try { v ? global.localStorage.setItem(SESSION_KEY, JSON.stringify(v)) : global.localStorage.removeItem(SESSION_KEY); } catch(e){} },
      clear() { try { global.localStorage.removeItem(SESSION_KEY); } catch(e){} }
    },
    /* 界面偏好：与题库数据分开存储，清空数据不会丢失主题与上次组卷配置 */
    prefs: {
      get() { try { const t = global.localStorage.getItem(PREFS_KEY); return t ? JSON.parse(t) : {}; } catch(e) { return {}; } },
      set(patch) {
        const cur = store.prefs.get();
        Object.assign(cur, patch || {});
        try { global.localStorage.setItem(PREFS_KEY, JSON.stringify(cur)); } catch(e) {}
        try { if (Quiz.accountGate && Quiz.accountGate.touch) Quiz.accountGate.touch(); } catch(e2) {}
        return cur;
      }
    },
    /* ---------- 题库（一级实体） ---------- */
    banks() { return read().banks.slice(); },
    bank(id) { return read().banks.find(b => b.bank_id === id) || null; },
    defaultBankId() { const b = read().banks.find(x => x.is_default); return b ? b.bank_id : (global.__NO_DEMO_DATA__ ? '' : DEFAULT_BANK_ID); },
    questionCount(bankId) {
      const qs = read().questions;
      return bankId === ALL_BANKS ? qs.length : qs.filter(q => q.bank_id === bankId).length;
    },
    addBank(name, description) {
      const n = String(name || '').trim();
      if (!n) return null;
      const t = now();
      const b = {bank_id: util.uid('BNK'), name: n, description: String(description || '').trim(),
                 is_default: false, created_at: t, updated_at: t};
      store.mutate(s => s.banks.push(b));
      return b;
    },
    renameBank(id, patch) {
      return store.mutate(s => {
        const b = s.banks.find(x => x.bank_id === id);
        if (!b) return false;
        if (patch.name != null && String(patch.name).trim()) b.name = String(patch.name).trim();
        if (patch.description != null) b.description = String(patch.description).trim();
        b.updated_at = now();
        return true;
      });
    },
    /* 删除题库不丢题：题目整体迁移到默认题库；默认题库不可删除 */
    removeBank(id) {
      return store.mutate(s => {
        const b = s.banks.find(x => x.bank_id === id);
        if (!b || b.is_default) return false;
        const def = s.banks.find(x => x.is_default);
        const target = def ? def.bank_id : (global.__NO_DEMO_DATA__ ? '' : DEFAULT_BANK_ID);
        s.questions.forEach(q => { if (q.bank_id === id) { q.bank_id = target; q.updated_at = now(); } });
        s.banks = s.banks.filter(x => x.bank_id !== id);
        return true;
      });
    },
    moveQuestions(ids, bankId) {
      const set = new Set(ids || []);
      return store.mutate(s => {
        if (!s.banks.some(b => b.bank_id === bankId)) return 0;
        let n = 0;
        s.questions.forEach(q => {
          if (set.has(q.question_id) && q.bank_id !== bankId) { q.bank_id = bankId; q.updated_at = now(); n++; }
        });
        return n;
      });
    },
    question(id) { return read().questions.find(q => q.question_id === id) || null; },
    upsertQuestion(q) {
      return store.mutate(s => {
        q.bank_id = s.banks.some(b => b.bank_id === q.bank_id) ? q.bank_id : s.banks.find(x => x.is_default).bank_id;
        const i = s.questions.findIndex(x => x.question_id === q.question_id);
        if (i >= 0) { q.version = (s.questions[i].version || 1) + 1; q.created_at = s.questions[i].created_at; q.updated_at = now(); s.questions[i] = q; }
        else { q.version = 1; q.created_at = q.created_at || now(); q.updated_at = now(); s.questions.push(q); }
        return q;
      });
    },
    deleteQuestions(ids) {
      return store.mutate(s => {
        s.questions = s.questions.filter(q => !ids.includes(q.question_id));
        s.favorites = s.favorites.filter(f => !ids.includes(f.question_id));
      });
    },
    toggleFavorite(questionId, folderId) {
      return store.mutate(s => {
        const i = s.favorites.findIndex(f => f.question_id === questionId && f.folder_id === folderId);
        if (i >= 0) { s.favorites.splice(i, 1); return false; }
        s.favorites.push({id: util.uid('FAV'), user_id: s.config.user_id, question_id: questionId, folder_id: folderId, note: '', created_at: now()});
        return true;
      });
    },
    addFolder(name) {
      if (!name || !name.trim()) return null;
      const f = {folder_id: util.uid('FLD'), name: name.trim(), created_at: now()};
      store.mutate(s => s.folders.push(f)); return f;
    },
    removeFolder(id) {
      return store.mutate(s => {
        s.folders = s.folders.filter(f => f.folder_id !== id || f.is_default);
        const target = s.folders.find(f => f.is_default).folder_id;
        s.favorites.forEach(f => { if (f.folder_id === id) f.folder_id = target; });
      });
    },
    /* ---------- v0.8 答题页：笔记 / 标记 / 单题作答统计（纯增量字段，旧数据自动补空数组） ---------- */
    note(questionId) {
      const s = read();
      return (s.notes || []).find(n => n.question_id === questionId && n.user_id === s.config.user_id) || null;
    },
    saveNote(questionId, text) {
      const t = String(text == null ? '' : text).trim();
      return store.mutate(s => {
        s.notes = s.notes || []; s.marks = s.marks || [];
        const uid = s.config.user_id;
        const i = s.notes.findIndex(n => n.question_id === questionId && n.user_id === uid);
        if (!t) { if (i >= 0) s.notes.splice(i, 1); return null; }
        if (i >= 0) { s.notes[i].text = t; s.notes[i].updated_at = now(); return s.notes[i]; }
        const n = {question_id: questionId, user_id: uid, text: t, created_at: now(), updated_at: now()};
        s.notes.push(n); return n;
      });
    },
    isMarked(questionId) {
      const s = read();
      return (s.marks || []).some(m => m.question_id === questionId && m.user_id === s.config.user_id);
    },
    toggleMark(questionId) {
      return store.mutate(s => {
        s.notes = s.notes || []; s.marks = s.marks || [];
        const uid = s.config.user_id;
        const i = s.marks.findIndex(m => m.question_id === questionId && m.user_id === uid);
        if (i >= 0) { s.marks.splice(i, 1); return false; }
        s.marks.push({question_id: questionId, user_id: uid, created_at: now()});
        return true;
      });
    },
    setQuestionTags(questionId, tags) {
      return store.mutate(s => {
        const q = s.questions.find(x => x.question_id === questionId);
        if (!q) return null;
        q.tags = Array.from(new Set(String(tags || '').split(/[,，;；\s]+/).map(x => x.trim()).filter(Boolean)));
        q.updated_at = now();
        return q.tags;
      });
    },
    /* 本人总答 / 全体作答：单机版「全体」即本机全部归档记录，不含云端数据 */
    questionStats(questionId) {
      const s = read(), uid = s.config.user_id;
      const rs = s.records.filter(r => r.question_id === questionId);
      const pack = arr => {
        const n = arr.length, c = arr.filter(r => r.status === 'correct').length;
        return {count: n, correct: c, rate: n ? Math.round(c / n * 10000) / 100 : 0};
      };
      return {mine: pack(rs.filter(r => r.user_id === uid)), all: pack(rs)};
    },
    /* v1.4.4：每答一题立即落库（未交卷也保留），交卷时按复合键去重、不重复计数 */
    appendLiveAnswer(record) {
      return store.mutate(s => {
        const k = answerKey(record);
        const i = s.records.findIndex(x => answerKey(x) === k);
        if (i >= 0) s.records[i] = record; else s.records.push(record);
        applyWrong(s, record, s.config.mastery_threshold);
        return record;
      });
    },
    /* 交卷：写入会话、补齐未实时落库的作答明细，并更新错题本 */
    finishSession(session, records) {
      return store.mutate(s => {
        s.sessions.push(session);
        const threshold = s.config.mastery_threshold;
        records.forEach(r => {
          const k = answerKey(r);
          const i = s.records.findIndex(x => answerKey(x) === k);
          if (i >= 0) { s.records[i] = r; return; }   // 已实时落库，避免重复
          s.records.push(r);
          applyWrong(s, r, threshold);
        });
      });
    }
  };

  /* 内置示例题：首次启动种子，覆盖单选/多选/判断 */
  const SEED = [
    ['Q001','single','下列哪个是 HTTP 协议的默认端口？',['21','80','443','3306'],{keys:['B']},'80 是 HTTP 默认端口；443 用于 HTTPS。','计算机网络/协议','基础;网络',1,2],
    ['Q002','multiple','以下属于关系型数据库的有？',['MySQL','Redis','PostgreSQL','MongoDB'],{keys:['A','C']},'MySQL 与 PostgreSQL 为关系型；Redis 为键值缓存，MongoDB 为文档型。','数据库/选型','SQL;面试高频',3,4],
    ['Q003','judge','HTTP 协议本身是无状态的。',[],{value:true},'服务端不保留上一次请求上下文，会话需靠 Cookie 等机制维持。','计算机网络/协议','基础',1,1],
    ['Q004','single','方程 x² - 5x + 6 = 0 的两个根是？',['1 和 2','2 和 3','-2 和 -3','1 和 6'],{keys:['B']},'因式分解得 (x-2)(x-3)=0，故根为 2 和 3。','数学/代数','方程',2,2],
    ['Q005','multiple','属于 TCP 协议特点的有？',['面向连接','可靠传输','无连接','支持广播'],{keys:['A','B']},'TCP 面向连接、提供可靠字节流；无连接与广播属于 UDP 范畴。','计算机网络/协议','传输层',2,3],
    ['Q006','judge','SQL 中 PRIMARY KEY 约束允许出现重复值。',[],{value:false},'主键必须唯一且非空，不允许重复。','数据库/选型','约束',1,1],
    ['Q007','single','「不以规矩，不能成方圆」出自哪部典籍？',['论语','孟子','老子','庄子'],{keys:['B']},'语出《孟子·离娄上》。','语文/常识','古文',2,2],
    ['Q008','multiple','以下属于线性数据结构的有？',['数组','栈','二叉树','队列'],{keys:['A','B','D']},'数组、栈、队列为线性结构；二叉树为非线性结构。','数据结构/基础','线性表',2,3],
    ['Q009','judge','在欧氏平面中，三角形内角和恒为 180°。',[],{value:true},'平面几何基本定理；非欧几何中不成立。','数学/代数','几何',1,1],
    ['Q010','single','关于进程与线程，下列说法正确的是？',['线程是资源分配的基本单位','进程是 CPU 调度的基本单位','同一进程内的线程共享地址空间','线程之间不能并发执行'],{keys:['C']},'进程是资源分配单位，线程是调度单位并共享所属进程的地址空间。','操作系统/基础','进程线程',3,2],
    ['Q011','multiple','以下属于 SQL DDL 语句的有？',['CREATE','SELECT','ALTER','INSERT'],{keys:['A','C']},'CREATE/ALTER 属数据定义语言；SELECT/INSERT 属 DML。','数据库/选型','SQL',2,3],
    ['Q012','judge','HTTPS 协议的默认端口是 443。',[],{value:true},'HTTPS 默认 443，HTTP 默认 80。','计算机网络/协议','基础',1,1]
  ];

  function seedIfEmpty() {
    /* v1.7.0：未登录时登录门已清空活动数据，禁止示例数据写回，避免污染账号隔离区 */
    if (global.__AUTH_GATE_LOCKED__) return false;
    /* v1.11.0：站点不再生成任何内置示例题；Node 自测未设置此开关，仍可造数据 */
    if (global.__NO_DEMO_DATA__) return false;
    const s = read();
    if (s.questions.length) return false;
    const t = now();
    s.questions = SEED.map(row => {
      const [id, type, stem, opts, answer, analysis, cat, tags, difficulty, score] = row;
      const options = opts.map((text, i) => ({key: 'ABCDEF'[i], text}));
      return {
        question_id: id, type, stem, options, answer, analysis,
        category: cat.split('/'), tags: tags.split(';'),
        difficulty, score, source: '内置示例', status: 'published', bank_id: DEFAULT_BANK_ID,
        fingerprint: util.fingerprint(stem, type, options),
        version: 1, created_at: t, updated_at: t
      };
    });
    save(); return true;
  }

  /* v1.11.0：清理当前活动数据里的内置示例题（用户自建题目不受影响） */
  function purgeDemo() {
    try {
      return store.mutate(s => {
        const before = s.questions.length;
        s.questions = s.questions.filter(q => q.source !== '内置示例');
        return before - s.questions.length;
      });
    } catch (x) { return 0; }
  }
  Quiz.seedIfEmpty = seedIfEmpty;
  Quiz.purgeDemo = purgeDemo;
  Quiz.DEFAULT_CONFIG = DEFAULT_CONFIG;
  Quiz.DEFAULT_BANK_ID = DEFAULT_BANK_ID;
  Quiz.ALL_BANKS = ALL_BANKS;

  if (typeof module !== 'undefined' && module.exports) module.exports = Quiz;
})(typeof window !== 'undefined' ? window : globalThis);
