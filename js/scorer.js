/* 判分引擎：题型注册表 + 四态判分（方案 3.2 / 3.3） */
(function (global) {
  const Quiz = global.Quiz = global.Quiz || {};

  const TYPE_REGISTRY = {
    single:   {label: '单选题', option_min: 2, normalizer: 'normalize_keys', scorer: 'score_exact_one'},
    multiple: {label: '多选题', option_min: 2, normalizer: 'normalize_keys', scorer: 'score_partial_credit'},
    judge:    {label: '判断题', option_min: 0, normalizer: 'normalize_bool',  scorer: 'score_exact_bool'}
  };
  const TYPE_LABEL = {single:'单选题', multiple:'多选题', judge:'判断题'};
  const STATUS_LABEL = {correct:'正确', partial:'部分得分', wrong:'错误', unanswered:'未作答'};

  const eqSet = (a, b) => a.length === b.length && a.every(x => b.includes(x));
  const round2 = x => Math.round((Number(x) + Number.EPSILON) * 100) / 100;
  const halfToFull = s => String(s == null ? '' : s).replace(/[\uFF01-\uFF5E]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/\u3000/g, ' ');
  const sortKeys = a => Array.from(new Set(a)).sort();

  function normalizeKeys(ans) {
    let arr = Array.isArray(ans) ? ans : (typeof ans === 'string' ? ans.split(/[,，;；\s]+/) : (ans == null ? [] : [ans]));
    return sortKeys(arr.map(x => halfToFull(x).trim().toUpperCase()).filter(Boolean).map(x => x.replace(/[^A-H]/g, '')).filter(Boolean));
  }
  function normalizeBool(ans) {
    if (typeof ans === 'boolean') return ans;
    let s = halfToFull(ans).trim().toUpperCase();
    if (Array.isArray(ans)) s = halfToFull(ans[0]).trim().toUpperCase();
    if (['T','TRUE','正确','对','是','YES','Y','√','A'].includes(s)) return true;
    if (['F','FALSE','错误','错','否','NO','N','×','B'].includes(s)) return false;
    return null;
  }
  function normalize(type, ans) { return type === 'judge' ? normalizeBool(ans) : normalizeKeys(ans); }

  function perOption(question, userKeys) {
    const correct = (question.answer && question.answer.keys) || [];
    return (question.options || []).map(o => {
      const should = correct.includes(o.key), sel = userKeys.includes(o.key);
      return {key: o.key, text: o.text, should_select: should, user_selected: sel,
              verdict: should && sel ? 'hit' : (!should && sel ? 'wrong' : (should && !sel ? 'missed' : 'ok'))};
    });
  }

  function base(question, userAnswer, status, score, extra) {
    return Object.assign({
      question_id: question.question_id, type: question.type,
      status, is_correct: status === 'correct',
      score: round2(score), max_score: Number(question.score) || 1,
      user_answer: userAnswer,
      correct_answer: question.answer,
      analysis: question.analysis || '',
      per_option: []
    }, extra || {});
  }

  /* 单选：完全一致满分，否则 0；无部分分 */
  function scoreExactOne(q, ans, cfg) {
    const u = normalizeKeys(ans), correct = (q.answer.keys || []).slice().sort();
    if (!u.length) return base(q, [], 'unanswered', 0, {per_option: perOption(q, [])});
    const ok = eqSet(u, correct);
    return base(q, u, ok ? 'correct' : 'wrong', ok ? q.score : 0, {per_option: perOption(q, u)});
  }

  /* 多选：全对 / 仅漏选按比例 / 含错选 / 全错或退化 */
  function scorePartialCredit(q, ans, cfg) {
    const u = normalizeKeys(ans), correct = (q.answer.keys || []).slice().sort();
    const po = perOption(q, u);
    if (!u.length) return base(q, [], 'unanswered', 0, {per_option: po});
    if (eqSet(u, correct)) return base(q, u, 'correct', q.score, {per_option: po});
    const hit = u.filter(k => correct.includes(k)).length;
    const hasWrong = u.some(k => !correct.includes(k));
    const max = Number(q.score) || 1;
    if (cfg.partial_mode === 'all_or_none') return base(q, u, 'wrong', 0, {per_option: po});
    if (hasWrong && !cfg.allow_partial_with_wrong) return base(q, u, 'wrong', 0, {per_option: po});
    let earned = max * hit / correct.length;
    if (hasWrong) earned = Math.min(earned, max * 0.5);   // 含错选时部分得分上限 50%
    if (earned <= 0) return base(q, u, 'wrong', 0, {per_option: po});
    return base(q, u, 'partial', earned, {per_option: po});
  }

  function scoreExactBool(q, ans, cfg) {
    const u = normalizeBool(ans), correct = !!(q.answer && q.answer.value);
    if (u === null) return base(q, null, 'unanswered', 0);
    const ok = u === correct;
    return base(q, u, ok ? 'correct' : 'wrong', ok ? q.score : 0);
  }

  const SCORERS = {score_exact_one: scoreExactOne, score_partial_credit: scorePartialCredit, score_exact_bool: scoreExactBool};

  function score(question, userAnswer, config) {
    const reg = TYPE_REGISTRY[question.type];
    if (!reg) throw new Error('未注册的题型：' + question.type);
    const cfg = Object.assign({partial_mode:'proportional', allow_partial_with_wrong:false}, config || {});
    return SCORERS[reg.scorer](question, userAnswer, cfg);
  }

  /* 校验器：新增题型时与 normalizer / scorer 一起注册即可 */
  function validate(question) {
    const errs = [];
    const reg = TYPE_REGISTRY[question.type];
    if (!reg) return ['题型未注册：' + question.type];
    if (!question.stem || !String(question.stem).trim()) errs.push('题干不能为空');
    if (question.type === 'judge') {
      if (typeof question.answer.value !== 'boolean') errs.push('判断题答案必须为布尔值');
    } else {
      const keys = (question.answer.keys || []);
      const valid = (question.options || []).map(o => o.key);
      if ((question.options || []).length < reg.option_min) errs.push('选项数量不足');
      if (!keys.length) errs.push('答案不能为空');
      if (question.type === 'single' && keys.length !== 1) errs.push('单选题答案须恰好 1 个');
      if (question.type === 'multiple' && keys.length < 2) errs.push('多选题答案至少 2 个');
      if (keys.some(k => !valid.includes(k))) errs.push('答案引用了不存在的选项');
    }
    if (!(Number(question.score) > 0 && Number(question.score) <= 100)) errs.push('分值须在 (0,100]');
    return errs;
  }

  /* 会话聚合：正确率与得分率分别统计，不可互相替代 */
  function aggregate(records) {
    const count = {correct:0, partial:0, wrong:0, unanswered:0};
    let earned = 0, total = 0, duration = 0;
    (records || []).forEach(r => {
      count[r.status] = (count[r.status] || 0) + 1;
      earned += Number(r.score) || 0;
      total += Number(r.max_score) || 0;
      duration += Number(r.duration_ms) || 0;
    });
    const answered = (records || []).length - count.unanswered;
    return {
      question_count: (records || []).length,
      counts: count,
      earned_score: round2(earned), total_score: round2(total),
      accuracy: answered ? count.correct / answered : 0,          // 只统计 correct
      score_rate: total ? earned / total : 0,                     // 含 partial 得分
      answer_rate: (records || []).length ? answered / (records || []).length : 0,
      duration_ms: duration
    };
  }

  Quiz.scorer = {TYPE_REGISTRY, TYPE_LABEL, STATUS_LABEL, score, validate, aggregate, normalize, normalizeKeys, normalizeBool, round2};
  if (typeof module !== 'undefined' && module.exports) module.exports = Quiz.scorer;
})(typeof window !== 'undefined' ? window : globalThis);
