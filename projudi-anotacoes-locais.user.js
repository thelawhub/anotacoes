// ==UserScript==
// @name         Projudi - Post-it local
// @namespace    projudi-anotacoes-locais.user.js
// @version      1.0
// @icon         https://img.icons8.com/ios-filled/100/scales--v1.png
// @description  Adiciona Post-it local ao Projudi.
// @author       lourencosv (GPT)
// @license      CC BY-NC 4.0
// @updateURL    https://gist.githubusercontent.com/lourencosv//raw/projudi-anotacoes-locais.user.js
// @downloadURL  https://gist.githubusercontent.com/lourencosv//raw/projudi-anotacoes-locais.user.js
// @match        https://projudi.tjgo.jus.br/*
// @run-at       document-end
// @grant        GM_getValue
// @grant        GM_setValue
// ==/UserScript==

(function () {
  'use strict';

  if (window.top === window.self) return;

  const Z_UI = 2147483000;

  // ---------- detecção: página de processo (CNJ completo) ----------
  function isProcessPage(doc) {
    if (!doc || !doc.body) return false;
    const text = doc.body.innerText || '';
    return /\b\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}\b/.test(text);
  }

  function getProcessContext() {
    const text = document.body.innerText || '';
    const match = text.match(/\b\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}\b/);
    if (!match) return null;
    const cnj = match[0];
    const loc = window.location;
    const subkey = (loc.pathname || '') + (loc.search || '');
    return { key: `cnj_${cnj}`, subkey };
  }

  const state = { mounted: false };
  function evaluate() {
    const ok = isProcessPage(document);
    if (ok && !state.mounted) mountButton();
    if (!ok && state.mounted) unmountAll();
  }

  window.addEventListener('load', () => setTimeout(evaluate, 300));
  const obs = new MutationObserver(() => {
    clearTimeout(state.timer);
    state.timer = setTimeout(evaluate, 250);
  });
  obs.observe(document.documentElement, { childList: true, subtree: true });

  // ---------- armazenamento ----------
  function storageKey(ctx) {
    return `projudi_note::${ctx.key}::${ctx.subkey}`;
  }

  // ---------- interface ----------
  function mountButton() {
    if (document.getElementById('pj-add-btn')) return;
    const btn = document.createElement('button');
    btn.id = 'pj-add-btn';
    btn.textContent = 'Nota';
    Object.assign(btn.style, {
      position: 'fixed',
      top: '8px',
      left: '8px',
      zIndex: Z_UI,
      background: '#0056b3',
      color: '#fff',
      padding: '6px 12px',
      border: 'none',
      borderRadius: '6px',
      cursor: 'pointer',
      font: '13px system-ui, sans-serif',
      boxShadow: '0 2px 6px rgba(0,0,0,.2)',
    });
    btn.addEventListener('click', openNote);
    document.body.appendChild(btn);
    state.mounted = true;
  }

  function unmountAll() {
    ['pj-add-btn', 'pj-note', 'pj-chip'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.remove();
    });
    state.mounted = false;
  }

  function openNote() {
    if (document.getElementById('pj-note')) return;
    const ctx = getProcessContext();
    if (!ctx) return;
    const key = storageKey(ctx);
    const saved = GM_getValue(key, '');

    const note = document.createElement('div');
    note.id = 'pj-note';
    Object.assign(note.style, {
      position: 'fixed',
      top: '60px',
      left: '60px',
      width: '340px',
      height: '240px',
      minWidth: '260px',
      minHeight: '140px',
      background: '#fffce1',
      border: '1px solid rgba(0,0,0,.15)',
      borderRadius: '10px',
      boxShadow: '0 8px 18px rgba(0,0,0,.25)',
      zIndex: Z_UI + 1,
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    });

    // ---------- cabeçalho ----------
    const header = document.createElement('div');
    header.textContent = 'Anotações (página atual)';
    Object.assign(header.style, {
      background: '#ffeb8a',
      padding: '6px 8px',
      font: '13px system-ui,sans-serif',
      color: '#4d3d00',
      cursor: 'move',
      userSelect: 'none',
      position: 'relative',
    });

    const actions = document.createElement('div');
    Object.assign(actions.style, {
      position: 'absolute',
      right: '8px',
      top: '3px',
      display: 'flex',
      gap: '8px',
      fontSize: '14px',
      fontWeight: '600',
      cursor: 'pointer',
      alignItems: 'center',
    });

    const minSpan = document.createElement('span');
    minSpan.textContent = '-';
    minSpan.style.color = '#3a2f00';
    const closeSpan = document.createElement('span');
    closeSpan.textContent = 'x';
    closeSpan.style.color = '#b91c1c'; // vermelho suave

    actions.append(minSpan, closeSpan);
    header.appendChild(actions);

    // ---------- toolbar ----------
    const toolbar = document.createElement('div');
    Object.assign(toolbar.style, {
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      background: '#fff9c4',
      borderTop: '1px solid #facc15',
      borderBottom: '1px solid #fde68a',
      padding: '6px',
      justifyContent: 'center',
      zIndex: Z_UI + 2,
    });

    const cmds = [
      { t: 'B', c: 'bold' },
      { t: 'I', c: 'italic' },
      { t: 'U', c: 'underline' },
      { t: 'T', c: 'strikeThrough' },
      { t: '<', c: 'justifyLeft' },
      { t: '=', c: 'justifyCenter' },
      { t: '>', c: 'justifyRight' },
      { t: '≡', c: 'justifyFull' },
    ];
    cmds.forEach(({ t, c }) => {
      const b = document.createElement('button');
      b.textContent = t;
      Object.assign(b.style, {
        width: '26px',
        height: '26px',
        background: '#fff',
        border: '1px solid #cbd5e1',
        borderRadius: '6px',
        cursor: 'pointer',
        fontWeight: '700',
        color: '#222',
        boxShadow: '0 1px 2px rgba(0,0,0,.06)',
      });
      b.addEventListener('click', () => document.execCommand(c, false, null));
      toolbar.appendChild(b);
    });

    // ---------- editor ----------
    const editor = document.createElement('div');
    editor.contentEditable = 'true';
    editor.innerHTML = saved || '';
    Object.assign(editor.style, {
      flex: '1',
      padding: '8px',
      outline: 'none',
      overflowY: 'auto',
      font: '13px/1.4 system-ui, sans-serif',
      color: '#3a2f00',
      background: 'transparent',
    });
    editor.addEventListener('input', () => GM_setValue(key, editor.innerHTML));

    // ---------- grip ----------
    const grip = document.createElement('div');
    Object.assign(grip.style, {
      position: 'absolute',
      right: '0',
      bottom: '0',
      width: '14px',
      height: '14px',
      cursor: 'se-resize',
      background: 'linear-gradient(135deg, transparent 50%, rgba(0,0,0,.35) 50%)',
      opacity: '.35',
    });

    // ações
    makeDraggable(note, header);
    makeResizable(note, grip);

    minSpan.addEventListener('click', () => {
      note.remove();
      mountChip();
    });
    closeSpan.addEventListener('click', () => {
      if (confirm('Excluir esta nota?')) {
        GM_setValue(key, '');
        note.remove();
      }
    });

    note.append(header, toolbar, editor, grip);
    document.body.appendChild(note);
  }

  function mountChip() {
    if (document.getElementById('pj-chip')) return;
    const chip = document.createElement('button');
    chip.id = 'pj-chip';
    chip.textContent = 'Nota';
    Object.assign(chip.style, {
      position: 'fixed',
      top: '8px',
      left: '8px',
      zIndex: Z_UI,
      background: '#0056b3',
      color: '#fff',
      padding: '6px 12px',
      border: 'none',
      borderRadius: '6px',
      cursor: 'pointer',
      font: '13px system-ui, sans-serif',
      boxShadow: '0 2px 6px rgba(0,0,0,.2)',
    });
    chip.addEventListener('click', () => {
      chip.remove();
      openNote();
    });
    document.body.appendChild(chip);
  }

  // ---------- funções utilitárias ----------
  function makeDraggable(el, handle) {
    let sx, sy, sl, st, dragging = false;
    handle.addEventListener('mousedown', e => {
      dragging = true;
      sx = e.clientX;
      sy = e.clientY;
      const r = el.getBoundingClientRect();
      sl = r.left;
      st = r.top;
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
      e.preventDefault();
    });
    function move(e) {
      if (!dragging) return;
      el.style.left = sl + (e.clientX - sx) + 'px';
      el.style.top = st + (e.clientY - sy) + 'px';
    }
    function up() {
      dragging = false;
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
    }
  }

  function makeResizable(el, grip) {
    let sx, sy, sw, sh, resizing = false;
    grip.addEventListener('mousedown', e => {
      resizing = true;
      sx = e.clientX;
      sy = e.clientY;
      const r = el.getBoundingClientRect();
      sw = r.width;
      sh = r.height;
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
      e.preventDefault();
    });
    function move(e) {
      if (!resizing) return;
      el.style.width = Math.max(260, sw + (e.clientX - sx)) + 'px';
      el.style.height = Math.max(140, sh + (e.clientY - sy)) + 'px';
    }
    function up() {
      resizing = false;
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
    }
  }

})();