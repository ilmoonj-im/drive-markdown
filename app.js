if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./service-worker.js').catch(() => {});
}

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

const $ = id => document.getElementById(id);
const els = {
  welcome: $('welcome'), browserView: $('browserView'), documentView: $('documentView'),
  loginBtn: $('loginBtn'), welcomeLoginBtn: $('welcomeLoginBtn'), settingsBtn: $('settingsBtn'),
  settingsDialog: $('settingsDialog'), clientIdInput: $('clientIdInput'), folderIdInput: $('folderIdInput'),
  saveSettingsBtn: $('saveSettingsBtn'), clearSettingsBtn: $('clearSettingsBtn'),
  fileList: $('fileList'), breadcrumb: $('breadcrumb'), searchBox: $('searchBox'),
  homeBtn: $('homeBtn'), upBtn: $('upBtn'), refreshBtn: $('refreshBtn'),
  backBtn: $('backBtn'), docTitle: $('docTitle'), viewer: $('viewer'), editor: $('editor'),
  editBtn: $('editBtn'), saveBtn: $('saveBtn'), cancelBtn: $('cancelBtn'), saveState: $('saveState'),
  toast: $('toast')
};

let tokenClient = null;
let accessToken = '';
let currentFolderId = '';
let currentFolderName = '';
let folderStack = [];
let currentItems = [];
let currentFile = null;
let currentText = '';

marked.setOptions({ gfm: true, breaks: true });

function getConfig() {
  return {
    clientId: localStorage.getItem('drive-md-client-id') || '',
    rootFolderId: localStorage.getItem('drive-md-root-folder') || ''
  };
}
function configReady() {
  const c = getConfig();
  return c.clientId.endsWith('.apps.googleusercontent.com') && c.rootFolderId.length > 5;
}
function loadSettingsInputs() {
  const c = getConfig();
  els.clientIdInput.value = c.clientId;
  els.folderIdInput.value = c.rootFolderId;
}
function normalizeFolderId(value) {
  const v = value.trim();
  const m = v.match(/\/folders\/([^/?#]+)/);
  return m ? m[1] : v;
}
function showToast(msg, ms=2200) {
  els.toast.textContent = msg;
  els.toast.classList.remove('hidden');
  setTimeout(() => els.toast.classList.add('hidden'), ms);
}
function show(view) {
  els.welcome.classList.toggle('hidden', view !== 'welcome');
  els.browserView.classList.toggle('hidden', view !== 'browser');
  els.documentView.classList.toggle('hidden', view !== 'document');
}
function initTokenClient() {
  if (!window.google?.accounts?.oauth2 || !configReady()) return false;
  const { clientId } = getConfig();
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: DRIVE_SCOPE,
    callback: async response => {
      if (response.error) {
        showToast(`Google 로그인 실패: ${response.error}`, 3500);
        return;
      }
      accessToken = response.access_token;
      els.loginBtn.textContent = '연결됨';
      await openRoot();
    }
  });
  return true;
}
function connectGoogle() {
  if (!configReady()) {
    loadSettingsInputs();
    els.settingsDialog.showModal();
    return;
  }
  if (!tokenClient && !initTokenClient()) {
    showToast('Google 로그인 모듈을 불러오는 중입니다. 잠시 후 다시 눌러주세요.');
    return;
  }
  tokenClient.requestAccessToken({ prompt: accessToken ? '' : 'consent' });
}
async function api(url, options={}) {
  if (!accessToken) throw new Error('Google 로그인이 필요합니다.');
  const response = await fetch(url, {
    ...options,
    headers: { Authorization: `Bearer ${accessToken}`, ...(options.headers || {}) }
  });
  if (!response.ok) {
    let detail = '';
    try { detail = await response.text(); } catch {}
    throw new Error(detail || `${response.status} ${response.statusText}`);
  }
  return response;
}
function qEscape(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}
async function listChildren(folderId) {
  const q = encodeURIComponent(`'${qEscape(folderId)}' in parents and trashed = false`);
  const fields = encodeURIComponent('nextPageToken,files(id,name,mimeType,modifiedTime,size,parents)');
  let pageToken = '';
  let files = [];
  do {
    const tokenPart = pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '';
    const url = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=${fields}&orderBy=folder,name&pageSize=1000${tokenPart}`;
    const res = await api(url);
    const data = await res.json();
    files.push(...(data.files || []));
    pageToken = data.nextPageToken || '';
  } while (pageToken);
  return files;
}
async function getMetadata(fileId) {
  const fields = encodeURIComponent('id,name,mimeType,parents');
  const res = await api(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=${fields}`);
  return res.json();
}
async function downloadText(fileId) {
  const res = await api(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`);
  return res.text();
}
async function downloadBlob(fileId) {
  const res = await api(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`);
  return res.blob();
}
async function updateText(fileId, text) {
  const res = await api(`https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(fileId)}?uploadType=media`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'text/markdown; charset=UTF-8' },
    body: text
  });
  return res.json();
}
async function findNamedChild(parentId, name, folderOnly=false) {
  let expr = `'${qEscape(parentId)}' in parents and name = '${qEscape(name)}' and trashed = false`;
  if (folderOnly) expr += ` and mimeType = '${FOLDER_MIME}'`;
  const q = encodeURIComponent(expr);
  const fields = encodeURIComponent('files(id,name,mimeType,parents)');
  const res = await api(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=${fields}&pageSize=20`);
  const data = await res.json();
  return data.files?.[0] || null;
}
async function findByNameAnywhere(name) {
  const q = encodeURIComponent(`name = '${qEscape(name)}' and trashed = false`);
  const fields = encodeURIComponent('files(id,name,mimeType,parents)');
  const res = await api(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=${fields}&pageSize=50`);
  const data = await res.json();
  return data.files?.[0] || null;
}

