// viewer.js — DataLock File Viewer & Editor
// CDN scripts are lazy-loaded per file type for fast startup.

const urlParams = new URLSearchParams(window.location.search);
const fileId = urlParams.get('file_id');
const workspaceDocId = urlParams.get('workspace_doc_id');
const mode = urlParams.get('mode') === 'edit' ? 'edit' : 'view';
let currentFile = null;
let isWorkspaceDoc = !!workspaceDocId;

// Editor instances
let documentEditorInstance = null;
let jsonEditorInstance = null;
let imageEditorInstance = null;
let currentExcelWorkbook = null;
let activeSheetIndex = 0;
let selectedCell = null;

// ═══════════════════════════════════════════════════════════
// LAZY SCRIPT LOADER
// ═══════════════════════════════════════════════════════════

const _loadedScripts = {};
function loadScript(src) {
    if (_loadedScripts[src]) return _loadedScripts[src];
    _loadedScripts[src] = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = src;
        s.onload = resolve;
        s.onerror = () => reject(new Error('Failed to load: ' + src));
        document.head.appendChild(s);
    });
    return _loadedScripts[src];
}
function loadCSS(href) {
    if (document.querySelector(`link[href="${href}"]`)) return Promise.resolve();
    return new Promise((resolve) => {
        const link = document.createElement('link');
        link.rel = 'stylesheet'; link.href = href;
        link.onload = resolve;
        document.head.appendChild(link);
    });
}

// ═══════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', async () => {
    if (!fileId && !workspaceDocId) { showError('No file ID provided.'); return; }

    const badge = document.getElementById('mode-badge');
    badge.textContent = mode === 'edit' ? 'Edit Mode' : 'Read-Only View';
    badge.className = `mode-badge ${mode}`;
    if (mode === 'edit') document.getElementById('btn-save').style.display = 'block';

    try {
        // Determine the download URL based on whether it's a workspace doc or regular file
        const downloadUrl = isWorkspaceDoc
            ? `/workspace/documents/${workspaceDocId}/download`
            : `/files/download/${fileId}`;

        const res = await apiFetch(downloadUrl);
        if (!res.ok) {
            let errMsg = 'Failed to load file.';
            try { const d = await res.json(); errMsg = d.error || errMsg; } catch(e) {}
            throw new Error(errMsg);
        }

        const disposition = res.headers.get('Content-Disposition');
        let filename = 'Document';
        if (disposition && disposition.indexOf('filename=') !== -1) {
            const matches = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/.exec(disposition);
            if (matches != null && matches[1]) filename = matches[1].replace(/['"]/g, '');
        }

        document.getElementById('header-filename').textContent = filename;
        const fileExt = filename.split('.').pop().toLowerCase();
        const blob = await res.blob();
        document.getElementById('header-meta').textContent = `${formatBytes(blob.size)} · ${fileExt.toUpperCase()}`;
        document.getElementById('loading-spinner').style.display = 'none';

        initFileInterface(blob, fileExt, filename);
    } catch (err) {
        showError(err.message);
    }
});

// ═══════════════════════════════════════════════════════════
// FILE TYPE ROUTER
// ═══════════════════════════════════════════════════════════

async function initFileInterface(blob, ext, filename) {
    const isImage = ['jpg','jpeg','png','webp','bmp'].includes(ext);
    const isPdf = ext === 'pdf';
    const isExcel = ['xlsx','xls','csv'].includes(ext);
    const isWord = ['docx','doc'].includes(ext);
    const isJson = ['json','900','tsf'].includes(ext);

    if (isImage) await initImageEditor(blob, ext, filename);
    else if (isPdf) await initPdfViewer(blob, ext);
    else if (isExcel) initSpreadsheetEditor(blob, ext);
    else if (isWord) initWordEditor(blob, ext);
    else if (isJson) await initJsonEditor(blob);
    else initTextEditor(blob);
}

// ═══════════════════════════════════════════════════════════
// WORD / DOCUMENT EDITOR
// ═══════════════════════════════════════════════════════════

