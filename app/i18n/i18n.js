// Công Giáo Live — chuyển giao diện sang tiếng Anh: dịch mọi chữ hiển thị theo từ điển (khớp nguyên câu, hoặc theo mẫu regex)
(function () {
  const I = window.I18N = { lang: 'vi' };
  const D = window.I18N_EN || { exact: {}, patterns: [] };
  const pats = (D.patterns || []).map(([re, rep]) => { try { return [new RegExp(re), rep]; } catch { return null; } }).filter(Boolean);
  const norm = s => s.replace(/\s+/g, ' ').trim();
  function trCore(k) {
    if (!k) return null;
    const e = D.exact[k]; if (e != null) return e;
    for (const [re, rep] of pats) if (re.test(k)) return k.replace(re, rep);
    return null;
  }
  I.tr = function (s) {
    if (I.lang !== 'en' || s == null) return s;
    s = String(s); const m = s.match(/^(\s*)([\s\S]*?)(\s*)$/); const k = norm(m[2]);
    const t = trCore(k); return t == null ? s : m[1] + t + m[3];
  };
  const SKIP = { SCRIPT: 1, STYLE: 1, CANVAS: 1, VIDEO: 1 };
  function trText(n) {
    if (n.__done === n.data) return;
    const p = n.parentNode; if (p && (SKIP[p.nodeName] || (p.closest && p.closest('[data-noi18n]')))) return;
    if (!/[À-ỹđĐ]/.test(n.data) && D.exact[norm(n.data)] == null) { n.__done = n.data; return; }
    const t = I.tr(n.data); if (t !== n.data) n.data = t; n.__done = n.data;
  }
  function trAttrs(el) {
    for (const a of ['placeholder', 'title']) { const v = el.getAttribute && el.getAttribute(a); if (v && /[À-ỹđĐ]/.test(v)) el.setAttribute(a, I.tr(v)); }
  }
  I.translate = function (root) {
    if (I.lang !== 'en' || !root) return;
    if (root.nodeType === 3) return trText(root);
    if (root.nodeType !== 1 && root.nodeType !== 9) return;
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) trText(n);
    if (root.querySelectorAll) { trAttrs(root); root.querySelectorAll('[placeholder],[title]').forEach(trAttrs); }
  };
  let obs = null;
  I.setLang = function (lang) {
    I.lang = lang === 'en' ? 'en' : 'vi';
    document.documentElement.lang = I.lang;
    if (I.lang !== 'en') return;
    document.title = I.tr(document.title);
    I.translate(document.body);
    if (!obs) {
      obs = new MutationObserver(ms => { for (const m of ms) { if (m.type === 'characterData') trText(m.target); else { m.addedNodes.forEach(x => I.translate(x)); if (m.type === 'attributes') trAttrs(m.target); } } });
      obs.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['placeholder', 'title'] });
    }
    const oa = window.alert, oc = window.confirm, op = window.prompt;
    window.alert = m => oa.call(window, I.tr(m)); window.confirm = m => oc.call(window, I.tr(m)); window.prompt = (m, d) => op.call(window, I.tr(m), d);
  };
})();
