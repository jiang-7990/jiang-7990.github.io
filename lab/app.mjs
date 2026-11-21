import { mountAccount } from './account.mjs';
import { initializeTheme, mountThemeSettings } from './themes.mjs';

initializeTheme();

const qs = (selector, root = document) => root.querySelector(selector);
const main = qs('#lab-content');
const dialog = qs('#photo-dialog');
const camera = qs('#photo-camera');
const gallery = qs('#photo-gallery');
const labels = { reports: '实验报告示例', data: '实验数据处理', me: '我的' };
const sections = [{ id: 'reports', icon: 'notebook-pen' }, { id: 'data', icon: 'chart-no-axes-combined' }, { id: 'me', icon: 'user-round' }];
const catalog = { categories: [], experiments: [] };
const state = {
  query: { reports: '', data: '' }, category: { reports: '', data: '' },
  profile: { records: [], favorites: [], history: [] }, settings: {},
  matches: [], photo: null, profileTab: 'report', settingsReturn: '#reports', settingsDraft: null,
};
const find = id => catalog.experiments.find(experiment => experiment.id === id);
const esc = (value = '') => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const icon = name => /^[a-z0-9-]+$/.test(name) ? '<i data-lucide="' + name + '" aria-hidden="true"></i>' : '';
const attr = (action, value = '') => ' data-action="' + action + '" data-value="' + esc(value) + '"';
const button = (label, name, action, value = '', className = '') =>
  '<button type="button" class="' + className + '"' + attr(action, value) + '>' + icon(name) + '<span>' + label + '</span></button>';
const iconButton = (label, name, action, value = '') =>
  '<button type="button" class="lab-icon" aria-label="' + label + '" title="' + label + '"' + attr(action, value) + '>' + icon(name) + '</button>';

let routeVersion = 0;
let toastTimer;
let cleanup;
let captureWorkspace;
let loaded;
let photoVersion = 0;
const libraries = new Map();

function script(name) {
  if (!libraries.has(name)) {
    libraries.set(name, new Promise((resolve, reject) => {
      const tag = document.createElement('script');
      tag.src = '/lab/vendor/' + name;
      tag.onload = resolve;
      tag.onerror = () => { libraries.delete(name); tag.remove(); reject(new Error('组件加载失败，请刷新重试')); };
      document.head.append(tag);
    }));
  }
  return libraries.get(name);
}

function icons() {
  window.lucide?.createIcons({ attrs: { 'stroke-width': 1.75 } });
}

function notify(message) {
  const toast = qs('#lab-toast');
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 4100);
}

async function api(path, method = 'GET', body) {
  const response = await fetch('/api/' + path, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(result.error || '请求未完成，请重试');
    error.status = response.status;
    throw error;
  }
  return result;
}

const refreshProfile = async () => { state.profile = await api('profile'); };
const go = path => { if (location.hash === path) render(); else location.hash = path; };
const nowRoute = () => (location.hash.slice(1) || 'reports').split('/');
const formatDate = date => date ? new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(date)) : '';
const segment = (choices, active, action, label) => '<div class="lab-segments" role="group" aria-label="' + label + '">' +
  choices.map(([label, id]) => '<button type="button" aria-pressed="' + (id === active) + '"' + attr(action, id) + '>' + esc(label) + '</button>').join('') + '</div>';

function chrome(active) {
  qs('#lab-brand').innerHTML = '<a href="#reports" class="lab-brand-link"><span class="lab-logo">' + icon('flask-conical') +
    '</span><span><strong>实验台</strong><small>物理实验助手</small></span></a>';
  qs('#lab-nav').innerHTML = sections.map(item =>
    '<a href="#' + item.id + '" class="lab-nav-link"' + (item.id === active ? ' aria-current="page"' : '') +
    '>' + icon(item.icon) + '<span>' + labels[item.id] + '</span></a>').join('');
  qs('#lab-foot').innerHTML = button('设置', 'settings', 'settings');
  qs('#lab-topbar').innerHTML = '<a class="lab-mobile-brand" href="#reports"><span class="lab-logo">' + icon('flask-conical') +
    '</span><strong>实验台</strong></a><div class="lab-breadcrumb">' + labels[active] + '</div><div class="lab-top-actions">' +
    button(state.settings.ready ? 'DeepSeek 已连接' : '接入 DeepSeek', state.settings.ready ? 'circle-check' : 'plug', 'settings', '', 'lab-api') + '</div>';
}

