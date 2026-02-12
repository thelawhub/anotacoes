// ==UserScript==
// @name         Post-it local
// @namespace    projudi-anotacoes-locais.user.js
// @version      1.7
// @icon         https://img.icons8.com/ios-filled/100/scales--v1.png
// @description  Adiciona Post-it local ao Projudi, com painel de notas, importação e exportação.
// @author       lourencosv (GPT)
// @license      CC BY-NC 4.0
// @updateURL    https://gist.githubusercontent.com/lourencosv/3fd541d959eb6e4cd0f96e30dda5c4d7/raw/projudi-anotacoes-locais.user.js
// @downloadURL  https://gist.githubusercontent.com/lourencosv/3fd541d959eb6e4cd0f96e30dda5c4d7/raw/projudi-anotacoes-locais.user.js
// @match        https://projudi.tjgo.jus.br/*
// @run-at       document-end
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_listValues
// @grant        GM_deleteValue
// @grant        GM_registerMenuCommand
// ==/UserScript==

(function () {
    'use strict';

    // roda so dentro de iframe
    if (window.top === window.self) return;

    const Z_UI = 2147483000;
    const NOTE_PREFIX = 'projudi_note::';

    const state = {
        mounted: false,
        timer: null,
        menuRegistered: false
    };

    // ------------------ deteccao: pagina de processo (CNJ completo) ------------------

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

    // ------------------ resolucao de nota p/ pagina (com fallback por CNJ) ------------------

    function resolveNoteForCurrentPage() {
        const ctx = getProcessContext();
        if (!ctx) return null;

        // chave "exata" (CNJ + subkey / URL)
        let key = storageKey(ctx);
        let html = GM_getValue(key, null);

        if (html === null || typeof html === 'undefined') {
            // fallback: qualquer nota com o mesmo CNJ, ignorando o subkey
            const prefixForCnj = `${NOTE_PREFIX}${ctx.key}::`;
            const keys = (typeof GM_listValues === 'function') ? GM_listValues() : [];
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

    // verifica se ha nota nao vazia para a pagina atual (usando fallback)
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

    // ------------------ avaliacao da pagina ------------------

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

    // ------------------ fonte do icone (Material Symbols) ------------------

    function ensureMaterialIconsLoaded() {
        if (document.getElementById('pj-material-symbols-link')) return;

        const link = document.createElement('link');
        link.id = 'pj-material-symbols-link';
        link.rel = 'stylesheet';
        link.href = 'https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,400,0,0';
        document.head.appendChild(link);

        const style = document.createElement('style');
        style.textContent = `
            .pj-icon-btn {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                border-radius: 999px;
                border: none;
                cursor: pointer;
                box-shadow: 0 2px 6px rgba(0,0,0,.2);
                background: #0056b3;
                color: #fff;
                padding: 0;
                box-sizing: border-box;
                width: 36px;
                height: 36px;
                position: relative;
            }
            .pj-note-badge {
                position: absolute;
                top: -4px;
                right: -4px;
                min-width: 16px;
                height: 16px;
                border-radius: 999px;
                background: #dc2626;
                color: #fff;
                font: 700 11px/16px system-ui, sans-serif;
                text-align: center;
                border: 1px solid #fff;
                box-shadow: 0 1px 3px rgba(0,0,0,.3);
                pointer-events: none;
            }
            .material-symbols-outlined {
                font-family: 'Material Symbols Outlined';
                font-weight: normal;
                font-style: normal;
                font-size: 22px;
                line-height: 1;
                letter-spacing: normal;
                text-transform: none;
                display: inline-block;
                white-space: nowrap;
                word-wrap: normal;
                direction: ltr;
                -webkit-font-feature-settings: 'liga';
                -webkit-font-smoothing: antialiased;
            }
        `;
        document.head.appendChild(style);
    }

    // ------------------ menu da extensao ------------------

    function ensureMenuRegistered() {
        if (state.menuRegistered) return;
        if (typeof GM_registerMenuCommand !== 'function') return;

        GM_registerMenuCommand('Abrir Painel', () => {
            openNotesPanel();
        });
        state.menuRegistered = true;
    }

    // ------------------ toggle da nota a partir do botao flutuante ------------------

    function toggleNoteFromButton() {
        const note = document.getElementById('pj-note');

        if (note) {
            note.remove();
            return;
        }

        openNote();
    }

    // ------------------ botao principal ------------------

    function mountButton() {
        if (document.getElementById('pj-add-btn')) return;

        ensureMaterialIconsLoaded();
        ensureMenuRegistered();

        const btn = document.createElement('button');
        btn.id = 'pj-add-btn';
        btn.className = 'pj-icon-btn';

        const icon = document.createElement('span');
        icon.className = 'material-symbols-outlined';
        icon.textContent = 'note_stack';

        btn.appendChild(icon);
        btn.title = 'Anotacoes locais desta pagina';

        Object.assign(btn.style, {
            position: 'fixed',
            top: '8px',
            left: '8px',
            zIndex: Z_UI,
            outline: 'none'
        });

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
            badge.className = 'pj-note-badge';
            badge.textContent = '!';
            badge.title = 'Ha nota neste processo';
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
        state.mounted = false;
    }

    // ------------------ janela de nota da pagina ------------------

    function openNote() {
        if (document.getElementById('pj-note')) return;

        const resolved = resolveNoteForCurrentPage();
        if (!resolved) return;

        const { key, html } = resolved;
        const saved = html || '';

        const note = document.createElement('div');
        note.id = 'pj-note';

        Object.assign(note.style, {
            position: 'fixed',
            top: '60px',
            left: '60px',
            width: '340px',
            height: '260px',
            minWidth: '260px',
            minHeight: '140px',
            background: '#fffce1',
            border: '1px solid rgba(0,0,0,.15)',
            borderRadius: '10px',
            boxShadow: '0 8px 18px rgba(0,0,0,.25)',
            zIndex: Z_UI + 1,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden'
        });

        // cabecalho
        const header = document.createElement('div');
        Object.assign(header.style, {
            background: '#ffeb8a',
            padding: '6px 8px',
            font: '13px system-ui,sans-serif',
            color: '#4d3d00',
            cursor: 'move',
            userSelect: 'none',
            position: 'relative',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '6px'
        });

        const headerTitle = document.createElement('div');
        headerTitle.textContent = 'Anotacoes (pagina atual)';

        const actions = document.createElement('div');
        Object.assign(actions.style, {
            display: 'flex',
            gap: '6px',
            alignItems: 'center',
            fontSize: '14px',
            fontWeight: '600',
            cursor: 'pointer'
        });

        const minSpan = document.createElement('span');
        minSpan.textContent = '-';
        minSpan.style.color = '#3a2f00';

        const closeSpan = document.createElement('span');
        closeSpan.textContent = 'x';
        closeSpan.style.color = '#b91c1c';

        actions.append(minSpan, closeSpan);
        header.append(headerTitle, actions);

        // toolbar
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
            zIndex: Z_UI + 2
        });

        const cmds = [
            { icon: 'format_bold', cmd: 'bold', title: 'Negrito' },
            { icon: 'format_italic', cmd: 'italic', title: 'Italico' },
            { icon: 'format_underlined', cmd: 'underline', title: 'Sublinhado' },
            { icon: 'strikethrough_s', cmd: 'strikeThrough', title: 'Riscado' },
            { icon: 'format_align_left', cmd: 'justifyLeft', title: 'Alinhar a esquerda' },
            { icon: 'format_align_center', cmd: 'justifyCenter', title: 'Centralizar' },
            { icon: 'format_align_right', cmd: 'justifyRight', title: 'Alinhar a direita' },
            { icon: 'format_align_justify', cmd: 'justifyFull', title: 'Justificar' }
        ];

        cmds.forEach(({ icon, cmd, title }) => {
            const b = document.createElement('button');
            Object.assign(b.style, {
                width: '30px',
                height: '30px',
                background: '#fff',
                border: '1px solid #cbd5e1',
                borderRadius: '6px',
                cursor: 'pointer',
                color: '#222',
                boxShadow: '0 1px 2px rgba(0,0,0,.06)',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '0'
            });
            b.title = title;

            const i = document.createElement('span');
            i.className = 'material-symbols-outlined';
            i.style.fontSize = '20px';
            i.textContent = icon;
            b.appendChild(i);

            b.addEventListener('click', () => document.execCommand(cmd, false, null));
            toolbar.appendChild(b);
        });

        // editor
        const editor = document.createElement('div');
        editor.contentEditable = 'true';
        editor.innerHTML = saved;
        Object.assign(editor.style, {
            flex: '1',
            padding: '8px',
            outline: 'none',
            overflowY: 'auto',
            font: '13px/1.4 system-ui, sans-serif',
            color: '#3a2f00',
            background: 'transparent'
        });

        editor.addEventListener('input', () => {
            GM_setValue(key, editor.innerHTML);
            updateNoteIndicator();
        });

        // grip de resize
        const grip = document.createElement('div');
        Object.assign(grip.style, {
            position: 'absolute',
            right: '0',
            bottom: '0',
            width: '14px',
            height: '14px',
            cursor: 'se-resize',
            background: 'linear-gradient(135deg, transparent 50%, rgba(0,0,0,.35) 50%)',
            opacity: '.35'
        });

        makeDraggable(note, header);
        makeResizable(note, grip);

        minSpan.addEventListener('click', () => {
            note.remove();
        });

        closeSpan.addEventListener('click', () => {
            if (confirm('Excluir esta nota?')) {
                GM_deleteValue(key);
                note.remove();
                updateNoteIndicator();
            }
        });

        note.append(header, toolbar, editor, grip);
        document.body.appendChild(note);
    }

    // ------------------ painel de notas (todas as notas) ------------------

    function getAllNotes() {
        const keys = (typeof GM_listValues === 'function') ? GM_listValues() : [];
        const result = [];

        keys.forEach(key => {
            if (!key.startsWith(NOTE_PREFIX)) return;

            const rest = key.slice(NOTE_PREFIX.length); // cnj_xxx::subkey
            const parts = rest.split('::');
            if (parts.length < 2) return;

            const ctxKey = parts[0];
            const subkey = parts.slice(1).join('::');
            const cnj = ctxKey.replace(/^cnj_/, '');

            const html = GM_getValue(key, '');

            // pula notas totalmente vazias (HTML vazio ou so tags em branco)
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
        if (document.getElementById('pj-notes-panel')) return;

        const notes = getAllNotes();

        const overlay = document.createElement('div');
        overlay.id = 'pj-notes-panel';
        Object.assign(overlay.style, {
            position: 'fixed',
            inset: '0',
            background: 'rgba(15,23,42,.55)',
            zIndex: Z_UI + 20,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
        });

        const panel = document.createElement('div');
        Object.assign(panel.style, {
            width: 'min(900px, 90vw)',
            maxHeight: '80vh',
            background: '#f9fafb',
            borderRadius: '12px',
            boxShadow: '0 20px 40px rgba(0,0,0,.35)',
            display: 'flex',
            flexDirection: 'column',
            font: '13px system-ui, sans-serif',
            overflow: 'hidden'
        });

        // header
        const header = document.createElement('div');
        Object.assign(header.style, {
            padding: '10px 14px',
            background: '#111827',
            color: '#e5e7eb',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between'
        });

        const titleWrapper = document.createElement('div');

        const title = document.createElement('div');
        title.textContent = 'Notas locais do Projudi';

        const subtitle = document.createElement('div');
        subtitle.textContent = 'Acesso pelo menu da extensao (Tampermonkey).';
        Object.assign(subtitle.style, {
            fontSize: '11px',
            color: '#9ca3af',
            marginTop: '2px'
        });

        titleWrapper.appendChild(title);
        titleWrapper.appendChild(subtitle);

        const closeBtn = document.createElement('button');
        closeBtn.textContent = '✕';
        Object.assign(closeBtn.style, {
            border: 'none',
            background: 'transparent',
            color: '#f9fafb',
            cursor: 'pointer',
            fontSize: '16px'
        });

        header.appendChild(titleWrapper);
        header.appendChild(closeBtn);

        // corpo
        const body = document.createElement('div');
        Object.assign(body.style, {
            display: 'flex',
            flex: '1',
            minHeight: '260px'
        });

        const left = document.createElement('div');
        Object.assign(left.style, {
            flex: '3',
            borderRight: '1px solid #e5e7eb',
            display: 'flex',
            flexDirection: 'column'
        });

        const right = document.createElement('div');
        Object.assign(right.style, {
            flex: '2',
            display: 'flex',
            flexDirection: 'column'
        });

        // --- lado esquerdo: lista de notas + preview ---

        const leftHeader = document.createElement('div');
        leftHeader.textContent = 'Notas salvas';
        Object.assign(leftHeader.style, {
            padding: '8px 10px',
            borderBottom: '1px solid #e5e7eb',
            fontWeight: '600',
            background: '#f3f4f6'
        });

        const listContainer = document.createElement('div');
        Object.assign(listContainer.style, {
            flex: '1',
            overflowY: 'auto',
            padding: '6px 8px',
            gap: '6px',
            display: 'flex',
            flexDirection: 'column'
        });

        const previewTitle = document.createElement('div');
        previewTitle.textContent = 'Pre-visualizacao da nota selecionada';
        Object.assign(previewTitle.style, {
            padding: '6px 8px 0',
            fontSize: '11px',
            color: '#6b7280'
        });

        const previewBox = document.createElement('div');
        Object.assign(previewBox.style, {
            margin: '4px 8px 8px',
            borderRadius: '8px',
            background: '#fff',
            border: '1px solid #e5e7eb',
            padding: '8px',
            minHeight: '80px',
            maxHeight: '140px',
            overflowY: 'auto',
            fontSize: '12px',
            color: '#374151'
        });

        previewBox.textContent = notes.length
            ? 'Selecione uma nota na lista ao lado.'
            : 'Nenhuma nota encontrada.';

        let selectedKey = null;

        function refreshEmptyStateAfterDelete() {
            if (!listContainer.children.length) {
                previewBox.textContent = 'Nenhuma nota encontrada.';
            } else if (!selectedKey) {
                previewBox.textContent = 'Selecione uma nota na lista ao lado.';
            }
        }

        notes.forEach(n => {
            const item = document.createElement('div');
            Object.assign(item.style, {
                borderRadius: '8px',
                border: '1px solid #e5e7eb',
                background: '#fff',
                padding: '6px 8px',
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                gap: '2px',
                position: 'relative'
            });

            item.addEventListener('mouseenter', () => {
                if (selectedKey === n.key) return;
                item.style.background = '#f9fafb';
            });

            item.addEventListener('mouseleave', () => {
                if (selectedKey === n.key) {
                    item.style.background = '#eff6ff';
                } else {
                    item.style.background = '#fff';
                }
            });

            item.addEventListener('click', () => {
                selectedKey = n.key;

                // reset background de todos
                [...listContainer.children].forEach(child => {
                    child.style.background = '#fff';
                });
                item.style.background = '#eff6ff';

                previewBox.innerHTML = n.html || '(Nota vazia)';
            });

            const line1 = document.createElement('div');
            line1.textContent = n.cnj || '(sem CNJ)';
            Object.assign(line1.style, {
                fontWeight: '600',
                fontSize: '12px',
                color: '#111827'
            });

            const line2 = document.createElement('div');
            line2.textContent = n.subkey || '';
            Object.assign(line2.style, {
                fontSize: '11px',
                color: '#6b7280'
            });

            const line3 = document.createElement('div');
            line3.textContent = n.preview || '(sem conteudo)';
            Object.assign(line3.style, {
                fontSize: '11px',
                color: '#4b5563',
                marginTop: '4px'
            });

            // botao de excluir dentro do item
            const deleteBtn = document.createElement('button');
            deleteBtn.textContent = 'Excluir';
            Object.assign(deleteBtn.style, {
                position: 'absolute',
                top: '4px',
                right: '6px',
                border: 'none',
                borderRadius: '6px',
                padding: '2px 6px',
                fontSize: '11px',
                cursor: 'pointer',
                background: '#fee2e2',
                color: '#b91c1c'
            });

            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (!confirm('Excluir esta nota?')) return;

                GM_deleteValue(n.key);

                if (selectedKey === n.key) {
                    selectedKey = null;
                    previewBox.textContent = 'Nota excluida.\nSelecione outra nota.';
                }

                item.remove();
                refreshEmptyStateAfterDelete();
                updateNoteIndicator();
            });

            item.append(line1, line2, line3, deleteBtn);
            listContainer.appendChild(item);
        });

        left.append(leftHeader, listContainer, previewTitle, previewBox);

        // --- lado direito: import/export ---

        const rightHeader = document.createElement('div');
        rightHeader.textContent = 'Importar / Exportar';
        Object.assign(rightHeader.style, {
            padding: '8px 10px',
            borderBottom: '1px solid #e5e7eb',
            fontWeight: '600',
            background: '#f3f4f6'
        });

        const rightBody = document.createElement('div');
        Object.assign(rightBody.style, {
            padding: '8px',
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
            flex: '1'
        });

        const info = document.createElement('div');
        info.innerHTML = `
            Use o botao <strong>Exportar</strong> para gerar um JSON com todas as notas.<br>
            Cole um JSON valido no campo abaixo e clique em <strong>Importar</strong> para restaurar.
        `;
        Object.assign(info.style, {
            fontSize: '11px',
            color: '#4b5563'
        });

        const textarea = document.createElement('textarea');
        Object.assign(textarea.style, {
            flex: '1',
            width: '100%',
            resize: 'vertical',
            minHeight: '80px',
            fontFamily: 'monospace',
            fontSize: '11px',
            border: '1px solid #e5e7eb',
            borderRadius: '6px',
            padding: '6px',
            boxSizing: 'border-box'
        });

        const buttonsRow = document.createElement('div');
        Object.assign(buttonsRow.style, {
            display: 'flex',
            gap: '6px',
            marginTop: '4px'
        });

        const btnExport = document.createElement('button');
        btnExport.textContent = 'Exportar notas';
        Object.assign(btnExport.style, {
            flex: '1',
            padding: '6px 8px',
            borderRadius: '6px',
            border: 'none',
            background: '#2563eb',
            color: '#ffffff',
            cursor: 'pointer',
            fontSize: '12px',
            fontWeight: '600',
            boxShadow: '0 1px 2px rgba(0,0,0,.15)'
        });

        const btnImport = document.createElement('button');
        btnImport.textContent = 'Importar notas';
        Object.assign(btnImport.style, {
            flex: '1',
            padding: '6px 8px',
            borderRadius: '6px',
            border: 'none',
            background: '#16a34a',
            color: '#ffffff',
            cursor: 'pointer',
            fontSize: '12px',
            fontWeight: '600',
            boxShadow: '0 1px 2px rgba(0,0,0,.15)'
        });

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
                alert('Cole um JSON para importar.');
                return;
            }

            let parsed;
            try {
                parsed = JSON.parse(raw);
            } catch (e) {
                alert('JSON invalido.');
                return;
            }

            if (!Array.isArray(parsed)) {
                alert('Formato invalido: esperado um array de notas.');
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
            alert(`Importacao concluida. ${count} nota(s) importada(s). Reabra o painel para ver a lista atualizada.`);
        });

        buttonsRow.append(btnExport, btnImport);
        rightBody.append(info, textarea, buttonsRow);
        right.append(rightHeader, rightBody);

        body.append(left, right);
        panel.append(header, body);
        overlay.appendChild(panel);
        document.body.appendChild(overlay);

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                overlay.remove();
            }
        });

        closeBtn.addEventListener('click', () => {
            overlay.remove();
        });
    }

    // ------------------ utilitarios: drag / resize ------------------

    function makeDraggable(el, handle) {
        let startX = 0;
        let startY = 0;
        let startLeft = 0;
        let startTop = 0;
        let dragging = false;

        handle.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
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

            // limites basicos da viewport
            const maxLeft = window.innerWidth - el.offsetWidth;
            const maxTop = window.innerHeight - el.offsetHeight;

            newLeft = Math.max(0, Math.min(maxLeft, newLeft));
            newTop = Math.max(0, Math.min(maxTop, newTop));

            el.style.left = newLeft + 'px';
            el.style.top = newTop + 'px';
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

        grip.addEventListener('mousedown', (e) => {
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
            const newW = Math.max(260, startW + dx);
            const newH = Math.max(140, startH + dy);
            el.style.width = newW + 'px';
            el.style.height = newH + 'px';
        }

        function onUp() {
            resizing = false;
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
        }

        el.appendChild(grip);
    }

})();