async function initWordEditor(blob, ext) {
    console.log('[Viewer] initWordEditor called, mode:', mode);

    document.getElementById('document-container').style.display = 'flex';

    const arrayBuffer = await blob.arrayBuffer();
    const contentDiv = document.getElementById('document-content');
    const textarea = document.getElementById('document-content-textarea');

    try {
        const result = await mammoth.convertToHtml({ arrayBuffer });

        console.log('[Viewer] Mammoth HTML:', result.value);

        // ✅ Use Mammoth HTML or empty string if document is empty
        const htmlContent = result.value || '';

        // ✅ Always use CKEditor
        contentDiv.style.display = 'none';
        textarea.style.display = 'block';

        // IMPORTANT: set content to textarea before init (fallback)
        textarea.value = htmlContent;

        // Destroy old instance if exists
        if (documentEditorInstance) {
            await documentEditorInstance.destroy();
            documentEditorInstance = null;
        }

        documentEditorInstance = await ClassicEditor.create(document.querySelector('#document-content-textarea'), {
            initialData: htmlContent,
            toolbar: [
                'undo', 'redo', '|', 'heading', '|', 'bold', 'italic', '|',
                'link', 'bulletedList', 'numberedList', 'blockQuote'
            ]
        });

        if (mode === 'view') {
            documentEditorInstance.enableReadOnlyMode('viewer');
            // Hide toolbar in view mode
            const toolbarElement = documentEditorInstance.ui.view.toolbar.element;
            if (toolbarElement) {
                toolbarElement.style.display = 'none';
            }
        }

        console.log('[Viewer] CKEditor init completed');

    } catch (e) {
        console.error('[Viewer] Word editor failed:', e);

        // ✅ fallback editor
        contentDiv.style.display = 'block';
        textarea.style.display = 'none';

        contentDiv.innerHTML = "<p style='color:red'>⚠️ Failed to load editor. Showing raw content.</p>";
        if (mode === 'edit') contentDiv.setAttribute('contenteditable', 'true');
    }
}

// ═══════════════════════════════════════════════════════════
// SPREADSHEET EDITOR
// ═══════════════════════════════════════════════════════════

async function initSpreadsheetEditor(blob, ext) {
    document.getElementById('spreadsheet-container').style.display = 'flex';
    try {
        const arrayBuffer = await blob.arrayBuffer();
        currentExcelWorkbook = XLSX.read(new Uint8Array(arrayBuffer), { type: 'array' });
        if (!currentExcelWorkbook.SheetNames || currentExcelWorkbook.SheetNames.length === 0) {
            throw new Error("No sheets found.");
        }
        if (mode === 'edit') {
            document.getElementById('spreadsheet-formula-bar').style.display = 'flex';
        }
        renderSpreadsheetTabs();
        renderSpreadsheetGrid(0);
    } catch (e) {
        showError("Failed to parse spreadsheet. Error: " + e.message, true);
    }
}

function renderSpreadsheetTabs() {
    const tabsEl = document.getElementById('spreadsheet-tabs');
    tabsEl.innerHTML = currentExcelWorkbook.SheetNames.map((name, i) =>
        `<button class="editor-tab ${i === 0 ? 'active' : ''}" onclick="switchSheet(${i})">${escHtml(name)}</button>`
    ).join('');
    if (mode === 'edit') {
        tabsEl.innerHTML += `<button class="btn btn-sm btn-ghost" onclick="addSheetRow()" style="margin-left: auto;">+ Row</button>`;
        tabsEl.innerHTML += `<button class="btn btn-sm btn-ghost" onclick="addSheetCol()">+ Col</button>`;
    }
}

function switchSheet(index) {
    activeSheetIndex = index;
    selectedCell = null;
    document.querySelectorAll('.editor-tab').forEach((t, i) => t.classList.toggle('active', i === index));
    renderSpreadsheetGrid(index);
    updateFormulaBar();
}

function colLetter(c) {
    let s = ''; c++;
    while (c > 0) { c--; s = String.fromCharCode(65 + (c % 26)) + s; c = Math.floor(c / 26); }
    return s;
}

