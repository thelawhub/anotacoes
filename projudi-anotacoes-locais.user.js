// ==UserScript==
// @name         Post-it local
// @namespace    projudi-anotacoes-locais.user.js
// @version      1.9
// @icon         https://img.icons8.com/ios-filled/100/scales--v1.png
// @description  Adiciona Post-it local ao Projudi, com painel de notas, importação e exportação.
// @author       lourencosv (GPT)
// @license      CC BY-NC 4.0
// @updateURL    https://gist.githubusercontent.com/lourencosv/3fd541d959eb6e4cd0f96e30dda5c4d7/raw/projudi-anotacoes-locais.user.js
// @downloadURL  https://gist.githubusercontent.com/lourencosv/3fd541d959eb6e4cd0f96e30dda5c4d7/raw/projudi-anotacoes-locais.user.js
// @match        *://projudi.tjgo.jus.br/*
// @run-at       document-end
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_listValues
// @grant        GM_deleteValue
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// ==/UserScript==

(function () {
    'use strict';

    if (window.top === window.self) return;

    const Z_UI = 2147483000;
    const NOTE_PREFIX = 'projudi_note::';
    const NOTE_META_PREFIX = 'projudi_note_meta::';
    const MENU_LABEL = 'Abrir Painel';
    const NOTE_COLORS = [
        { id: 'yellow', label: 'Amarela', body: '#fff7b2', header: '#f4e38a', border: '#e3d37d', text: '#4a3f00' },
        { id: 'blue', label: 'Azul', body: '#dff0ff', header: '#c9e5ff', border: '#adcff2', text: '#0f3b63' },
        { id: 'pink', label: 'Rosa', body: '#ffe3ef', header: '#ffd0e4', border: '#f5b7cf', text: '#6b1f42' },
        { id: 'green', label: 'Verde', body: '#e8f8d8', header: '#d6efbc', border: '#bddda0', text: '#1f4f24' },
        { id: 'lilac', label: 'Lilás', body: '#efe5ff', header: '#e1d0ff', border: '#cab3ef', text: '#42236c' }
    ];
    const DEFAULT_NOTE_COLOR_ID = 'yellow';

    const state = {
        mounted: false,
        timer: null,
        menuRegistered: false,
        menuCommandId: null
    };

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

        return {
            key: `cnj_${cnj}`,
            subkey
        };
    }

    function storageKey(ctx) {
        return `${NOTE_PREFIX}${ctx.key}::${ctx.subkey}`;
    }

    function metaStorageKey(noteKey) {
        return `${NOTE_META_PREFIX}${noteKey}`;
    }

    function getDefaultNoteColor() {
        return NOTE_COLORS.find(c => c.id === DEFAULT_NOTE_COLOR_ID) || NOTE_COLORS[0];
    }

    function getNoteColorMeta(noteKey) {
        const fallback = getDefaultNoteColor();
        const raw = GM_getValue(metaStorageKey(noteKey), '');
        if (!raw) return fallback;
        try {
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== 'object') return fallback;
            const found = NOTE_COLORS.find(c => c.id === parsed.colorId);
            return found || fallback;
        } catch (_) {
            return fallback;
        }
    }

    function saveNoteColorMeta(noteKey, colorId) {
        const found = NOTE_COLORS.find(c => c.id === colorId);
        if (!found) return;
        GM_setValue(metaStorageKey(noteKey), JSON.stringify({ colorId: found.id }));
    }

    function deleteNoteColorMeta(noteKey) {
        GM_deleteValue(metaStorageKey(noteKey));
    }

    function getTopContext() {
        try {
            if (window.top && window.top.document && window.top.document.body) {
                return {
                    doc: window.top.document,
                    win: window.top
                };
            }
        } catch (_) {}

        return {
            doc: document,
            win: window
        };
    }

    function resolveNoteForCurrentPage() {
        const ctx = getProcessContext();
        if (!ctx) return null;

        let key = storageKey(ctx);
        let html = GM_getValue(key, null);

        if (html === null || typeof html === 'undefined') {
            const prefixForCnj = `${NOTE_PREFIX}${ctx.key}::`;
            const keys = typeof GM_listValues === 'function' ? GM_listValues() : [];
            const fallbackKey = keys.find(k => k.startsWith(prefixForCnj));

            if (fallbackKey) {
                key = fallbackKey;
                html = GM_getValue(key, '');
            } else {
                html = '';
            }
        }

        return {
            ctx,
            key,
            html: html || ''
        };
    }

    function hasNonEmptyNoteForCurrentPage() {
        const resolved = resolveNoteForCurrentPage();
        if (!resolved) return false;

        const html = resolved.html;
        if (!html) return false;

        const tmp = document.createElement('div');
        tmp.innerHTML = html;
        const text = (tmp.innerText || '').replace(/\s+/g, '').trim();

        return !!text;
    }

    function evaluate() {
        const ok = isProcessPage(document);

        if (ok && !state.mounted) {
            mountButton();
        }

        if (ok && state.mounted) {
            updateNoteIndicator();
        }

        if (!ok && state.mounted) {
            unmountAll();
        }
    }

    window.addEventListener('load', () => setTimeout(evaluate, 300));

    const obs = new MutationObserver(() => {
        clearTimeout(state.timer);
        state.timer = setTimeout(evaluate, 250);
    });

    obs.observe(document.documentElement, {
        childList: true,
        subtree: true
    });

    function ensureUiAssetsLoaded(targetDoc = document) {
        if (!targetDoc.getElementById('pj-fa-link')) {
            const link = targetDoc.createElement('link');
            link.id = 'pj-fa-link';
            link.rel = 'stylesheet';
            link.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css';
            targetDoc.head.appendChild(link);
        }

        if (targetDoc.getElementById('pj-ui-style')) return;

        const style = targetDoc.createElement('style');
        style.id = 'pj-ui-style';
        style.textContent = `
            #pj-add-btn {
                position: fixed;
                top: 8px;
                left: 8px;
                width: 38px;
                height: 38px;
                border: 0;
                border-radius: 999px;
                background: #2b69aa;
                color: #ffffff;
                box-shadow: 0 6px 14px rgba(43, 105, 170, .35);
                cursor: pointer;
                z-index: ${Z_UI};
                display: inline-flex;
                align-items: center;
                justify-content: center;
                font-size: 15px;
                line-height: 1;
            }

            #pj-add-btn:hover {
                filter: brightness(1.06);
            }

            #pj-note-badge {
                position: absolute;
                top: -4px;
                right: -4px;
                min-width: 16px;
                height: 16px;
                border-radius: 999px;
                background: #dc2626;
                color: #fff;
                font: 700 11px/16px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
                text-align: center;
                border: 1px solid #fff;
                box-shadow: 0 1px 3px rgba(0,0,0,.3);
                pointer-events: none;
            }

            #pj-note {
                position: fixed;
                top: 60px;
                left: 60px;
                width: 360px;
                height: 290px;
                min-width: 280px;
                min-height: 160px;
                background: var(--pj-note-bg, #fff7b2);
                border: 1px solid var(--pj-note-border, #e3d37d);
                border-radius: 12px;
                box-shadow: 0 16px 40px rgba(2, 6, 23, .30);
                z-index: ${Z_UI + 1};
                display: flex;
                flex-direction: column;
                overflow: hidden;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
                color: var(--pj-note-text, #4a3f00);
            }

            .pj-note-header {
                padding: 8px 10px;
                background: var(--pj-note-header, #f4e38a);
                color: var(--pj-note-text, #4a3f00);
                cursor: move;
                user-select: none;
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 6px;
            }

            .pj-note-title {
                font-size: 13px;
                font-weight: 600;
                display: inline-flex;
                align-items: center;
                gap: 6px;
                min-width: 0;
                flex: 1;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }

            .pj-note-actions {
                display: flex;
                align-items: center;
                gap: 6px;
            }

            .pj-note-icon-btn {
                border: 0;
                background: rgba(0,0,0,.08);
                color: inherit;
                width: 24px;
                height: 24px;
                border-radius: 999px;
                cursor: pointer;
                font-size: 12px;
                line-height: 1;
                display: inline-flex;
                align-items: center;
                justify-content: center;
            }

            .pj-note-icon-btn[data-danger='1'] {
                background: #b91c1c;
                color: #ffffff;
            }

            .pj-note-toolbar {
                display: flex;
                flex-direction: column;
                align-items: stretch;
                gap: 5px;
                background: #f8fafc;
                border-top: 1px solid #e5e7eb;
                border-bottom: 1px solid #e5e7eb;
                padding: 6px;
            }

            .pj-note-toolbar-row {
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 6px;
                flex-wrap: wrap;
            }

            .pj-note-tool-btn {
                width: 30px;
                height: 30px;
                border: 1px solid #cbd5e1;
                border-radius: 7px;
                background: #ffffff;
                color: #0f172a;
                cursor: pointer;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                font-size: 13px;
                line-height: 1;
            }

            .pj-note-color-row {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                gap: 5px;
            }

            .pj-note-color-dot {
                appearance: none;
                -webkit-appearance: none;
                margin: 0;
                width: 10px;
                height: 10px;
                min-width: 10px;
                min-height: 10px;
                max-width: 10px;
                max-height: 10px;
                border-radius: 2px;
                border: 1px solid rgba(15,23,42,.18);
                cursor: pointer;
                box-shadow: inset 0 0 0 1px rgba(255,255,255,.35);
                padding: 0;
                display: inline-block;
                box-sizing: border-box;
                line-height: 0;
                font-size: 0;
                vertical-align: middle;
            }

            .pj-note-color-dot[data-selected='1'] {
                outline: 2px solid #2b69aa;
                outline-offset: 1px;
            }

            .pj-note-editor {
                flex: 1;
                padding: 8px;
                outline: none;
                overflow-y: auto;
                font: 13px/1.45 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
                color: var(--pj-note-text, #4a3f00);
                background: transparent;
            }

            .pj-note-resize {
                position: absolute;
                right: 0;
                bottom: 0;
                width: 14px;
                height: 14px;
                cursor: se-resize;
                background: linear-gradient(135deg, transparent 50%, rgba(0,0,0,.35) 50%);
                opacity: .35;
            }

            #pj-notes-panel {
                position: fixed;
                inset: 0;
                background: rgba(11, 18, 32, .50);
                z-index: ${Z_UI + 20};
                backdrop-filter: blur(4px);
                -webkit-backdrop-filter: blur(4px);
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 18px;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
            }

            .pj-panel {
                width: min(980px, calc(100vw - 24px));
                max-height: calc(100vh - 34px);
                background: #ffffff;
                color: #0f172a;
                border-radius: 14px;
                box-shadow: 0 24px 70px rgba(2, 6, 23, .30);
                border: 1px solid #dbe3ef;
                overflow: hidden;
                display: flex;
                flex-direction: column;
                transform: translateY(6px) scale(.985);
                opacity: .96;
                transition: transform .16s ease, opacity .16s ease;
            }

            .pj-panel-header {
                padding: 14px 16px;
                background: linear-gradient(135deg,#0f3e75,#1f5ca4);
                color: #ffffff;
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 12px;
            }

            .pj-panel-title {
                font-size: 16px;
                font-weight: 700;
                line-height: 1.2;
            }

            .pj-panel-subtitle {
                font-size: 12px;
                opacity: .9;
                margin-top: 2px;
            }

            .pj-panel-close {
                border: 0;
                width: 28px;
                height: 28px;
                border-radius: 999px;
                cursor: pointer;
                color: #ffffff;
                background: rgba(255,255,255,.2);
                display: inline-flex;
                align-items: center;
                justify-content: center;
                font-size: 13px;
            }

            .pj-panel-body {
                display: flex;
                flex: 1;
                min-height: 320px;
                background: #f8fafc;
            }

            .pj-panel-left,
            .pj-panel-right {
                display: flex;
                flex-direction: column;
                min-height: 0;
            }

            .pj-panel-left {
                flex: 3;
                border-right: 1px solid #e5e7eb;
            }

            .pj-panel-right {
                flex: 2;
            }

            .pj-section-title {
                padding: 9px 10px;
                border-bottom: 1px solid #e5e7eb;
                font-weight: 600;
                background: #f1f5f9;
            }

            .pj-note-list {
                flex: 1;
                overflow-y: auto;
                padding: 8px;
                display: flex;
                flex-direction: column;
                gap: 8px;
                min-height: 0;
            }

            .pj-note-item {
                border: 1px solid #e5e7eb;
                border-radius: 10px;
                background: #ffffff;
                padding: 8px 10px;
                cursor: pointer;
                position: relative;
            }

            .pj-note-item[data-selected='1'] {
                background: #eff6ff;
                border-color: #bfdbfe;
            }

            .pj-note-line1 {
                font-size: 12px;
                font-weight: 700;
                color: #0f172a;
                margin-right: 62px;
            }

            .pj-note-line2 {
                font-size: 11px;
                color: #64748b;
                margin-top: 2px;
                margin-right: 62px;
                word-break: break-all;
            }

            .pj-note-line3 {
                font-size: 11px;
                color: #334155;
                margin-top: 5px;
            }

            .pj-note-delete {
                position: absolute;
                top: 6px;
                right: 8px;
                border: 1px solid #fecaca;
                border-radius: 7px;
                padding: 2px 7px;
                font-size: 11px;
                cursor: pointer;
                background: #fee2e2;
                color: #b91c1c;
                font-weight: 600;
            }

            .pj-preview-title {
                padding: 7px 8px 0;
                font-size: 11px;
                color: #64748b;
            }

            .pj-preview-box {
                margin: 4px 8px 8px;
                border-radius: 10px;
                background: #ffffff;
                border: 1px solid #e5e7eb;
                padding: 8px;
                min-height: 90px;
                max-height: 170px;
                overflow-y: auto;
                font-size: 12px;
                color: #334155;
            }

            .pj-panel-right-body {
                padding: 8px;
                display: flex;
                flex-direction: column;
                gap: 8px;
                flex: 1;
                min-height: 0;
            }

            .pj-info {
                font-size: 11px;
                color: #475569;
                line-height: 1.45;
                border: 1px solid #e5e7eb;
                border-radius: 10px;
                background: #ffffff;
                padding: 10px;
            }

            #pj-notes-io {
                flex: 1;
                min-height: 120px;
                width: 100%;
                resize: vertical;
                border: 1px solid #cbd5e1;
                border-radius: 10px;
                padding: 8px;
                box-sizing: border-box;
                font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace;
                font-size: 12px;
                color: #0f172a;
                background: #ffffff;
            }

            .pj-row-btns {
                display: flex;
                gap: 8px;
            }

            .pj-btn {
                flex: 1;
                min-height: 34px;
                padding: 7px 9px;
                border-radius: 8px;
                border: 1px solid #cbd5e1;
                background: #ffffff;
                color: #1e293b;
                cursor: pointer;
                font-size: 12px;
                font-weight: 600;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                gap: 6px;
            }

            .pj-btn[data-variant='primary'] {
                color: #ffffff;
                background: #0f3e75;
                border-color: #0f3e75;
            }

            .pj-btn[data-variant='success'] {
                color: #ffffff;
                background: #15803d;
                border-color: #15803d;
            }

            @media (max-width: 860px) {
                .pj-panel-body {
                    flex-direction: column;
                }

                .pj-panel-left {
                    border-right: 0;
                    border-bottom: 1px solid #e5e7eb;
                    min-height: 230px;
                }

                .pj-panel-right {
                    min-height: 220px;
                }
            }
        `;

        targetDoc.head.appendChild(style);
    }

    function ensureMenuRegistered(force = false) {
        if (typeof GM_registerMenuCommand !== 'function') return;

        if (force) {
            try {
                if (state.menuRegistered && state.menuCommandId !== null && typeof GM_unregisterMenuCommand === 'function') {
                    GM_unregisterMenuCommand(state.menuCommandId);
                }
            } catch (_) {}
            state.menuCommandId = null;
            state.menuRegistered = false;
        }

        if (state.menuRegistered) return;

        try {
            const id = GM_registerMenuCommand(MENU_LABEL, () => {
                openNotesPanel();
            });
            state.menuCommandId = id == null ? null : id;
            state.menuRegistered = true;
        } catch (_) {}
    }

    function toggleNoteFromButton() {
        const note = document.getElementById('pj-note');

        if (note) {
            note.remove();
            return;
        }

        openNote();
    }

    function mountButton() {
        if (document.getElementById('pj-add-btn')) return;

        ensureUiAssetsLoaded();
        ensureMenuRegistered(false);

        const btn = document.createElement('button');
        btn.id = 'pj-add-btn';
        btn.title = 'Anotações locais desta página';
        btn.innerHTML = '<i class="fa-solid fa-pen-to-square" aria-hidden="true"></i>';

        btn.addEventListener('mousedown', e => e.preventDefault());
        btn.addEventListener('click', toggleNoteFromButton);

        document.body.appendChild(btn);
        state.mounted = true;
        updateNoteIndicator();
    }

    function updateNoteIndicator() {
        const btn = document.getElementById('pj-add-btn');
        if (!btn) return;

        const existing = document.getElementById('pj-note-badge');
        const hasNote = hasNonEmptyNoteForCurrentPage();

        if (hasNote && !existing) {
            const badge = document.createElement('span');
            badge.id = 'pj-note-badge';
            badge.textContent = '!';
            badge.title = 'Há nota neste processo';
            btn.appendChild(badge);
        }

        if (!hasNote && existing) {
            existing.remove();
        }
    }

    function unmountAll() {
        ['pj-add-btn', 'pj-note', 'pj-notes-panel'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.remove();
        });
        const { doc: rootDoc } = getTopContext();
        const rootPanel = rootDoc.getElementById('pj-notes-panel');
        if (rootPanel) rootPanel.remove();
        state.mounted = false;
    }

    function createToolbarButton(iconClass, cmd, title) {
        const b = document.createElement('button');
        b.className = 'pj-note-tool-btn';
        b.type = 'button';
        b.title = title;
        b.innerHTML = `<i class="fa-solid ${iconClass}" aria-hidden="true"></i>`;
        b.addEventListener('click', () => document.execCommand(cmd, false, null));
        return b;
    }

    function applyNoteTheme(noteEl, color) {
        noteEl.style.setProperty('--pj-note-bg', color.body);
        noteEl.style.setProperty('--pj-note-header', color.header);
        noteEl.style.setProperty('--pj-note-border', color.border);
        noteEl.style.setProperty('--pj-note-text', color.text);
    }

    function openNote() {
        if (document.getElementById('pj-note')) return;

        const resolved = resolveNoteForCurrentPage();
        if (!resolved) return;

        const { key, html, ctx } = resolved;
        const saved = html || '';
        const processNumber = (ctx && ctx.key ? String(ctx.key).replace(/^cnj_/, '') : '') || 'processo atual';
        const processShort = processNumber.split('.')[0] || processNumber;
        let selectedColor = getNoteColorMeta(key);

        ensureUiAssetsLoaded(document);

        const note = document.createElement('div');
        note.id = 'pj-note';
        applyNoteTheme(note, selectedColor);

        const header = document.createElement('div');
        header.className = 'pj-note-header';

        const headerTitle = document.createElement('div');
        headerTitle.className = 'pj-note-title';
        headerTitle.innerHTML = `<i class="fa-solid fa-pen-to-square" aria-hidden="true"></i><span>Anotações (${processShort})</span>`;

        const actions = document.createElement('div');
        actions.className = 'pj-note-actions';

        const closeBtn = document.createElement('button');
        closeBtn.className = 'pj-note-icon-btn';
        closeBtn.type = 'button';
        closeBtn.title = 'Fechar';
        closeBtn.innerHTML = '<i class="fa-solid fa-xmark" aria-hidden="true"></i>';

        const delBtn = document.createElement('button');
        delBtn.className = 'pj-note-icon-btn';
        delBtn.dataset.danger = '1';
        delBtn.type = 'button';
        delBtn.title = 'Excluir nota';
        delBtn.innerHTML = '<i class="fa-solid fa-trash" aria-hidden="true"></i>';

        [closeBtn, delBtn].forEach(btn => {
            btn.addEventListener('mousedown', e => {
                e.stopPropagation();
            });
        });

        actions.append(closeBtn, delBtn);
        header.append(headerTitle, actions);

        const toolbar = document.createElement('div');
        toolbar.className = 'pj-note-toolbar';

        const formatRow = document.createElement('div');
        formatRow.className = 'pj-note-toolbar-row';

        const colorRow = document.createElement('div');
        colorRow.className = 'pj-note-color-row';

        function syncColorSelection() {
            Array.from(colorRow.children).forEach(child => {
                child.dataset.selected = child.dataset.colorId === selectedColor.id ? '1' : '0';
            });
        }

        NOTE_COLORS.forEach(color => {
            const dot = document.createElement('button');
            dot.type = 'button';
            dot.className = 'pj-note-color-dot';
            dot.title = `Cor: ${color.label}`;
            dot.dataset.colorId = color.id;
            dot.style.background = color.body;
            dot.addEventListener('click', () => {
                selectedColor = color;
                applyNoteTheme(note, selectedColor);
                saveNoteColorMeta(key, selectedColor.id);
                syncColorSelection();
            });
            colorRow.appendChild(dot);
        });
        syncColorSelection();

        const cmds = [
            { icon: 'fa-bold', cmd: 'bold', title: 'Negrito' },
            { icon: 'fa-italic', cmd: 'italic', title: 'Itálico' },
            { icon: 'fa-underline', cmd: 'underline', title: 'Sublinhado' },
            { icon: 'fa-strikethrough', cmd: 'strikeThrough', title: 'Riscado' },
            { icon: 'fa-align-left', cmd: 'justifyLeft', title: 'Alinhar à esquerda' },
            { icon: 'fa-align-center', cmd: 'justifyCenter', title: 'Centralizar' },
            { icon: 'fa-align-right', cmd: 'justifyRight', title: 'Alinhar a direita' },
            { icon: 'fa-align-justify', cmd: 'justifyFull', title: 'Justificar' }
        ];

        cmds.forEach(({ icon, cmd, title }) => {
            formatRow.appendChild(createToolbarButton(icon, cmd, title));
        });
        toolbar.append(formatRow, colorRow);

        const editor = document.createElement('div');
        editor.className = 'pj-note-editor';
        editor.contentEditable = 'true';
        editor.innerHTML = saved;

        editor.addEventListener('input', () => {
            GM_setValue(key, editor.innerHTML);
            updateNoteIndicator();
        });

        const grip = document.createElement('div');
        grip.className = 'pj-note-resize';

        makeDraggable(note, header);
        makeResizable(note, grip);

        closeBtn.addEventListener('click', () => {
            note.remove();
        });

        delBtn.addEventListener('click', () => {
            if (!window.confirm('Excluir esta nota?')) return;
            GM_deleteValue(key);
            deleteNoteColorMeta(key);
            note.remove();
            updateNoteIndicator();
        });

        note.append(header, toolbar, editor);
        document.body.appendChild(note);
    }

    function getAllNotes() {
        const keys = typeof GM_listValues === 'function' ? GM_listValues() : [];
        const result = [];

        keys.forEach(key => {
            if (!key.startsWith(NOTE_PREFIX)) return;

            const rest = key.slice(NOTE_PREFIX.length);
            const parts = rest.split('::');
            if (parts.length < 2) return;

            const ctxKey = parts[0];
            const subkey = parts.slice(1).join('::');
            const cnj = ctxKey.replace(/^cnj_/, '');

            const html = GM_getValue(key, '');
            if (!html || !html.replace(/<[^>]*>/g, '').replace(/\s+/g, '').trim()) {
                return;
            }

            const tmp = document.createElement('div');
            tmp.innerHTML = html;
            const text = (tmp.innerText || '').replace(/\s+/g, ' ').trim();
            const preview = text.length > 180 ? text.slice(0, 180) + '...' : text;

            result.push({ key, cnj, subkey, html, preview });
        });

        return result.sort((a, b) => a.cnj.localeCompare(b.cnj));
    }

    function openNotesPanel() {
        const { doc: rootDoc, win: rootWin } = getTopContext();
        if (rootDoc.getElementById('pj-notes-panel')) return;

        ensureUiAssetsLoaded(rootDoc);

        const notes = getAllNotes();
        const previousBodyOverflow = rootDoc.body.style.overflow;

        const overlay = rootDoc.createElement('div');
        overlay.id = 'pj-notes-panel';

        const panel = rootDoc.createElement('div');
        panel.className = 'pj-panel';

        const header = rootDoc.createElement('div');
        header.className = 'pj-panel-header';

        const headerLeft = rootDoc.createElement('div');
        const title = rootDoc.createElement('div');
        title.className = 'pj-panel-title';
        title.textContent = 'Notas Locais do Projudi';
        const subtitle = rootDoc.createElement('div');
        subtitle.className = 'pj-panel-subtitle';
        subtitle.textContent = 'Gerencie suas notas salvas localmente com importação e exportação';
        headerLeft.append(title, subtitle);

        const closeBtn = rootDoc.createElement('button');
        closeBtn.className = 'pj-panel-close';
        closeBtn.type = 'button';
        closeBtn.title = 'Fechar painel';
        closeBtn.innerHTML = '<i class="fa-solid fa-xmark" aria-hidden="true"></i>';

        header.append(headerLeft, closeBtn);

        const body = rootDoc.createElement('div');
        body.className = 'pj-panel-body';

        const left = rootDoc.createElement('div');
        left.className = 'pj-panel-left';

        const right = rootDoc.createElement('div');
        right.className = 'pj-panel-right';

        const leftHeader = rootDoc.createElement('div');
        leftHeader.className = 'pj-section-title';
        leftHeader.textContent = 'Notas salvas';

        const listContainer = rootDoc.createElement('div');
        listContainer.className = 'pj-note-list';

        const previewTitle = rootDoc.createElement('div');
        previewTitle.className = 'pj-preview-title';
        previewTitle.textContent = 'Pré-visualização da nota selecionada';

        const previewBox = rootDoc.createElement('div');
        previewBox.className = 'pj-preview-box';
        previewBox.textContent = notes.length ? 'Selecione uma nota na lista ao lado.' : 'Nenhuma nota encontrada.';

        let selectedKey = null;

        function refreshSelectionStyles() {
            Array.from(listContainer.children).forEach(child => {
                if (child.dataset.noteKey === selectedKey) {
                    child.dataset.selected = '1';
                } else {
                    child.dataset.selected = '0';
                }
            });
        }

        function refreshEmptyStateAfterDelete() {
            if (!listContainer.children.length) {
                previewBox.textContent = 'Nenhuma nota encontrada.';
            } else if (!selectedKey) {
                previewBox.textContent = 'Selecione uma nota na lista ao lado.';
            }
        }

        notes.forEach(n => {
            const item = rootDoc.createElement('div');
            item.className = 'pj-note-item';
            item.dataset.noteKey = n.key;
            item.dataset.selected = '0';

            const line1 = rootDoc.createElement('div');
            line1.className = 'pj-note-line1';
            line1.textContent = n.cnj || '(sem CNJ)';

            const line2 = rootDoc.createElement('div');
            line2.className = 'pj-note-line2';
            line2.textContent = n.subkey || '';

            const line3 = rootDoc.createElement('div');
            line3.className = 'pj-note-line3';
            line3.textContent = n.preview || '(sem conteúdo)';

            const deleteBtn = rootDoc.createElement('button');
            deleteBtn.className = 'pj-note-delete';
            deleteBtn.type = 'button';
            deleteBtn.textContent = 'Excluir';

            item.addEventListener('click', () => {
                selectedKey = n.key;
                refreshSelectionStyles();
                previewBox.innerHTML = n.html || '(Nota vazia)';
            });

            deleteBtn.addEventListener('click', e => {
                e.stopPropagation();
                if (!rootWin.confirm('Excluir esta nota?')) return;

                GM_deleteValue(n.key);
                deleteNoteColorMeta(n.key);
                item.remove();

                if (selectedKey === n.key) {
                    selectedKey = null;
                    previewBox.textContent = 'Nota excluída. Selecione outra nota.';
                }

                refreshEmptyStateAfterDelete();
                updateNoteIndicator();
            });

            item.append(line1, line2, line3, deleteBtn);
            listContainer.appendChild(item);
        });

        left.append(leftHeader, listContainer, previewTitle, previewBox);

        const rightHeader = rootDoc.createElement('div');
        rightHeader.className = 'pj-section-title';
        rightHeader.textContent = 'Importar / Exportar';

        const rightBody = rootDoc.createElement('div');
        rightBody.className = 'pj-panel-right-body';

        const info = rootDoc.createElement('div');
        info.className = 'pj-info';
        info.innerHTML = [
            'Use <strong>Exportar notas</strong> para gerar um JSON com todas as notas.',
            'Cole um JSON valido abaixo e clique em <strong>Importar notas</strong> para restaurar.'
        ].join('<br>');

        const textarea = rootDoc.createElement('textarea');
        textarea.id = 'pj-notes-io';

        const buttonsRow = rootDoc.createElement('div');
        buttonsRow.className = 'pj-row-btns';

        const btnExport = rootDoc.createElement('button');
        btnExport.className = 'pj-btn';
        btnExport.type = 'button';
        btnExport.dataset.variant = 'primary';
        btnExport.innerHTML = '<i class="fa-solid fa-file-export" aria-hidden="true"></i><span>Exportar notas</span>';

        const btnImport = rootDoc.createElement('button');
        btnImport.className = 'pj-btn';
        btnImport.type = 'button';
        btnImport.dataset.variant = 'success';
        btnImport.innerHTML = '<i class="fa-solid fa-file-import" aria-hidden="true"></i><span>Importar notas</span>';

        btnExport.addEventListener('click', () => {
            const all = getAllNotes();
            const payload = all.map(n => ({
                key: n.key,
                cnj: n.cnj,
                subkey: n.subkey,
                html: n.html
            }));
            textarea.value = JSON.stringify(payload, null, 2);
        });

        btnImport.addEventListener('click', () => {
            const raw = textarea.value.trim();
            if (!raw) {
                rootWin.alert('Cole um JSON para importar.');
                return;
            }

            let parsed;
            try {
                parsed = JSON.parse(raw);
            } catch (_) {
                rootWin.alert('JSON inválido.');
                return;
            }

            if (!Array.isArray(parsed)) {
                rootWin.alert('Formato inválido: esperado um array de notas.');
                return;
            }

            let count = 0;
            parsed.forEach(item => {
                if (!item || typeof item !== 'object') return;
                if (!item.key || !item.html) return;
                if (!String(item.key).startsWith(NOTE_PREFIX)) return;

                GM_setValue(item.key, String(item.html));
                count++;
            });

            updateNoteIndicator();
            rootWin.alert(`Importação concluída. ${count} nota(s) importada(s). Reabra o painel para ver a lista atualizada.`);
        });

        buttonsRow.append(btnExport, btnImport);
        rightBody.append(info, textarea, buttonsRow);
        right.append(rightHeader, rightBody);

        body.append(left, right);
        panel.append(header, body);
        overlay.appendChild(panel);
        rootDoc.body.appendChild(overlay);
        rootDoc.body.style.overflow = 'hidden';

        rootWin.requestAnimationFrame(() => {
            panel.style.transform = 'translateY(0) scale(1)';
            panel.style.opacity = '1';
        });

        function closePanel() {
            rootDoc.body.style.overflow = previousBodyOverflow;
            overlay.remove();
            rootDoc.removeEventListener('keydown', onEsc);
        }

        function onEsc(ev) {
            if (ev.key === 'Escape') closePanel();
        }

        closeBtn.addEventListener('click', closePanel);

        overlay.addEventListener('click', e => {
            if (e.target === overlay) closePanel();
        });

        rootDoc.addEventListener('keydown', onEsc);
    }

    function makeDraggable(el, handle) {
        let startX = 0;
        let startY = 0;
        let startLeft = 0;
        let startTop = 0;
        let dragging = false;

        handle.addEventListener('mousedown', e => {
            if (e.button !== 0) return;
            if (e.target && typeof e.target.closest === 'function') {
                if (e.target.closest('button') || e.target.closest('.pj-note-actions')) return;
            }
            dragging = true;
            startX = e.clientX;
            startY = e.clientY;
            startLeft = parseInt(el.style.left || '0', 10);
            startTop = parseInt(el.style.top || '0', 10);
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
            e.preventDefault();
        });

        function onMove(e) {
            if (!dragging) return;
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            let newLeft = startLeft + dx;
            let newTop = startTop + dy;

            const maxLeft = window.innerWidth - el.offsetWidth;
            const maxTop = window.innerHeight - el.offsetHeight;

            newLeft = Math.max(0, Math.min(maxLeft, newLeft));
            newTop = Math.max(0, Math.min(maxTop, newTop));

            el.style.left = `${newLeft}px`;
            el.style.top = `${newTop}px`;
        }

        function onUp() {
            dragging = false;
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
        }
    }

    function makeResizable(el, grip) {
        let startX = 0;
        let startY = 0;
        let startW = 0;
        let startH = 0;
        let resizing = false;

        grip.addEventListener('mousedown', e => {
            if (e.button !== 0) return;
            resizing = true;
            startX = e.clientX;
            startY = e.clientY;
            startW = el.offsetWidth;
            startH = el.offsetHeight;
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
            e.preventDefault();
        });

        function onMove(e) {
            if (!resizing) return;
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            const newW = Math.max(280, startW + dx);
            const newH = Math.max(160, startH + dy);
            el.style.width = `${newW}px`;
            el.style.height = `${newH}px`;
        }

        function onUp() {
            resizing = false;
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
        }

        el.appendChild(grip);
    }

    function reviveAfterReturn() {
        ensureMenuRegistered(true);
        evaluate();
    }

    window.addEventListener('pageshow', reviveAfterReturn, true);
    window.addEventListener('focus', reviveAfterReturn, true);
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) reviveAfterReturn();
    });
})();