async function openRoot() {
  const { rootFolderId } = getConfig();
  currentFolderId = rootFolderId;
  currentFolderName = 'Drive';
  folderStack = [];
  await refreshFolder();
  show('browser');
}
async function refreshFolder() {
  try {
    els.fileList.innerHTML = `<div class="file-row"><div class="file-main"><div class="file-name">불러오는 중…</div></div></div>`;
    currentItems = await listChildren(currentFolderId);
    renderList();
    updateNav();
  } catch (e) {
    showToast('Drive 폴더를 열지 못했습니다.', 3000);
    els.fileList.innerHTML = `<div class="file-row"><div class="file-main"><div class="file-name">오류</div><div class="file-meta">${escapeHtml(e.message)}</div></div></div>`;
  }
}
function renderList() {
  const term = els.searchBox.value.trim().toLowerCase();
  const visible = currentItems
    .filter(f => f.mimeType === FOLDER_MIME || /\.md(?:own)?$/i.test(f.name))
    .filter(f => !term || f.name.toLowerCase().includes(term))
    .sort((a,b) => {
      const af = a.mimeType === FOLDER_MIME ? 0 : 1;
      const bf = b.mimeType === FOLDER_MIME ? 0 : 1;
      return af - bf || a.name.localeCompare(b.name, 'ko');
    });
  els.fileList.innerHTML = '';
  if (!visible.length) {
    els.fileList.innerHTML = `<div class="file-row"><div class="file-main"><div class="file-name">표시할 Markdown 파일이 없습니다.</div></div></div>`;
    return;
  }
  for (const f of visible) {
    const row = document.createElement('div');
    row.className = 'file-row';
    const folder = f.mimeType === FOLDER_MIME;
    row.innerHTML = `
      <div class="file-icon">${folder ? '📁' : '📄'}</div>
      <div class="file-main">
        <div class="file-name">${escapeHtml(f.name)}</div>
        <div class="file-meta">${folder ? '폴더' : formatDate(f.modifiedTime)}</div>
      </div>
      <div>›</div>`;
    row.addEventListener('click', () => folder ? enterFolder(f) : openDocument(f));
    els.fileList.appendChild(row);
  }
}
function updateNav() {
  els.breadcrumb.textContent = [...folderStack.map(x => x.name), currentFolderName].join(' / ');
  els.upBtn.disabled = folderStack.length === 0;
}
async function enterFolder(folder) {
  folderStack.push({ id: currentFolderId, name: currentFolderName });
  currentFolderId = folder.id;
  currentFolderName = folder.name;
  els.searchBox.value = '';
  await refreshFolder();
}
async function goUp() {
  const prev = folderStack.pop();
  if (!prev) return;
  currentFolderId = prev.id;
  currentFolderName = prev.name;
  els.searchBox.value = '';
  await refreshFolder();
}