function renderSpreadsheetGrid(index) {
    const ws = currentExcelWorkbook.Sheets[currentExcelWorkbook.SheetNames[index]];
    const gridEl = document.getElementById('spreadsheet-grid');

    if (mode === 'edit') {
        const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
        const rowCount = Math.max(data.length, 20);
        const colCount = Math.max(...data.map(r => r.length), 10);

        let html = '<table><thead><tr><th class="corner"></th>';
        for (let c = 0; c < colCount; c++) html += `<th>${colLetter(c)}</th>`;
        html += '</tr></thead><tbody>';

        for (let r = 0; r < rowCount; r++) {
            html += `<tr><td class="row-header">${r + 1}</td>`;
            for (let c = 0; c < colCount; c++) {
                const val = (data[r] && data[r][c] !== undefined) ? data[r][c] : '';
                const escaped = escHtml(String(val));
                html += `<td class="cell" data-r="${r}" data-c="${c}" onclick="selectCell(this)" ondblclick="editCell(this)">${escaped}</td>`;
            }
            html += '</tr>';
        }
        html += '</tbody></table>';
        gridEl.innerHTML = html;
    } else {
        gridEl.innerHTML = XLSX.utils.sheet_to_html(ws);
    }
}

function selectCell(td) {
    document.querySelectorAll('#spreadsheet-grid td.cell.selected').forEach(el => el.classList.remove('selected'));
    td.classList.add('selected');
    selectedCell = { r: parseInt(td.dataset.r), c: parseInt(td.dataset.c) };
    updateFormulaBar();
}

function editCell(td) {
    if (mode !== 'edit') return;
    const prev = document.querySelector('#spreadsheet-grid td.cell.editing');
    if (prev && prev !== td) commitCellEdit(prev);

    td.classList.add('editing');
    td.setAttribute('contenteditable', 'true');
    td.focus();

    const range = document.createRange();
    range.selectNodeContents(td);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);

    td._originalValue = td.textContent;
    td.onkeydown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitCellEdit(td); moveCellSelection(1, 0); }
        else if (e.key === 'Tab') { e.preventDefault(); commitCellEdit(td); moveCellSelection(0, e.shiftKey ? -1 : 1); }
        else if (e.key === 'Escape') { td.textContent = td._originalValue || ''; commitCellEdit(td); }
    };

    const fi = document.getElementById('formula-input');
    if (fi) { fi.value = td.textContent; fi.oninput = () => { td.textContent = fi.value; }; }
}

function commitCellEdit(td) {
    td.classList.remove('editing');
    td.removeAttribute('contenteditable');
    td.onkeydown = null;

    const r = parseInt(td.dataset.r), c = parseInt(td.dataset.c);
    const ws = currentExcelWorkbook.Sheets[currentExcelWorkbook.SheetNames[activeSheetIndex]];
    const cellRef = XLSX.utils.encode_cell({ r, c });
    const val = td.textContent.trim();

    if (val === '') { delete ws[cellRef]; }
    else {
        const num = Number(val);
        ws[cellRef] = (!isNaN(num) && val !== '') ? { t: 'n', v: num } : { t: 's', v: val };
    }

    const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
    if (r > range.e.r) range.e.r = r;
    if (c > range.e.c) range.e.c = c;
    ws['!ref'] = XLSX.utils.encode_range(range);
}

function moveCellSelection(dr, dc) {
    if (!selectedCell) return;
    const newR = Math.max(0, selectedCell.r + dr);
    const newC = Math.max(0, selectedCell.c + dc);
    const td = document.querySelector(`#spreadsheet-grid td.cell[data-r="${newR}"][data-c="${newC}"]`);
    if (td) { selectCell(td); editCell(td); }
}

function updateFormulaBar() {
    const refEl = document.getElementById('formula-cell-ref');
    const inputEl = document.getElementById('formula-input');
    if (!refEl || !inputEl) return;
    if (selectedCell) {
        refEl.textContent = `${XLSX.utils.encode_col(selectedCell.c)}${selectedCell.r + 1}`;
        const td = document.querySelector(`#spreadsheet-grid td.cell[data-r="${selectedCell.r}"][data-c="${selectedCell.c}"]`);
        inputEl.value = td ? td.textContent : '';
    } else {
        refEl.textContent = '—'; inputEl.value = '';
    }
}

