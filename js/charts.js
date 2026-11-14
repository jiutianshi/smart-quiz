/* 轻量 SVG 图表，无外部依赖 */
(function (global) {
  const Quiz = global.Quiz = global.Quiz || {};
  const esc = Quiz.util.esc;
  const AXIS = '#9ca3af', GRID = '#e8ecf4', BLUE = '#3b5bdb', GREEN = '#15803d', ORANGE = '#c2410c';

  function barChart(items, opts) {
    opts = opts || {};
    const suffix = opts.suffix || '';
    const color = opts.color || BLUE;
    const W = Math.max(340, items.length * 72 + 56), H = 210;
    const pad = {l: 42, r: 14, t: 16, b: 40};
    const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
    const max = Math.max(1, ...items.map(d => Number(d.value) || 0));
    const step = iw / Math.max(1, items.length);
    const bw = Math.min(38, step * 0.55);
    let s = '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" role="img">';
    for (let g = 0; g <= 4; g++) {
      const y = pad.t + ih - (ih * g / 4);
      s += '<line x1="' + pad.l + '" y1="' + y + '" x2="' + (W - pad.r) + '" y2="' + y + '" stroke="' + GRID + '" stroke-width="1"/>';
      s += '<text x="' + (pad.l - 8) + '" y="' + (y + 4) + '" text-anchor="end" font-size="10" fill="' + AXIS + '">' + Math.round(max * g / 4) + suffix + '</text>';
    }
    items.forEach((d, i) => {
      const v = Number(d.value) || 0;
      const h = ih * v / max;
      const x = pad.l + step * i + (step - bw) / 2;
      const y = pad.t + ih - h;
      s += '<rect x="' + x + '" y="' + y + '" width="' + bw + '" height="' + Math.max(0, h) + '" rx="4" fill="' + (d.color || color) + '" opacity="' + (v ? 0.92 : 0.35) + '"/>';
      if (v) s += '<text x="' + (x + bw/2) + '" y="' + (y - 5) + '" text-anchor="middle" font-size="10.5" fill="#374151" font-weight="600">' + esc(String(d.display != null ? d.display : v + suffix)) + '</text>';
      s += '<text x="' + (pad.l + step * i + step/2) + '" y="' + (H - 14) + '" text-anchor="middle" font-size="10.5" fill="' + AXIS + '">' + esc(d.label) + '</text>';
    });
    s += '</svg>';
    return s;
  }

  function lineChart(items, opts) {
    opts = opts || {};
    const W = Math.max(360, items.length * 58 + 60), H = 210;
    const pad = {l: 42, r: 16, t: 16, b: 36};
    const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
    const max = opts.max || 100;
    const X = i => pad.l + (items.length <= 1 ? iw/2 : iw * i / (items.length - 1));
    const Y = v => pad.t + ih - ih * (Math.max(0, Math.min(max, Number(v) || 0)) / max);
    let s = '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" role="img">';
    for (let g = 0; g <= 4; g++) {
      const y = pad.t + ih - ih * g / 4;
      s += '<line x1="' + pad.l + '" y1="' + y + '" x2="' + (W - pad.r) + '" y2="' + y + '" stroke="' + GRID + '"/>';
      s += '<text x="' + (pad.l - 8) + '" y="' + (y + 4) + '" text-anchor="end" font-size="10" fill="' + AXIS + '">' + Math.round(max*g/4) + '%</text>';
    }
    const pts = items.map((d,i) => X(i) + ',' + Y(d.value)).join(' ');
    if (items.length > 1) {
      s += '<polygon points="' + pad.l + ',' + (pad.t+ih) + ' ' + pts + ' ' + X(items.length-1) + ',' + (pad.t+ih) + '" fill="' + BLUE + '" opacity="0.08"/>';
      s += '<polyline points="' + pts + '" fill="none" stroke="' + BLUE + '" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>';
    }
    items.forEach((d,i) => {
      s += '<circle cx="' + X(i) + '" cy="' + Y(d.value) + '" r="3.5" fill="#fff" stroke="' + BLUE + '" stroke-width="2"/>';
      s += '<text x="' + X(i) + '" y="' + (H - 12) + '" text-anchor="middle" font-size="10" fill="' + AXIS + '">' + esc(d.label) + '</text>';
    });
    s += '</svg>';
    return s;
  }

  Quiz.charts = {barChart, lineChart, COLORS:{BLUE, GREEN, ORANGE}};
})(typeof window !== 'undefined' ? window : globalThis);
