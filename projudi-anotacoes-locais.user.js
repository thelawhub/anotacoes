// ==UserScript==
// @name         Anotações Locais
// @namespace    projudi-anotacoes-locais.user.js
// @version      3.1
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
// @grant        GM_xmlhttpRequest
// @connect      api.github.com
// ==/UserScript==

(function () {
    'use strict';

    const INSTANCE_KEY = '__projudi_postit_local_instance__';
    if (window[INSTANCE_KEY] && typeof window[INSTANCE_KEY].destroy === 'function') {
        try { window[INSTANCE_KEY].destroy(); } catch (_) {}
    }

    const Z_UI = 2147483000;
    const NOTE_PREFIX = 'projudi_note::';
    const NOTE_META_PREFIX = 'projudi_note_meta::';
    const CNJ_REGEX = /\b\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}\b/;
    const NOTE_COLORS = [
        { id: 'yellow', label: 'Amarela', body: '#fff7b2', header: '#f4e38a', border: '#e3d37d', text: '#4a3f00' },
        { id: 'blue', label: 'Azul', body: '#dff0ff', header: '#c9e5ff', border: '#adcff2', text: '#0f3b63' },
        { id: 'pink', label: 'Rosa', body: '#ffe3ef', header: '#ffd0e4', border: '#f5b7cf', text: '#6b1f42' },
        { id: 'green', label: 'Verde', body: '#e8f8d8', header: '#d6efbc', border: '#bddda0', text: '#1f4f24' },
        { id: 'lilac', label: 'Lilás', body: '#efe5ff', header: '#e1d0ff', border: '#cab3ef', text: '#42236c' }
    ];
    const DEFAULT_NOTE_COLOR_ID = 'yellow';
    const SCRIPT_META = (() => {
        const fallbackName = 'Anotacoes Locais';
        const fallbackId = 'projudi-anotacoes-locais';
        try {
            const script = GM_info && GM_info.script ? GM_info.script : {};
            const name = String(script.name || fallbackName).trim() || fallbackName;
            const namespace = String(script.namespace || '').trim();
            const version = String(script.version || 'unknown').trim() || 'unknown';
            const base = (namespace || name || fallbackId)
                .replace(/\.user\.js$/i, '')
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .replace(/[^a-zA-Z0-9]+/g, '-')
                .replace(/^-+|-+$/g, '')
                .toLowerCase();
            const id = base || fallbackId;
            return { name, version, id, fileName: `${id}.json` };
        } catch (_) {
            return { name: fallbackName, version: 'unknown', id: fallbackId, fileName: `${fallbackId}.json` };
        }
    })();
    const BACKUP_SETTINGS_KEY = 'projudi_notes_backup_settings_v1';
    const BACKUP_SCHEMA = 'projudi-anotacoes-locais-backup-v1';
    const DEFAULT_BACKUP_SETTINGS = {
        enabled: false,
        gistId: '',
        token: '',
        fileName: SCRIPT_META.fileName,
        autoBackupOnSave: false,
        lastBackupAt: ''
    };

    const state = {
        mounted: false,
        timer: null,
        scheduled: false,
        observer: null,
        menuRegistered: false,
        menuCommandId: null,
        scratchHtmlEl: null,
        fallbackNoteKeyByCnjKey: Object.create(null),
        noteHtmlCheckCache: {
            signature: null,
            hasText: false
        },
        indicatorCache: {
            signature: null,
            hasNote: null
        },
        handlers: {
            onLoad: null,
            onPageShow: null,
            onFocus: null,
            onVisibilityChange: null
        },
        backupTimer: null
    };

    function lockBodyScroll(doc = document) {
        const body = doc && doc.body;
        if (!body) return () => {};
        const win = (doc && doc.defaultView) || window;
        const KEY = "__pjBodyScrollLock__";
        const lockState = win[KEY] || (win[KEY] = { count: 0, prevOverflow: "" });
        if (lockState.count === 0) {
            lockState.prevOverflow = body.style.overflow;
            body.style.overflow = 'hidden';
        }
        lockState.count += 1;
        let released = false;
        return () => {
            if (released) return;
            released = true;
            lockState.count = Math.max(0, lockState.count - 1);
            if (lockState.count === 0) body.style.overflow = lockState.prevOverflow;
        };
    }

    function isProcessPage(doc) {
        if (!doc || !doc.body) return false;
        const text = doc.body.innerText || '';
        return CNJ_REGEX.test(text);
    }

    function getProcessContext() {
        if (!document.body) return null;
        const text = document.body.innerText || '';
        const match = text.match(CNJ_REGEX);
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

    function normalizeBackupSettings(value) {
        const next = { ...DEFAULT_BACKUP_SETTINGS, ...(value || {}) };
        next.enabled = !!next.enabled;
        next.gistId = String(next.gistId || '').trim();
        next.token = String(next.token || '').trim();
        next.fileName = String(next.fileName || SCRIPT_META.fileName).trim() || SCRIPT_META.fileName;
        next.autoBackupOnSave = !!next.autoBackupOnSave;
        next.lastBackupAt = String(next.lastBackupAt || '').trim();
        return next;
    }

    function formatLastBackupLabel(value) {
        if (!value) return 'Último backup: ainda não enviado.';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return 'Último backup: ainda não enviado.';
        return `Último backup: ${date.toLocaleString('pt-BR')}.`;
    }

    function loadBackupSettings() {
        return normalizeBackupSettings(GM_getValue(BACKUP_SETTINGS_KEY, DEFAULT_BACKUP_SETTINGS));
    }

    function saveBackupSettings(next) {
        const normalized = normalizeBackupSettings(next);
        GM_setValue(BACKUP_SETTINGS_KEY, normalized);
        return normalized;
    }

    function buildBackupPayload() {
        return {
            schema: BACKUP_SCHEMA,
            scriptId: SCRIPT_META.id,
            scriptName: SCRIPT_META.name,
            version: SCRIPT_META.version,
            exportedAt: new Date().toISOString(),
            host: location.host,
            notes: getAllNotes().map(note => ({
                key: note.key,
                cnj: note.cnj,
                subkey: note.subkey,
                html: note.html,
                colorId: getNoteColorMeta(note.key).id
            }))
        };
    }

    function applyBackupPayload(payload) {
        const notes = payload && Array.isArray(payload.notes) ? payload.notes : (Array.isArray(payload) ? payload : []);
        let count = 0;
        notes.forEach(item => {
            if (!item || typeof item !== 'object') return;
            if (!item.key || !String(item.key).startsWith(NOTE_PREFIX)) return;
            GM_setValue(item.key, String(item.html || ''));
            if (item.colorId) saveNoteColorMeta(item.key, String(item.colorId));
            count++;
        });
        updateNoteIndicator(true);
        return count;
    }

    function githubRequest(options) {
        return new Promise((resolve, reject) => {
            if (typeof GM_xmlhttpRequest !== 'function') {
                reject(new Error('GM_xmlhttpRequest indisponivel.'));
                return;
            }
            GM_xmlhttpRequest({
                method: options.method || 'GET',
                url: options.url,
                headers: options.headers || {},
                data: options.data,
                onload: resolve,
                onerror: () => reject(new Error('Falha de rede ao acessar o GitHub.')),
                ontimeout: () => reject(new Error('Tempo esgotado ao acessar o GitHub.'))
            });
        });
    }

    function parseGithubError(response) {
        try {
            const parsed = JSON.parse(response.responseText || '{}');
            if (parsed && parsed.message) return parsed.message;
        } catch (_) {}
        return `GitHub respondeu com status ${response.status}.`;
    }

    async function pushBackupToGist(backupSettings, payload) {
        if (!backupSettings.gistId) throw new Error('Informe o Gist ID.');
        if (!backupSettings.token) throw new Error('Informe o token do GitHub.');
        const response = await githubRequest({
            method: 'PATCH',
            url: `https://api.github.com/gists/${encodeURIComponent(backupSettings.gistId)}`,
            headers: {
                Accept: 'application/vnd.github+json',
                Authorization: `Bearer ${backupSettings.token}`,
                'Content-Type': 'application/json'
            },
            data: JSON.stringify({ files: { [backupSettings.fileName]: { content: JSON.stringify(payload, null, 2) } } })
        });
        if (response.status < 200 || response.status >= 300) throw new Error(parseGithubError(response));
    }

    async function readBackupFromGist(backupSettings) {
        if (!backupSettings.gistId) throw new Error('Informe o Gist ID.');
        if (!backupSettings.token) throw new Error('Informe o token do GitHub.');
        const response = await githubRequest({
            method: 'GET',
            url: `https://api.github.com/gists/${encodeURIComponent(backupSettings.gistId)}`,
            headers: {
                Accept: 'application/vnd.github+json',
                Authorization: `Bearer ${backupSettings.token}`
            }
        });
        if (response.status < 200 || response.status >= 300) throw new Error(parseGithubError(response));
        const gist = JSON.parse(response.responseText || '{}');
        const file = gist && gist.files ? gist.files[backupSettings.fileName] : null;
        if (!file || !file.content) throw new Error('Arquivo de backup não encontrado no Gist.');
        return JSON.parse(file.content);
    }

    function scheduleAutoBackup() {
        clearTimeout(state.backupTimer);
        state.backupTimer = null;
        const backupSettings = loadBackupSettings();
        if (!backupSettings.enabled || !backupSettings.autoBackupOnSave) return;
        state.backupTimer = setTimeout(async () => {
            state.backupTimer = null;
            try {
                await pushBackupToGist(backupSettings, buildBackupPayload());
                saveBackupSettings({ ...backupSettings, lastBackupAt: new Date().toISOString() });
            } catch (_) {}
        }, 800);
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

    function getScratchHtmlEl() {
        if (!state.scratchHtmlEl) {
            state.scratchHtmlEl = document.createElement('div');
        }
        return state.scratchHtmlEl;
    }

    function noteHtmlHasVisibleText(html) {
        if (!html) return false;

        const signature = `${html.length}:${html.slice(0, 96)}`;
        if (state.noteHtmlCheckCache.signature === signature) {
            return state.noteHtmlCheckCache.hasText;
        }

        const tmp = getScratchHtmlEl();
        tmp.innerHTML = html;
        const text = (tmp.innerText || tmp.textContent || '').replace(/\s+/g, '').trim();
        const hasText = !!text;
        tmp.innerHTML = '';

        state.noteHtmlCheckCache.signature = signature;
        state.noteHtmlCheckCache.hasText = hasText;
        return hasText;
    }

    function resolveNoteForCurrentPage(ctxOverride) {
        const ctx = ctxOverride || getProcessContext();
        if (!ctx) return null;

        let key = storageKey(ctx);
        let html = GM_getValue(key, null);

        if (html === null || typeof html === 'undefined') {
            const prefixForCnj = `${NOTE_PREFIX}${ctx.key}::`;
            let fallbackKey = state.fallbackNoteKeyByCnjKey[ctx.key] || null;
            if (fallbackKey && !String(fallbackKey).startsWith(prefixForCnj)) {
                fallbackKey = null;
            }

            if (!fallbackKey) {
                const keys = typeof GM_listValues === 'function' ? GM_listValues() : [];
                fallbackKey = keys.find(k => k.startsWith(prefixForCnj)) || null;
                state.fallbackNoteKeyByCnjKey[ctx.key] = fallbackKey;
            }

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

    function hasNonEmptyNoteForCurrentPage(resolvedOverride) {
        const resolved = resolvedOverride || resolveNoteForCurrentPage();
        if (!resolved) return false;
        return noteHtmlHasVisibleText(resolved.html);
    }

    function scheduleEvaluate(delay = 250, options = {}) {
        const reset = !!(options && options.reset);
        if (state.scheduled && !reset) return;

        clearTimeout(state.timer);
        state.scheduled = true;
        state.timer = setTimeout(() => {
            state.scheduled = false;
            evaluate();
        }, delay);
    }

    function evaluate() {
        if (!document.documentElement) return;

        const ctx = getProcessContext();
        const ok = !!ctx;
        cleanupDuplicateButtons();
        let btn = document.getElementById('pj-add-btn');
        if (btn) {
            const bcs = window.getComputedStyle(btn);
            const brokenMount = bcs.display === 'none' || bcs.visibility === 'hidden' || btn.offsetWidth === 0 || btn.offsetHeight === 0;
            if (brokenMount) {
                btn.remove();
                state.mounted = false;
                btn = null;
            }
        }
        const hasButton = !!btn;
        const hasNativeAnchor = !!getNativeAnchorButton();

        if (state.mounted && !hasButton) {
            state.mounted = false;
        }

        if (state.mounted && hasButton && !hasNativeAnchor) {
            unmountAll();
            return;
        }

        if (ok && !state.mounted) {
            mountButton();
        }

        if (ok && state.mounted) {
            updateNoteIndicator(false, resolveNoteForCurrentPage(ctx));
        }

        if (!ok && state.mounted) {
            unmountAll();
        }
    }

    state.handlers.onLoad = () => scheduleEvaluate(300, { reset: true });
    window.addEventListener('load', state.handlers.onLoad);

    state.observer = new MutationObserver(mutations => {
        if (document.hidden) return;

        const isOwnUiMutation = mutations.every(m => {
            const t = m.target;
            return t && t.nodeType === 1 && typeof t.closest === 'function' &&
                t.closest('#pj-note, #pj-notes-panel, #pj-add-btn');
        });
        if (isOwnUiMutation) return;

        scheduleEvaluate(250);
    });

    state.observer.observe(document.documentElement, {
        childList: true,
        subtree: true
    });

    scheduleEvaluate(80, { reset: true });

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
                position: relative !important;
                color: #d4a017 !important;
                z-index: ${Z_UI} !important;
            }

            #pj-add-btn i {
                color: #d4a017 !important;
                display: inline-block !important;
                line-height: 1 !important;
                vertical-align: middle !important;
                transform: scale(0.92) !important;
                transform-origin: center center !important;
            }

            #pj-add-btn:hover {
                filter: brightness(1.1);
            }

            #pj-add-btn[data-has-note='1']::after {
                content: '!';
                position: absolute;
                top: -4px !important;
                right: -3px !important;
                display: inline-flex !important;
                align-items: center !important;
                justify-content: center !important;
                width: 14px !important;
                height: 14px !important;
                border-radius: 50% !important;
                background: #dc2626 !important;
                color: #fff !important;
                font: 700 9px/1 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif !important;
                border: 1px solid #fff !important;
                box-shadow: 0 1px 2px rgba(0,0,0,.3) !important;
                pointer-events: none !important;
                z-index: 1 !important;
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

            #pj-note,
            #pj-note * {
                box-sizing: border-box;
            }

            #pj-note .pj-note-header {
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

            #pj-note .pj-note-title {
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

            #pj-note .pj-note-actions {
                display: flex;
                align-items: center;
                gap: 6px;
            }

            #pj-note .pj-note-icon-btn {
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

            #pj-note .pj-note-icon-btn[data-danger='1'] {
                background: #b91c1c;
                color: #ffffff;
            }

            #pj-note .pj-note-toolbar {
                display: flex;
                flex-direction: column;
                align-items: stretch;
                gap: 5px;
                background: #f8fafc;
                border-top: 1px solid #dbe3ef;
                border-bottom: 1px solid #dbe3ef;
                padding: 6px;
            }

            #pj-note .pj-note-toolbar-row {
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 6px;
                flex-wrap: wrap;
            }

            #pj-note .pj-note-tool-btn {
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

            #pj-note .pj-note-color-row {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                gap: 5px;
            }

            #pj-note .pj-note-color-dot {
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

            #pj-note .pj-note-color-dot[data-selected='1'] {
                outline: 2px solid #2b69aa;
                outline-offset: 1px;
            }

            #pj-note .pj-note-editor {
                flex: 1;
                padding: 8px;
                outline: none;
                overflow-y: auto;
                font: 13px/1.45 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
                color: var(--pj-note-text, #4a3f00);
                background: transparent;
            }

            #pj-note .pj-note-resize {
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
                --pj-font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
                --pj-font-size-base: 14px;
                --pj-line-height-base: 1.35;
                --pj-color-text: #0f172a;
                --pj-color-text-muted: #64748b;
                --pj-color-border: #dbe3ef;
                --pj-color-border-control: #cbd5e1;
                --pj-color-surface-soft: #f8fafc;
                --pj-radius-sm: 8px;
                --pj-radius-md: 10px;
                --pj-radius-lg: 14px;
                --pj-space-2: 8px;
                --pj-space-3: 10px;
                --pj-space-4: 12px;
                --pj-space-5: 16px;
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
                font-family: var(--pj-font-family);
                font-size: var(--pj-font-size-base);
                line-height: var(--pj-line-height-base);
                color: var(--pj-color-text);
            }

            #pj-notes-panel,
            #pj-notes-panel * {
                box-sizing: border-box;
            }

            #pj-notes-panel .pj-panel {
                width: min(980px, calc(100vw - 24px));
                max-height: min(88vh, 860px);
                background: #ffffff;
                color: var(--pj-color-text);
                border-radius: var(--pj-radius-lg);
                box-shadow: 0 24px 70px rgba(2, 6, 23, .30);
                border: 1px solid var(--pj-color-border);
                overflow: hidden;
                display: flex;
                flex-direction: column;
                transform: translateY(6px) scale(.985);
                opacity: .96;
                transition: transform .16s ease, opacity .16s ease;
            }

            #pj-notes-panel .pj-panel-header {
                padding: 14px 16px;
                background: linear-gradient(135deg,#0f3e75,#1f5ca4);
                color: #ffffff;
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: var(--pj-space-4);
            }

            #pj-notes-panel .pj-panel-title {
                font-size: 16px;
                font-weight: 700;
                line-height: 1.2;
            }

            #pj-notes-panel .pj-panel-subtitle {
                font-size: 12px;
                opacity: .9;
                margin-top: 2px;
            }

            #pj-notes-panel .pj-panel-close {
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
                font-size: 14px;
                font-weight: 500;
                line-height: 1.2;
            }

            #pj-notes-panel .pj-panel-body {
                display: flex;
                flex: 1;
                min-height: 320px;
                background: var(--pj-color-surface-soft);
            }

            #pj-notes-panel .pj-panel-left,
            #pj-notes-panel .pj-panel-right {
                display: flex;
                flex-direction: column;
                min-height: 0;
            }

            #pj-notes-panel .pj-panel-left {
                flex: 3;
                border-right: 1px solid #dbe3ef;
            }

            #pj-notes-panel .pj-panel-right {
                flex: 2;
            }

            #pj-notes-panel .pj-section-title {
                padding: 10px 12px;
                border-bottom: 1px solid #dbe3ef;
                font-weight: 600;
                background: #f8fafc;
                font-size: 14px;
                line-height: 1.35;
            }

            #pj-notes-panel .pj-note-list {
                flex: 1;
                overflow-y: auto;
                padding: 10px;
                display: flex;
                flex-direction: column;
                gap: 10px;
                min-height: 0;
            }

            #pj-notes-panel .pj-note-item {
                border: 1px solid #dbe3ef;
                border-radius: 10px;
                background: #ffffff;
                padding: 12px;
                cursor: pointer;
                position: relative;
            }

            #pj-notes-panel .pj-note-item[data-selected='1'] {
                background: #eff6ff;
                border-color: #bfdbfe;
            }

            #pj-notes-panel .pj-note-line1 {
                font-size: 14px;
                font-weight: 700;
                color: var(--pj-color-text);
                margin-right: 62px;
                line-height: 1.2;
            }

            #pj-notes-panel .pj-note-line2 {
                font-size: 12px;
                color: var(--pj-color-text-muted);
                margin-top: 2px;
                margin-right: 62px;
                word-break: break-all;
            }

            #pj-notes-panel .pj-note-line3 {
                font-size: 12px;
                color: #334155;
                margin-top: 5px;
                line-height: 1.35;
            }

            #pj-notes-panel .pj-note-delete {
                position: absolute;
                top: 6px;
                right: 8px;
                border: 1px solid #fecaca;
                border-radius: 7px;
                padding: 2px 7px;
                font-size: 12px;
                cursor: pointer;
                background: #fee2e2;
                color: #b91c1c;
                font-weight: 600;
            }

            #pj-notes-panel .pj-preview-title {
                padding: 7px 8px 0;
                font-size: 12px;
                color: var(--pj-color-text-muted);
            }

            #pj-notes-panel .pj-preview-box {
                margin: 4px 8px 8px;
                border-radius: var(--pj-radius-md);
                background: #ffffff;
                border: 1px solid #dbe3ef;
                padding: 12px;
                min-height: 90px;
                max-height: 170px;
                overflow-y: auto;
                font-size: 14px;
                line-height: 1.35;
                color: #334155;
            }

            #pj-notes-panel .pj-panel-right-body {
                padding: 12px;
                display: flex;
                flex-direction: column;
                gap: 12px;
                flex: 1;
                min-height: 0;
                overflow-y: auto;
            }

            #pj-notes-panel .pj-info {
                font-size: 12px;
                color: #475569;
                line-height: 1.35;
                border: 1px solid #dbe3ef;
                border-radius: var(--pj-radius-md);
                background: #ffffff;
                padding: 12px;
            }

            #pj-notes-panel #pj-notes-io {
                flex: 0 0 160px;
                min-height: 120px;
                max-height: 220px;
                width: 100%;
                resize: vertical;
                border: 1px solid var(--pj-color-border-control);
                border-radius: var(--pj-radius-sm);
                padding: 6px 8px;
                font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace;
                font-size: 12px;
                line-height: 1.35;
                color: var(--pj-color-text);
                background: #ffffff;
            }

            #pj-notes-panel .pj-row-btns {
                display: flex;
                gap: 8px;
                flex-wrap: wrap;
            }

            #pj-notes-panel .pj-backup-grid {
                display: grid;
                grid-template-columns: repeat(2, minmax(0, 1fr));
                gap: 8px;
                margin-top: 10px;
            }

            #pj-notes-panel .pj-backup-grid input {
                width: 100%;
                min-width: 0;
            }

            #pj-notes-panel .pj-backup-grid .pj-backup-span {
                grid-column: 1 / -1;
            }

            #pj-notes-panel .pj-backup-toggles {
                display: flex;
                gap: 14px;
                flex-wrap: wrap;
                margin-top: 10px;
            }

            #pj-notes-panel .pj-backup-actions {
                display: flex;
                gap: 8px;
                align-items: center;
                flex-wrap: wrap;
                margin-top: 10px;
            }

            #pj-notes-panel .pj-backup-status {
                font-size: 12px;
                color: #475569;
                flex: 1 1 100%;
            }

            #pj-notes-panel .pj-btn {
                flex: 1 1 auto;
                min-width: 86px;
                min-height: 34px;
                padding: 7px 11px;
                border-radius: 8px;
                border: 1px solid var(--pj-color-border-control);
                background: #ffffff;
                color: #1e293b;
                cursor: pointer;
                font-size: 14px;
                font-weight: 500;
                line-height: 1.2;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                gap: 6px;
            }

            #pj-notes-panel .pj-btn[data-variant='primary'] {
                color: #ffffff;
                background: #0f3e75;
                border-color: #0f3e75;
            }

            #pj-notes-panel .pj-btn[data-variant='success'] {
                color: #ffffff;
                background: #15803d;
                border-color: #15803d;
            }

            @media (max-width: 860px) {
                #pj-notes-panel .pj-panel-body {
                    flex-direction: column;
                }

                #pj-notes-panel .pj-panel-left {
                    border-right: 0;
                    border-bottom: 1px solid #dbe3ef;
                    min-height: 230px;
                }

                #pj-notes-panel .pj-panel-right {
                    min-height: 220px;
                }

                #pj-notes-panel .pj-panel-right-body {
                    padding: 12px;
                    gap: 10px;
                }

                #pj-notes-panel .pj-backup-grid {
                    grid-template-columns: 1fr;
                }

                #pj-notes-panel .pj-backup-grid .pj-backup-span {
                    grid-column: auto;
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
            const id = GM_registerMenuCommand('Post-it: Abrir Painel', () => {
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

    function getNativeAnchorButton() {
        const candidates = Array.from(document.querySelectorAll([
            'button.notaProcesso',
            'button[onclick*="criarNota"]',
            'a.notaProcesso',
            'a[onclick*="criarNota"]'
        ].join(', ')));
        if (!candidates.length) return null;

        const visible = candidates.find(btn => {
            const cs = window.getComputedStyle(btn);
            if (cs.display === 'none' || cs.visibility === 'hidden') return false;
            return true;
        });

        return visible || candidates[0];
    }

    function cleanupDuplicateButtons() {
        const buttons = Array.from(document.querySelectorAll('#pj-add-btn'));
        if (buttons.length <= 1) return;
        buttons.slice(1).forEach(el => el.remove());
    }

    function applyIntegratedButtonLayout(btn, nativeBtn) {
        const cs = window.getComputedStyle(nativeBtn);
        const isFloatRight = cs.float === 'right';
        const isHiddenAnchor = cs.display === 'none' || cs.visibility === 'hidden';
        const widthPx = parseFloat(cs.width) || 0;
        const heightPx = parseFloat(cs.height) || 0;
        const hasUsableSize = widthPx > 0 && heightPx > 0;

        btn.style.setProperty('float', cs.float || 'none', 'important');
        btn.style.setProperty('margin-top', cs.marginTop, 'important');
        btn.style.setProperty('margin-right', cs.marginRight, 'important');
        btn.style.setProperty('margin-bottom', cs.marginBottom, 'important');
        btn.style.setProperty('margin-left', cs.marginLeft, 'important');
        btn.style.setProperty('padding-top', cs.paddingTop, 'important');
        btn.style.setProperty('padding-right', cs.paddingRight, 'important');
        btn.style.setProperty('padding-bottom', cs.paddingBottom, 'important');
        btn.style.setProperty('padding-left', cs.paddingLeft, 'important');
        btn.style.setProperty('border-top-width', cs.borderTopWidth, 'important');
        btn.style.setProperty('border-right-width', cs.borderRightWidth, 'important');
        btn.style.setProperty('border-bottom-width', cs.borderBottomWidth, 'important');
        btn.style.setProperty('border-left-width', cs.borderLeftWidth, 'important');
        btn.style.setProperty('border-top-style', cs.borderTopStyle, 'important');
        btn.style.setProperty('border-right-style', cs.borderRightStyle, 'important');
        btn.style.setProperty('border-bottom-style', cs.borderBottomStyle, 'important');
        btn.style.setProperty('border-left-style', cs.borderLeftStyle, 'important');
        btn.style.setProperty('border-top-color', cs.borderTopColor, 'important');
        btn.style.setProperty('border-right-color', cs.borderRightColor, 'important');
        btn.style.setProperty('border-bottom-color', cs.borderBottomColor, 'important');
        btn.style.setProperty('border-left-color', cs.borderLeftColor, 'important');
        btn.style.setProperty('border-radius', cs.borderRadius, 'important');
        btn.style.setProperty('background', cs.background, 'important');
        btn.style.setProperty('box-shadow', cs.boxShadow, 'important');
        if (!isHiddenAnchor) {
            btn.style.setProperty('display', cs.display === 'inline' ? 'inline-block' : cs.display, 'important');
        } else {
            btn.style.setProperty('display', 'inline-block', 'important');
        }

        if (!isHiddenAnchor && cs.visibility && cs.visibility !== 'collapse') {
            btn.style.setProperty('visibility', cs.visibility, 'important');
        } else {
            btn.style.setProperty('visibility', 'visible', 'important');
        }

        btn.style.setProperty('vertical-align', cs.verticalAlign || 'middle', 'important');
        btn.style.setProperty('cursor', cs.cursor || 'pointer', 'important');
        btn.style.setProperty('line-height', cs.lineHeight, 'important');
        btn.style.setProperty('text-align', cs.textAlign, 'important');
        if (hasUsableSize) {
            btn.style.setProperty('width', cs.width, 'important');
            btn.style.setProperty('height', cs.height, 'important');
            btn.style.setProperty('min-width', cs.width, 'important');
            btn.style.setProperty('min-height', cs.height, 'important');
        } else {
            btn.style.removeProperty('width');
            btn.style.removeProperty('height');
            btn.style.removeProperty('min-width');
            btn.style.removeProperty('min-height');
        }
        btn.style.setProperty('overflow', 'visible', 'important');
        btn.style.setProperty('opacity', '1', 'important');

        const ml = parseFloat(cs.marginLeft) || 0;
        const mr = parseFloat(cs.marginRight) || 0;
        if (isFloatRight) {
            btn.style.setProperty('margin-left', `${Math.max(ml, 8)}px`, 'important');
        } else {
            btn.style.setProperty('margin-right', `${Math.max(mr, 8)}px`, 'important');
        }
    }

    function mountButton() {
        cleanupDuplicateButtons();
        if (document.getElementById('pj-add-btn')) {
            state.mounted = true;
            return;
        }

        const nativeNoteButton = getNativeAnchorButton();
        if (!nativeNoteButton || !nativeNoteButton.parentElement) return;

        ensureUiAssetsLoaded();
        ensureMenuRegistered(false);

        const btn = document.createElement('button');
        btn.id = 'pj-add-btn';
        btn.type = 'button';
        btn.title = 'Anotações locais desta página';
        btn.innerHTML = '<i class="fa-solid fa-pen-to-square fa-3x" aria-hidden="true"></i>';

        btn.addEventListener('mousedown', e => {
            e.preventDefault();
            e.stopPropagation();
        });
        btn.addEventListener('click', e => {
            e.preventDefault();
            e.stopPropagation();
            toggleNoteFromButton();
        });

        applyIntegratedButtonLayout(btn, nativeNoteButton);

        const parentCs = window.getComputedStyle(nativeNoteButton.parentElement);
        const parentDisplay = parentCs.display || '';
        const parentFlexDir = parentCs.flexDirection || '';
        const visualOrderReversed = parentDisplay.includes('flex') && parentFlexDir.includes('reverse');
        const nativeFloat = window.getComputedStyle(nativeNoteButton).float;
        const insertBefore = nativeFloat === 'right' || visualOrderReversed;

        nativeNoteButton.insertAdjacentElement(insertBefore ? 'beforebegin' : 'afterend', btn);

        state.mounted = true;
        updateNoteIndicator(true);
    }

    function updateNoteIndicator(force = false, resolvedOverride) {
        const btn = document.getElementById('pj-add-btn');
        if (!btn) return;

        const resolved = resolvedOverride || resolveNoteForCurrentPage();
        const signature = resolved ? `${resolved.key}|${resolved.html.length}|${resolved.html.slice(0, 64)}` : 'no-note-context';
        let hasNote;

        if (!force && state.indicatorCache.signature === signature && typeof state.indicatorCache.hasNote === 'boolean') {
            hasNote = state.indicatorCache.hasNote;
        } else {
            hasNote = hasNonEmptyNoteForCurrentPage(resolved);
            state.indicatorCache.signature = signature;
            state.indicatorCache.hasNote = hasNote;
        }

        const legacyBadge = document.getElementById('pj-note-badge');
        if (legacyBadge) legacyBadge.remove();

        if (hasNote) {
            btn.dataset.hasNote = '1';
            btn.title = 'Anotações locais desta página (há nota)';
        } else {
            delete btn.dataset.hasNote;
            btn.title = 'Anotações locais desta página';
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
        state.indicatorCache.signature = null;
        state.indicatorCache.hasNote = null;
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
                scheduleAutoBackup();
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
            updateNoteIndicator(true);
            scheduleAutoBackup();
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
            updateNoteIndicator(true);
            scheduleAutoBackup();
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

            result.push({ key, cnj, subkey, html, preview, colorId: getNoteColorMeta(key).id });
        });

        return result.sort((a, b) => a.cnj.localeCompare(b.cnj));
    }

    function openNotesPanel() {
        const { doc: rootDoc, win: rootWin } = getTopContext();
        if (rootDoc.getElementById('pj-notes-panel')) return;

        ensureUiAssetsLoaded(rootDoc);

        const notes = getAllNotes();
        const unlockBodyScroll = lockBodyScroll(rootDoc);

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
                updateNoteIndicator(true);
                scheduleAutoBackup();
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
        let backupSettings = loadBackupSettings();

        const info = rootDoc.createElement('div');
        info.className = 'pj-info';
        info.innerHTML = [
            'Use <strong>Exportar notas</strong> para gerar um JSON com todas as notas.',
            'Cole um JSON válido abaixo e clique em <strong>Importar notas</strong> para restaurar.'
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
            textarea.value = JSON.stringify(buildBackupPayload().notes, null, 2);
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

            const count = applyBackupPayload(parsed);

            updateNoteIndicator(true);
            scheduleAutoBackup();
            rootWin.alert(`Importação concluída. ${count} nota(s) importada(s). Reabra o painel para ver a lista atualizada.`);
        });

        buttonsRow.append(btnExport, btnImport);
        const backupBox = rootDoc.createElement('div');
        backupBox.className = 'pj-info';
        backupBox.style.marginTop = '12px';
        backupBox.innerHTML = `
            <strong>Backup remoto</strong><br>
            Um único Gist no GitHub pode armazenar este script em arquivo separado.
            <div class="pj-backup-grid">
                <input id="pj-notes-backup-gist" type="text" placeholder="Gist ID" value="${backupSettings.gistId}">
                <input id="pj-notes-backup-file" type="text" placeholder="projudi-anotacoes-locais.json" value="${backupSettings.fileName}">
                <input id="pj-notes-backup-token" class="pj-backup-span" type="password" placeholder="ghp_..." value="${backupSettings.token}">
            </div>
            <div class="pj-backup-toggles">
                <label><input id="pj-notes-backup-enabled" type="checkbox" ${backupSettings.enabled ? 'checked' : ''}> Ativar backup por Gist no GitHub.</label>
                <label><input id="pj-notes-backup-auto" type="checkbox" ${backupSettings.autoBackupOnSave ? 'checked' : ''}> Backup automático</label>
            </div>
            <div class="pj-backup-actions">
                <button id="pj-notes-backup-send" class="pj-btn" type="button" data-variant="primary"><i class="fa-solid fa-cloud-arrow-up" aria-hidden="true"></i><span>Enviar backup</span></button>
                <button id="pj-notes-backup-restore" class="pj-btn" type="button" data-variant="success"><i class="fa-solid fa-cloud-arrow-down" aria-hidden="true"></i><span>Restaurar backup</span></button>
                <button id="pj-notes-backup-clear" class="pj-btn" type="button" data-variant="secondary"><i class="fa-solid fa-eraser" aria-hidden="true"></i><span>Limpar backup</span></button>
                <span id="pj-notes-backup-status" class="pj-backup-status"></span>
            </div>
            <div id="pj-notes-backup-last" class="pj-backup-status">${formatLastBackupLabel(backupSettings.lastBackupAt)}</div>
        `;

        rightBody.append(info, textarea, buttonsRow, backupBox);
        right.append(rightHeader, rightBody);

        body.append(left, right);
        panel.append(header, body);
        overlay.appendChild(panel);
        rootDoc.body.appendChild(overlay);

        rootWin.requestAnimationFrame(() => {
            panel.style.transform = 'translateY(0) scale(1)';
            panel.style.opacity = '1';
        });

        function closePanel() {
            unlockBodyScroll();
            overlay.remove();
            rootDoc.removeEventListener('keydown', onEsc);
        }

        function onEsc(ev) {
            if (ev.key === 'Escape') closePanel();
        }

        const backupEnabledInput = rootDoc.getElementById('pj-notes-backup-enabled');
        const backupAutoInput = rootDoc.getElementById('pj-notes-backup-auto');
        const backupGistInput = rootDoc.getElementById('pj-notes-backup-gist');
        const backupTokenInput = rootDoc.getElementById('pj-notes-backup-token');
        const backupFileInput = rootDoc.getElementById('pj-notes-backup-file');
        const backupSendBtn = rootDoc.getElementById('pj-notes-backup-send');
        const backupRestoreBtn = rootDoc.getElementById('pj-notes-backup-restore');
        const backupClearBtn = rootDoc.getElementById('pj-notes-backup-clear');
        const backupStatusEl = rootDoc.getElementById('pj-notes-backup-status');
        const backupLastEl = rootDoc.getElementById('pj-notes-backup-last');
        const hasBackupUi = [
            backupEnabledInput,
            backupAutoInput,
            backupGistInput,
            backupTokenInput,
            backupFileInput,
            backupSendBtn,
            backupRestoreBtn,
            backupClearBtn,
            backupStatusEl,
            backupLastEl
        ].every(Boolean);

        function setBackupStatus(message, isError) {
            const status = backupStatusEl;
            if (!hasBackupUi || !status) return;
            status.textContent = message || '';
            status.style.color = isError ? '#b42318' : '#475569';
        }

        function updateBackupLast(nextSettings) {
            const status = backupLastEl;
            if (!hasBackupUi || !status) return;
            status.textContent = formatLastBackupLabel((nextSettings || backupSettings).lastBackupAt);
        }

        function readBackupSettingsFromPanel() {
            if (!hasBackupUi) return backupSettings;
            return saveBackupSettings({
                enabled: !!backupEnabledInput?.checked,
                autoBackupOnSave: !!backupAutoInput?.checked,
                gistId: backupGistInput?.value || '',
                token: backupTokenInput?.value || '',
                fileName: backupFileInput?.value || ''
            });
        }

        if (hasBackupUi) {
            [
                backupEnabledInput,
                backupAutoInput,
                backupGistInput,
                backupTokenInput,
                backupFileInput
            ].forEach(el => {
                const eventName = el.type === 'checkbox' ? 'change' : 'input';
                el.addEventListener(eventName, () => {
                    readBackupSettingsFromPanel();
                });
            });

            backupSendBtn.addEventListener('click', async () => {
                try {
                    let nextSettings = readBackupSettingsFromPanel();
                    setBackupStatus('Enviando backup...');
                    await pushBackupToGist(nextSettings, buildBackupPayload());
                    nextSettings = saveBackupSettings({ ...nextSettings, lastBackupAt: new Date().toISOString() });
                    backupSettings = nextSettings;
                    updateBackupLast(nextSettings);
                    setBackupStatus('Backup enviado.');
                } catch (error) {
                    setBackupStatus(error && error.message ? error.message : 'Falha ao enviar backup.', true);
                }
            });

            backupRestoreBtn.addEventListener('click', async () => {
                try {
                    const nextSettings = readBackupSettingsFromPanel();
                    setBackupStatus('Restaurando backup...');
                    const payload = await readBackupFromGist(nextSettings);
                    const count = applyBackupPayload(payload);
                    setBackupStatus(`Backup restaurado: ${count} nota(s).`);
                } catch (error) {
                    setBackupStatus(error && error.message ? error.message : 'Falha ao restaurar backup.', true);
                }
            });

            backupClearBtn.addEventListener('click', () => {
                const nextSettings = saveBackupSettings(DEFAULT_BACKUP_SETTINGS);
                backupSettings = nextSettings;
                backupEnabledInput.checked = nextSettings.enabled;
                backupAutoInput.checked = nextSettings.autoBackupOnSave;
                backupGistInput.value = nextSettings.gistId;
                backupTokenInput.value = nextSettings.token;
                backupFileInput.value = nextSettings.fileName;
                updateBackupLast(nextSettings);
                setBackupStatus('Configuração de backup removida.');
            });
        }
        updateBackupLast(backupSettings);

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
        scheduleEvaluate(50);
    }

    state.handlers.onPageShow = reviveAfterReturn;
    state.handlers.onFocus = reviveAfterReturn;
    state.handlers.onVisibilityChange = () => {
        if (!document.hidden) reviveAfterReturn();
    };

    window.addEventListener('pageshow', state.handlers.onPageShow, true);
    window.addEventListener('focus', state.handlers.onFocus, true);
    document.addEventListener('visibilitychange', state.handlers.onVisibilityChange);

    function destroy() {
        clearTimeout(state.timer);
        state.timer = null;
        state.scheduled = false;

        try {
            if (state.observer) state.observer.disconnect();
        } catch (_) {}
        state.observer = null;

        try {
            if (state.handlers.onLoad) window.removeEventListener('load', state.handlers.onLoad);
            if (state.handlers.onPageShow) window.removeEventListener('pageshow', state.handlers.onPageShow, true);
            if (state.handlers.onFocus) window.removeEventListener('focus', state.handlers.onFocus, true);
            if (state.handlers.onVisibilityChange) document.removeEventListener('visibilitychange', state.handlers.onVisibilityChange);
        } catch (_) {}

        unmountAll();
    }

    window[INSTANCE_KEY] = { destroy };
})();