function chartThumbnail(canvas, experiment) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const { width, height } = canvas;
  const color = getComputedStyle(canvas).color;
  const xValues = experiment.sampleRows.map(row => row[experiment.xKey]);
  const yValues = experiment.sampleRows.map(row => row[experiment.yKey]);
  const x0 = Math.min(...xValues), y0 = Math.min(...yValues);
  const dx = Math.max(...xValues) - x0 || 1, dy = Math.max(...yValues) - y0 || 1;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.24;
  for (let x = 12; x < width; x += 11) { ctx.beginPath(); ctx.moveTo(x, 8); ctx.lineTo(x, height - 10); ctx.stroke(); }
  for (let y = 8; y < height - 5; y += 11) { ctx.beginPath(); ctx.moveTo(10, y); ctx.lineTo(width - 7, y); ctx.stroke(); }
  const points = xValues.map((x, i) => [15 + (x - x0) / dx * (width - 28), height - 14 - (yValues[i] - y0) / dy * (height - 27)]);
  ctx.globalAlpha = 0.7;
  ctx.lineWidth = 1.5;
  const ordered = [...points].sort((a, b) => a[0] - b[0]);
  if (ordered.length) {
    ctx.beginPath();
    ordered.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = color;
  points.forEach(([x, y]) => { ctx.beginPath(); ctx.arc(x, y, 2.2, 0, Math.PI * 2); ctx.fill(); });
}

function matchList(experiment, query, mode) {
  const typeWords = mode === 'reports' ? /实验报告示例|实验报告|预习报告|报告示例/g : /数据处理|实验预设/g;
  const words = query.toLowerCase().replace(typeWords, ' ').trim().split(/\s+/).filter(Boolean);
  const haystack = [experiment.title, experiment.category, ...experiment.keywords].join(' ').toLowerCase();
  return words.every(word => haystack.includes(word));
}

function catalogCards(mode) {
  const list = qs('#lab-cards');
  if (!list) return;
  const category = state.category[mode];
  const query = state.query[mode];
  const items = catalog.experiments.filter(experiment => (!category || category === experiment.category) && matchList(experiment, query, mode));
  qs('#lab-result-count').textContent = items.length + (mode === 'reports' ? ' 项实验' : ' 项预设');
  if (!items.length) {
    list.innerHTML = '<div class="lab-empty">' + icon('search-x') + '<h2>没有找到匹配的实验</h2>' +
      button('清空筛选', 'list-restart', 'clear-search', mode, 'lab-secondary') + '</div>';
    icons();
    return;
  }
  list.innerHTML = items.map(experiment => {
    const family = catalog.categories.indexOf(experiment.category);
    const glyph = ['flask-conical', 'magnet', 'atom'][family] || 'flask-conical';
    const id = esc(experiment.id);
    return '<a class="lab-exp-card family-' + family + '" href="#' + (mode === 'data' ? 'analysis/' : 'report/') + id + '">' +
      '<div class="lab-card-top"><span class="lab-card-icon">' + icon(glyph) + '</span><canvas width="96" height="60" data-preview="' + id +
      '" aria-hidden="true"></canvas></div><div class="lab-card-body"><span class="lab-card-category">' + esc(experiment.category) +
      '</span><h2>' + esc(experiment.title) + '</h2><p>' + esc(experiment.summary || experiment.description) +
      '</p></div><div class="lab-card-bottom"><span>' + (mode === 'data' ? experiment.columns.length + ' 个数据列' : esc(experiment.keywords.slice(0, 2).join(' · '))) +
      '</span>' + icon('chevron-right') + '</div></a>';
  }).join('');
  list.querySelectorAll('canvas').forEach(canvas => chartThumbnail(canvas, find(canvas.dataset.preview)));
  icons();
}

