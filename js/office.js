/* Office 文档导入：xlsx / docx 本地解析与模板生成（ZIP + OOXML，零外部依赖）
   - xlsx：读取第一个工作表（含 sharedStrings / inlineStr）
   - docx：读取第一个含表头的表格（w:tbl → w:tr → w:tc → w:t）
   - 模板用 ZIP store 模式生成，可直接在 Excel / Word 打开
   - 旧二进制 .xls / .doc 不支持，需另存为新格式
*/
(function (global) {
  const Quiz = global.Quiz = global.Quiz || {};
  const importer = Quiz.importer;
  const TE = new TextEncoder(), TD = new TextDecoder('utf-8');

  /* ---------- 通用工具 ---------- */
  function xe(s) { return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;'); }
  function xd(s) {
    return String(s == null ? '' : s)
      .replace(/&#x([0-9a-fA-F]+);/g, (_,h) => String.fromCodePoint(parseInt(h,16)))
      .replace(/&#(\d+);/g, (_,d) => String.fromCodePoint(parseInt(d,10)))
      .replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&');
  }
  function concat(parts) {
    const n = parts.reduce((s,p) => s + p.length, 0), out = new Uint8Array(n);
    let o = 0; parts.forEach(p => { out.set(p, o); o += p.length; }); return out;
  }
  function crc32(buf) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) {
      c ^= buf[i];
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
    }
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  function indexToCol(i) { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }
  function colToIndex(s) { let n = 0; for (const c of String(s).toUpperCase()) n = n * 26 + (c.charCodeAt(0) - 64); return n - 1; }

  /* ---------- ZIP 读 ---------- */
  function zipEntries(bytes) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let eocd = -1;
    const min = Math.max(0, bytes.length - 65558);
    for (let i = bytes.length - 22; i >= min; i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('不是有效的 Office 文件（缺少 ZIP 目录）');
    const count = dv.getUint16(eocd + 10, true);
    let off = dv.getUint32(eocd + 16, true);
    const list = [];
    for (let n = 0; n < count; n++) {
      if (off + 46 > bytes.length || dv.getUint32(off, true) !== 0x02014b50) break;
      const method = dv.getUint16(off + 10, true);
      const compSize = dv.getUint32(off + 20, true);
      const nameLen = dv.getUint16(off + 28, true);
      const extraLen = dv.getUint16(off + 30, true);
      const commentLen = dv.getUint16(off + 32, true);
      const localOff = dv.getUint32(off + 42, true);
      const name = TD.decode(bytes.subarray(off + 46, off + 46 + nameLen));
      const lNameLen = dv.getUint16(localOff + 26, true);
      const lExtraLen = dv.getUint16(localOff + 28, true);
      const start = localOff + 30 + lNameLen + lExtraLen;
      list.push({name, method, comp: bytes.subarray(start, start + compSize)});
      off += 46 + nameLen + extraLen + commentLen;
    }
    return list;
  }
  async function inflateRaw(bytes) {
    if (typeof DecompressionStream === 'undefined')
      throw new Error('当前浏览器不支持原生解压，请升级浏览器，或将文件另存为 CSV 后粘贴导入');
    const ds = new DecompressionStream('deflate-raw');
    const out = await new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer();
    return new Uint8Array(out);
  }
  async function readPackage(source) {
    let bytes;
    if (source instanceof Uint8Array) bytes = source;
    else if (source && typeof source.arrayBuffer === 'function') bytes = new Uint8Array(await source.arrayBuffer());
    else if (source && source.buffer instanceof ArrayBuffer) bytes = new Uint8Array(source.buffer);
    else throw new Error('无法读取文件内容');
    const list = zipEntries(bytes);
    const names = list.map(e => e.name);
    return {
      names,
      async text(name) {
        const e = list.find(x => x.name === name) || list.find(x => x.name.replace(/\\/g,'/').endsWith(name));
        if (!e) return null;
        const data = e.method === 0 ? e.comp : (e.method === 8 ? await inflateRaw(e.comp) : null);
        if (!data) throw new Error('不支持的 ZIP 压缩方式：' + e.method);
        return TD.decode(data);
      }
    };
  }

  /* ---------- OOXML → 二维数组 ---------- */
  function xmlTexts(frag) {
    const out = [], re = /<(?:[A-Za-z0-9_-]+:)?t\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_-]+:)?t>/g;
    let m; while ((m = re.exec(frag))) out.push(xd(m[1]));
    return out;
  }
  function xlsxRows(sheetXml, sharedXml) {
    const shared = [];
    if (sharedXml) {
      const re = /<si\b[^>]*>([\s\S]*?)<\/si>/g; let m;
      while ((m = re.exec(sharedXml))) shared.push(xmlTexts(m[1]).join(''));
    }
    const rows = [], rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
    let rm;
    while ((rm = rowRe.exec(sheetXml))) {
      const cells = [], cRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
      let cm;
      while ((cm = cRe.exec(rm[1]))) {
        const attrs = cm[1] || '', body = cm[2] || '';
        const ref = (/\br="([A-Za-z]+)\d+"/.exec(attrs) || [])[1];
        const ci = ref ? colToIndex(ref) : cells.length;
        const t = (/\bt="([^"]+)"/.exec(attrs) || [])[1];
        let v = '';
        if (t === 'inlineStr') v = xmlTexts(body).join('');
        else {
          const vm = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body);
          const raw = vm ? xd(vm[1]) : '';
          v = t === 's' ? (shared[parseInt(raw, 10)] || '') : raw;
        }
        if (ci >= 0) cells[ci] = v;
      }
      const arr = []; for (let i = 0; i < cells.length; i++) arr.push(cells[i] == null ? '' : cells[i]);
      if (arr.some(x => x !== '')) rows.push(arr);
    }
    return rows;
  }
  function docxRows(docXml) {
    const tables = [], tblRe = /<w:tbl\b[^>]*>([\s\S]*?)<\/w:tbl>/g;
    let tm;
    while ((tm = tblRe.exec(docXml))) {
      const rows = [], trRe = /<w:tr\b[^>]*>([\s\S]*?)<\/w:tr>/g;
      let rm;
      while ((rm = trRe.exec(tm[1]))) {
        const cells = [], tcRe = /<w:tc\b[^>]*>([\s\S]*?)<\/w:tc>/g;
        let cm;
        while ((cm = tcRe.exec(rm[1]))) {
          cells.push(xmlTexts(cm[1]).join('').replace(/\s+/g, ' ').trim());
        }
        if (cells.length) rows.push(cells);
      }
      if (rows.length) tables.push(rows);
    }
    if (!tables.length) throw new Error('Word 文档中未检测到表格');
    const head = r => r.join('|').toLowerCase();
    const good = tables.find(t => /题型|题干|\btype\b|\bstem\b/.test(head(t[0])));
    return (good || tables.sort((a,b) => b.length - a.length)[0]).filter(r => r.some(x => x !== ''));
  }

  /* ---------- 考试宝等中文模板适配（v0.7.0） ----------
     ① 说明行可前置：扫描前 12 行定位真正的表头行
     ② 中文表头 / 题型 / 值由 importer 归一化，此处只做结构对齐
     ③ 过滤本系统暂不支持的题型行，并补默认 status=published
  */
  const OPTION_KEYS = ['option_a','option_b','option_c','option_d','option_e','option_f','option_g','option_h'];
  const WORD_HEAD = ['question_id','type','stem'].concat(OPTION_KEYS, ['answer','analysis','category','status']);
  let lastNotice = '';

  function headerIndex(rows) {
    let best = -1;
    for (let i = 0; i < Math.min(rows.length, 12); i++) {
      const h = rows[i].map(x => importer.normalizeHeader(x));
      if (h.includes('stem') && (h.includes('type') || h.includes('answer'))) return i;
      /* v1.4.1：无题干列时，仍要选中真正的表头行（题型 + 答案 / ≥2 个选项列），
         避免把前置说明行当表头，导致后续列全部错位 */
      if (best < 0 && h.includes('type') && (h.includes('answer') || h.filter(k => /^option_/.test(k)).length >= 2)) best = i;
    }
    return best >= 0 ? best : 0;
  }
  function notice(skipped, labels, kind, converted) {
    const names = Object.keys(labels), parts = [];
    if (skipped) parts.push('已跳过 ' + skipped + ' 道暂不支持的题型' + (names.length ? '（' + names.slice(0, 4).join(' / ') + '）' : ''));
    if (converted) parts.push(converted + ' 道单答案不定项按单选题导入');
    lastNotice = parts.length ? parts.join('；') + '；仅导入单选 / 多选 / 判断' : (kind ? kind + '解析完成' : '');
  }
  function adaptRows(rows, kind) {
    const hi = headerIndex(rows);
    const rawHead = rows[hi] || [];
    const mapped = rawHead.map(h => importer.normalizeHeader(h));
    const idx = [];
    mapped.forEach((h, j) => { if (importer.KEYS.includes(h)) idx.push(j); });
    const head = idx.map(j => mapped[j]);
    if (!head.includes('status')) head.push('status');
    const out = [head];
    let skipped = 0, converted = 0; const labels = {};
    for (let i = hi + 1; i < rows.length; i++) {
      const r = rows[i];
      if (!r.some(x => String(x == null ? '' : x).trim() !== '')) continue;
      const obj = {};
      idx.forEach(j => { obj[mapped[j]] = r[j] == null ? '' : String(r[j]); });
      const t = importer.normalizeType(obj.type || '');
      if (!['single','multiple','judge'].includes(t)) {
        skipped++; labels[String(obj.type || '未填题型').trim()] = 1; obj.__skip = true;
      } else {
        // 不定项选择题允许单答案，本系统「多选」要求≥2 项，故按单选题归档
        const letters = String(obj.answer || '').toUpperCase().replace(/[^A-H]/g, '');
        if (t === 'multiple' && letters.length === 1) { obj.type = 'single'; converted++; }
        else obj.type = t;
        if (t === 'judge') OPTION_KEYS.forEach(k => { obj[k] = ''; });  // 判断题不接受选项列，避免 W001
      }
      if (obj.__skip) continue;
      if (!obj.status) obj.status = 'published';
      out.push(head.map(h => obj[h] == null ? '' : obj[h]));
    }
    notice(skipped, labels, kind, converted);
    /* v1.4.1：解析阶段就预警，避免生成一份残缺 CSV 后用户点了导入才发现失败 */
    const lack = importer.COLS.filter(c => c.required).map(c => c.key).filter(k => !head.includes(k));
    if (lack.length) {
      const show = rawHead.filter(Boolean).slice(0, 12).join(' / ');
      lastNotice = (lastNotice ? lastNotice + '；' : '') +
        '⚠ 未识别到必填列 ' + lack.join(', ') + '（原表头：' + show + '），请打开「文档导入校验页」逐列匹配字段';
    }
    return out;
  }

  /* Word 纯段落文本模板：分节标题 + 题号 + 选项 + 答案 / 解析 / 章节 */
  function docxParagraphs(docXml) {
    const body = (/<w:body\b[^>]*>([\s\S]*)<\/w:body>/.exec(docXml) || [,''])[1];
    const plain = body.replace(/<w:tbl\b[^>]*>[\s\S]*?<\/w:tbl>/g, '');
    const out = [], re = /<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g;
    let m; while ((m = re.exec(plain))) out.push(xmlTexts(m[1]).join('').replace(/\s+/g, ' ').trim());
    return out;
  }
  const P_SECT = /^\s*(单选题|多项选择题|多选题|不定项选择题|单项选择题|判断题|填空题|简答题|问答题|排序题|计算题|论述题)\s*$/;
  const P_QNUM = /^\s*\d+\s*[.、．,，]\s*(.+)$/;
  const P_ANS  = /^\s*答案\s*[:：]\s*(.+)$/;
  const P_ANA  = /^\s*解析\s*[:：]\s*(.+)$/;
  const P_CAT  = /^\s*章节\s*[:：]\s*(.+)$/;
  const P_OPTALL = /(?:^|\s)([A-H])\s*[.、．:：]\s*/g;
  const P_JUDGE_TAIL = /[（(]\s*(正确|错误|对|错|√|×|T|F)\s*[）)]\s*$/i;

  function docxTextToRows(paras) {
    const rows = [WORD_HEAD], labels = {};
    let section = '', cur = null, skipped = 0;
    function flush() {
      if (!cur || !cur.stem) { cur = null; return; }
      const ans = String(cur.answer || '').trim();
      const hasOpts = OPTION_KEYS.some(k => cur[k]);
      const t = cur.explicit ? section
        : (hasOpts ? (/^[A-H]{2,}$/.test(ans.toUpperCase()) ? 'multiple' : 'single') : 'judge');
      if (!['single','multiple','judge'].includes(t)) {
        skipped++; labels[section || '未知题型'] = 1; cur = null; return;
      }
      const row = {
        question_id: '', type: t, stem: cur.stem, answer: ans,
        analysis: cur.analysis || '', category: cur.category || '', status: 'published'
      };
      OPTION_KEYS.forEach(k => { row[k] = t === 'judge' ? '' : (cur[k] || ''); });
      rows.push(WORD_HEAD.map(h => row[h] == null ? '' : row[h]));
      cur = null;
    }
    paras.forEach(line => {
      if (!line) return;
      const sm = P_SECT.exec(line);
      if (sm) { flush(); section = importer.normalizeType(sm[1]); return; }
      const qm = P_QNUM.exec(line);
      if (qm) {
        flush();
        let stem = qm[1].trim(), tail = '';
        const jm = P_JUDGE_TAIL.exec(stem);
        if (jm) { tail = jm[1]; stem = stem.slice(0, jm.index).trim(); }
        cur = {stem, answer: tail, analysis: '', category: '', explicit: !!section};
        return;
      }
      if (!cur) return;                                   // 说明性文字与空行忽略
      let m;
      if ((m = P_ANS.exec(line))) { cur.answer = m[1].trim(); return; }
      if ((m = P_ANA.exec(line))) { cur.analysis = m[1].trim(); return; }
      if ((m = P_CAT.exec(line))) { cur.category = m[1].trim(); return; }
      P_OPTALL.lastIndex = 0;
      const marks = []; let om;
      while ((om = P_OPTALL.exec(line))) marks.push({key: om[1], at: om.index, start: om.index + om[0].length});
      if (marks.length) {
        marks.forEach((mk, i) => {
          const to = i + 1 < marks.length ? marks[i+1].at : line.length;
          cur['option_' + mk.key.toLowerCase()] = line.slice(mk.start, Math.max(mk.start, to)).trim();
        });
      }
      // 其它行（模板说明、分节提示、空行）一律忽略：题干按模板为单行，不拼接
    });
    flush();
    notice(skipped, labels, 'Word', 0);
    return rows;
  }

  /* ---------- 二维数组 → CSV（含标准转义） ---------- */
  function toCsv(rows) {
    return rows.map(r => r.map(v => {
      const s = String(v == null ? '' : v);
      return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(',')).join('\n');
  }

  /* ---------- 对外解析入口 ---------- */
  /* v1.3.3 导入校验页：列出 .xlsx 的全部工作表，供「第一步：选择表单」使用 */
  async function xlsxSheetNames(source) {
    const zip = await readPackage(source);
    const wbXml = await zip.text('xl/workbook.xml');
    if (!wbXml) return [];
    const tags = wbXml.match(/<sheet\b[^>]*>/g) || [];
    return tags.map((t, i) => ({
      index: i,
      name: (/name="([^"]+)"/.exec(t) || [, 'Sheet' + (i + 1)])[1],
      rid: (/r:id="([^"]+)"/.exec(t) || [, ''])[1]
    }));
  }
  async function readXlsx(source, sheetIndex) {
    const zip = await readPackage(source);
    const wbXml = await zip.text('xl/workbook.xml');
    const relXml = await zip.text('xl/_rels/workbook.xml.rels');
    let target = 'worksheets/sheet1.xml';
    const tags = (wbXml && wbXml.match(/<sheet\b[^>]*>/g)) || [];
    const pick = Math.max(0, Math.min(tags.length - 1, Number(sheetIndex) || 0));
    const rid = (tags[pick] && /r:id="([^"]+)"/.exec(tags[pick]) || [])[1];
    if (rid && relXml) {
      const re = new RegExp('<Relationship\\b[^>]*Id="' + rid + '"[^>]*Target="([^"]+)"');
      const m = re.exec(relXml); if (m) target = m[1];
    }
    let path = target.replace(/^\//, '');
    if (!/^xl\//.test(path)) path = 'xl/' + path;
    let xml = await zip.text(path);
    if (!xml) {
      const alt = zip.names.find(n => /^xl\/worksheets\/sheet\d+\.xml$/.test(n));
      if (alt) xml = await zip.text(alt);
    }
    if (!xml) throw new Error('Excel 文件中未找到工作表，请确认是 .xlsx 格式');
    const rows = xlsxRows(xml, await zip.text('xl/sharedStrings.xml'));
    if (rows.length < 2) throw new Error('工作表为空或只有表头，请填写题目数据');
    return toCsv(adaptRows(rows, 'Excel'));
  }
  async function readDocx(source) {
    const zip = await readPackage(source);
    const xml = await zip.text('word/document.xml');
    if (!xml) throw new Error('Word 文件中未找到正文，请确认是 .docx 格式');
    let rows = null;
    try { rows = docxRows(xml); } catch (e) { rows = null; }
    if (rows && rows.length >= 2) {
      const adapted = adaptRows(rows, 'Word');
      if (adapted[0].includes('stem')) return toCsv(adapted);
    }
    const textRows = docxTextToRows(docxParagraphs(xml));   // 考试宝 Word：纯段落文本
    if (textRows.length < 2) throw new Error('Word 文档中未检测到可用题目，请按模板填写题号、选项与答案');
    return toCsv(textRows);
  }
  /* v1.3.0：旧版 .xls / .doc（OLE2 二进制）走 legacy-office.js，
     解析为同一二维数组后复用 adaptRows / docxTextToRows / toCsv，与新版格式共用后续校验链 */
  async function readLegacy(source, hint) {
    if (!Quiz.legacyOffice) throw new Error('旧版格式解析模块未加载（js/legacy-office.js）');
    const parsed = await Quiz.legacyOffice.read(source, hint);
    let csv = '';
    if (parsed.kind === 'xls') {
      if (parsed.rows.length < 2) throw new Error('工作表为空或只有表头，请填写题目数据');
      csv = toCsv(adaptRows(parsed.rows, 'Excel'));
    } else {
      if (parsed.rows.length >= 2) {
        const adapted = adaptRows(parsed.rows, 'Word');
        if (adapted[0].includes('stem')) csv = toCsv(adapted);
      }
      if (!csv) {
        const textRows = docxTextToRows(parsed.paragraphs);
        if (textRows.length < 2) throw new Error('Word 文档中未检测到可用题目，请按模板填写题号、选项与答案');
        csv = toCsv(textRows);
      }
    }
    lastNotice = [lastNotice, parsed.note].filter(Boolean).join('；');
    return csv;
  }
  function detect(name) {
    const n = String(name || '').toLowerCase();
    if (/\.xlsx$/.test(n)) return 'xlsx';
    if (/\.docx$/.test(n)) return 'docx';
    if (/\.(xls|doc)$/.test(n)) return 'legacy';
    return 'text';
  }

  /* ---------- v1.3.2：按文件内容而非扩展名分流 ----------
     题库导出常见错配：把 Excel 97-2003 二进制 .xls 直接改名 / 另存为 .xlsx，
     或把 HTML 表格、CSV 存成 .xls。仅看扩展名会把 OLE2 当 ZIP 解，报「缺少 ZIP 目录」。 */
  async function toBytes(source) {
    if (source instanceof Uint8Array) return source;
    if (source && typeof source.arrayBuffer === 'function') return new Uint8Array(await source.arrayBuffer());
    if (source instanceof ArrayBuffer) return new Uint8Array(source);
    if (source && source.buffer instanceof ArrayBuffer) return new Uint8Array(source.buffer);
    throw new Error('无法读取文件内容');
  }
  async function readAuto(source, name) {
    const bytes = await toBytes(source);
    if (!bytes.length) throw new Error('文件为空');
    const zip = bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4B && bytes[2] === 0x03 && bytes[3] === 0x04;
    const ole = bytes.length >= 8 && bytes[0] === 0xD0 && bytes[1] === 0xCF && bytes[2] === 0x11 && bytes[3] === 0xE0;
    const asDoc = /\.doc$/i.test(String(name || ''));
    if (ole) return readLegacy(bytes, asDoc ? 'doc' : 'xls');
    if (zip) {
      let names = [];
      try { names = zipEntries(bytes).map(x => x.name); }
      catch (err) { throw new Error('不是有效的 Excel / Word 文件（ZIP 目录损坏或文件不完整）'); }
      if (names.some(n => /^word\//i.test(n))) return readDocx(bytes);
      if (names.some(n => /^xl\//i.test(n))) return readXlsx(bytes);
      throw new Error('ZIP 包内没有 Excel / Word 内容，请确认是 .xlsx / .docx 文件');
    }
    /* 纯文本：CSV / TSV / TXT 原样返回（自动处理 UTF-8 BOM / UTF-16 / GBK） */
    if (detect(name) === 'text') return Quiz.legacyOffice ? Quiz.legacyOffice.decodeBytes(bytes) : TD.decode(bytes);
    /* 扩展名是 Office 但内容是 HTML 表格 / CSV / RTF：走兼容解析 */
    return readLegacy(bytes, asDoc ? 'doc' : 'xls');
  }

  /* ---------- ZIP 写（store 模式，用于生成模板） ---------- */
  function zipStore(files) {
    const locals = [], centrals = [];
    let offset = 0;
    const dosDate = 0x0021, dosTime = 0;
    files.forEach(f => {
      const name = TE.encode(f.name);
      const data = typeof f.data === 'string' ? TE.encode(f.data) : f.data;
      const crc = crc32(data);
      const lh = new Uint8Array(30 + name.length), lv = new DataView(lh.buffer);
      lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, 0, true);
      lv.setUint16(8, 0, true); lv.setUint16(10, dosTime, true); lv.setUint16(12, dosDate, true);
      lv.setUint32(14, crc, true); lv.setUint32(18, data.length, true); lv.setUint32(22, data.length, true);
      lv.setUint16(26, name.length, true); lv.setUint16(28, 0, true); lh.set(name, 30);
      locals.push(lh, data);
      const ch = new Uint8Array(46 + name.length), cv = new DataView(ch.buffer);
      cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true);
      cv.setUint16(8, 0, true); cv.setUint16(10, 0, true); cv.setUint16(12, dosTime, true); cv.setUint16(14, dosDate, true);
      cv.setUint32(16, crc, true); cv.setUint32(20, data.length, true); cv.setUint32(24, data.length, true);
      cv.setUint16(28, name.length, true); cv.setUint16(30, 0, true); cv.setUint16(32, 0, true);
      cv.setUint16(34, 0, true); cv.setUint16(36, 0, true); cv.setUint32(38, 0, true); cv.setUint32(42, offset, true);
      ch.set(name, 46); centrals.push(ch);
      offset += lh.length + data.length;
    });
    const cdSize = centrals.reduce((n,c) => n + c.length, 0);
    const eo = new Uint8Array(22), ev = new DataView(eo.buffer);
    ev.setUint32(0, 0x06054b50, true); ev.setUint16(4, 0, true); ev.setUint16(6, 0, true);
    ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true);
    ev.setUint32(12, cdSize, true); ev.setUint32(16, offset, true); ev.setUint16(20, 0, true);
    return concat(locals.concat(centrals, [eo]));
  }

  const parsed = importer.parseDelimited(importer.SAMPLE_CSV);
  const TEMPLATE_ROWS = [parsed.headers].concat(parsed.rows);

  function buildXlsxTemplate() {
    const sheet = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:' + indexToCol(TEMPLATE_ROWS[0].length - 1) + TEMPLATE_ROWS.length + '"/><sheetData>' +
      TEMPLATE_ROWS.map((row, ri) => '<row r="' + (ri+1) + '">' + row.map((v, ci) =>
        '<c r="' + indexToCol(ci) + (ri+1) + '" t="inlineStr"><is><t xml:space="preserve">' + xe(v) + '</t></is></c>').join('') + '</row>').join('') +
      '</sheetData></worksheet>';
    const ct = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
      '</Types>';
    const rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>';
    const wb = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheets><sheet name="题库导入" sheetId="1" r:id="rId1"/></sheets></workbook>';
    const wbRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>';
    return zipStore([
      {name:'[Content_Types].xml', data:ct}, {name:'_rels/.rels', data:rels},
      {name:'xl/workbook.xml', data:wb}, {name:'xl/_rels/workbook.xml.rels', data:wbRels},
      {name:'xl/worksheets/sheet1.xml', data:sheet}
    ]);
  }

  function buildDocxTemplate() {
    // Word 模板省略 option_e / option_f 两个选填列，减小表格宽度
    const rows = TEMPLATE_ROWS.map(r => r.filter((_, i) => i !== 7 && i !== 8));
    const tbl = '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/>' +
      '<w:tblBorders>' + ['top','left','bottom','right','insideH','insideV'].map(s =>
        '<w:' + s + ' w:val="single" w:sz="4" w:color="BFBFBF"/>').join('') + '</w:tblBorders></w:tblPr>' +
      rows.map(row => '<w:tr>' + row.map(v =>
        '<w:tc><w:tcPr><w:tcW w:w="900" w:type="dxa"/></w:tcPr><w:p><w:r><w:t xml:space="preserve">' + xe(v) + '</w:t></w:r></w:p></w:tc>').join('') + '</w:tr>').join('') +
      '</w:tbl>';
    const doc = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
      '<w:p><w:r><w:t>题库导入模板 · 请在下表中填写题目（首行为表头，勿删）</w:t></w:r></w:p>' + tbl +
      '<w:sectPr><w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/></w:sectPr></w:body></w:document>';
    const ct = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
      '</Types>';
    const rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>';
    const docRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>';
    const styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault/></w:docDefaults></w:styles>';
    return zipStore([
      {name:'[Content_Types].xml', data:ct}, {name:'_rels/.rels', data:rels},
      {name:'word/document.xml', data:doc}, {name:'word/_rels/document.xml.rels', data:docRels},
      {name:'word/styles.xml', data:styles}
    ]);
  }

  Quiz.office = {readXlsx, xlsxSheetNames, readDocx, readLegacy, readAuto, toBytes, detect, toCsv, zipEntries, zipStore, xlsxRows, docxRows,
                 adaptRows, headerIndex, docxParagraphs, docxTextToRows, WORD_HEAD,
                 buildXlsxTemplate, buildDocxTemplate, TEMPLATE_ROWS, xe, xd,
                 get notice() { return lastNotice; }, clearNotice() { lastNotice = ''; }};
  if (typeof module !== 'undefined' && module.exports) module.exports = Quiz.office;
})(typeof window !== 'undefined' ? window : globalThis);
