const storageKey = 'lab-appearance-v1';
const skins = [
  { id: 'standard', name: '标准', accent: '#087760', bg: '#f4f7f4', surface: '#ffffff' },
  { id: 'star', name: '星空', accent: '#afc8ff', bg: '#111728', surface: '#1b243a' },
  { id: 'physics', name: '物理学', accent: '#a7382e', bg: '#f5f3ee', surface: '#fffefa' },
];
const palettes = [
  { name: '深海青', color: '#16856f' },
  { name: '群青', color: '#4368c5' },
  { name: '雾紫', color: '#7856a0' },
  { name: '朱红', color: '#b14435' },
  { name: '琥珀', color: '#927025' },
];
const isHex = value => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
const skinById = id => skins.find(skin => skin.id === id);
let preferences;

function loadPreferences() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || '{}');
    const skin = skinById(saved?.skin)?.id || 'standard';
    const accents = Object.fromEntries(skins.map(item => [item.id, saved?.accents?.[item.id]]).filter(([, value]) => isHex(value)));
    return { skin, accents };
  } catch {
    return { skin: 'standard', accents: {} };
  }
}

function channels(color) {
  return [1, 3, 5].map(offset => parseInt(color.slice(offset, offset + 2), 16));
}

function luminance(color) {
  const weights = [0.2126, 0.7152, 0.0722];
  return channels(color).reduce((value, channel, index) => {
    const level = channel / 255;
    const linear = level <= 0.04045 ? level / 12.92 : ((level + 0.055) / 1.055) ** 2.4;
    return value + linear * weights[index];
  }, 0);
}

function contrast(color, background) {
  const a = luminance(color) + .05, b = luminance(background) + .05;
  return Math.max(a, b) / Math.min(a, b);
}

function mix(a, b, amount) {
  const target = channels(b);
  return '#' + channels(a).map((channel, index) => Math.round(channel * (1 - amount) + target[index] * amount).toString(16).padStart(2, '0')).join('');
}

function accessibleAccent(color, skin) {
  const target = skin.id === 'star' ? '#ffffff' : '#000000';
  for (let step = 0; step < 20; step++) {
    const option = mix(color, target, step / 20);
    if (contrast(option, skin.bg) >= 4.5 && contrast(option, skin.surface) >= 4.5) return option;
  }
  return target;
}

function applyTheme() {
  const skin = skinById(preferences.skin);
  const element = document.documentElement;
  const accent = preferences.accents[skin.id];
  element.dataset.labSkin = skin.id;
  if (accent) {
    const primary = accessibleAccent(accent, skin);
    const isDark = skin.id === 'star';
    const onPrimary = contrast(primary, '#080b12') >= 4.5 ? '#080b12' : '#ffffff';
    const hoverTarget = onPrimary === '#ffffff' ? '#000000' : '#ffffff';
    element.style.setProperty('--primary', primary);
    element.style.setProperty('--primary-dark', mix(primary, hoverTarget, .12));
    element.style.setProperty('--primary-soft', mix(skin.surface, primary, isDark ? .16 : .10));
    element.style.setProperty('--focus', primary);
    element.style.setProperty('--lab-on-primary', onPrimary);
  } else {
    for (const property of ['--primary', '--primary-dark', '--primary-soft', '--focus', '--lab-on-primary']) {
      element.style.removeProperty(property);
    }
  }
}

export function initializeTheme() {
  preferences = loadPreferences();
  applyTheme();
}

function updateTheme() {
  applyTheme();
  try { localStorage.setItem(storageKey, JSON.stringify(preferences)); } catch {}
}

function line(ctx, from, to, color, width = 1) {
  ctx.beginPath();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.moveTo(...from);
  ctx.lineTo(...to);
  ctx.stroke();
}