function catalogView(mode) {
  const report = mode === 'reports';
  main.innerHTML = '<section class="lab-search-zone"><div class="lab-title"><h1>' + labels[mode] + '</h1></div>' +
    '<div class="lab-search"><label class="lab-search-field">' + icon('search') + '<input id="lab-search-input" type="search" autocomplete="off" aria-label="' +
    (report ? '搜索实验报告示例' : '搜索实验数据预设') + '" placeholder="' + (report ? '搜索实验或关键词' : '搜索实验数据预设') +
    '" value="' + esc(state.query[mode]) + '"></label>' + (report ? button('拍照识别', 'camera', 'photo', '', 'lab-secondary lab-photo-button') : '') + '</div>' +
    '</section>' + (report ?
      '<div id="lab-photo-results"></div>' :
      '<section class="lab-new-row"><span class="lab-new-icon">' + icon('plus') + '</span><div><h2>新建实验数据处理</h2><p>空白数据表</p></div>' +
      '<a class="lab-primary" href="#analysis/new">' + icon('plus') + '新建</a></section>') +
    '<section class="lab-catalog"><div class="lab-section-head"><div><h2>' + (report ? '实验目录' : '实验预设') +
    '</h2><span id="lab-result-count"></span></div>' + (report ? '<a class="lab-secondary" href="#report/new">' + icon('upload') + '上传报告</a>' : '') +
    '</div>' + segment([['全部', ''], ...catalog.categories.map(category => [category, category])], state.category[mode], 'category', '课程筛选') +
    '<div class="lab-card-grid" id="lab-cards"></div></section>';
  const search = qs('#lab-search-input');
  search.addEventListener('input', () => {
    state.query[mode] = search.value;
    catalogCards(mode);
  });
  catalogCards(mode);
  renderMatches();
}

function renderMatches() {
  const region = qs('#lab-photo-results');
  if (!region) return;
  if (!state.matches.length) { region.innerHTML = ''; return; }
  region.innerHTML = '<section class="lab-matches"><div class="lab-section-head"><h2>照片识别结果</h2>' +
    iconButton('关闭识别结果', 'x', 'clear-matches') + '</div>' +
    state.matches.map(item => '<a href="#report/' + esc(item.id) + '"><strong>' + esc(find(item.id)?.title || '') +
      '</strong><span>' + esc(item.reason) + '</span>' + icon('chevron-right') + '</a>').join('') + '</section>';
  icons();
}

const profileOptions = [['我的实验报告', 'report'], ['我的实验数据', 'data'], ['浏览记录', 'history'], ['收藏', 'favorites']];
function profileView() {
  const tab = state.profileTab;
  const records = tab === 'report' || tab === 'data';
  const items = records ? state.profile.records.filter(record => record.kind === tab) :
    (tab === 'history' ? state.profile.history : state.profile.favorites.map(id => ({ id }))).filter(item => find(item.id));
  main.innerHTML = '<section class="lab-personal"><div class="lab-section-head"><h1>我的</h1>' +
    button('设置', 'settings', 'settings', '', 'lab-secondary') + '</div>' +
    '<div class="lab-profile-actions"><a class="lab-secondary" href="#me/account">' + icon('mail') + '邮箱登录</a>' +
    '<a class="lab-secondary" href="#me/theme">' + icon('palette') + '主题外观</a></div>' +
    segment(profileOptions, tab, 'profile-tab', '个人记录') +
    '<div class="lab-record-list">' + (items.length ? items.map(item => '<div class="lab-record"><a href="#' +
      (records ? 'record/' : 'report/') + esc(item.id) + '">' +
      '<span class="lab-record-icon">' + icon(tab === 'history' ? 'history' : tab === 'favorites' ? 'bookmark' : tab === 'data' ? 'table-2' : 'file-text') + '</span>' +
      '<span><strong>' + esc(records ? item.title : find(item.id).title) + '</strong><small>' +
      esc(formatDate(item.savedAt || item.viewedAt) || find(item.id)?.category || '') + '</small></span></a>' +
      (records ? iconButton('删除记录', 'trash-2', 'delete-record', item.id) : '') + '</div>').join('') :
      '<div class="lab-empty">' + icon('folder-open') + '<h2>暂无' + ({ report: '实验报告', data: '实验数据', history: '浏览记录', favorites: '收藏' })[tab] +
      '</h2>' + '<a class="lab-secondary" href="#' + (tab === 'data' ? 'data' : 'reports') + '">查看实验目录</a></div>') + '</div></section>';
}

