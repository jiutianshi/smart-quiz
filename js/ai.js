/* AI 能力（可选、纯增量）：OpenAI 兼容模型配置、逐题讲解、导入兜底解析、用量审计
 * 设计约束（参考 youmizhihui/shuatixia 第 8 章，适配纯前端单机版）：
 *  - 完全手动触发：不配 / 不启用时，本模块不发起任何网络请求，其余功能零影响
 *  - 配置与缓存、用量存放在独立 localStorage 键，绝不进入 store.exportText() 的 JSON 备份
 *  - API Key 仅存本机浏览器，界面永不回显完整值，只展示脱敏尾号
 *  - 讲解按题目指纹 + 模型名缓存，同题同模型不重复计费
 *  - ai_usage 只记 时间 / 类型 / 模型 / 字符数 / 成败，不记录题目内容
 *  - 浏览器直连模型服务，可能受服务商 CORS 限制；Ollama 等本地服务需自行放行来源
 */
(function (global) {
  const Quiz = global.Quiz = global.Quiz || {};
  const CFG_KEY   = 'smartQuiz.aiConfig.v1';
  const CACHE_KEY = 'smartQuiz.aiCache.v1';
  const USAGE_KEY = 'smartQuiz.aiUsage.v1';
  const TIMEOUT = 60000;
  const MAX_BLOCK_CHARS = 6000;   // 单次导入解析原文字符预算
  const MAX_USAGE = 200;
  const MAX_CACHE = 500;

  /* 常用 OpenAI 兼容接口预设：仅自动填充地址与模型名称，均可手动修改。
     是否允许浏览器跨域由服务商决定，请自行以「测试连接」验证。 */
  const PRESETS = [
    {label:'DeepSeek 深度求索',        base:'https://api.deepseek.com/v1',                    model:'deepseek-chat'},
    {label:'豆包 / 火山方舟',           base:'https://ark.cn-beijing.volces.com/api/v3',       model:'doubao-pro-32k'},
    {label:'OpenAI',                    base:'https://api.openai.com/v1',                      model:'gpt-4o-mini'},
    {label:'通义千问（阿里云百炼）',     base:'https://dashscope.aliyuncs.com/compatible-mode/v1', model:'qwen-plus'},
    {label:'智谱 GLM',                  base:'https://open.bigmodel.cn/api/paas/v4',          model:'glm-4-flash'},
    {label:'Kimi（Moonshot）',          base:'https://api.moonshot.cn/v1',                     model:'moonshot-v1-8k'},
    {label:'硅基流动 SiliconFlow',      base:'https://api.siliconflow.cn/v1',                  model:'deepseek-ai/DeepSeek-V3'},
    {label:'Ollama 本地模型',           base:'http://localhost:11434/v1',                      model:'llama3'},
    {label:'自定义（自行填写）',         base:'',                                               model:''}
  ];

  /* ---------- 独立存储 ---------- */
  function lsGet(key, fallback) {
    try { const t = global.localStorage.getItem(key); return t ? JSON.parse(t) : fallback; }
    catch (e) { return fallback; }
  }
  function lsSet(key, obj) {
    try {
      global.localStorage.setItem(key, JSON.stringify(obj));
      /* v1.12.5：AI 配置 / 缓存 / 用量随账号自动保存 */
      try { if (Quiz.accountGate && Quiz.accountGate.touch) Quiz.accountGate.touch(); } catch (e2) {}
      return true;
    }
    catch (e) { return false; }
  }
  function lsDel(key) { try { global.localStorage.removeItem(key); } catch (e) {} }

  function maskKey(key) {
    if (!key) return '';
    if (key.length <= 8) return '****';
    return key.slice(0, 4) + '****' + key.slice(-4);
  }
  function rawConfig() {
    const c = lsGet(CFG_KEY, null) || {};
    return {enabled: !!c.enabled, baseUrl: String(c.baseUrl || ''), model: String(c.model || ''),
            apiKey: String(c.apiKey || ''), updated_at: c.updated_at || null};
  }
  /** 供界面使用的脱敏视图：任何情况下都不返回完整 Key */
  function config() {
    const c = rawConfig();
    return {enabled: c.enabled, baseUrl: c.baseUrl, model: c.model,
            hasKey: !!c.apiKey, keyMask: maskKey(c.apiKey), updated_at: c.updated_at,
            configured: !!(c.baseUrl && c.model)};
  }
  function isReady() { const c = rawConfig(); return !!(c.enabled && c.baseUrl && c.model); }

  /** apiKey 留空 = 保留已存 Key；clearKey=true = 显式清空（本地服务无需 Key） */
  function saveConfig(patch) {
    patch = patch || {};
    const old = rawConfig();
    const next = {
      enabled: patch.enabled === undefined ? old.enabled : !!patch.enabled,
      baseUrl: String(patch.baseUrl === undefined ? old.baseUrl : patch.baseUrl).trim().replace(/\/+$/, ''),
      model: String(patch.model === undefined ? old.model : patch.model).trim(),
      apiKey: patch.clearKey ? ''
        : (patch.apiKey === undefined || patch.apiKey === null || String(patch.apiKey).trim() === ''
            ? old.apiKey : String(patch.apiKey).trim()),
      updated_at: new Date().toISOString()
    };
    if (!next.baseUrl) throw new Error('API 地址不能为空');
    if (!/^https?:\/\//i.test(next.baseUrl)) throw new Error('API 地址须以 http:// 或 https:// 开头');
    if (!next.model) throw new Error('模型名称不能为空');
    if (!lsSet(CFG_KEY, next)) throw new Error('本地存储写入失败');
    return config();
  }
  function clearConfig() { lsDel(CFG_KEY); }

  /* ---------- 用量审计（不含题目内容） ---------- */
  function usage() { const u = lsGet(USAGE_KEY, []); return Array.isArray(u) ? u : []; }
  function logUsage(kind, model, chars, ok, err) {
    const list = usage();
    list.unshift({at: new Date().toISOString(), kind, model: String(model || ''),
                  chars: Number(chars) || 0, ok: !!ok,
                  error: ok ? '' : String(err || '').slice(0, 80)});
    lsSet(USAGE_KEY, list.slice(0, MAX_USAGE));
  }
  function clearUsage() { lsDel(USAGE_KEY); }
  function stats() {
    const u = usage(), ca = lsGet(CACHE_KEY, {});
    return {calls: u.length, success: u.filter(x => x.ok).length, failed: u.filter(x => !x.ok).length,
            chars: u.reduce((n, x) => n + (x.chars || 0), 0), cached: Object.keys(ca || {}).length};
  }

  /* ---------- 讲解缓存 ---------- */
  function cacheKey(q, kind) {
    const stem = String((q && q.stem) || '');
    let fp = stem;
    try { fp = Quiz.util.fingerprint(stem, q.type, q.options || []); } catch (e) { /* 无 util 时退化为题干 */ }
    return kind + ':' + ((q && q.question_id) || '') + ':' + fp;
  }
  function getCache(key, model) {
    const ca = lsGet(CACHE_KEY, {}); const item = ca[key];
    return (item && item.text && (!model || item.model === model)) ? item : null;
  }
  function setCache(key, item) {
    const ca = lsGet(CACHE_KEY, {});
    ca[key] = item;
    const keys = Object.keys(ca);
    if (keys.length > MAX_CACHE) keys.slice(MAX_CACHE).forEach(k => delete ca[k]);
    lsSet(CACHE_KEY, ca);
  }
  function clearCache() { lsDel(CACHE_KEY); }

  /* ---------- OpenAI 兼容调用 ---------- */
  function looseParse(content) {
    const t = String(content || '').trim();
    try { return JSON.parse(t); } catch (e) {}
    const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) { try { return JSON.parse(fence[1].trim()); } catch (e) {} }
    const obj = t.match(/\{[\s\S]*\}/);
    if (obj) { try { return JSON.parse(obj[0]); } catch (e) {} }
    const arr = t.match(/\[[\s\S]*\]/);
    if (arr) { try { return JSON.parse(arr[0]); } catch (e) {} }
    return null;
  }

  async function callLLM(messages, opts) {
    const c = rawConfig();
    if (!c.enabled) throw new Error('AI 功能未启用：请到「数据与设置 → AI 模型配置」开启');
    if (!c.baseUrl || !c.model) throw new Error('模型配置不完整：请填写 API 地址与模型名称');
    if (typeof global.fetch !== 'function') throw new Error('当前环境不支持 fetch，无法调用模型服务');
    const url = c.baseUrl.replace(/\/+$/, '') + '/chat/completions';
    const payload = {model: c.model, messages, temperature: 0.3};
    if (opts && opts.json) payload.response_format = {type: 'json_object'};
    const headers = {'Content-Type': 'application/json'};
    if (c.apiKey) headers['Authorization'] = 'Bearer ' + c.apiKey;
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), TIMEOUT) : null;
    let res;
    try {
      res = await global.fetch(url, {
        method: 'POST', headers, body: JSON.stringify(payload),
        signal: ctrl ? ctrl.signal : undefined
      });
    } catch (e) {
      if (timer) clearTimeout(timer);
      const why = e && e.name === 'AbortError' ? '请求超时（60s）' : (e && e.message ? e.message : '网络错误');
      throw new Error('无法连接模型服务：' + why + '。若为跨域问题，请确认服务商允许浏览器直连，或改用本地 Ollama 并放行来源');
    }
    if (timer) clearTimeout(timer);
    if (!res.ok) {
      let detail = '';
      try { detail = await res.text(); } catch (e) {}
      throw new Error('模型服务返回 HTTP ' + res.status + (detail ? '：' + String(detail).slice(0, 160) : ''));
    }
    let data;
    try { data = await res.json(); } catch (e) { throw new Error('模型响应不是合法 JSON'); }
    const text = (data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
    if (!text) throw new Error('模型未返回内容');
    return {text: String(text), usage: data.usage || {}, model: c.model};
  }

  async function testConnection() {
    const c = rawConfig();
    try {
      const r = await callLLM([
        {role: 'system', content: '你是一个连通性测试助手，只回复两个字：正常'},
        {role: 'user', content: '请回复「正常」'}
      ]);
      logUsage('test', c.model, 40 + r.text.length, true, '');
      return {ok: true, text: r.text.slice(0, 60), model: c.model};
    } catch (e) {
      logUsage('test', c.model, 0, false, e.message);
      throw e;
    }
  }

  /* ---------- 逐题 AI 讲解 ---------- */
  const EXPLAIN_SYSTEM = '你是一位严谨的题库讲解老师。针对给定题目，用简体中文输出：1) 正确结论；2) 关键推理步骤；3) 易错点提示；4) 若题目自带解析，补充其未说明之处。条理清晰，控制在 350 字以内，不要编造题目未给出的条件，不要输出 Markdown 代码块。';

  function answerText(q) {
    if (!q) return '';
    if (q.type === 'judge') return q.answer && q.answer.value === true ? '正确(T)' : q.answer && q.answer.value === false ? '错误(F)' : '—';
    return ((q.answer && q.answer.keys) || []).join('、') || '—';
  }
  function questionText(q) {
    const type = ({single:'单选题', multiple:'多选题', judge:'判断题'})[q.type] || q.type;
    const opts = (q.options || []).map(o => o.key + '. ' + o.text).join('\n') || '（无选项）';
    return '题型：' + type + '\n题干：' + String(q.stem || '') +
      '\n选项：\n' + opts + '\n正确答案：' + answerText(q) +
      '\n题库已有解析：' + String(q.analysis || '（无）') +
      '\n分类：' + ((q.category || []).join('/') || '未分类');
  }
  async function explain(q, force) {
    if (!q || !q.stem) throw new Error('题目数据不完整，无法生成讲解');
    const c = rawConfig(), key = cacheKey(q, 'explain');
    if (!force) {
      const hit = getCache(key, c.model);
      if (hit) return {text: hit.text, cached: true, model: hit.model, at: hit.at};
    }
    const prompt = questionText(q);
    try {
      const r = await callLLM([{role: 'system', content: EXPLAIN_SYSTEM}, {role: 'user', content: prompt}]);
      setCache(key, {text: r.text, model: c.model, at: new Date().toISOString(), question_id: q.question_id || ''});
      logUsage('explain', c.model, prompt.length + r.text.length, true, '');
      return {text: r.text, cached: false, model: c.model};
    } catch (e) {
      logUsage('explain', c.model, prompt.length, false, e.message);
      throw e;
    }
  }

  /* ---------- 导入 AI 兜底解析 ---------- */
  const PARSE_SYSTEM = '你是题库结构化助手。把用户提供的非表格题目文本转换为 JSON 对象，格式严格为 {"rows":[ {...}, {...} ]}。每个对象代表一道题，可用字段：question_id、type、stem、option_a~option_f、answer、analysis、category、tags、difficulty、score、source、status（也接受中文键名如 题型/题干/正确答案/选项A）。规则：type 只能是 single / multiple / judge；单选与多选的 answer 为大写字母，多选用逗号分隔（如 "A,C"），判断题 answer 为 T 或 F；判断题不要填选项；无法判断的字段留空字符串，不要编造题干或答案。只输出 JSON，不要输出解释文字。';

  const TYPE_MAP = {'单选题':'single','单选':'single','single':'single','多选题':'multiple','多选':'multiple','multiple':'multiple','判断题':'judge','判断':'judge','judge':'judge'};
  const DIFF_MAP = {'简单':'1','较易':'2','中等':'3','较难':'4','困难':'5','easy':'1','medium':'3','hard':'5'};
  function csvCell(v) {
    if (v == null) return '';
    let s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    s = s.replace(/"/g, '""');
    return '"' + s + '"';
  }
  function normalizeRow(obj) {
    const IMP = Quiz.importer || {}, KEYS = IMP.KEYS || [];
    const out = {};
    Object.keys(obj || {}).forEach(k => {
      const key = IMP.normalizeHeader ? IMP.normalizeHeader(k) : k;
      if (KEYS.indexOf(key) >= 0) out[key] = obj[k];
    });
    if (Array.isArray(obj && obj.options) && !out.option_a) {
      obj.options.slice(0, 6).forEach((t, i) => { out['option_' + 'abcdef'[i]] = t; });
    }
    if (out.type) out.type = TYPE_MAP[String(out.type).trim().toLowerCase()] || TYPE_MAP[String(out.type).trim()] || String(out.type).trim().toLowerCase();
    if (out.difficulty && DIFF_MAP[String(out.difficulty).trim().toLowerCase()]) out.difficulty = DIFF_MAP[String(out.difficulty).trim().toLowerCase()];
    if (Array.isArray(out.answer)) out.answer = out.answer.join(',');
    if (typeof out.answer === 'boolean') out.answer = out.answer ? 'T' : 'F';
    if (Array.isArray(out.tags)) out.tags = out.tags.join(';');
    if (Array.isArray(out.category)) out.category = out.category.join('/');
    if (out.status && /已发布|发布/.test(out.status)) out.status = 'published';
    return out;
  }
  /** 模型返回的对象数组 → 标准 CSV（沿用导入模板表头，仍须经 E001–E010 校验） */
  function rowsToCsv(rows) {
    const KEYS = (Quiz.importer && Quiz.importer.KEYS) || [];
    if (!KEYS.length) throw new Error('导入模块未加载');
    const head = KEYS.join(',');
    const body = rows.map(raw => {
      const o = normalizeRow(raw);
      return KEYS.map(k => csvCell(o[k] === undefined ? '' : o[k])).join(',');
    });
    return [head].concat(body).join('\n');
  }
  async function parseQuestions(text) {
    const raw = String(text || '');
    const src = raw.slice(0, MAX_BLOCK_CHARS);
    if (!src.trim()) throw new Error('输入框没有可解析的文本');
    const c = rawConfig();
    try {
      const r = await callLLM([
        {role: 'system', content: PARSE_SYSTEM},
        {role: 'user', content: '以下是待转换的题库原文：\n' + src}
      ], {json: true});
      const parsed = looseParse(r.text);
      const rows = Array.isArray(parsed) ? parsed : (parsed && Array.isArray(parsed.rows) ? parsed.rows : null);
      if (!rows || !rows.length) throw new Error('模型未返回可识别的题目（可尝试缩短文本或换模型）');
      const csv = rowsToCsv(rows);
      logUsage('parse', c.model, src.length + r.text.length, true, '');
      return {csv, count: rows.length, truncated: raw.length > MAX_BLOCK_CHARS, model: c.model};
    } catch (e) {
      logUsage('parse', c.model, src.length, false, e.message);
      throw e;
    }
  }

  Quiz.ai = {
    PRESETS, TIMEOUT, MAX_BLOCK_CHARS,
    config, rawConfig, saveConfig, clearConfig, maskKey, isReady,
    usage, clearUsage, stats, clearCache, cacheKey, getCache, setCache,
    looseParse, normalizeRow, rowsToCsv, questionText, answerText,
    callLLM, testConnection, explain, parseQuestions
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Quiz.ai;
})(typeof window !== 'undefined' ? window : globalThis);
