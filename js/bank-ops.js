/* v1.5.0 题库「更多操作」十项功能（纯增量，参考图一）
   置顶 / 重命名 / 移动 / 导出 / 练习设置 / 自定义题型 / 编辑章节 / 设置封面 /
   配置模拟考试模板 / 删除，外加顶部工具栏的「合并题库 / 批量分享」。
   数据挂在 store 主 state 的 bank_ops / bank_groups，随导出备份一起走。
   事件用 data-action^="bo-" + stopImmediatePropagation 隔离，避免 app.js 通用 render 干扰。 */
(function (global) {
  const Quiz = global.Quiz = global.Quiz || {};
  const store = Quiz.store, util = Quiz.util;
  const e = v => util.esc(String(v == null ? '' : v));
  const S = Quiz.bankOpsState = {openRow: '', menuPos: {left: 8, top: 60}};
  const COVERS = ['#3b5bdb','#15803d','#c2410c','#7048b6','#c62828','#0f766e'];
  const LABEL = {single:'单选题', multiple:'多选题', judge:'判断题'};

  const app = () => Quiz.app;
  const $ = id => global.document && global.document.getElementById(id);
  const v = id => { const x = $(id); return x ? String(x.value || '') : ''; };
  const ck = id => { const x = $(id); return !!(x && x.checked); };
  const toast = (m, t) => { const a = app(); if (a && a.toast) a.toast(m, t || 'ok'); };
  const render = () => { const a = app(); if (a && a.render) a.render(); };
  const modal = (title, body, foot) => { const a = app(); if (a && a.modal) a.modal(title, body, foot); };
  const close = () => { const a = app(); if (a && a.closeModal) a.closeModal(); };

  function raw() {
    const s = store.state();
    if (!s.bank_ops || typeof s.bank_ops !== 'object') store.mutate(x => { x.bank_ops = {}; });
    if (!Array.isArray(s.bank_groups)) store.mutate(x => { x.bank_groups = []; });
    return store.state();
  }
  function defaults() {
    return {
      pinned:false, group:'未分组', cover:COVERS[0], icon:'题', category:'未分类', taskMode:'顺序练习',
      chapters:[], types:{single:true, multiple:true, judge:true, custom:''},
      practice:{count:10, order:'random', feedback_mode:'immediate', auto_advance:false, shuffle_options:true},
      exam:{enabled:false, duration:45, pass:60, single:5, multiple:3, judge:2}
    };
  }
  function has(id) { return !!raw().bank_ops[id]; }
  function get(id) {
    const r = raw().bank_ops[id] || {}, d = defaults();
    return Object.assign(d, r, {
      types: Object.assign(d.types, r.types || {}),
      practice: Object.assign(d.practice, r.practice || {}),
      exam: Object.assign(d.exam, r.exam || {})
    });
  }
  function patch(id, obj) {
    return store.mutate(s => {
      if (!s.bank_ops) s.bank_ops = {};
      const cur = get(id);
      Object.keys(obj || {}).forEach(k => { cur[k] = obj[k]; });
      s.bank_ops[id] = cur;
    });
  }
  function groups() { return ['未分组'].concat(raw().bank_groups || []); }
  function addGroup(name) {
    const n = String(name || '').trim();
    if (!n || groups().indexOf(n) >= 0) return false;
    store.mutate(s => { if (!Array.isArray(s.bank_groups)) s.bank_groups = []; s.bank_groups.push(n); });
    return true;
  }
  function sorted(list) {
    return list.slice().sort((a, b) => {
      const pa = has(a.bank_id) && get(a.bank_id).pinned ? 1 : 0;
      const pb = has(b.bank_id) && get(b.bank_id).pinned ? 1 : 0;
      return pb - pa;
    });
  }
  function chaptersFor(id) { return has(id) ? (get(id).chapters || []) : []; }
  function templateFor(id) { return has(id) ? get(id).exam : null; }

  /* ---------- 行级下拉菜单 ---------- */
  const ITEMS = [
    ['bo-pin', '置顶'], ['bo-rename', '重命名'], ['bo-move', '移动'], ['bo-export', '导出'],
    ['bo-practice', '练习设置'], ['bo-types', '自定义题型'], ['bo-chapters', '编辑章节'],
    ['bo-cover', '设置封面'], ['bo-exam', '配置模拟考试模板'], ['bo-delete', '删除', 'danger']
  ];
  /* v1.5.1：菜单改用 fixed 定位，避免被 .table-wrap(overflow-x:auto) 与
     .blank-panel(overflow:hidden) 双重裁切；打开前先算好触发按钮的视口坐标。 */
  const MENU_W = 176, MENU_H = 320;
  function menuPosition(el) {
    try {
      const win = global.window || {}, vw = win.innerWidth || 1280, vh = win.innerHeight || 800;
      const r = el && el.getBoundingClientRect ? el.getBoundingClientRect() : null;
      let left = r ? r.right - MENU_W : vw - MENU_W - 16;
      let top = r ? r.bottom + 5 : 60;
      left = Math.max(8, Math.min(left, Math.max(8, vw - MENU_W - 8)));
      if (top + MENU_H > vh - 8) top = Math.max(8, (r ? r.top : 60) - MENU_H - 5);
      return {left: Math.round(left), top: Math.round(Math.max(8, top))};
    } catch (x) { return {left: 8, top: 60}; }
  }
  function menuHtml(id) {
    const pinned = has(id) && get(id).pinned, p = S.menuPos || {left: 8, top: 60};
    return '<div class="bo-wrap"><button class="btn-link" data-action="bo-menu" data-id="' + e(id) + '">更多 ⌄</button>' +
      '<div class="bo-menu' + (S.openRow === id ? ' open' : '') + '" style="left:' + p.left + 'px;top:' + p.top + 'px">' +
      ITEMS.map(it => '<button data-action="' + it[0] + '" data-id="' + e(id) + '"' + (it[2] ? ' class="bo-danger"' : '') + '>' +
        (it[0] === 'bo-pin' && pinned ? '取消置顶' : it[1]) + '</button>').join('') +
      '</div></div>';
  }
  function nameCell(b) {
    const o = get(b.bank_id), pinned = has(b.bank_id) && o.pinned;
    return '<div class="bo-name"><span class="bo-cover" style="background:' + e(o.cover) + '">' + e(o.icon) + '</span>' +
      '<span class="bo-name-tx">' + e(b.name) + '</span>' + (pinned ? '<span class="bo-pin-tag">置顶</span>' : '') +
      (b.is_default ? '<span class="bo-def">默认</span>' : '') + '</div>';
  }
  function extras(b) {
    const o = get(b.bank_id), chs = o.chapters || [];
    return [
      '<span class="small">' + e(o.category || '未分类') + '</span>',
      '<span class="small muted">' + (chs.length ? chs.length + ' 个章节' : '—') + '</span>',
      '<span class="small muted">' + e(o.taskMode || '顺序练习') + '</span>'
    ];
  }

  /* ---------- 弹窗 ---------- */
  const foot = (label, action, id) => '<button class="btn" data-action="close-modal">取消</button>' +
    '<button class="btn btn-primary" data-action="' + action + '" data-id="' + e(id) + '">' + label + '</button>';
  function formRow(label, body) { return '<label class="field" style="margin-bottom:10px">' + label + body + '</label>'; }
  const sel = (id, list, cur) => '<select id="' + id + '">' + list.map(x =>
    '<option value="' + e(x) + '"' + (String(cur) === String(x) ? ' selected' : '') + '>' + e(x) + '</option>').join('') + '</select>';

  function openDialog(a, id) {
    const b = store.bank(id), o = get(id);
    if (!b) { toast('题库不存在', 'err'); return; }
    if (a === 'bo-rename') {
      const body = formRow('题库名称', '<input type="text" id="bo-name" value="' + e(b.name) + '">') +
        formRow('描述', '<textarea id="bo-desc" style="min-height:60px">' + e(b.description || '') + '</textarea>');
      modal('重命名题库', body, foot('保存', 'bo-rename-save', id)); return;
    }
    if (a === 'bo-move') {
      modal('移动题库 · ' + b.name,
        formRow('目标分组', sel('bo-group', groups(), o.group)) +
        formRow('新建分组（选填）', '<input type="text" id="bo-new-group" placeholder="输入后同时创建并移动">'),
        foot('移动', 'bo-move-save', id)); return;
    }
    if (a === 'bo-export') {
      modal('导出题库 · ' + b.name,
        formRow('导出格式', sel('bo-format', ['CSV（可再导入）', 'JSON（完整备份）'], 'CSV（可再导入）')) +
        '<p class="small faint">仅导出该题库题目；整站备份请用「导出数据」。</p>',
        foot('下载', 'bo-export-save', id)); return;
    }
    if (a === 'bo-practice') {
      const p = o.practice;
      modal('练习设置 · ' + b.name,
        formRow('每次题量', '<input type="number" id="bo-count" min="1" max="200" value="' + e(p.count) + '">') +
        formRow('出题顺序', sel('bo-order', ['random', 'sequential'], p.order)) +
        formRow('反馈时机', sel('bo-feedback', ['immediate', 'after_submit'], p.feedback_mode)) +
        '<label class="check"><input type="checkbox" id="bo-auto"' + (p.auto_advance ? ' checked' : '') + '> 答对自动下一题</label>' +
        '<label class="check"><input type="checkbox" id="bo-shuffle"' + (p.shuffle_options ? ' checked' : '') + '> 随机打乱选项</label>' +
        formRow('任务方式', sel('bo-task', ['顺序练习', '随机练习', '章节练习', '题型练习'], o.taskMode)),
        foot('保存并用于组卷', 'bo-practice-save', id)); return;
    }
    if (a === 'bo-types') {
      const t = o.types;
      modal('自定义题型 · ' + b.name,
        '<p class="small muted">关闭的题型不会进入该题库的练习抽题池。</p>' +
        Object.keys(LABEL).map(k => '<label class="check"><input type="checkbox" id="bo-t-' + k + '"' + (t[k] !== false ? ' checked' : '') + '> ' + LABEL[k] + '</label>').join('') +
        formRow('自定义题型标签（逗号分隔，仅作目录展示）', '<input type="text" id="bo-custom" value="' + e(t.custom || '') + '">'),
        foot('保存', 'bo-types-save', id)); return;
    }
    if (a === 'bo-chapters') {
      modal('编辑章节 · ' + b.name,
        formRow('章节目录（每行一个，对应题目「分类」字段）', '<textarea id="bo-chapters" style="min-height:140px" placeholder="第一章 基础知识\n第二章 进阶">' + e((o.chapters || []).join('\n')) + '</textarea>') +
        formRow('题库类别', '<input type="text" id="bo-category" value="' + e(o.category || '') + '">'),
        foot('保存', 'bo-chapters-save', id)); return;
    }
    if (a === 'bo-cover') {
      modal('设置封面 · ' + b.name,
        '<div class="bo-covers">' + COVERS.map(c => '<label class="bo-cover-opt"><input type="radio" name="bo-color" value="' + c + '"' + (o.cover === c ? ' checked' : '') + '><span style="background:' + c + '">' + e(o.icon) + '</span></label>').join('') + '</div>' +
        formRow('封面文字（1–2 字）', '<input type="text" id="bo-icon" maxlength="2" value="' + e(o.icon) + '">'),
        foot('保存', 'bo-cover-save', id)); return;
    }
    if (a === 'bo-exam') {
      const x = o.exam;
      modal('配置模拟考试模板 · ' + b.name,
        '<label class="check"><input type="checkbox" id="bo-exam-on"' + (x.enabled ? ' checked' : '') + '> 在模拟考试页显示「应用模板」</label>' +
        formRow('考试时长（分钟）', '<input type="number" id="bo-ex-duration" min="1" value="' + e(x.duration) + '">') +
        formRow('及格分', '<input type="number" id="bo-ex-pass" min="0" value="' + e(x.pass) + '">') +
        formRow('单选题数', '<input type="number" id="bo-ex-single" min="0" value="' + e(x.single) + '">') +
        formRow('多选题数', '<input type="number" id="bo-ex-multiple" min="0" value="' + e(x.multiple) + '">') +
        formRow('判断题数', '<input type="number" id="bo-ex-judge" min="0" value="' + e(x.judge) + '">'),
        foot('保存模板', 'bo-exam-save', id)); return;
    }
    if (a === 'bo-merge') {
      const banks = store.banks();
      modal('合并题库',
        formRow('源题库（题目移出后删除该题库）', sel('bo-src', banks.map(x => x.name), banks[0] && banks[0].name)) +
        formRow('目标题库', sel('bo-dst', banks.map(x => x.name), banks[0] && banks[0].name)) +
        '<p class="small faint">题目不会被删除，只会移出该题库。</p>',
        foot('合并', 'bo-merge-save', '')); return;
    }
  }

  /* ---------- 导出 ---------- */
  function cell(x) { const s = String(x == null ? '' : x); return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
  function exportBank(id, format) {
    const b = store.bank(id), qs = store.state().questions.filter(q => q.bank_id === id);
    if (!b) return;
    let text, name, mime;
    if (format === 'json') {
      text = JSON.stringify({bank:b, ops:get(id), questions:qs}, null, 2);
      name = b.name + '.json'; mime = 'application/json';
    } else {
      const keys = (Quiz.importer && Quiz.importer.KEYS) || ['question_id','type','stem','answer'];
      const row = q => {
        const o = {question_id:q.question_id, type:q.type, stem:q.stem, answer:
          q.type === 'judge' ? (q.answer && q.answer.value ? 'T' : 'F') : ((q.answer && q.answer.keys) || []).join(','),
          analysis:q.analysis, category:(q.category || []).join('/'), tags:(q.tags || []).join(';'),
          difficulty:q.difficulty, score:q.score, source:q.source, status:q.status, bank_id:q.bank_id};
        (q.options || []).forEach(x => { o['option_' + String(x.key).toLowerCase()] = x.text; });
        return keys.map(k => cell(o[k])).join(',');
      };
      text = [keys.map(cell).join(',')].concat(qs.map(row)).join('\n');
      name = b.name + '.csv'; mime = 'text/csv';
    }
    util.download(name, text, mime);
    toast('已导出 ' + qs.length + ' 题 · ' + name, 'ok');
  }

  /* ---------- 动作 ---------- */
  function onAction(a, el) {
    const id = el.dataset.id || '';
    if (a === 'bo-menu') {
      if (S.openRow === id) S.openRow = '';
      else { S.menuPos = menuPosition(el); S.openRow = id; }
      render(); return true;
    }
    if (a === 'bo-close-menu') { S.openRow = ''; render(); return true; }
    if (a === 'bo-pin') {
      const p = has(id) && get(id).pinned;
      patch(id, {pinned: !p}); S.openRow = ''; render(); toast(p ? '已取消置顶' : '已置顶', 'ok'); return true;
    }
    if (['bo-rename','bo-move','bo-export','bo-practice','bo-types','bo-chapters','bo-cover','bo-exam','bo-merge'].indexOf(a) >= 0) {
      S.openRow = ''; openDialog(a, id); return true;
    }
    if (a === 'bo-rename-save') {
      const n = v('bo-name').trim();
      if (!n) { toast('题库名称不能为空', 'err'); return true; }
      store.renameBank(id, {name:n, description:v('bo-desc')});
      close(); render(); toast('已重命名', 'ok'); return true;
    }
    if (a === 'bo-move-save') {
      const ng = v('bo-new-group').trim();
      if (ng) addGroup(ng);
      patch(id, {group: ng || v('bo-group') || '未分组'});
      close(); render(); toast('已移动题库', 'ok'); return true;
    }
    if (a === 'bo-export-save') {
      exportBank(id, v('bo-format').indexOf('JSON') >= 0 ? 'json' : 'csv'); close(); return true;
    }
    if (a === 'bo-practice-save') {
      patch(id, {taskMode: v('bo-task') || '顺序练习', practice: {
        count: Math.max(1, Number(v('bo-count')) || 10), order: v('bo-order') || 'random',
        feedback_mode: v('bo-feedback') || 'immediate',
        auto_advance: ck('bo-auto'), shuffle_options: ck('bo-shuffle')
      }});
      close(); render(); toast('练习设置已保存，之后从该题库组卷自动生效', 'ok'); return true;
    }
    if (a === 'bo-types-save') {
      patch(id, {types: {single:ck('bo-t-single'), multiple:ck('bo-t-multiple'), judge:ck('bo-t-judge'), custom:v('bo-custom')}});
      close(); render(); toast('自定义题型已保存', 'ok'); return true;
    }
    if (a === 'bo-chapters-save') {
      const chs = v('bo-chapters').split(/\r?\n/).map(x => x.trim()).filter(Boolean);
      patch(id, {chapters:chs, category:v('bo-category').trim() || '未分类'});
      close(); render(); toast('已保存 ' + chs.length + ' 个章节', 'ok'); return true;
    }
    if (a === 'bo-cover-save') {
      let color = COVERS[0];
      try { const r = global.document.querySelector('input[name="bo-color"]:checked'); if (r) color = r.value; } catch (x) {}
      patch(id, {cover:color, icon:(v('bo-icon') || '题').slice(0, 2)});
      close(); render(); toast('封面已更新', 'ok'); return true;
    }
    if (a === 'bo-exam-save') {
      patch(id, {exam: {enabled:ck('bo-exam-on'),
        duration:Math.max(1, Number(v('bo-ex-duration')) || 45), pass:Number(v('bo-ex-pass')) || 0,
        single:Number(v('bo-ex-single')) || 0, multiple:Number(v('bo-ex-multiple')) || 0, judge:Number(v('bo-ex-judge')) || 0}});
      close(); render(); toast('模拟考试模板已保存', 'ok'); return true;
    }
    if (a === 'bo-exam-apply') {
      const t = templateFor(id), H = Quiz.hub;
      if (t && H && H.exam && H.exam.cfg) {
        Object.assign(H.exam.cfg, {single:t.single, multiple:t.multiple, judge:t.judge, duration:t.duration, pass:t.pass});
        render(); toast('已应用该题库的模拟考试模板', 'ok');
      }
      return true;
    }
    if (a === 'bo-delete') {
      const b = store.bank(id);
      if (!b) return true;
      if (b.is_default) { toast('默认题库不可删除', 'err'); return true; }
      if (!global.confirm || !global.confirm('删除题库「' + b.name + '」？题目会变为未分类，不会丢失。')) return true;
      store.removeBank(id); S.openRow = ''; render(); toast('已删除题库，题目已变为未分类', 'ok'); return true;
    }
    if (a === 'bo-merge-save') {
      const banks = store.banks(), src = banks.find(x => x.name === v('bo-src')), dst = banks.find(x => x.name === v('bo-dst'));
      if (!src || !dst || src.bank_id === dst.bank_id) { toast('请选择两个不同的题库', 'err'); return true; }
      const ids = store.state().questions.filter(q => q.bank_id === src.bank_id).map(q => q.question_id);
      const n = store.moveQuestions(ids, dst.bank_id);
      if (!src.is_default) store.removeBank(src.bank_id);
      close(); render(); toast('已合并 ' + n + ' 题到「' + dst.name + '」', 'ok'); return true;
    }
    if (a === 'bo-share') {
      const banks = store.banks();
      const picked = [];
      try { global.document.querySelectorAll('.nb-ck:checked').forEach(x => picked.push(x.value)); } catch (x) {}
      const list = picked.length ? banks.filter(b => picked.indexOf(b.bank_id) >= 0) : banks;
      const text = ['题库分享清单 · ' + new Date().toLocaleString(), ''].concat(list.map(b =>
        '· ' + b.name + '（' + store.questionCount(b.bank_id) + ' 题 · ' + get(b.bank_id).group + '）')).join('\n');
      util.download('题库分享清单.txt', text, 'text/plain');
      toast('已生成 ' + list.length + ' 个题库的分享清单', 'ok'); return true;
    }
    return false;
  }
  function onChange(a, el, target) {
    if (a === 'bo-filter') {
      const nav = Quiz.navState;
      if (nav && nav.mybanks) {
        if (el.dataset.key === 'group') nav.mybanks.group = target.value;
        if (el.dataset.key === 'date') nav.mybanks.date = target.value;
      }
      render(); return true;
    }
    return false;
  }
  try {
    global.document.addEventListener('click', function (ev) {
      const el = ev.target && ev.target.closest && ev.target.closest('[data-action^="bo-"]');
      if (!el) return;
      if (!onAction(el.dataset.action, el)) return;
      if (ev.stopImmediatePropagation) ev.stopImmediatePropagation();
    });
    global.document.addEventListener('change', function (ev) {
      const el = ev.target && ev.target.closest && ev.target.closest('[data-action^="bo-"]');
      if (!el) return;
      if (!onChange(el.dataset.action, el, ev.target)) return;
      if (ev.stopImmediatePropagation) ev.stopImmediatePropagation();
    });
  } catch (x) {}
  /* v1.5.1：fixed 菜单不跟随滚动，滚动或窗口尺寸变化时自动收起，避免浮层错位 */
  try {
    const dismiss = () => { if (S.openRow) { S.openRow = ''; render(); } };
    if (global.window && global.window.addEventListener) {
      global.window.addEventListener('scroll', dismiss, true);
      global.window.addEventListener('resize', dismiss);
    }
  } catch (x) {}

  Quiz.bankOps = {state:S, defaults, has, get, patch, groups, addGroup, sorted, menuHtml, nameCell, extras,
    chaptersFor, templateFor, exportBank, onAction, onChange, ITEMS, COVERS};
  if (typeof module !== 'undefined' && module.exports) module.exports = Quiz.bankOps;
})(typeof window !== 'undefined' ? window : globalThis);