function profileSection(section) {
  const account = section === 'account';
  const title = account ? '邮箱账号' : '主题外观';
  main.innerHTML = '<section class="lab-settings"><div class="lab-work-head"><a class="lab-icon" href="#me" aria-label="返回我的" title="返回我的">' +
    icon('arrow-left') + '</a><h1>' + title + '</h1></div><div id="lab-profile-panel"' +
    (account ? ' class="lab-form-section"' : '') + '></div></section>';
  const panel = qs('#lab-profile-panel');
  cleanup = account ? mountAccount(panel, { api, icon }) : mountThemeSettings(panel, icon, notify);
}

function settingsView() {
  const config = state.settings;
  main.innerHTML = '<section class="lab-settings"><div class="lab-work-head">' +
    iconButton('返回', 'arrow-left', 'settings-back') + '<h1>接入 DeepSeek</h1></div><div class="lab-form-section">' +
    '<form id="lab-settings-form"><label>DeepSeek API Key<input required type="password" name="key" autocomplete="off" maxlength="512" ' +
    'spellcheck="false" placeholder="' + (config.ready ? '已连接，输入新 Key 可更换' : '粘贴你的 DeepSeek API Key') +
    '"></label><div class="lab-form-actions"><button type="submit" class="lab-primary">' + icon('plug') + (config.ready ? '更换 API Key' : '连接 DeepSeek') + '</button>' +
    (config.ready ? button('测试连接', 'plug-zap', 'test-ai', '', 'lab-secondary') +
      button('断开连接', 'unlink', 'clear-key', '', 'lab-secondary') : '') +
    '</div><p class="lab-form-feedback" id="lab-settings-status" role="status">' + (config.ready ? 'DeepSeek 已连接' : '') +
    '</p></form></div>' +
    '<section class="lab-tutorial" aria-labelledby="lab-tutorial-title"><h2 id="lab-tutorial-title">接入教程</h2><ol>' +
    '<li>登录 <a href="https://platform.deepseek.com/api_keys" target="_blank" rel="noopener noreferrer">DeepSeek 开放平台' +
    icon('external-link') + '</a>，进入「API keys」。</li>' +
    '<li>点击「创建 API key」，填写名称后复制新生成的密钥。</li>' +
    '<li>将密钥粘贴到上方输入框，点击「连接 DeepSeek」。验证通过后即可使用拍照识别、实验问答、批注和润色。</li>' +
    '</ol><p>平台提示余额不足时，可在开放平台充值后再重试。服务重启后需要重新填写密钥。</p></section></section>';
  qs('#lab-settings-form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = qs('button[type="submit"]', form);
    const feedback = qs('#lab-settings-status');
    const { key } = Object.fromEntries(new FormData(form));
    submit.disabled = true;
    feedback.textContent = '正在验证 DeepSeek API Key…';
    try {
      state.settings = await api('settings', 'PUT', { key });
      if (form.isConnected) { chrome('me'); settingsView(); icons(); }
    } catch (error) {
      feedback.textContent = error.message;
    } finally {
      submit.disabled = false;
    }
  });
}