function addSheetRow() {
    const tbody = document.querySelector('#spreadsheet-grid table tbody');
    if (!tbody) return;
    const colCount = tbody.rows[0] ? tbody.rows[0].cells.length - 1 : 10;
    const rowIndex = tbody.rows.length;
    const tr = document.createElement('tr');
    tr.innerHTML = `<td class="row-header">${rowIndex + 1}</td>`;
    for (let i = 0; i < colCount; i++) {
        tr.innerHTML += `<td class="cell" data-r="${rowIndex}" data-c="${i}" onclick="selectCell(this)" ondblclick="editCell(this)"></td>`;
    }
    tbody.appendChild(tr);
}

function addSheetCol() {
    const table = document.querySelector('#spreadsheet-grid table');
    if (!table) return;
    const thead = table.querySelector('thead tr');
    const colIndex = thead.cells.length - 1;
    thead.innerHTML += `<th>${colLetter(colIndex)}</th>`;
    table.querySelectorAll('tbody tr').forEach((row, rIdx) => {
        row.innerHTML += `<td class="cell" data-r="${rIdx}" data-c="${colIndex}" onclick="selectCell(this)" ondblclick="editCell(this)"></td>`;
    });
}

// Formula bar Enter key
document.addEventListener('DOMContentLoaded', () => {
    const fi = document.getElementById('formula-input');
    if (fi) {
        fi.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                const editingTd = document.querySelector('#spreadsheet-grid td.cell.editing');
                if (editingTd) { editingTd.textContent = fi.value; commitCellEdit(editingTd); }
                moveCellSelection(1, 0);
            }
        });
    }
});

// ═══════════════════════════════════════════════════════════
// IMAGE EDITOR (lazy-loads TUI libs)
// ═══════════════════════════════════════════════════════════

async function initImageEditor(blob, ext, filename) {
    document.getElementById('image-container').style.display = 'flex';
    const url = URL.createObjectURL(blob);

    if (mode === 'view') {
        const img = document.getElementById('image-viewer');
        img.src = url; img.style.display = 'block';
    } else {
        // Lazy-load TUI Image Editor libs
        await loadCSS('https://uicdn.toast.com/tui-color-picker/v2.2.6/tui-color-picker.css');
        await loadCSS('https://uicdn.toast.com/tui-image-editor/v3.15.2/tui-image-editor.css');
        await loadScript('https://cdnjs.cloudflare.com/ajax/libs/fabric.js/4.3.1/fabric.min.js');
        await loadScript('https://uicdn.toast.com/tui.code-snippet/v1.5.0/tui-code-snippet.min.js');
        await loadScript('https://uicdn.toast.com/tui-color-picker/v2.2.6/tui-color-picker.js');
        await loadScript('https://uicdn.toast.com/tui-image-editor/v3.15.2/tui-image-editor.js');

        document.getElementById('tui-image-editor').style.display = 'block';
        imageEditorInstance = new tui.ImageEditor('#tui-image-editor', {
            includeUI: {
                loadImage: { path: url, name: filename },
                theme: { 'common.bi.image': '', 'common.bisize.width': '0' },
                menu: ['crop','flip','rotate','draw','shape','icon','text','filter'],
                initMenu: 'filter',
                uiSize: { width: '100%', height: '100%' },
                menuBarPosition: 'bottom'
            },
            cssMaxWidth: 700, cssMaxHeight: 500,
            selectionStyle: { cornerSize: 20, rotatingPointOffset: 70 }
        });
        setTimeout(() => imageEditorInstance.ui.resizeEditor(), 100);
    }
}

// ═══════════════════════════════════════════════════════════
// PDF VIEWER (lazy-loads PDF.js + Fabric.js)
// ═══════════════════════════════════════════════════════════

