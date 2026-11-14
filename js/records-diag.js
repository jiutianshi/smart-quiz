/* v1.4.3 统一答题记录视图（纯增量）
   背景：#/records 只列已归档 sessions；未交卷练习在 runtimeSession、模拟考试在
   smartQuiz.hubExam.v1，用户做完题在「刷题记录」看到空白 →「答题记录不显示」。
   本模块把三源汇总成一张表，并给出来源诊断（版本 / origin / 存储 / 计数 / 云账号）。
   只读本机真实数据，不写示例、不改判分与归档口径。 */
(function (global) {
  const Quiz = global.Quiz = global.Quiz || {};
  const store = Quiz.store, util = Quiz.util;
  const e = v => util.esc(String(v == null ? '' : v));
  const VERSION = 'v1.11.0';

  function fmt(ts) {
    if (!ts) return '—';
    const d = new Date(ts);
    if (isNaN(d.getTime())) return String(ts);
    const p = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function pct(n) { return (Math.round((Number(n) || 0) * 10) / 10) + '%'; }
  function dur(ms) {
    const t = Math.max(0, Math.round((Number(ms) || 0) / 1000));
    const p = n => String(n).padStart(2, '0');
    return p(Math.floor(t / 3600)) + ':' + p(Math.floor(t % 3600 / 60)) + ':' + p(t % 60);
  }
  function host() {
    try { return (global.location && global.location.host) || '本地文件（file://）'; }
    catch (x) { return '本地文件（file://）'; }
  }
  function keyExists(k) {
    try { return !!(global.localStorage && global.localStorage.getItem(k)); } catch (x) { return false; }
  }

  function sources() {
    const s = store.state();
    const sessions = (s.sessions || []).slice();
    const records = (s.records || []).slice();
    let rt = null;
    try { rt = (store.runtime && store.runtime.get && store.runtime.get()) || null; } catch (x) {}
    const running = rt && Array.isArray(rt.answers) ? rt.answers.filter(Boolean).length : 0;
    let exams = [];
    try { exams = (Quiz.hubPages && Quiz.hubPages.examHistory) ? Quiz.hubPages.examHistory() : []; } catch (x) {}
    return {sessions, records, rt, running, exams: exams || []};
  }

  /** 三源统一行：已归档会话 / 进行中练习 / 模拟考试，按时间倒序 */
  function rows() {
    const x = sources(), out = [];
    x.sessions.forEach(s => out.push({
      kind: '已归档练习', at: s.started_at,
      count: Number(s.question_count) || 0,
      correct: Number(s.correct_count) || 0,
      rate: (Number(s.accuracy) || 0) * 100,
      used: Number(s.duration_ms) || 0,
      mode: s.mode || 'normal', id: s.session_id || ''
    }));
    if (x.running) {
      const ans = x.rt.answers || [];
      const correct = ans.filter(a => a && a.result && a.result.status === 'correct').length;
      out.push({
        kind: '进行中（未交卷）', at: (x.rt && x.rt.session_started_at) || Date.now(),
        count: x.running, correct, rate: correct / x.running * 100,
        used: ans.reduce((n, a) => n + (a && Number(a.duration_ms) || 0), 0),
        mode: (x.rt && x.rt.mode) || 'normal', id: (x.rt && x.rt.session_id) || ''
      });
    }
    x.exams.forEach(h => out.push({
      kind: '模拟考试', at: h.at,
      count: Number(h.count) || 0, correct: Number(h.correct) || 0,
      rate: Number(h.rate) || 0, used: (Number(h.used) || 0) * 1000,
      mode: 'exam', id: ''
    }));
    return out.sort((a, b) => (new Date(b.at).getTime() || 0) - (new Date(a.at).getTime() || 0));
  }

  function table() {
    const list = rows();
    if (!list.length) return '<div class="empty"><span class="e-icon">◷</span>本机没有任何答题记录（已归档 / 进行中 / 模拟考试均为空）</div>';
    return '<div class="table-wrap"><table><thead><tr><th>时间</th><th>类型</th><th>题数</th><th>答对</th><th>正确率</th><th>用时</th><th>会话 / 模式</th></tr></thead><tbody>' +
      list.slice(0, 30).map(r => '<tr><td class="nowrap">' + e(fmt(r.at)) + '</td><td>' + e(r.kind) + '</td>' +
        '<td>' + r.count + '</td><td>' + r.correct + '</td><td>' + pct(r.rate) + '</td><td>' + dur(r.used) + '</td>' +
        '<td class="mono small">' + e(r.mode) + (r.id ? ' · ' + e(String(r.id).slice(0, 18)) : '') + '</td></tr>').join('') +
      '</tbody></table></div>';
  }

  /** v1.4.4：逐题明细表。每答一题立即落库，这里无需交卷即可看到 */
  function detailsTable() {
    const s = store.state(), list = (s.records || []).slice().reverse().slice(0, 20);
    if (!list.length) return '<div class="small muted">暂无逐题作答记录；答完第一题后这里立即出现。</div>';
    return '<div class="table-wrap"><table><thead><tr><th>时间</th><th>题干</th><th>作答</th><th>判定</th><th>得分</th></tr></thead><tbody>' +
      list.map(r => {
        const na = r.normalized_answer;
        const user = Array.isArray(na) ? na.join('、')
          : (na === true ? '正确' : na === false ? '错误' : (r.status === 'unanswered' ? '未作答' : '—'));
        return '<tr><td class="nowrap">' + e(fmt(r.answered_at)) + '</td>' +
          '<td><div class="ellip" style="max-width:320px">' + e((r.question_snapshot || {}).stem || '') + '</div></td>' +
          '<td class="mono">' + e(user) + '</td>' +
          '<td>' + e(r.status) + '</td><td>' + e(r.score) + '/' + e(r.max_score) + '</td></tr>';
      }).join('') +
      '</tbody></table></div>';
  }

  /** v1.4.4：按日汇总的实时口径。
      题目数 / 答对 / 用时取自逐题 records（含未交卷）；练习次数取自已归档会话 + 进行中会话 + 模拟考试。 */
  function daily() {
    const s = store.state(), x = sources(), by = {};
    const day = ts => {
      const d = new Date(ts || 0);
      if (isNaN(d.getTime())) return '—';
      const p = n => String(n).padStart(2, '0');
      return p(d.getMonth() + 1) + '-' + p(d.getDate());
    };
    const get = d => by[d] || (by[d] = {date:d, sessions:0, questions:0, correct:0, duration:0});
    (s.sessions || []).forEach(v => { get(day(v.started_at)).sessions++; });
    if (x.running) get(day((x.rt && x.rt.session_started_at) || Date.now())).sessions++;
    (s.records || []).forEach(r => {
      const o = get(day(r.answered_at));
      o.questions++; if (r.status === 'correct') o.correct++;
      o.duration += Number(r.duration_ms) || 0;
    });
    x.exams.forEach(v => {
      const o = get(day(v.at));
      o.sessions++; o.questions += Number(v.count) || 0;
      o.correct += Number(v.correct) || 0; o.duration += (Number(v.used) || 0) * 1000;
    });
    return Object.keys(by).map(k => by[k]).sort((a, b) => b.date.localeCompare(a.date));
  }

  function html() {
    const s = store.state(), x = sources(), list = rows();
    const fallback = store.isFallback && store.isFallback();
    const row = (k, v, warn) => '<div class="rec-diag-k">' + k + '</div><div class="rec-diag-v' + (warn ? ' warn' : '') + '">' + v + '</div>';
    let h = '<section class="card rec-diag"><h2>答题记录 · 来源诊断与汇总</h2>' +
      '<p class="hint">汇总已归档练习、未交卷进行中练习与模拟考试三类数据，全部取自本机真实记录。</p>' +
      '<div class="rec-diag-grid">' +
      row('站点版本', e(VERSION)) +
      row('当前站点', e(host())) +
      row('存储模式', fallback ? '内存模式（刷新即丢，请立即导出备份）' : '正常（localStorage）', fallback) +
      row('已归档会话 / 作答明细', x.sessions.length + ' 次 / ' + x.records.length + ' 条', !x.sessions.length) +
      row('逐题作答记录（实时）', x.records.length + ' 条（每答一题立即写入，无需交卷）', !x.records.length) +
      row('进行中练习 / 模拟考试', x.running + ' 题 / ' + x.exams.length + ' 场') +
      row('汇总记录条数', list.length + ' 条', !list.length) +
      row('本地数据键', ['smartQuiz.v1=' + (keyExists('smartQuiz.v1') ? '有' : '无'),
                        'smartQuiz.runtimeSession.v1=' + (keyExists('smartQuiz.runtimeSession.v1') ? '有' : '无'),
                        'smartQuiz.hubExam.v1=' + (keyExists('smartQuiz.hubExam.v1') ? '有' : '无')].join(' · ')) +
      '</div>';
    if (!list.length) h += '<div class="notice-bar warn">当前没有任何答题记录。常见原因：① 答完最后一题后没点「确认交卷」（未交卷只算进行中）；② 换了浏览器 / 域名 / 设备（数据按 origin 隔离，本地预览、GitHub Pages、应用域名是三套）；③ 无痕或内存模式，刷新即丢；④ 清空过数据或导入旧备份；⑤ 浏览器仍加载旧版 JS，按 Ctrl + F5 强刷一次。</div>';
    h += '<h3 style="margin:14px 0 8px">全部答题记录</h3>' + table();
    h += '<h3 style="margin:14px 0 8px">逐题作答明细（实时）</h3>' + detailsTable();
    h += '<p class="small muted" style="margin:10px 0 0">数据保存在<b>当前浏览器 + 当前域名</b>的本地存储，按账号隔离。跨设备请用「导出 JSON / 导入备份」迁移。若此处计数不为 0 但别的页面空白，说明看的是不同地址或旧缓存。</p>' +
      '<div class="row" style="margin-top:10px"><button class="btn btn-sm" data-action="export-json">导出当前数据</button>' +
      '<a class="btn btn-sm" href="#/practiceRecords">练习记录统计</a>' +
      '<a class="btn btn-sm" href="#/records">刷题记录明细</a></div></section>';
    return h;
  }

  Quiz.recordsDiag = {VERSION, html, table, rows, sources, fmt, detailsTable, daily};
  if (typeof module !== 'undefined' && module.exports) module.exports = Quiz.recordsDiag;
})(typeof window !== 'undefined' ? window : globalThis);