async function openWorkspace(mode, id, record, version) {
  const experiment = find(id);
  if (!experiment && id !== 'new' && !record) throw new Error('没有找到这个实验');
  if (state.settingsDraft?.route === location.hash) {
    record = state.settingsDraft.record;
    state.settingsDraft = null;
  }
  let currentRecordId = record?.id;
  const previous = location.hash.startsWith('#record/') ? '返回我的记录' : '返回目录';
  main.innerHTML = '<div class="lab-work-nav">' + iconButton(previous, 'arrow-left', 'back', mode) +
    '<span>' + previous + '</span></div><div id="lab-workspace"></div>';
  icons();
  const dataMode = mode === 'analysis';
  const module = dataMode ? (await Promise.all([
    import('./data-workspace.mjs'), script('chart.umd.js'), script('regression.min.js'), script('math.js'),
  ]))[0] : await import('./report-workspace.mjs');
  if (version !== routeVersion) return;
  if (experiment) {
    api('history', 'POST', { id: experiment.id }).then(refreshProfile).catch(() => {});
  }
  const mount = dataMode ? module.mountDataWorkspace : module.mountReportWorkspace;
  cleanup = mount(qs('#lab-workspace'), {
    experiment, record, icon, notify,
    onData: current => go('#analysis/' + (current?.id || 'new')),
    goSettings: openSettings,
    askAI: async details => (await api('ai', 'POST', details)).answer,
    isFavorite: target => state.profile.favorites.includes(target),
    toggleFavorite: async (target, active) => {
      const next = typeof active === 'boolean' ? active : !state.profile.favorites.includes(target);
      await api('favorites', 'POST', { id: target, active: next });
      await refreshProfile();
      return next;
    },
    onSave: async item => {
      const saved = await api('records', 'POST', { ...item, id: currentRecordId, kind: dataMode ? 'data' : 'report' });
      currentRecordId = saved.id;
      notify(dataMode ? '实验数据已保存' : '报告已保存');
      refreshProfile().catch(() => {});
      return saved;
    },
  });
  if (cleanup?.capture) {
    captureWorkspace = () => ({ ...cleanup.capture(), id: currentRecordId, experimentId: experiment?.id || null });
  }
  icons();
}

async function render() {
  if (!loaded) return;
  if (typeof cleanup === 'function') cleanup();
  cleanup = undefined;
  captureWorkspace = undefined;
  const version = ++routeVersion;
  const [route, id] = nowRoute();
  let active = route === 'data' || route === 'analysis' ? 'data' : route === 'me' || route === 'settings' || route === 'record' ? 'me' : 'reports';
  chrome(active);
  window.scrollTo(0, 0);
  try {
    if (route === 'settings') settingsView();
    else if (route === 'me' && (id === 'account' || id === 'theme')) profileSection(id);
    else if (route === 'me') {
      profileView();
      await refreshProfile();
      if (version === routeVersion) profileView();
    } else if (route === 'record') {
      main.innerHTML = '<p class="lab-loading" role="status">正在读取记录…</p>';
      const record = await api('records/' + encodeURIComponent(id));
      if (version !== routeVersion) return;
      await openWorkspace(record.kind === 'data' ? 'analysis' : 'report', record.experimentId || 'new', record, version);
    } else if (route === 'report' || route === 'analysis') await openWorkspace(route, id, undefined, version);
    else catalogView(active);
  } catch (error) {
    if (version !== routeVersion) return;
    main.innerHTML = '<div class="lab-empty"><h2>' + esc(error.message) + '</h2><a href="#reports" class="lab-secondary">返回实验目录</a></div>';
  }
  if (version === routeVersion) icons();
}

function openSettings() {
  if (location.hash === '#settings') return;
  state.settingsReturn = location.hash || '#reports';
  state.settingsDraft = captureWorkspace ? { route: location.hash, record: captureWorkspace() } : null;
  go('#settings');
}

function openPhoto() {
  dialog.innerHTML = '<div class="lab-dialog-header"><h2 id="photo-title">识别实验照片</h2>' + iconButton('关闭', 'x', 'close-photo') + '</div>' +
    '<div class="lab-photo-actions">' + button('拍照', 'camera', 'choose-camera', '', 'lab-secondary') +
    button('从相册选择', 'images', 'choose-gallery', '', 'lab-secondary') + '</div>' +
    '<p role="status" id="lab-photo-status"></p><div id="lab-photo-settings"></div>';
  dialog.showModal();
  icons();
  if (state.photo) void identifyPhoto(state.photo);
}

