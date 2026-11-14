/* 答题体验增强工具模块（纯增量，不修改判分引擎与既有数据结构）
 * - 选项随机：重排选项并重新编号，同步重映射答案键，保留映射供追溯/解析对照
 * - 题型配额组卷：按 single / multiple / judge 分别指定题数
 * - 三态主题：跟随系统 / 浅色 / 深色
 * - 快捷键解析：返回动作对象，由 app.js 统一调度
 */
(function (global) {
  const Quiz = global.Quiz = global.Quiz || {};
  const LETTERS = 'ABCDEFGH';
  const TYPES = ['single', 'multiple', 'judge'];

  function shuffleInPlace(arr, rnd) {
    const r = typeof rnd === 'function' ? rnd : Math.random;
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  /* 返回题目快照：选项重新编号 A..，answer.keys 按 原key→新key 映射，option_map 记录原始顺序。
     判断题无选项，不参与随机；映射随题目快照一起归档，历史成绩可复算。 */
  function shuffleQuestion(q, enabled, rnd) {
    if (!enabled || !q || q.type === 'judge' || !q.options || q.options.length < 2) return q;
    const snap = JSON.parse(JSON.stringify(q));
    const original = snap.options;
    const originalKeys = (snap.answer && snap.answer.keys) ? snap.answer.keys.slice() : [];
    const order = shuffleInPlace(original.map((_, i) => i), rnd);
    const keyMap = {};
    const next = order.map((oi, ni) => {
      const oldKey = original[oi].key;
      keyMap[oldKey] = LETTERS[ni];
      return {key: LETTERS[ni], text: original[oi].text, original_key: oldKey};
    });
    snap.options = next;
    if (snap.answer && snap.answer.keys) snap.answer.keys = snap.answer.keys.map(k => keyMap[k] || k).sort();
    snap.option_map = {
      shuffled: true,
      original_keys: originalKeys,
      mapping: next.map(o => ({key: o.key, original_key: o.original_key, text: o.text}))
    };
    return snap;
  }

  /* 解析文字中若出现选项字母，可按此对照还原到原题库顺序 */
  function optionMapText(q) {
    if (!q || !q.option_map || !q.option_map.shuffled) return '';
    return q.option_map.mapping.map(m => '原' + m.original_key + '→现' + m.key).join('，');
  }

  /* v0.8：把已随机的题目还原成原题库选项顺序（依据 option_map 快照，答案键同步反向映射）。
     供答题页「选项乱序」开关实时切换使用；已作答题目不参与，保证成绩快照与作答记录一致。 */
  function unshuffleQuestion(q) {
    if (!q || !q.option_map || !q.option_map.shuffled || !Array.isArray(q.option_map.mapping)) return q;
    const snap = JSON.parse(JSON.stringify(q));
    const map = snap.option_map.mapping.slice().sort((a, b) => String(a.original_key).localeCompare(String(b.original_key)));
    const back = {};
    map.forEach(m => { back[m.key] = m.original_key; });
    snap.options = map.map(m => ({key: m.original_key, text: m.text}));
    if (snap.answer && snap.answer.keys) snap.answer.keys = snap.answer.keys.map(k => back[k] || k).sort();
    delete snap.option_map;
    return snap;
  }

  /* 按目标开关状态返回题目快照：开→随机（若已随机则保持）；关→还原（若原本有序则保持） */
  function setQuestionShuffle(q, enabled, rnd) {
    if (enabled) {
      if (q && q.option_map && q.option_map.shuffled) return q;   // 已随机的不再二次洗牌，保留原始映射
      return shuffleQuestion(q, true, rnd);
    }
    return unshuffleQuestion(q);
  }

  /* 按题型配额抽题；quota 中 0 表示不抽该题型，不足时按实际数量 */
  function quotaPick(pool, quota, order, rnd) {
    const out = [];
    TYPES.forEach(t => {
      const n = Math.max(0, parseInt((quota || {})[t], 10) || 0);
      if (!n) return;
      const list = pool.filter(q => q.type === t);
      if (order !== 'sequential') shuffleInPlace(list, rnd);
      list.slice(0, n).forEach(q => out.push(q));
    });
    if (order !== 'sequential') shuffleInPlace(out, rnd);
    return out;
  }

  function quotaAvailable(pool) {
    const m = {};
    TYPES.forEach(t => { m[t] = pool.filter(q => q.type === t).length; });
    return m;
  }

  /* ---------- 三态主题 ---------- */
  const THEME_KEY = 'smartQuiz.theme.v1';
  function systemDark() {
    try { return !!(global.matchMedia && global.matchMedia('(prefers-color-scheme: dark)').matches); }
    catch (e) { return false; }
  }
  function resolveTheme(mode) {
    if (mode === 'dark') return 'dark';
    if (mode === 'light') return 'light';
    return systemDark() ? 'dark' : 'light';
  }
  function readTheme() {
    try {
      const v = global.localStorage.getItem(THEME_KEY);
      if (v === 'light' || v === 'dark' || v === 'system') return v;
    } catch (e) { /* ignore */ }
    return 'system';
  }
  function applyTheme(mode) {
    const m = mode || readTheme(), r = resolveTheme(m);
    try {
      if (global.document && global.document.documentElement)
        global.document.documentElement.setAttribute('data-theme', r);
    } catch (e) { /* ignore */ }
    return {mode: m, resolved: r};
  }
  function setTheme(mode) {
    if (['light', 'dark', 'system'].indexOf(mode) < 0) return readTheme();
    try { global.localStorage.setItem(THEME_KEY, mode); } catch (e) { /* ignore */ }
    /* v1.12.5：主题偏好随账号自动保存 */
    try { if (Quiz.accountGate && Quiz.accountGate.touch) Quiz.accountGate.touch(); } catch (e2) {}
    applyTheme(mode);
    return mode;
  }
  function watchTheme(fn) {
    try {
      const mq = global.matchMedia && global.matchMedia('(prefers-color-scheme: dark)');
      const cb = () => fn(applyTheme(readTheme()));
      if (mq && mq.addEventListener) mq.addEventListener('change', cb);
      else if (mq && mq.addListener) mq.addListener(cb);
    } catch (e) { /* ignore */ }
  }

  /* ---------- 快捷键解析 ----------
     ctx: {hasModal, targetTag, done, qType}
     返回 {act:'submit'|'next'|'prev'|'option', key?} 或 null（不处理） */
  function shortcut(e, ctx) {
    ctx = ctx || {};
    if (ctx.hasModal) return null;
    const tag = (ctx.targetTag || '').toUpperCase();
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return null;
    const k = e.key;
    if (k === 'Enter') return {act: ctx.done ? 'next' : 'submit'};
    if (k === 'ArrowRight') return {act: 'next'};
    if (k === 'ArrowLeft') return {act: 'prev'};
    if (ctx.qType === 'judge') {
      if (/^[tfTF]$/.test(k)) return {act: 'option', key: k.toUpperCase()};
      if (k === '1') return {act: 'option', key: 'T'};
      if (k === '2') return {act: 'option', key: 'F'};
      return null;
    }
    if (/^[a-hA-H]$/.test(k)) return {act: 'option', key: k.toUpperCase()};
    if (/^[1-8]$/.test(k)) return {act: 'option', key: LETTERS[Number(k) - 1]};
    return null;
  }

  Quiz.enhance = {
    LETTERS, TYPES, THEME_KEY,
    shuffleInPlace, shuffleQuestion, unshuffleQuestion, setQuestionShuffle, optionMapText, quotaPick, quotaAvailable,
    readTheme, setTheme, applyTheme, resolveTheme, watchTheme, shortcut
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Quiz.enhance;
})(typeof window !== 'undefined' ? window : globalThis);
