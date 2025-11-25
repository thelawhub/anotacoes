// ==UserScript==
// @name         Projudi - Post-it local
// @namespace    projudi-anotacoes-locais.user.js
// @version      1.5
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
// ==/UserScript==

(function () {
    'use strict';

    // roda só dentro de iframe
    if (window.top === window.self) return;

    const Z_UI = 2147483000;
    const NOTE_PREFIX = 'projudi_note::';

    const state = {
        mounted: false,
        timer: null
    };

    // ------------------ detecção: página de processo (CNJ completo) ------------------

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

    // verifica se há nota não vazia para a página atual
    function hasNonEmptyNoteForCurrentPage() {
        const ctx = getProcessContext();
        if (!ctx) return false;

        const key = storageKey(ctx);
        const html = GM_getValue(key, '');
        if (!html) return false;

        const tmp = document.createElement('div');
        tmp.innerHTML = html;
        const text = (tmp.innerText || '').replace(/\s+/g, '').trim();
        return !!text;
    }

    // ------------------ avaliação da página ------------------

    function evaluate() {
        const ok = isProcessPage(document);

        if (ok && !state.mounted) {
            mountButton();
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

    obs.observe(document.documentElement, { childList: true, subtree: true });

    // ------------------ fonte do ícone (Material Symbols) ------------------

    function ensureMaterialIconsLoaded() {
        if (document.getElementById('pj-material-symbols-link')) return;

        const link = document.createElement('link');
        link.id = 'pj-material-symbols-link';
        link.rel = 'stylesheet';
        link.href = 'https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,400,0,0';
        document.head.appendChild(link);

        const style = document.createElement('style');
        style.textContent = `
        .pj-icon-btn,
        .pj-icon-chip {
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

    // ------------------ toggle da nota a partir do botão flutuante ------------------

    function toggleNoteFromButton() {
        const note = document.getElementById('pj-note');
        const chip = document.getElementById('pj-chip');

        // 1) Se a nota está aberta, o botão passa a "minimizar"
        if (note) {
            note.remove();
            if (!chip) {
                mountChip();
            }
            return;
        }

        // 2) Se está minimizada (chip visível), o botão restauraria,
        // mas como o botão fica oculto enquanto há chip, isso é mais uma proteção.
        if (chip) {
            chip.remove();
            openNote();
            return;
        }

        // 3) Não há nota ainda (nem aberta, nem minimizada) → abre normalmente
        openNote();
    }

    // ------------------ botão principal / chip ------------------

    function mountButton() {
        if (document.getElementById('pj-add-btn')) return;

        ensureMaterialIconsLoaded();

        const btn = document.createElement('button');
        btn.id = 'pj-add-btn';
        btn.className = 'pj-icon-btn';

        const icon = document.createElement('span');
        icon.className = 'material-symbols-outlined';
        icon.textContent = 'note_stack';
        btn.appendChild(icon);

        btn.title = 'Anotações locais desta página';

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

        // se já houver nota com conteúdo, abre automaticamente
        if (hasNonEmptyNoteForCurrentPage()) {
            openNote();
        }
    }

    function mountChip() {
        if (document.getElementById('pj-chip')) return;

        ensureMaterialIconsLoaded();

        const chip = document.createElement('button');
        chip.id = 'pj-chip';
        chip.className = 'pj-icon-chip';

        const icon = document.createElement('span');
        icon.className = 'material-symbols-outlined';
        icon.textContent = 'note_stack';
        chip.appendChild(icon);

        chip.title = 'Mostrar anotações desta página';

        Object.assign(chip.style, {
            position: 'fixed',
            top: '8px',
            left: '8px', // mesmo lugar do botão principal
            zIndex: Z_UI
        });

        chip.addEventListener('click', () => {
            chip.remove();
            openNote();
        });

        document.body.appendChild(chip);

        // quando o chip existe, escondemos o botão principal
        const btn = document.getElementById('pj-add-btn');
        if (btn) btn.style.display = 'none';
    }

    function unmountAll() {
        ['pj-add-btn', 'pj-note', 'pj-chip'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.remove();
        });
        state.mounted = false;
    }

    // ------------------ janela de nota da página ------------------

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

        // quando abre a nota:
        // - garante que o chip suma
        // - garante que o botão principal volte a aparecer
        const chip = document.getElementById('pj-chip');
        if (chip) chip.remove();
        const btn = document.getElementById('pj-add-btn');
        if (btn) btn.style.display = '';

        // cabeçalho
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
        headerTitle.textContent = 'Anotações (página atual)';

        const actions = document.createElement('div');
        Object.assign(actions.style, {
            display: 'flex',
            gap: '6px',
            alignItems: 'center',
            fontSize: '14px',
            fontWeight: '600',
            cursor: 'pointer'
        });

        const panelBtn = document.createElement('span');
        panelBtn.textContent = 'Painel';
        Object.assign(panelBtn.style, {
            fontSize: '12px',
            padding: '2px 6px',
            borderRadius: '6px',
            border: '1px solid rgba(0,0,0,.1)',
            background: '#fef9c3',
            cursor: 'pointer',
            userSelect: 'none'
        });

        const minSpan = document.createElement('span');
        minSpan.textContent = '-';
        minSpan.style.color = '#3a2f00';

        const closeSpan = document.createElement('span');
        closeSpan.textContent = 'x';
        closeSpan.style.color = '#b91c1c';

        actions.append(panelBtn, minSpan, closeSpan);
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
            { t: 'B', c: 'bold' },
            { t: 'I', c: 'italic' },
            { t: 'U', c: 'underline' },
            { t: 'T', c: 'strikeThrough' },
            { t: '<', c: 'justifyLeft' },
            { t: '=', c: 'justifyCenter' },
            { t: '>', c: 'justifyRight' },
            { t: '≡', c: 'justifyFull' }
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
                boxShadow: '0 1px 2px rgba(0,0,0,.06)'
            });
            b.addEventListener('click', () => document.execCommand(c, false, null));
            toolbar.appendChild(b);
        });

        // editor
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
            background: 'transparent'
        });

        editor.addEventListener('input', () => GM_setValue(key, editor.innerHTML));

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
            mountChip();
        });

        closeSpan.addEventListener('click', () => {
            if (confirm('Excluir esta nota?')) {
                GM_deleteValue(key);
                note.remove();
            }
        });

        panelBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            openNotesPanel();
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

            // pula notas totalmente vazias (HTML vazio ou só tags em branco)
            if (!html || !html.replace(/<[^>]*>/g, '').replace(/\s+/g, '').trim()) {
                return;
            }

            const tmp = document.createElement('div');
            tmp.innerHTML = html;
            const text = (tmp.innerText || '').replace(/\s+/g, ' ').trim();
            const preview = text.length > 180 ? text.slice(0, 180) + '…' : text;

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
        subtitle.textContent = 'Atalho: Ctrl + Alt + N (Windows / Linux) · Ctrl + Option + N (macOS)';
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
        previewTitle.textContent = 'Pré-visualização da nota selecionada';
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

        previewBox.textContent = notes.length ? 'Selecione uma nota na lista ao lado.' : 'Nenhuma nota encontrada.';

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
            line3.textContent = n.preview || '(sem conteúdo)';
            Object.assign(line3.style, {
                fontSize: '11px',
                color: '#4b5563',
                marginTop: '4px'
            });

            // botão de excluir dentro do item
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
                    previewBox.textContent = 'Nota excluída.\nSelecione outra nota.';
                }

                item.remove();
                refreshEmptyStateAfterDelete();
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
      Use o botão Exportar para gerar um JSON com todas as notas.<br>
      Cole um JSON válido no campo abaixo e clique em Importar para restaurar.
    `;

        const textarea = document.createElement('textarea');
        textarea.placeholder = 'JSON das notas aqui...';
        Object.assign(textarea.style, {
            flex: '1',
            resize: 'vertical',
            minHeight: '80px',
            fontFamily: 'monospace',
            fontSize: '11px',
            padding: '6px',
            borderRadius: '6px',
            border: '1px solid #d1d5db'
        });

        const btnRow = document.createElement('div');
        Object.assign(btnRow.style, {
            display: 'flex',
            gap: '6px',
            marginTop: '4px'
        });

        function makeSmallButton(label) {
            const b = document.createElement('button');
            b.textContent = label;
            Object.assign(b.style, {
                flex: '1',
                borderRadius: '6px',
                border: 'none',
                cursor: 'pointer',
                padding: '6px 8px',
                fontSize: '12px',
                fontWeight: '500',
                background: '#111827',
                color: '#f9fafb'
            });
            return b;
        }

        const exportBtn = makeSmallButton('Exportar');
        const importBtn = makeSmallButton('Importar');

        exportBtn.addEventListener('click', () => {
            const freshNotes = getAllNotes();
            const payload = JSON.stringify({
                version: 1,
                exportedAt: new Date().toISOString(),
                notes: freshNotes.map(n => ({
                    key: n.key,
                    cnj: n.cnj,
                    subkey: n.subkey,
                    html: n.html
                }))
            }, null, 2);

            textarea.value = payload;

            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(payload).catch(() => {
                    // silencioso
                });
            }
        });

        importBtn.addEventListener('click', () => {
            const txt = textarea.value.trim();
            if (!txt) {
                alert('Cole o JSON das notas para importar.');
                return;
            }

            let parsed;
            try {
                parsed = JSON.parse(txt);
            } catch (e) {
                alert('JSON inválido.');
                return;
            }

            const arr = Array.isArray(parsed) ? parsed : parsed.notes;
            if (!Array.isArray(arr)) {
                alert('Formato inválido.\nEsperado campo "notes" como array.');
                return;
            }

            let count = 0;
            arr.forEach(n => {
                if (n && typeof n.key === 'string' && typeof n.html === 'string') {
                    GM_setValue(n.key, n.html);
                    count++;
                }
            });

            alert(`${count} nota(s) importada(s).\nA lista será recarregada.`);
            overlay.remove();
            openNotesPanel(); // reabre já com as novas notas
        });

        btnRow.append(exportBtn, importBtn);
        rightBody.append(info, textarea, btnRow);
        right.append(rightHeader, rightBody);

        body.append(left, right);
        panel.append(header, body);
        overlay.appendChild(panel);
        document.body.appendChild(overlay);

        closeBtn.addEventListener('click', () => overlay.remove());
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) overlay.remove();
        });
    }

    function toggleNotesPanel() {
        const existing = document.getElementById('pj-notes-panel');
        if (existing) {
            existing.remove();
        } else {
            openNotesPanel();
        }
    }

    // ------------------ utilitárias: drag / resize ------------------

    function makeDraggable(el, handle) {
        let sx, sy, sl, st, dragging = false;

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
    }

    function makeResizable(el, grip) {
        let sx, sy, sw, sh, resizing = false;

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
    }

    // ------------------ atalho de teclado: Ctrl + Alt/Option + N ------------------

    window.addEventListener('keydown', e => {
        // evita conflito quando estiver digitando em inputs/textareas
        const t = e.target;
        const tag = (t && t.tagName) ? t.tagName.toUpperCase() : '';
        const isEditable = t && (t.isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT');
        if (isEditable) return;

        // Windows/Linux: Ctrl + Alt + N
        // macOS: Ctrl + Option + N (Option aciona altKey)
        if (e.ctrlKey && e.altKey && !e.shiftKey && String(e.key).toLowerCase() === 'n') {
            e.preventDefault();
            toggleNotesPanel();
        }
    });

})();