async function initPdfViewer(blob, ext) {
    document.getElementById('pdf-container').style.display = 'flex';
    const url = URL.createObjectURL(blob);

    if (mode === 'view') {
        const iframe = document.getElementById('pdf-iframe');
        iframe.src = url + '#toolbar=0&navpanes=0&scrollbar=0';
        iframe.style.display = 'block';
    } else {
        // Lazy-load PDF.js + Fabric.js
        await loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.min.js');
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';
        if (typeof fabric === 'undefined') {
            await loadScript('https://cdnjs.cloudflare.com/ajax/libs/fabric.js/4.3.1/fabric.min.js');
        }

        document.getElementById('pdf-annotation-wrapper').style.display = 'block';
        document.getElementById('pdf-toolbar').style.display = 'flex';
        try {
            const pdf = await pdfjsLib.getDocument(url).promise;
            const container = document.getElementById('pdf-pages-container');
            for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
                const page = await pdf.getPage(pageNum);
                const viewport = page.getViewport({ scale: 1.5 });
                const wrapper = document.createElement('div');
                wrapper.style.cssText = `position:relative;margin-bottom:20px;width:${viewport.width}px;height:${viewport.height}px;box-shadow:0 2px 10px rgba(0,0,0,0.2);`;
                const canvas = document.createElement('canvas');
                canvas.height = viewport.height; canvas.width = viewport.width;
                wrapper.appendChild(canvas);
                container.appendChild(wrapper);
                await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
                const fCanvasEl = document.createElement('canvas');
                fCanvasEl.id = `fcanvas-${pageNum}`;
                fCanvasEl.width = viewport.width; fCanvasEl.height = viewport.height;
                fCanvasEl.style.cssText = 'position:absolute;top:0;left:0;';
                wrapper.appendChild(fCanvasEl);
                wrapper.fCanvas = new fabric.Canvas(fCanvasEl.id, { isDrawingMode: false });
            }
        } catch (e) { showError("Error rendering PDF: " + e.message); }
    }
}

function getActivePdfCanvas() {
    const wrapper = document.querySelector('#pdf-pages-container > div');
    return wrapper ? wrapper.fCanvas : null;
}
function addPdfText() {
    const c = getActivePdfCanvas(); if (!c) return;
    c.add(new fabric.IText('New Text', { left:50,top:50,fontFamily:'Helvetica',fill:'#d32f2f',fontSize:20 }));
}
function addPdfHighlight() {
    const c = getActivePdfCanvas(); if (!c) return;
    c.add(new fabric.Rect({ left:50,top:50,width:100,height:20,fill:'rgba(255,235,59,0.5)',transparentCorners:false }));
}

// ═══════════════════════════════════════════════════════════
// JSON EDITOR (lazy-loads JSONEditor lib)
// ═══════════════════════════════════════════════════════════

async function initJsonEditor(blob) {
    document.getElementById('json-container').style.display = 'flex';
    const text = await blob.text();
    if (mode === 'view') {
        const pre = document.createElement('pre');
        pre.style.padding = '20px'; pre.style.margin = '0'; pre.textContent = text;
        document.getElementById('json-container').appendChild(pre);
        document.getElementById('jsoneditor').style.display = 'none';
    } else {
        await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jsoneditor/9.10.0/jsoneditor.min.js');
        const container = document.getElementById("jsoneditor");
        jsonEditorInstance = new JSONEditor(container, { mode:'tree', modes:['code','form','text','tree','view'], onError: (err) => alert(err.toString()) });
        try { jsonEditorInstance.set(JSON.parse(text)); } catch(e) { jsonEditorInstance.setText(text); }
    }
}

// ═══════════════════════════════════════════════════════════
// TEXT EDITOR (fallback)
// ═══════════════════════════════════════════════════════════

function initTextEditor(blob) {
    document.getElementById('text-container').style.display = 'flex';
    blob.text().then(text => {
        const textarea = document.getElementById('text-editor');
        textarea.value = text;
        if (mode === 'edit') textarea.removeAttribute('readonly');
    });
}

// ═══════════════════════════════════════════════════════════
// SAVE LOGIC
// ═══════════════════════════════════════════════════════════