async function identifyPhoto(file) {
  const status = qs('#lab-photo-status');
  if (!status || !dialog.open) return;
  if (!/^image\/(jpeg|png|webp|gif)$/i.test(file.type) || file.size > 5 * 1024 * 1024) {
    status.textContent = '请选择 5 MB 以内的 JPG、PNG、WebP 或 GIF 照片';
    return;
  }
  state.photo = file;
  if (!state.settings.ready) {
    status.textContent = '识别照片需要先接入 DeepSeek';
    qs('#lab-photo-settings').innerHTML = button('接入 DeepSeek', 'plug', 'photo-settings', '', 'lab-primary');
    icons();
    return;
  }
  const version = ++photoVersion;
  qs('#lab-photo-settings').innerHTML = '';
  status.textContent = '正在识别 ' + file.name + '…';
  try {
    const image = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    const result = await api('ai', 'POST', { task: 'identify', text: '根据实验报告照片识别目录中的实验', image });
    if (version !== photoVersion || !dialog.open) return;
    state.photo = null;
    state.matches = result.candidates || [];
    if (!state.matches.length) { status.textContent = '没有匹配的实验。可以换一张更清晰的照片，或用关键词搜索。'; return; }
    dialog.close();
    renderMatches();
  } catch (error) {
    if (version === photoVersion && dialog.open) status.textContent = error.message;
  }
}

document.addEventListener('click', async event => {
  const target = event.target.closest('[data-action]');
  if (!target || target.closest('#lab-workspace')) return;
  const { action, value } = target.dataset;
  const [route] = nowRoute();
  try {
    if (action === 'settings') openSettings();
    else if (action === 'settings-back') go(state.settingsReturn);
    else if (action === 'back') go(route === 'record' ? '#me' : value === 'analysis' ? '#data' : '#reports');
    else if (action === 'category') {
      state.category[route === 'data' ? 'data' : 'reports'] = value; catalogView(route === 'data' ? 'data' : 'reports'); icons();
    } else if (action === 'clear-search') {
      state.category[value] = ''; state.query[value] = ''; catalogView(value); icons(); qs('#lab-search-input').focus();
    } else if (action === 'profile-tab') {
      state.profileTab = value; profileView(); icons();
    } else if (action === 'photo') openPhoto();
    else if (action === 'close-photo') { dialog.close(); photoVersion++; state.photo = null; }
    else if (action === 'choose-camera') camera.click();
    else if (action === 'choose-gallery') gallery.click();
    else if (action === 'photo-settings') { dialog.close(); openSettings(); }
    else if (action === 'clear-matches') { state.matches = []; renderMatches(); }
    else if (action === 'delete-record' && confirm('删除这条实验记录？')) {
      await api('records/' + value, 'DELETE'); await refreshProfile(); if (nowRoute()[0] === 'me') { profileView(); icons(); }
      notify('记录已删除');
    } else if (action === 'test-ai') {
      const feedback = qs('#lab-settings-status');
      feedback.textContent = '正在测试 DeepSeek 连接…';
      target.disabled = true;
      try { await api('ai', 'POST', { task: 'test', text: 'OK' }); feedback.textContent = 'DeepSeek 连接成功'; }
      catch (error) { feedback.textContent = error.message; }
      finally { target.disabled = false; }
    } else if (action === 'clear-key') {
      state.settings = await api('settings', 'PUT', { clearKey: true });
      if (nowRoute()[0] === 'settings') { chrome('me'); settingsView(); icons(); notify('已断开 DeepSeek'); }
    }
  } catch (error) { notify(error.message); }
});

for (const input of [camera, gallery]) input.addEventListener('change', () => {
  const file = input.files[0];
  input.value = '';
  if (file) void identifyPhoto(file);
});
dialog.addEventListener('cancel', () => { photoVersion++; state.photo = null; });
addEventListener('hashchange', render);
new MutationObserver(records => {
  if (records.some(record => [...record.addedNodes].some(node => node.nodeType === 1 &&
    (node.matches('i[data-lucide]') || node.querySelector('i[data-lucide]'))))) icons();
}).observe(document.body, { childList: true, subtree: true });

try {
  await script('lucide.min.js');
  const [data, settings] = await Promise.all([api('catalog'), api('settings'), refreshProfile()]);
  Object.assign(catalog, data);
  state.settings = settings;
  loaded = true;
  await render();
} catch (error) {
  main.innerHTML = '<div class="lab-empty"><h1>工作台加载失败</h1><p>' + esc(error.message) + '</p><a class="lab-secondary" href="/">重试</a></div>';
}