function drawPreview(canvas, skin) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const { width, height } = canvas;
  ctx.fillStyle = skin.bg;
  ctx.fillRect(0, 0, width, height);

  if (skin.id === 'star') {
    const glow = ctx.createRadialGradient(192, 62, 17, 192, 62, 153);
    glow.addColorStop(0, '#383974');
    glow.addColorStop(1, skin.bg);
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, height);
    let seed = 10929;
    const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
    for (let index = 0; index < 95; index++) {
      const x = random() * width, y = random() * height;
      ctx.fillStyle = 'rgba(210,229,255,' + (.15 + random() * .68) + ')';
      const size = random() > .95 ? 2.2 : 1;
      ctx.fillRect(x, y, size, size);
    }
    ctx.save();
    ctx.translate(width / 2, height / 2);
    ctx.rotate(-.26);
    ctx.strokeStyle = '#7686b9';
    for (const radii of [[55, 19], [77, 30], [109, 45]]) {
      ctx.beginPath();
      ctx.ellipse(0, 0, radii[0], radii[1], 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = '#cfddff';
    ctx.beginPath();
    ctx.arc(0, 0, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#a2b8f7';
    ctx.fillRect(70, 9, 5, 5);
    ctx.fillRect(-52, -10, 4, 4);
    ctx.restore();
    return;
  }

  if (skin.id === 'physics') {
    ctx.fillStyle = '#dfd7ca';
    ctx.fillRect(0, 0, width, height);
    ctx.save();
    ctx.translate(106, 28);
    ctx.rotate(-.25);
    ctx.fillStyle = '#ad3b2e';
    ctx.fillRect(-74, -60, 140, 134);
    ctx.fillStyle = '#e6b855';
    ctx.fillRect(117, -10, 103, 100);
    ctx.restore();

    ctx.fillStyle = '#252320';
    ctx.fillRect(92, 16, 5, 78);
    ctx.fillRect(74, 90, 74, 6);
    ctx.fillRect(93, 16, 57, 5);
    line(ctx, [149, 19], [166, 65], '#272320', 3);
    ctx.beginPath();
    ctx.arc(168, 73, 11, 0, Math.PI * 2);
    ctx.fillStyle = '#263f70';
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(257, 32);
    ctx.lineTo(231, 80);
    ctx.lineTo(287, 80);
    ctx.closePath();
    ctx.fillStyle = '#28394d';
    ctx.fill();
    line(ctx, [199, 42], [247, 52], '#fff7e7', 2.5);
    line(ctx, [265, 56], [307, 41], '#a3352a', 3);
    line(ctx, [269, 62], [313, 52], '#26567b', 3);
    line(ctx, [272, 68], [315, 65], '#fff8e8', 3);
    return;
  }

  ctx.fillStyle = '#e5eee7';
  ctx.fillRect(0, 0, width, height);
  for (let x = 14; x < width; x += 17) line(ctx, [x, 0], [x, height], '#cfddd3');
  for (let y = 7; y < height; y += 17) line(ctx, [0, y], [width, y], '#cfddd3');
  const points = [[80, 87], [121, 79], [162, 65], [203, 54], [244, 33], [285, 24]];
  line(ctx, [70, 91], [300, 20], '#16856f', 2);
  ctx.fillStyle = '#0c6a57';
  for (const [x, y] of points) {
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fill();
  }
}

export function mountThemeSettings(root, icon = () => '', notify = () => {}) {
  if (!root) return;
  if (!preferences) initializeTheme();

  root.innerHTML = '<section class="lab-appearance" aria-labelledby="lab-appearance-title">' +
    '<h2 id="lab-appearance-title">主题与皮肤</h2>' +
    '<div class="lab-skin-options" role="group" aria-label="界面皮肤">' +
    skins.map(skin => '<button type="button" class="lab-skin-choice" data-choose-skin="' + skin.id + '" aria-pressed="false">' +
      '<canvas width="360" height="110" aria-hidden="true"></canvas><span>' + skin.name +
      '<i class="lab-skin-check">' + icon('check') + '</i></span></button>').join('') + '</div>' +
    '<div class="lab-accent-controls"><div class="lab-accent-group"><h3>推荐配色</h3>' +
    '<div class="lab-color-options" role="group" aria-label="推荐配色">' +
    palettes.map(({ name, color }) => '<button type="button" class="lab-color-option" data-choose-color="' + color +
      '" style="--lab-swatch:' + color + '" aria-label="' + name + ' ' + color.toUpperCase() +
      '" title="' + name + ' ' + color.toUpperCase() + '" aria-pressed="false"></button>').join('') + '</div></div>' +
    '<div class="lab-accent-group"><h3><label for="lab-theme-color">自定义主题色</label></h3>' +
    '<div class="lab-color-picker"><input type="color" id="lab-theme-color" aria-label="自定义主题色">' +
    '<output for="lab-theme-color"></output>' +
    '<button type="button" class="lab-icon lab-accent-reset" data-reset-color title="恢复皮肤默认配色" aria-label="恢复皮肤默认配色">' +
    icon('rotate-ccw') + '</button></div></div></div></section>';

  for (const button of root.querySelectorAll('[data-choose-skin]')) {
    drawPreview(button.querySelector('canvas'), skinById(button.dataset.chooseSkin));
  }

  const input = root.querySelector('#lab-theme-color');
  const readout = root.querySelector('output');
  const reset = root.querySelector('[data-reset-color]');
  function updateControls() {
    const skin = skinById(preferences.skin);
    const selectedColor = preferences.accents[skin.id] || skin.accent;
    input.value = selectedColor.toLowerCase();
    readout.value = selectedColor.toUpperCase();
    reset.disabled = !preferences.accents[skin.id];
    for (const choice of root.querySelectorAll('[data-choose-skin]')) {
      choice.setAttribute('aria-pressed', choice.dataset.chooseSkin === skin.id);
    }
    for (const choice of root.querySelectorAll('[data-choose-color]')) {
      choice.setAttribute('aria-pressed', choice.dataset.chooseColor === selectedColor.toLowerCase());
    }
  }

  const change = () => {
    preferences.accents[preferences.skin] = input.value;
    updateTheme();
    updateControls();
  };
  const click = event => {
    const button = event.target.closest('button');
    if (!button) return;
    if (skinById(button.dataset.chooseSkin)) {
      preferences.skin = button.dataset.chooseSkin;
    } else if (isHex(button.dataset.chooseColor)) {
      preferences.accents[preferences.skin] = button.dataset.chooseColor;
    } else if (button.hasAttribute('data-reset-color')) {
      delete preferences.accents[preferences.skin];
      notify('已恢复皮肤默认配色');
    } else {
      return;
    }
    updateTheme();
    updateControls();
  };
  input.addEventListener('input', change);
  root.addEventListener('click', click);
  updateControls();
  return () => {
    input.removeEventListener('input', change);
    root.removeEventListener('click', click);
  };
}