async function saveChanges() {
    const btn = document.getElementById('btn-save');
    btn.disabled = true;
    const origText = btn.textContent;
    btn.textContent = 'Saving...';

    try {
        let fetchOptions = { method: 'PUT', headers: {} };
        const ext = document.getElementById('header-meta').textContent.split('·')[1].trim().toLowerCase();

        if (['jpg','jpeg','png','webp','bmp'].includes(ext)) {
            if (!imageEditorInstance) throw new Error("Editor not initialized");
            const dataUrl = imageEditorInstance.toDataURL();
            const b = dataURLtoBlob(dataUrl);
            const fd = new FormData(); fd.append('file', b, `edited.${ext}`);
            fetchOptions.body = fd;
        }
        else if (['json','900','tsf'].includes(ext)) {
            if (!jsonEditorInstance) throw new Error("Editor not initialized");
            fetchOptions.headers['Content-Type'] = 'application/json';
            fetchOptions.body = JSON.stringify({ content: jsonEditorInstance.getText() });
        }
        else if (['xlsx','xls','csv'].includes(ext)) {
            const editingTd = document.querySelector('#spreadsheet-grid td.cell.editing');
            if (editingTd) commitCellEdit(editingTd);
            const bookType = ext === 'csv' ? 'csv' : 'xlsx';
            const wbout = XLSX.write(currentExcelWorkbook, { bookType, type: 'array' });
            const fd = new FormData();
            fd.append('file', new Blob([wbout], { type: 'application/octet-stream' }), `edited.${ext}`);
            fetchOptions.body = fd;
        }
        else if (['docx','doc'].includes(ext)) {
            // Send HTML to backend so backend can safely convert it to DOCX using Aspose.Words
            let htmlContent = '';
            if (documentEditorInstance) {
                htmlContent = documentEditorInstance.getData();
            } else {
                htmlContent = document.getElementById('document-content-textarea').value || document.getElementById('document-content').innerHTML;
            }
            fetchOptions.body = JSON.stringify({ content: htmlContent });
        }
        else if (ext === 'pdf') {
            alert("PDF annotation saving is not yet supported.");
            btn.disabled = false; btn.textContent = origText; return;
        }
        else {
            fetchOptions.headers['Content-Type'] = 'application/json';
            fetchOptions.body = JSON.stringify({ content: document.getElementById('text-editor').value });
        }

        // Choose the correct save endpoint
        const saveUrl = isWorkspaceDoc
            ? `/workspace/documents/${workspaceDocId}/content`
            : `/files/edit/${fileId}`;

        const res = await apiFetch(saveUrl, fetchOptions);
        if (!res.ok) { const d = await res.json().catch(()=>({})); throw new Error(d.error || 'Failed to save'); }

        showSaveToast('✓ Changes saved successfully!');
    } catch (err) {
        alert('Error saving: ' + err.message);
    } finally {
        btn.disabled = false;
        btn.textContent = origText;
    }
}

// ═══════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════

function formatBytes(bytes, decimals = 2) {
    if (!+bytes) return '0 Bytes';
    const k = 1024, dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes','KB','MB','GB','TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

function escHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function showError(msg, showDownload = false) {
    document.getElementById('loading-spinner').style.display = 'none';
    const err = document.getElementById('error-container');
    err.style.display = 'flex';
    err.innerHTML = `<div style="font-size: 3rem;">⚠️</div><h3>Error Loading File</h3><p>${escHtml(msg)}</p>
        ${showDownload ? `<button class="btn btn-primary" style="margin-top:20px;" onclick="downloadCurrentFile()">⬇ Download File</button>` : ''}`;
}

function downloadCurrentFile() {
    const token = localStorage.getItem('dam_token');
    let link = `/api/files/download/${fileId}`;
    if (token) link += `?token=${encodeURIComponent(token)}`;
    window.open(link, '_blank');
}

function dataURLtoBlob(dataurl) {
    var arr = dataurl.split(','), mime = arr[0].match(/:(.*?);/)[1],
        bstr = atob(arr[1]), n = bstr.length, u8arr = new Uint8Array(n);
    while(n--) u8arr[n] = bstr.charCodeAt(n);
    return new Blob([u8arr], {type:mime});
}

function showSaveToast(msg) {
    const toast = document.createElement('div');
    toast.className = 'save-toast';
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => { toast.style.opacity = '0'; toast.style.transition = 'opacity 0.3s'; }, 2500);
    setTimeout(() => toast.remove(), 3000);
}
