/* 旧版二进制 Office 导入（v1.3.0）：.xls / .doc 纯前端解析，零外部依赖、零网络请求
   ─────────────────────────────────────────────────────────────────────────
   .xls  OLE2/CFB 复合文档 → Workbook 流 → BIFF8 记录（SST 含 CONTINUE 分片、
         BOUNDSHEET、LABELSST / LABEL / NUMBER / RK / MULRK / FORMULA / STRING）
   .doc  OLE2/CFB → WordDocument(FIB) + 0Table/1Table(CLX 片表 PlcPcd) → 正文文本
         兼容 fComplex / 压缩 8 位片 / UTF-16 片 / 表格单元格 \x07 标记
   兜底  非 OLE2 的「伪 .xls / .doc」：HTML 表格、CSV / TSV、RTF、纯文本
   输出  {kind:'xls'|'doc', rows:二维数组, paragraphs:段落数组, note:string}
        由 office.js 复用 adaptRows / docxTextToRows / toCsv 接入既有导入链路
*/
(function (global) {
  const Quiz = global.Quiz = global.Quiz || {};
  const importer = Quiz.importer;

  const ENDOF = 0xFFFFFFFE, FREE = 0xFFFFFFFF;
  const isBadSector = v => v === ENDOF || v === FREE || v >= 0xFFFFFFFA;

  function dv(u8) { return new DataView(u8.buffer, u8.byteOffset, u8.byteLength); }
  function u16(u8, p) { return u8[p] | (u8[p + 1] << 8); }
  function u32(u8, p) { return (u8[p] | (u8[p + 1] << 8) | (u8[p + 2] << 16) | (u8[p + 3] << 24)) >>> 0; }
  function utf16(bytes) {
    let s = '';
    for (let i = 0; i + 1 < bytes.length; i += 2) s += String.fromCharCode(bytes[i] | (bytes[i + 1] << 8));
    return s;
  }
  function cpName(codepage) {
    const n = Number(codepage) || 1252;
    if (n === 936 || n === 54936 || n === 20936) return 'gbk';
    if (n === 950) return 'big5';
    if (n === 932) return 'shift_jis';
    if (n === 949) return 'euc-kr';
    return null;
  }
  function decodeAnsi(bytes, codepage) {
    const name = cpName(codepage);
    if (name) { try { return new TextDecoder(name).decode(bytes); } catch (e) { /* 浏览器不支持时退回 Latin-1 */ } }
    let s = ''; for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]); return s;
  }
  function clean(s) {
    return String(s == null ? '' : s)
      .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x13-\x1f]/g, '')
      .replace(/[\uFFF0-\uFFFF]/g, '')
      .replace(/\s+/g, ' ').trim();
  }

  /* ================= OLE2 / CFB 复合文档 ================= */
  function cfb(bytes) {
    if (bytes.length < 512) throw new Error('文件过小，不是有效的旧版 Office 文件');
    const sig = [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1];
    for (let i = 0; i < 8; i++) if (bytes[i] !== sig[i])
      throw new Error('不是有效的 .xls / .doc 二进制文件（缺少 OLE2 复合文档头）');
    const h = dv(bytes);
    const major = h.getUint16(0x1A, true);
    const S = 1 << h.getUint16(0x1E, true);
    const M = 1 << h.getUint16(0x20, true);
    if (S !== 512 && S !== 4096) throw new Error('不支持的 OLE2 扇区大小：' + S);
    const dirStart = h.getUint32(0x30, true);
    const cutoff = h.getUint32(0x38, true) || 4096;
    const miniFatStart = h.getUint32(0x3C, true), miniFatCount = h.getUint32(0x40, true);
    const difatStart = h.getUint32(0x44, true), difatCount = h.getUint32(0x48, true);

    function sector(id) {
      const off = (id + 1) * S;
      if (off < 0 || off + S > bytes.length) throw new Error('OLE2 扇区越界，文件可能已损坏');
      return bytes.subarray(off, off + S);
    }
    /* DIFAT：头内 109 项 + DIFAT 扇区链 */
    const fatIds = [];
    for (let i = 0; i < 109; i++) {
      const v = h.getUint32(0x4C + i * 4, true);
      if (!isBadSector(v)) fatIds.push(v);
    }
    let d = difatStart, guard = 0;
    while (!isBadSector(d) && guard++ < difatCount + 8) {
      const sv = dv(sector(d)), n = S / 4 - 1;
      for (let i = 0; i < n; i++) {
        const v = sv.getUint32(i * 4, true);
        if (!isBadSector(v)) fatIds.push(v);
      }
      d = sv.getUint32(n * 4, true);
    }
    /* FAT */
    const fat = [];
    fatIds.forEach(id => {
      const sv = dv(sector(id));
      for (let i = 0; i < S / 4; i++) fat.push(sv.getUint32(i * 4, true));
    });
    if (!fat.length) throw new Error('OLE2 FAT 为空，文件可能已损坏');

    function chain(start, want) {
      const ids = [], seen = new Set();
      let cur = start, g = 0;
      while (!isBadSector(cur) && cur < fat.length && !seen.has(cur) && g++ < fat.length + 8) {
        seen.add(cur); ids.push(cur);
        if (want && ids.length >= want) break;
        cur = fat[cur];
      }
      return ids;
    }
    function readChain(start, size) {
      const ids = chain(start, size != null ? Math.ceil(size / S) : 0);
      const out = new Uint8Array(ids.length * S);
      ids.forEach((id, i) => out.set(sector(id), i * S));
      return size != null ? out.subarray(0, Math.min(size, out.length)) : out;
    }

    /* 目录项（128 字节/项）：不依赖红黑树，直接按名字查，兼容各种写入器 */
    const dir = readChain(dirStart);
    const entries = []; let root = null;
    for (let p = 0; p + 128 <= dir.length; p += 128) {
      const e = dir.subarray(p, p + 128), ev = dv(e);
      const nameLen = ev.getUint16(0x40, true);
      const name = utf16(e.subarray(0, Math.max(0, Math.min(64, nameLen - 2)))).replace(/^[\x00-\x1f]+/, '');
      const type = e[0x42];
      const start = ev.getUint32(0x74, true);
      let size = ev.getUint32(0x78, true);
      if (major >= 4) {
        const hi = ev.getUint32(0x7C, true);
        if (hi) size += hi * 4294967296;
      }
      if (type === 5 && !root) root = {name, type, start, size};
      if (name) entries.push({name, type, start, size});
    }
    if (!root) throw new Error('OLE2 根目录项缺失，文件可能已损坏');

    /* Mini 流：< 4096 字节的流都放在 Mini Stream（多数 .xls / .doc 模板如此） */
    let miniStream = new Uint8Array(0), miniFat = [];
    if (root.size) {
      miniStream = readChain(root.start, root.size);
      if (!isBadSector(miniFatStart) && miniFatCount) {
        const mb = readChain(miniFatStart, miniFatCount * S), mv = dv(mb);
        for (let i = 0; i + 4 <= mb.length; i += 4) miniFat.push(mv.getUint32(i, true));
      }
    }
    function readMini(start, size) {
      const out = new Uint8Array(size); let w = 0, cur = start, g = 0;
      const seen = new Set();
      while (w < size && cur < miniFat.length && !isBadSector(cur) && !seen.has(cur) && g++ < miniFat.length + 8) {
        seen.add(cur);
        const off = cur * M, chunk = miniStream.subarray(off, Math.min(off + M, miniStream.length));
        const take = Math.min(chunk.length, size - w);
        out.set(chunk.subarray(0, take), w); w += take;
        cur = miniFat[cur];
      }
      return out.subarray(0, w);
    }
    function stream(name) {
      const key = String(name).toLowerCase();
      const e = entries.find(x => x.name.toLowerCase() === key);
      if (!e || !e.size) return null;
      if (e.size < cutoff && miniFat.length && miniStream.length) return readMini(e.start, e.size);
      return readChain(e.start, e.size);
    }
    return {stream, names: entries.map(e => e.name), entries};
  }

  /* ================= BIFF 记录 / SST ================= */
  function records(bytes) {
    const v = dv(bytes), out = []; let p = 0;
    while (p + 4 <= bytes.length) {
      const id = v.getUint16(p, true), len = v.getUint16(p + 2, true);
      if (p + 4 + len > bytes.length) break;
      out.push({id, off: p, data: bytes.subarray(p + 4, p + 4 + len)});
      p += 4 + len;
    }
    return out;
  }
  /* 跨 CONTINUE 记录读取：字符数据跨越记录边界时，CONTINUE 首字节是剩余字符的压缩标志 */
  function SegReader(parts) { this.parts = parts; this.i = 0; this.p = 0; }
  SegReader.prototype.avail = function () { return this.i < this.parts.length ? this.parts[this.i].length - this.p : 0; };
  SegReader.prototype.hasMore = function () {
    for (let i = this.i; i < this.parts.length; i++) if ((i === this.i ? this.avail() : this.parts[i].length) > 0) return true;
    return false;
  };
  SegReader.prototype.next = function () {
    if (this.i + 1 >= this.parts.length) return false;
    this.i++; this.p = 0; return true;
  };
  SegReader.prototype.take = function (n) {
    const part = this.parts[this.i];
    const s = part.subarray(this.p, Math.min(this.p + n, part.length));
    this.p += s.length; return s;
  };
  SegReader.prototype.read = function (n) {
    const out = new Uint8Array(n); let w = 0;
    while (w < n) {
      const a = this.avail();
      if (!a) { if (!this.next()) break; continue; }
      const chunk = this.take(Math.min(a, n - w));
      out.set(chunk, w); w += chunk.length;
    }
    return out.subarray(0, w);
  };
  SegReader.prototype.u8 = function () { return this.read(1)[0] || 0; };
  SegReader.prototype.u16 = function () { const b = this.read(2); return b.length < 2 ? 0 : u16(b, 0); };
  SegReader.prototype.u32 = function () { const b = this.read(4); return b.length < 4 ? 0 : u32(b, 0); };
  SegReader.prototype.skip = function (n) { this.read(n); };
  function xlString(r, codepage) {
    const cch = r.u16(), flags = r.u8();
    const rich = !!(flags & 0x08), ext = !!(flags & 0x04);
    const cRun = rich ? r.u16() : 0, cbExt = ext ? r.u32() : 0;
    let compressed = !(flags & 0x01), s = '', left = cch;
    while (left > 0) {
      const avail = r.avail();
      if (!avail) {
        if (!r.next()) break;
        compressed = !(r.u8() & 0x01);   // CONTINUE 首字节
        continue;
      }
      if (compressed) {
        const n = Math.min(left, avail);
        s += decodeAnsi(r.take(n), codepage); left -= n;
      } else {
        const n = Math.min(left, Math.floor(avail / 2));
        if (!n) { r.take(1); continue; }
        s += utf16(r.take(n * 2)); left -= n;
      }
    }
    r.skip(cRun * 4 + cbExt);
    return s;
  }
  function parseSst(recs, codepage) {
    const at = recs.findIndex(r => r.id === 0x00FC);
    if (at < 0) return null;
    const parts = [recs[at].data];
    for (let i = at + 1; i < recs.length && recs[i].id === 0x003C; i++) parts.push(recs[i].data);
    const first = dv(parts[0]);
    const uniq = parts[0].length >= 8 ? first.getUint32(4, true) : 0;
    const r = new SegReader(parts); r.skip(8);
    const arr = [];
    for (let i = 0; i < uniq && r.hasMore(); i++) arr.push(xlString(r, codepage));
    return arr;
  }
  function rkNumber(rk) {
    let v;
    if (rk & 0x02) v = rk >> 2;
    else {
      const b = new ArrayBuffer(8), w = new DataView(b);
      w.setUint32(4, rk & 0xFFFFFFFC, true);
      w.setUint32(0, 0, true);
      v = w.getFloat64(0, true);
    }
    return (rk & 0x01) ? v / 100 : v;
  }
  function num(v) {
    if (!isFinite(v)) return '';
    if (Number.isInteger(v)) return String(v);
    return String(Math.round(v * 1e8) / 1e8);
  }
  function formulaString(data) {
    const cch = u16(data, 0), flags = data[2] || 0, b = data.subarray(3);
    return flags & 1 ? utf16(b.subarray(0, cch * 2)) : decodeAnsi(b.subarray(0, cch), 936);
  }

  function xlsRows(wb) {
    const recs = records(wb);
    if (!recs.length) throw new Error('Workbook 流为空，无法解析 .xls');
    const bof = recs[0];
    const biff8 = bof.id === 0x0809 || (bof.data.length >= 2 && u16(bof.data, 2) >= 0x0600);
    let codepage = 1252;
    const cpRec = recs.find(r => r.id === 0x0042);
    if (cpRec && cpRec.data.length >= 2) codepage = u16(cpRec.data, 0);
    const sst = parseSst(recs, codepage) || [];
    const bound = recs.find(r => r.id === 0x0085);
    let start = 0;
    if (bound && bound.data.length >= 4) {
      const pos = u32(bound.data, 0);
      start = recs.findIndex(r => r.off === pos);
      if (start < 0) start = recs.findIndex(r => r.off >= pos);
    }
    if (start < 0 || start === 0) start = recs.findIndex((r, i) => i > 0 && (r.id === 0x0809 || r.id === 0x0009 || r.id === 0x0209 || r.id === 0x0409));
    if (start < 0) start = 1;

    const cells = {}; let maxRow = 0, maxCol = 0, pending = null;
    function put(row, col, value) {
      const v = String(value == null ? '' : value);
      if (v === '') return;
      if (!cells[row]) cells[row] = {};
      cells[row][col] = v;
      if (row > maxRow) maxRow = row;
      if (col > maxCol) maxCol = col;
    }
    for (let i = start; i < recs.length; i++) {
      const rec = recs[i], d = rec.data, w = dv(d), id = rec.id;
      if (id === 0x000A) break;                       // EOF
      if (d.length < 6) continue;
      const row = u16(d, 0), col = u16(d, 2);
      switch (id) {
        case 0x00FD:                                  // LABELSST
          put(row, col, sst[u32(d, 6)] || ''); break;
        case 0x0204: {                               // LABEL（BIFF5/7 字节串）
          if (d.length < 9) break;
          const cch = u16(d, 6), flags = d[8], b = d.subarray(9);
          put(row, col, (flags & 1) ? utf16(b.subarray(0, cch * 2)) : decodeAnsi(b.subarray(0, cch), codepage));
          break;
        }
        case 0x0203: put(row, col, d.length >= 14 ? num(w.getFloat64(6, true)) : ''); break;   // NUMBER
        case 0x027E: put(row, col, d.length >= 10 ? num(rkNumber(w.getInt32(6, true))) : ''); break; // RK
        case 0x00BD: {                                // MULRK
          const n = Math.floor((d.length - 6) / 6);
          for (let k = 0; k < n; k++) {
            const rk = w.getInt32(4 + k * 6 + 2, true);
            put(row, col + k, num(rkNumber(rk)));
          }
          break;
        }
        case 0x0006: {                                // FORMULA（缓存值）
          if (d.length < 14) break;
          if (d[12] === 0x00) pending = {row, col};   // 字符串结果在后续 STRING 记录
          else if (d[12] === 0x03) put(row, col, '');
          else if (d[12] === 0x01) put(row, col, d[8] ? 'TRUE' : 'FALSE');
          else put(row, col, num(w.getFloat64(6, true)));
          break;
        }
        case 0x0207:                                  // STRING（公式字符串结果）
          if (pending && d.length >= 3) { put(pending.row, pending.col, formulaString(d)); pending = null; }
          break;
        default: break;                              // BLANK / MULBLANK / ROW / 样式记录忽略
      }
    }
    const rows = [];
    for (let r = 0; r <= maxRow; r++) {
      const line = [];
      for (let c = 0; c <= maxCol; c++) line.push((cells[r] && cells[r][c]) || '');
      rows.push(line);
    }
    while (rows.length && !rows[rows.length - 1].some(Boolean)) rows.pop();
    return {rows, biff8, strings: sst.length};
  }

  /* ================= Word 97-2003（.doc） ================= */
  function docText(c) {
    const wd = c.stream('WordDocument');
    if (!wd) throw new Error('不是有效的 .doc 文件（缺少 WordDocument 流）');
    const w = dv(wd);
    if (wd.length < 64) throw new Error('.doc 文件头过短');
    const flags = u16(wd, 0x0A);
    if (flags & 0x0100) throw new Error('该 .doc 已加密，请在 Word 中取消文档保护后重试');
    const lid = u16(wd, 0x06);
    const codepage = (lid === 0x0804 || lid === 0x0404 || lid === 0x0C04) ? 936 : 1252;
    const tblName = (flags & 0x0200) ? '1Table' : '0Table';
    const candidates = [c.stream(tblName), c.stream('0Table'), c.stream('1Table')].filter(Boolean);

    /* FIB：FibBase(32) → csw/rgW → cslw/rgLw(ccpText 在 rgLw[3]) → cbRgFcLcb/fibRgFcLcb(fcClx 在 pair[33]) */
    let p = 32;
    const csw = w.getUint16(p, true); p += 2 + csw * 2;
    const cslw = w.getUint16(p, true); p += 2;
    const ccpText = cslw > 3 ? w.getUint32(p + 3 * 4, true) : 0;
    p += cslw * 4;
    const cbRg = w.getUint16(p, true); p += 2;
    if (cbRg < 34) throw new Error('FIB 版本过旧（缺少 fcClx），请用 Word 97 及以上版本另存');
    const clxOff = p + 33 * 8;
    const fcClx = w.getUint32(clxOff, true), lcbClx = w.getUint32(clxOff + 4, true);

    /* CLX：跳过 Prc(0x01) 块，读取 Pcdt(0x02) → PlcPcd(aCP[n+1] + aPcd[n]) */
    function fromTable(tb) {
      const t = dv(tb);
      if (!lcbClx || fcClx + lcbClx > tb.length) throw new Error('.doc 片表（CLX）缺失或越界');
      let q = fcClx; const end = fcClx + lcbClx;
      while (q < end && tb[q] === 0x01) {
        const cb = t.getUint16(q + 1, true); q += 3 + cb;
      }
      if (q >= end || tb[q] !== 0x02) throw new Error('.doc 片表格式异常');
      const lcbPlcfpcd = t.getUint32(q + 1, true), base = q + 5;
      if (base + lcbPlcfpcd > end + 8) throw new Error('.doc 片表长度异常');
      const n = Math.floor((lcbPlcfpcd - 4) / 12);
      if (n <= 0) throw new Error('.doc 片表为空');
      const cps = []; for (let i = 0; i <= n; i++) cps.push(t.getUint32(base + i * 4, true));
      const pcd = base + (n + 1) * 4;
      let text = '', compressedPieces = 0;
      for (let i = 0; i < n; i++) {
        const fc = t.getUint32(pcd + i * 8 + 2, true);
        const compressed = !!(fc & 0x40000000);
        const off = compressed ? Math.floor((fc & 0x3FFFFFFF) / 2) : (fc & 0x3FFFFFFF);
        const len = Math.max(0, cps[i + 1] - cps[i]);
        if (off + len * (compressed ? 1 : 2) > wd.length) break;
        if (compressed) { text += decodeAnsi(wd.subarray(off, off + len), codepage); compressedPieces++; }
        else text += utf16(wd.subarray(off, off + len * 2));
      }
      if (ccpText && text.length > ccpText) text = text.slice(0, ccpText);
      return {text, pieces: n, compressedPieces};
    }
    /* 少数写入器的 fWhichTblStm 与实际 CLX 所在流不一致：两个表格流都试一次 */
    let result = null, lastErr = null;
    for (const tb of candidates) {
      try { const r = fromTable(tb); if (r.text.length) { result = r; break; } }
      catch (e) { lastErr = e; }
    }
    if (!result) throw (lastErr || new Error('.doc 缺少表格流（0Table / 1Table），可能不是 Word 97-2003 格式'));
    return result;
  }
  function docStructure(text) {
    const cellCount = (text.match(/\x07/g) || []).length;
    /* Word 二进制表格：单元格以 \x07 结尾，行尾常见 \r 或连续 \x07 */
    const grid = text
      .replace(/\r/g, '\n')
      .replace(/\x07\x07/g, '\n')
      .replace(/\x07/g, '\t')
      .split('\n')
      .map(line => {
        const r = line.split('\t').map(clean);
        while (r.length && !r[r.length - 1]) r.pop();
        return r;
      })
      .filter(r => r.some(Boolean));
    const tableRows = cellCount >= 2 && grid.length >= 2 &&
      grid.slice(0, 12).some(r => r.some(c => /题型|题干|type|stem/i.test(c))) ? grid : null;
    const paragraphs = text.split(/[\r\x07\x0b\x0c\x0e]/).map(clean).filter(Boolean);
    return {rows: tableRows, paragraphs};
  }

  /* ================= 非 OLE2 兜底：HTML / CSV / RTF / 纯文本 ================= */
  function decodeBytes(bytes) {
    if (bytes[0] === 0xFF && bytes[1] === 0xFE) return utf16(bytes.subarray(2));
    if (bytes[0] === 0xFE && bytes[1] === 0xFF) {
      const swap = new Uint8Array(bytes.length - 2);
      for (let i = 2; i + 1 < bytes.length; i += 2) { swap[i - 2] = bytes[i + 1]; swap[i - 1] = bytes[i]; }
      return utf16(swap);
    }
    try {
      const s = new TextDecoder('utf-8', {fatal: true}).decode(bytes);
      if (s.indexOf('\uFFFD') < 0) return s;
    } catch (e) { /* 非 UTF-8 */ }
    try { return new TextDecoder('gbk').decode(bytes); } catch (e) { /* 退回 Latin-1 */ }
    return decodeAnsi(bytes, 1252);
  }
  function htmlTableRows(text) {
    if (typeof DOMParser !== 'undefined') {
      try {
        const doc = new DOMParser().parseFromString(text, 'text/html');
        const tables = Array.from(doc.querySelectorAll('table'));
        const best = tables.map(tb => Array.from(tb.querySelectorAll('tr')).map(tr =>
          Array.from(tr.querySelectorAll('td,th')).map(td => clean(td.textContent))))
          .sort((a, b) => b.length - a.length)[0];
        if (best && best.length >= 2) return best;
      } catch (e) { /* 退回正则 */ }
    }
    const trs = text.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi) || [];
    const rows = trs.map(tr => (tr.match(/<t[dh]\b[^>]*>[\s\S]*?<\/t[dh]>/gi) || [])
      .map(td => clean(td.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' '))));
    return rows.filter(r => r.length);
  }
  function rtfText(s) {
    const bytes = []; let out = '', inSkip = 0;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === '\\') {
        const next = s[i + 1];
        if (next === "'" && /^[0-9a-fA-F]{2}$/.test(s.substr(i + 2, 2))) {
          bytes.push(parseInt(s.substr(i + 2, 2), 16)); i += 3; continue;
        }
        const m = /^\\([a-zA-Z]+)(-?\d+)? ?/.exec(s.slice(i));
        if (m) {
          if (m[1] === 'par' || m[1] === 'line' || m[1] === 'tab') {
            out += decodeAnsi(new Uint8Array(bytes), 936); bytes.length = 0;
            out += m[1] === 'tab' ? '\t' : '\n';
          }
          i += m[0].length - 1; continue;
        }
        i += 1; continue;
      }
      if (c === '{' || c === '}') { if (c === '{') inSkip++; else inSkip--; continue; }
      if (inSkip < 0) continue;
      out += decodeAnsi(new Uint8Array(bytes), 936); bytes.length = 0;
      out += c;
    }
    if (bytes.length) out += decodeAnsi(new Uint8Array(bytes), 936);
    return out;
  }
  function pseudoRows(text, hint) {
    if (/<table\b/i.test(text)) {
      const rows = htmlTableRows(text);
      if (rows.length >= 2) return {rows, paragraphs: []};
    }
    if (/^\s*\{\\rtf/i.test(text)) {
      const plain = rtfText(text);
      const lines = plain.split(/\r?\n/).map(clean).filter(Boolean);
      if (hint === 'xls') {
        const rows = lines.map(l => l.split('\t'));
        if (rows.length >= 2) return {rows, paragraphs: lines};
      }
      return {rows: null, paragraphs: lines};
    }
    if (hint === 'xls') {
      try {
        const p = importer.parseDelimited(text);
        return {rows: [p.headers].concat(p.rows), paragraphs: []};
      } catch (e) { /* 落到段落模式 */ }
    }
    return {rows: null, paragraphs: text.split(/\r?\n/).map(clean).filter(Boolean)};
  }

  /* ================= 对外入口 ================= */
  async function toBytes(source) {
    if (source instanceof Uint8Array) return source;
    if (source && typeof source.arrayBuffer === 'function') return new Uint8Array(await source.arrayBuffer());
    if (source && source.buffer instanceof ArrayBuffer) return new Uint8Array(source.buffer);
    if (source instanceof ArrayBuffer) return new Uint8Array(source);
    throw new Error('无法读取文件内容');
  }
  async function read(source, hint) {
    const bytes = await toBytes(source);
    if (!bytes.length) throw new Error('文件为空');
    const ole = bytes.length >= 8 && bytes[0] === 0xD0 && bytes[1] === 0xCF;
    const kind = /^doc$/i.test(hint || '') ? 'doc' : 'xls';
    if (!ole) {
      const text = decodeBytes(bytes);
      const shape = pseudoRows(text, kind);
      return {kind, rows: shape.rows || [], paragraphs: shape.paragraphs || [],
        note: '非二进制 Office 格式，已按 HTML / 文本兼容解析', engine: 'text'};
    }
    const c = cfb(bytes);
    const isWorkbook = c.names.some(n => /^(workbook|book)$/i.test(n));
    const isWord = c.names.some(n => /^worddocument$/i.test(n));
    const real = isWord ? 'doc' : (isWorkbook ? 'xls' : kind);
    if (real === 'xls') {
      const wb = c.stream('Workbook') || c.stream('Book');
      if (!wb) throw new Error('.xls 中未找到 Workbook 流');
      const parsed = xlsRows(wb);
      return {kind: 'xls', rows: parsed.rows, paragraphs: [],
        note: 'BIFF' + (parsed.biff8 ? '8' : '5/7') + ' · 共享字符串 ' + parsed.strings + ' 条',
        engine: 'biff'};
    }
    const t = docText(c), shape = docStructure(t.text);
    return {kind: 'doc', rows: shape.rows || [], paragraphs: shape.paragraphs,
      note: 'Word97 片表 ' + t.pieces + ' 片（压缩 ' + t.compressedPieces + ' 片）' + (shape.rows ? ' · 表格模式' : ' · 段落模式'),
      engine: 'fib'};
  }

  Quiz.legacyOffice = {read, cfb, records, xlsRows, docText, docStructure, decodeBytes, pseudoRows,
    htmlTableRows, rtfText, utf16, decodeAnsi, toBytes};
  if (typeof module !== 'undefined' && module.exports) module.exports = Quiz.legacyOffice;
})(typeof window !== 'undefined' ? window : globalThis);