async function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
async function fileToDataUrl(file) {
  const blob = await downloadBlob(file.id);
  return blobToDataUrl(blob);
}
async function resolvePath(startFolderId, rawPath) {
  const clean = decodeURIComponent(rawPath).replace(/^\.?\//, '').split(/[?#]/)[0];
  const parts = clean.split('/').filter(Boolean);
  if (!parts.length) return null;
  let folderId = startFolderId;
  for (let i=0; i<parts.length-1; i++) {
    if (parts[i] === '..') {
      const meta = await getMetadata(folderId);
      folderId = meta.parents?.[0] || folderId;
      continue;
    }
    const folder = await findNamedChild(folderId, parts[i], true);
    if (!folder) return null;
    folderId = folder.id;
  }
  return findNamedChild(folderId, parts[parts.length-1], false);
}
async function prepareMarkdown(md, parentFolderId) {
  let out = md;

  // 메타데이터에 과거 blob URL이 있으면 읽기 화면에서는 보기 좋게 치환
  out = out.replace(/^사진:\s*blob:[^\n]+$/m, '사진: 첨부 이미지');

  // Obsidian embeds
  const wikiMatches = [...out.matchAll(/!\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g)];
  for (const m of wikiMatches) {
    const target = m[1].trim();
    let file = target.includes('/')
      ? await resolvePath(parentFolderId, target)
      : await findNamedChild(parentFolderId, target, false);
    if (!file && !target.includes('/')) file = await findByNameAnywhere(target);
    if (file && file.mimeType !== FOLDER_MIME) {
      const dataUrl = await fileToDataUrl(file);
      out = out.replace(m[0], `![](${dataUrl})`);
    }
  }

  // Standard relative images
  const imgMatches = [...out.matchAll(/!\[([^\]]*)\]\(([^)]+)\)/g)];
  for (const m of imgMatches) {
    const src = m[2].trim().replace(/^<|>$/g,'');
    if (/^(?:https?:|data:)/i.test(src)) continue;
    if (src.startsWith('blob:')) continue;

    let file = await resolvePath(parentFolderId, src);
    if (!file && !src.includes('/')) file = await findNamedChild(parentFolderId, src, false);
    if (file && file.mimeType !== FOLDER_MIME) {
      const dataUrl = await fileToDataUrl(file);
      out = out.replace(m[2], dataUrl);
    }
  }

  // PhotoMD 구조 보정: 같은 이름 이미지가 있으면 자동 표시
  const hasImage = /!\[\[/.test(out) || /!\[[^\]]*\]\((?!blob:)[^)]+\)/.test(out);
  if (!hasImage && currentFile?.name) {
    const base = currentFile.name.replace(/\.md(?:own)?$/i, '');
    for (const ext of ['jpeg','jpg','png','webp']) {
      const file = await findNamedChild(parentFolderId, `${base}.${ext}`, false);
      if (file) {
        const dataUrl = await fileToDataUrl(file);
        out = out.replace(/(# Seen & Kept[^\n]*\n?)/i, `$1\n\n![](${dataUrl})\n`);
        if (!out.includes(dataUrl)) out += `\n\n![](${dataUrl})\n`;
        break;
      }
    }
  }

  return out;
}
async function renderCurrent() {
  const parentFolderId = currentFile.parents?.[0] || currentFolderId;
  const prepared = await prepareMarkdown(currentText, parentFolderId);
  const html = marked.parse(prepared);
  els.viewer.innerHTML = DOMPurify.sanitize(html, {
    ADD_ATTR: ['target'],
    ADD_URI_SAFE_ATTR: ['src']
  });
}
async function openDocument(file) {
  try {
    currentFile = file;
    currentText = await downloadText(file.id);
    els.docTitle.textContent = file.name;
    els.editor.classList.add('hidden');
    els.viewer.classList.remove('hidden');
    els.editBtn.classList.remove('hidden');
    els.saveBtn.classList.add('hidden');
    els.cancelBtn.classList.add('hidden');
    els.saveState.textContent = '';
    await renderCurrent();
    show('document');
    window.scrollTo(0,0);
  } catch (e) {
    showToast('파일을 열지 못했습니다.', 3000);
  }
}
function startEdit() {
  els.editor.value = currentText;
  els.viewer.classList.add('hidden');
  els.editor.classList.remove('hidden');
  els.editBtn.classList.add('hidden');
  els.saveBtn.classList.remove('hidden');
  els.cancelBtn.classList.remove('hidden');
  els.editor.focus();
}
async function cancelEdit() {
  els.editor.classList.add('hidden');
  els.viewer.classList.remove('hidden');
  els.editBtn.classList.remove('hidden');
  els.saveBtn.classList.add('hidden');
  els.cancelBtn.classList.add('hidden');
}
async function saveEdit() {
  const next = els.editor.value;
  els.saveBtn.disabled = true;
  els.saveState.textContent = 'Google Drive에 저장 중…';
  try {
    await updateText(currentFile.id, next);
    currentText = next;
    els.saveState.textContent = '저장됨';
    await renderCurrent();
    await cancelEdit();
    setTimeout(() => els.saveState.textContent = '', 1500);
  } catch (e) {
    els.saveState.textContent = '저장 실패';
    showToast('저장하지 못했습니다.', 3000);
  } finally {
    els.saveBtn.disabled = false;
  }
}
function backToList() { show('browser'); }
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
}
function formatDate(s) {
  if (!s) return '';
  try { return new Date(s).toLocaleString('ko-KR', {dateStyle:'short', timeStyle:'short'}); }
  catch { return ''; }
}

