/* v1.10.0 练习历史合并（纯函数，供导入备份合并与自测共用）
   用途：把两份本机快照合并时，练习历史按 ID 取双方并集、只增不减，
   避免导入旧备份或合并记录时把本机刚做完的题覆盖掉。
   cut（清空数据时间戳）之前的历史不回填，保持「清空所有数据」语义。
   纯计算，不依赖网络、账号或任何云端服务。 */
(function (global) {
  const Quiz = global.Quiz = global.Quiz || {};

  function stamp(x) {
    const t = Date.parse((x && (x.answered_at || x.finished_at || x.started_at || x.created_at)) || 0);
    return Number.isFinite(t) ? t : 0;
  }
  function sessionKey(x) { return x && (x.session_id || ''); }
  function recordKey(x) {
    return x && (x.record_id || ((x.session_id || '') + '|' + (x.question_id || '') + '|' + (x.answered_at || '')));
  }
  function wrongKey(x) { return x && ((x.user_id || '') + '|' + (x.question_id || '')); }
  function favKey(x) { return x && (x.id || ((x.question_id || '') + '|' + (x.folder_id || ''))); }

  function mergeList(remote, local, keyFn, cut) {
    const out = [], seen = new Set();
    (remote || []).forEach(x => {
      if (!x) return;
      if (cut && stamp(x) < cut) return;              // 清空之后不回填旧历史
      const k = keyFn(x) || JSON.stringify(x);
      if (seen.has(k)) return;
      seen.add(k); out.push(x);
    });
    (local || []).forEach(x => {
      if (!x) return;
      const k = keyFn(x) || JSON.stringify(x);
      if (seen.has(k)) return;
      seen.add(k); out.push(x);                      // 本地独有记录保留
    });
    return out;
  }

  /** remote / local 为完整 state 对象；cut=0 表示未清空过 */
  function mergeHistory(remote, local, cut) {
    const r = remote || {}, l = local || {}, c = Number(cut) || 0;
    const out = Object.assign({}, r);
    /* 清空时间戳只作用于练习历史；错题本 / 收藏属题库维护数据，不按时间裁剪 */
    out.sessions = mergeList(r.sessions, l.sessions, sessionKey, c);
    out.records = mergeList(r.records, l.records, recordKey, c);
    out.wrong = mergeList(r.wrong, l.wrong, wrongKey, 0);
    out.favorites = mergeList(r.favorites, l.favorites, favKey, 0);
    /* importText 要求 questions / records 为数组 */
    if (!Array.isArray(out.questions)) out.questions = Array.isArray(l.questions) ? l.questions : [];
    if (!Array.isArray(out.records)) out.records = [];
    return out;
  }

  function historyStats(s) {
    const x = s || {};
    return {
      sessions: (x.sessions || []).length,
      records: (x.records || []).length,
      wrong: (x.wrong || []).length,
      favorites: (x.favorites || []).length,
      latest: Math.max(0, ...(x.sessions || []).map(stamp), ...(x.records || []).map(stamp))
    };
  }

  Quiz.historyMerge = {mergeHistory, mergeList, historyStats, stamp,
    sessionKey, recordKey, wrongKey, favKey};
  if (typeof module !== 'undefined' && module.exports) module.exports = Quiz.historyMerge;
})(typeof window !== 'undefined' ? window : globalThis);
