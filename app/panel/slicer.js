// Tự cắt sprite sheet thành từng khung hình (chạy trong bảng điều khiển)
window.Slicer = (function () {
  function imgData(img) {
    const c = document.createElement('canvas'); c.width = img.naturalWidth || img.width; c.height = img.naturalHeight || img.height;
    const x = c.getContext('2d'); x.drawImage(img, 0, 0); return { c, d: x.getImageData(0, 0, c.width, c.height) };
  }
  function label(m, w, h) {
    const lab = new Int32Array(w * h); const comps = []; let n = 0; const st = new Int32Array(w * h);
    for (let i = 0; i < w * h; i++) {
      if (!m[i] || lab[i]) continue;
      n++; let sp = 0; st[sp++] = i; lab[i] = n;
      const c = { id: n, x0: w, y0: h, x1: 0, y1: 0, area: 0 };
      while (sp) {
        const p = st[--sp]; const px = p % w, py = (p / w) | 0; c.area++;
        if (px < c.x0) c.x0 = px; if (px > c.x1) c.x1 = px; if (py < c.y0) c.y0 = py; if (py > c.y1) c.y1 = py;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = px + dx, ny = py + dy; if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const q = ny * w + nx; if (m[q] && !lab[q]) { lab[q] = n; st[sp++] = q; }
        }
      }
      comps.push(c);
    }
    return { lab, comps };
  }
  function bbox(lab, w, id, c) { c.x0 = 1e9; c.y0 = 1e9; c.x1 = -1; c.y1 = -1; c.area = 0; for (let i = 0; i < lab.length; i++) if (lab[i] === id) { const x = i % w, y = (i / w) | 0; c.area++; if (x < c.x0) c.x0 = x; if (x > c.x1) c.x1 = x; if (y < c.y0) c.y0 = y; if (y > c.y1) c.y1 = y; } }

  function detect(img, opts = {}) {
    const { c: src, d } = imgData(img);
    const W = src.width, H = src.height;
    const f = Math.max(1, Math.ceil(Math.max(W, H) / 700));
    const w = Math.ceil(W / f), h = Math.ceil(H / f);
    let m = new Uint8Array(w * h);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (d.data[(y * W + x) * 4 + 3] > 60) m[((y / f) | 0) * w + ((x / f) | 0)] = 1;
    // bỏ đốm nhỏ
    let L = label(m, w, h); const minA = Math.max(4, 1500 / (f * f));
    for (const c of L.comps) if (c.area < minA) for (let i = 0; i < m.length; i++) if (L.lab[i] === c.id) m[i] = 0;
    // giãn 1 ô
    const m2 = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (m[y * w + x]) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const nx = x + dx, ny = y + dy; if (nx >= 0 && ny >= 0 && nx < w && ny < h) m2[ny * w + nx] = 1; }
    L = label(m2, w, h);
    const lab = L.lab; let comps = L.comps; let nextId = comps.length + 1;
    // gộp mảnh nhỏ (tay, vạt áo rời) vào nhân vật gần nhất
    const mains = comps.filter(c => (c.y1 - c.y0) >= h * 0.15);
    for (const c of comps) {
      if (mains.includes(c) || !mains.length) continue;
      const cx = (c.x0 + c.x1) / 2, cy = (c.y0 + c.y1) / 2;
      let best = mains[0], bd = 1e9; for (const mm of mains) { const dd = Math.abs((mm.x0 + mm.x1) / 2 - cx) + Math.abs((mm.y0 + mm.y1) / 2 - cy); if (dd < bd) { bd = dd; best = mm; } }
      for (let i = 0; i < lab.length; i++) if (lab[i] === c.id) lab[i] = best.id;
      best.x0 = Math.min(best.x0, c.x0); best.y0 = Math.min(best.y0, c.y0); best.x1 = Math.max(best.x1, c.x1); best.y1 = Math.max(best.y1, c.y1);
    }
    comps = mains;
    const splitAt = (c, vertical) => { // vertical=true: cắt theo cột
      const cw = c.x1 - c.x0 + 1, ch = c.y1 - c.y0 + 1;
      const n = vertical ? cw : ch, prof = new Float32Array(n);
      for (let y = c.y0; y <= c.y1; y++) for (let x = c.x0; x <= c.x1; x++) if (lab[y * w + x] === c.id) prof[vertical ? x - c.x0 : y - c.y0]++;
      const a0 = Math.floor(n * (vertical ? 0.3 : 0.35)), a1 = Math.floor(n * (vertical ? 0.7 : 0.65));
      let cut = a0; for (let i = a0; i < a1; i++) if (prof[i] < prof[cut]) cut = i;
      if (!vertical && rowCut > c.y0 && rowCut < c.y1) cut = rowCut - c.y0; // dùng khe giữa 2 hàng của cả tấm ảnh
      const nid = nextId++; const nc = { id: nid };
      for (let y = c.y0; y <= c.y1; y++) for (let x = c.x0; x <= c.x1; x++) { const i = y * w + x; if (lab[i] === c.id && (vertical ? x - c.x0 >= cut : y - c.y0 >= cut)) lab[i] = nid; }
      bbox(lab, w, c.id, c); bbox(lab, w, nid, nc); return nc;
    };
    // tách khối quá cao (2 hàng dính nhau)
    const gp = new Float32Array(h); for (let i = 0; i < lab.length; i++) if (lab[i]) gp[(i / w) | 0]++;
    let rowCut = Math.floor(h * 0.35); for (let y = Math.floor(h * 0.35); y < Math.floor(h * 0.65); y++) if (gp[y] < gp[rowCut]) rowCut = y;
    const hs = comps.map(c => c.y1 - c.y0).sort((a, b) => a - b); const medH = hs[hs.length >> 1] || h;
    for (const c of comps.slice()) if (((c.y1 - c.y0) > h * 0.62 || (c.y1 - c.y0) > medH * 1.12) && (c.y1 - c.y0) > h * 0.45 && !opts.singleRow) comps.push(splitAt(c, false));
    // chia hàng
    let rows = [[], []];
    for (const c of comps) rows[(c.y0 + c.y1) / 2 < h / 2 ? 0 : 1].push(c);
    rows = rows.filter(r => r.length);
    // nếu hàng trên ít hơn mong đợi -> tách khối rộng nhất
    if (opts.expectTop && rows[0]) {
      let guard = 0;
      while (rows[0].length < opts.expectTop && guard++ < 10) {
        const c = rows[0].reduce((a, b) => (b.x1 - b.x0) > (a.x1 - a.x0) ? b : a);
        rows[0].push(splitAt(c, true));
      }
    }
    rows.forEach(r => r.sort((a, b) => a.x0 - b.x0));
    // cắt khung ở độ phân giải gốc
    const out = [];
    rows.forEach((r, ri) => r.forEach(c => {
      const X0 = c.x0 * f, Y0 = c.y0 * f, X1 = Math.min(W, (c.x1 + 1) * f), Y1 = Math.min(H, (c.y1 + 1) * f);
      const cw = X1 - X0, ch = Y1 - Y0;
      const cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
      const cx = cv.getContext('2d'); const od = cx.createImageData(cw, ch);
      let minx = cw, miny = ch, maxx = -1, maxy = -1;
      for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
        const gx = X0 + x, gy = Y0 + y, lx = (gx / f) | 0, ly = (gy / f) | 0;
        let own = lab[ly * w + lx] === c.id;
        if (!own && lab[ly * w + lx] === 0) { for (let dy = -1; dy <= 1 && !own; dy++) for (let dx = -1; dx <= 1; dx++) { const nx = lx + dx, ny = ly + dy; if (nx >= 0 && ny >= 0 && nx < w && ny < h && lab[ny * w + nx] === c.id) { own = true; break; } } }
        if (!own) continue;
        const si = (gy * W + gx) * 4, di = (y * cw + x) * 4;
        const a = d.data[si + 3]; if (a < 25) continue;
        od.data[di] = d.data[si]; od.data[di + 1] = d.data[si + 1]; od.data[di + 2] = d.data[si + 2]; od.data[di + 3] = a;
        if (a > 40) { if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y; }
      }
      if (maxx < 0) return;
      cx.putImageData(od, 0, 0);
      const t = document.createElement('canvas'); t.width = maxx - minx + 1; t.height = maxy - miny + 1;
      t.getContext('2d').drawImage(cv, minx, miny, t.width, t.height, 0, 0, t.width, t.height);
      out.push({ canvas: t, row: ri, w: t.width, h: t.height });
    }));
    return out;
  }
  function grid(img, rows, cols) {
    const { c: src } = imgData(img); const out = [];
    const cw = Math.floor(src.width / cols), ch = Math.floor(src.height / rows);
    for (let r = 0; r < rows; r++) for (let k = 0; k < cols; k++) {
      const cv = document.createElement('canvas'); cv.width = cw; cv.height = ch; const x = cv.getContext('2d');
      x.drawImage(src, k * cw, r * ch, cw, ch, 0, 0, cw, ch);
      const t = trim(cv); if (t) out.push({ canvas: t, row: r, w: t.width, h: t.height });
    }
    return out;
  }
  function trim(cv) {
    const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data; let x0 = cv.width, y0 = cv.height, x1 = -1, y1 = -1;
    for (let y = 0; y < cv.height; y++) for (let x = 0; x < cv.width; x++) if (d[(y * cv.width + x) * 4 + 3] > 40) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 < 0) return null;
    const t = document.createElement('canvas'); t.width = x1 - x0 + 1; t.height = y1 - y0 + 1; t.getContext('2d').drawImage(cv, x0, y0, t.width, t.height, 0, 0, t.width, t.height); return t;
  }
  // điểm neo ngang: tâm phần đầu (16% trên) cho dáng đi, giữa khung cho dáng khác
  function anchor(cv, isWalk) {
    if (!isWalk) return cv.width / 2;
    const hh = Math.max(4, Math.floor(cv.height * 0.16)); const d = cv.getContext('2d').getImageData(0, 0, cv.width, hh).data;
    let s = 0, n = 0; for (let y = 0; y < hh; y++) for (let x = 0; x < cv.width; x++) if (d[(y * cv.width + x) * 4 + 3] > 40) { s += x; n++; }
    return n ? s / n : cv.width / 2;
  }
  // tìm lỗ tròn trong khung avatar
  function detectHole(img) {
    const { c, d } = imgData(img); const W = c.width, H = c.height;
    const f = Math.max(1, Math.ceil(Math.max(W, H) / 400)); const w = Math.ceil(W / f), h = Math.ceil(H / f);
    const m = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const a = d.data[((Math.min(H - 1, y * f)) * W + Math.min(W - 1, x * f)) * 4 + 3]; m[y * w + x] = a < 40 ? 1 : 0; }
    const s = ((h / 2) | 0) * w + ((w / 2) | 0);
    if (!m[s]) return { cx: 0.5, cy: 0.5, r: 0.3, auto: false };
    const seen = new Uint8Array(w * h), st = [s]; seen[s] = 1; let x0 = w, y0 = h, x1 = 0, y1 = 0, touch = false;
    while (st.length) { const p = st.pop(), px = p % w, py = (p / w) | 0; if (px < x0) x0 = px; if (px > x1) x1 = px; if (py < y0) y0 = py; if (py > y1) y1 = py; if (px === 0 || py === 0 || px === w - 1 || py === h - 1) touch = true;
      for (const q of [p - 1, p + 1, p - w, p + w]) if (q >= 0 && q < w * h && m[q] && !seen[q]) { seen[q] = 1; st.push(q); } }
    if (touch) return { cx: 0.5, cy: 0.5, r: 0.3, auto: false };
    return { cx: (x0 + x1) / 2 / w, cy: (y0 + y1) / 2 / h, r: Math.min(x1 - x0, y1 - y0) / 2 / w, auto: true };
  }
  return { detect, grid, anchor, detectHole };
})();