els.loginBtn.addEventListener('click', connectGoogle);
els.welcomeLoginBtn.addEventListener('click', connectGoogle);
els.settingsBtn.addEventListener('click', () => { loadSettingsInputs(); els.settingsDialog.showModal(); });
els.saveSettingsBtn.addEventListener('click', () => {
  const clientId = els.clientIdInput.value.trim();
  const folderId = normalizeFolderId(els.folderIdInput.value);
  if (!clientId.endsWith('.apps.googleusercontent.com') || !folderId) {
    showToast('Client ID와 폴더 ID를 확인하세요.');
    return;
  }
  localStorage.setItem('drive-md-client-id', clientId);
  localStorage.setItem('drive-md-root-folder', folderId);
  accessToken = '';
  tokenClient = null;
  initTokenClient();
  els.settingsDialog.close();
  showToast('설정을 저장했습니다.');
});
els.clearSettingsBtn.addEventListener('click', () => {
  localStorage.removeItem('drive-md-client-id');
  localStorage.removeItem('drive-md-root-folder');
  accessToken = ''; tokenClient = null;
  loadSettingsInputs();
  show('welcome');
  showToast('설정을 지웠습니다.');
});
els.searchBox.addEventListener('input', renderList);
els.refreshBtn.addEventListener('click', refreshFolder);
els.homeBtn.addEventListener('click', openRoot);
els.upBtn.addEventListener('click', goUp);
els.backBtn.addEventListener('click', backToList);
els.editBtn.addEventListener('click', startEdit);
els.cancelBtn.addEventListener('click', cancelEdit);
els.saveBtn.addEventListener('click', saveEdit);

window.addEventListener('load', () => {
  show('welcome');
  const timer = setInterval(() => {
    if (window.google?.accounts?.oauth2) {
      clearInterval(timer);
      if (configReady()) initTokenClient();
    }
  }, 100);
});
