const coverageFactor = 2;

export function measurementStats(values, instrumentLimit, math = globalThis.math) {
  const n = values.length;
  const scale = Math.max(0, ...values.map(Math.abs)) || 1;
  const normalized = values.map(value => value / scale);
  const mean = n ? math.mean(normalized) * scale : null;
  const deviation = n >= 2 ? math.std(normalized, 'unbiased') * scale : null;
  const typeA = deviation === null ? null : deviation / Math.sqrt(n);
  const typeB = instrumentLimit === null ? null : instrumentLimit / Math.sqrt(3);
  const combined = typeA === null || typeB === null ? null : Math.hypot(typeA, typeB);
  const expanded = combined === null ? null : coverageFactor * combined;
  const relative = combined === null || !mean ? null : 100 * (combined / Math.abs(mean));
  return { n, mean, deviation, typeA, typeB, combined, expanded, relative };
}

const metrics = [
  ['n', '有效读数 n'],
  ['mean', '平均值'],
  ['deviation', '样本标准差 s'],
  ['typeA', 'A 类不确定度 uA'],
  ['typeB', 'B 类不确定度 uB'],
  ['combined', '合成标准不确定度 uC'],
  ['expanded', '扩展不确定度 U（k = 2）'],
  ['relative', '相对标准不确定度'],
];

export function mountUncertainty(root, { numeric, display, icon, notify, onLimitChange }) {
  root.innerHTML = `
    <summary>统计与不确定度</summary>
    <div class="dw-uncertainty-heading">
      <p data-uncertainty-source></p>
      <button type="button" class="dw-icon" aria-label="复制统计结果" title="复制统计结果" data-uncertainty-copy disabled>${icon('copy')}</button>
    </div>
    <div class="dw-form-row">
      <label>仪器误差限 Δ <input data-uncertainty-limit type="text" inputmode="decimal" placeholder="填写非负误差限"></label>
    </div>
    <p class="dw-uncertainty-note">适用于同一条件下的重复测量。B 类不确定度按均匀分布估计，uB = Δ / √3。</p>
    <dl class="dw-metrics dw-uncertainty-metrics">
      ${metrics.map(([key, name]) => `<div><dt>${name}</dt><dd data-uncertainty-stat="${key}">—</dd></div>`).join('')}
    </dl>
    <p class="dw-status" data-uncertainty-status role="status"></p>
  `;

  const input = root.querySelector('[data-uncertainty-limit]');
  const source = root.querySelector('[data-uncertainty-source]');
  const copy = root.querySelector('[data-uncertainty-copy]');
  const status = root.querySelector('[data-uncertainty-status]');
  const outputs = new Map(metrics.map(([key]) => [key, root.querySelector('[data-uncertainty-stat="' + key + '"]')]));
  let copiedText = '';

  input.addEventListener('input', () => onLimitChange(input.value));
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(copiedText);
      notify('已复制统计结果。');
    } catch {
      notify('无法访问剪贴板，可选择结果后手动复制。');
    }
  });

  return ({ column, rows, limit }) => {
    const { key, label, unit } = column;
    const values = rows.map(row => numeric(row[key])).filter(value => value !== null);
    const delta = numeric(limit);
    const invalid = limit.trim() && (delta === null || delta < 0);
    const result = measurementStats(values, invalid ? null : delta);
    const columnLabel = label + (unit ? '（' + unit + '）' : '');
    if (input.value !== limit) input.value = limit;
    input.setAttribute('aria-invalid', invalid ? 'true' : 'false');
    source.textContent = 'Y 轴列 · ' + columnLabel;
    status.textContent = invalid ? '请输入非负的仪器误差限。' :
      result.n < 2 ? '样本标准差和 A 类不确定度至少需要 2 个有效读数。' : '';

    const lines = [];
    for (const [name, metricLabel] of metrics) {
      const value = result[name];
      const suffix = name === 'n' ? '' : name === 'relative' ? '%' : unit ? ' ' + unit : '';
      const formatted = Number.isFinite(value) ? display(value) + suffix : '—';
      outputs.get(name).textContent = formatted;
      if (formatted !== '—') lines.push(metricLabel + ' ' + formatted);
    }
    copy.disabled = !result.n;
    copiedText = ['测量统计 · ' + columnLabel, ...lines].join('\n');
  };
}
