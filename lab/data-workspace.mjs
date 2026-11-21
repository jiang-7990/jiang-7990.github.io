import { mountUncertainty } from './uncertainty-ui.mjs';

const fitModes = [
  ['none', '仅散点'],
  ['linear', '线性拟合'],
  ['quadratic', '二次拟合'],
  ['exponential', '指数拟合'],
  ['logarithmic', '对数拟合'],
  ['power', '幂函数拟合'],
];

const mathFunctions = new Set([
  'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'sqrt', 'cbrt', 'abs', 'exp',
  'ln', 'log', 'log10', 'sinh', 'cosh', 'tanh', 'floor', 'ceil', 'round',
]);
const mathSymbols = new Set(['pi', 'e', ...mathFunctions]);
const mathOperators = new Set(['+', '-', '*', '/', '^']);
const allowedNodes = new Set(['OperatorNode', 'ConstantNode', 'SymbolNode', 'FunctionNode', 'ParenthesisNode']);
const maxRows = 500;
const maxColumns = 20;

const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]);

function numeric(value) {
  const clean = String(value ?? '').trim().replaceAll('−', '-');
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(clean)) return null;
  const number = Number(clean);
  return Number.isFinite(number) ? number : null;
}

function display(value, digits = 6) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return Number(value.toPrecision(digits)).toString().replaceAll('-', '−');
}

function axisLabel(column) {
  return column.unit ? `${column.label}（${column.unit}）` : column.label;
}

function parseTable(text) {
  const source = text.replace(/^\uFEFF/, '');
  const separator = source.includes('\t') ? '\t' : ',';
  const rows = [];
  let row = [];
  let value = '';
  let quoted = false;
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (char === '"') {
      if (quoted && source[i + 1] === '"') {
        value += '"';
        i++;
      } else if (quoted || value === '') {
        quoted = !quoted;
      } else {
        value += char;
      }
    } else if (!quoted && char === separator) {
      row.push(value.trim());
      value = '';
    } else if (!quoted && (char === '\n' || char === '\r')) {
      if (char === '\r' && source[i + 1] === '\n') i++;
      row.push(value.trim());
      rows.push(row);
      row = [];
      value = '';
    } else {
      value += char;
    }
  }
  row.push(value.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function getPairs(rows, xKey, yKey) {
  const points = [];
  let incomplete = 0;
  rows.forEach((row, index) => {
    const x = numeric(row[xKey]);
    const y = numeric(row[yKey]);
    if (x !== null && y !== null) {
      points.push({ x, y, row: index + 1 });
    } else if (String(row[xKey] ?? '').trim() || String(row[yKey] ?? '').trim()) {
      incomplete++;
    }
  });
  return { points, incomplete };
}

function fitData(points, mode) {
  if (mode === 'none') return {};
  if (!globalThis.regression) return { message: '拟合组件未加载。' };
  const degree = mode === 'quadratic' ? 2 : 1;
  if (new Set(points.map(point => point.x)).size <= degree) {
    return { message: `需要至少 ${degree + 1} 个不同的 X 值。` };
  }
  if ((mode === 'logarithmic' || mode === 'power') && points.some(point => point.x <= 0)) {
    return { message: '此模型要求所有 X 大于 0。' };
  }
  if ((mode === 'exponential' || mode === 'power') && points.some(point => point.y <= 0)) {
    return { message: '此模型要求所有 Y 大于 0。' };
  }

  const opts = { precision: 15 };
  const original = points.map(({ x, y }) => [x, y]);
  const center = Math.min(...points.map(p => p.x)) / 2 + Math.max(...points.map(p => p.x)) / 2;
  const scale = Math.max(...points.map(p => Math.abs(p.x - center)));
  const yScale = Math.max(...points.map(p => Math.abs(p.y))) || 1;
  const normalizeX = x => (x - center) / scale;
  const scaledPoints = original.map(([x, y]) => [normalizeX(x), y / yScale]);
  let estimate;
  let coefficients;
  let equation;

  try {
    if (mode === 'linear') {
      const result = regression.linear(scaledPoints, opts);
      const [normalizedSlope, normalizedIntercept] = result.equation.map(value => value * yScale);
      const slope = normalizedSlope / scale;
      const intercept = normalizedIntercept - slope * center;
      coefficients = [{ name: '斜率', value: slope }, { name: '截距', value: intercept }];
      equation = `y = ${display(slope)}x ${signTerm(intercept)}`;
      estimate = x => normalizedSlope * normalizeX(x) + normalizedIntercept;
    } else if (mode === 'quadratic') {
      const result = regression.polynomial(scaledPoints, { ...opts, order: 2 });
      const [a, b, c] = result.equation.map(value => value * yScale);
      const quadratic = a / scale / scale;
      const linear = b / scale - 2 * quadratic * center;
      const constant = c - b * (center / scale) + quadratic * center * center;
      coefficients = [{ name: 'a', value: quadratic }, { name: 'b', value: linear }, { name: 'c', value: constant }];
      equation = `y = ${display(quadratic)}x² ${signTerm(linear, 'x')} ${signTerm(constant)}`;
      estimate = x => (a * normalizeX(x) + b) * normalizeX(x) + c;
    } else {
      const result = regression[mode](original, opts);
      const [a, b] = result.equation;
      coefficients = [{ name: 'a', value: a }, { name: 'b', value: b }];
      if (mode === 'exponential') {
        equation = `y = ${display(a)} · exp(${display(b)}x)`;
        estimate = x => a * Math.exp(b * x);
      }
      if (mode === 'logarithmic') {
        equation = `y = ${display(a)} ${signTerm(b, ' ln(x)')}`;
        estimate = x => a + b * Math.log(x);
      }
      if (mode === 'power') {
        equation = `y = ${display(a)} · x^(${display(b)})`;
        estimate = x => a * x ** b;
      }
    }

    const results = points.map(({ x, y, row }) => {
      const predicted = estimate(x);
      return { x, y, row, predicted, residual: y - predicted };
    });
    if (coefficients.some(item => !Number.isFinite(item.value)) ||
        results.some(item => !Number.isFinite(item.residual))) {
      return { message: '此数据上无法得到稳定的拟合结果。' };
    }
    const mean = results.reduce((sum, p) => sum + p.y / yScale, 0) / results.length;
    const total = results.reduce((sum, p) => sum + (p.y / yScale - mean) ** 2, 0);
    const squaredError = results.reduce((sum, p) => sum + (p.residual / yScale) ** 2, 0);
    return {
      equation, coefficients, results, estimate,
      r2: points.every(point => point.y === points[0].y) ? null : 1 - squaredError / total,
      rmse: Math.sqrt(squaredError / results.length) * yScale,
    };
  } catch {
    return { message: '此数据上无法得到稳定的拟合结果。' };
  }
}

function signTerm(value, suffix = '') {
  return `${value < 0 ? '−' : '+'} ${display(Math.abs(value))}${suffix}`;
}

function curvePoints(fn, min, max) {
  return Array.from({ length: 201 }, (_, index) => {
    const x = min + (max - min) * (index / 200);
    let y = null;
    try {
      const value = fn(x);
      if (typeof value === 'number' && Number.isFinite(value)) y = value;
    } catch {
      // An individual X can be outside the real domain of an expression.
    }
    return { x, y };
  });
}

function compileScalar(source, allowedVariables) {
  const expression = source.replaceAll('π', 'pi').replaceAll('−', '-').replaceAll('×', '*').replaceAll('÷', '/');
  const node = math.parse(expression.replace(/\bln(?=\s*\()/g, 'log'));
  const variables = new Set();
  node.traverse(part => {
    if (!allowedNodes.has(part.type)) throw new Error('Unsupported expression');
    if (part.type === 'OperatorNode' && !mathOperators.has(part.op)) throw new Error('Unsupported operator');
    if (part.type === 'ConstantNode' && typeof part.value !== 'number') throw new Error('Unsupported constant');
    if (part.type === 'SymbolNode' && !mathSymbols.has(part.name)) {
      if (!allowedVariables.has(part.name)) throw new Error('Unsupported symbol');
      variables.add(part.name);
    }
    if (part.type === 'FunctionNode' && !mathFunctions.has(part.fn.name)) throw new Error('Unsupported function');
  });
  return { expression: node.compile(), variables };
}

function formulaData(raw, minText, maxText, automaticRange) {
  const expression = raw.trim().replace(/^\s*y\s*=\s*/i, '');
  if (!expression) return raw.trim() ? { message: '请填写公式右边的表达式。' } : {};
  if (expression.length > 150) return { message: '公式最多 150 个字符。' };
  if (!globalThis.math) return { message: '公式组件未加载。' };
  const min = minText.trim() ? numeric(minText) : automaticRange[0];
  const max = maxText.trim() ? numeric(maxText) : automaticRange[1];
  if (min === null || max === null || min >= max || !Number.isFinite(max - min)) {
    return { message: '请输入有效的 X 范围，起点须小于终点。' };
  }
  try {
    const { expression: formula } = compileScalar(expression, new Set(['x']));
    const points = curvePoints(x => formula.evaluate({ x }), min, max);
    return points.some(point => point.y !== null) ? { points } : { message: '该范围内没有可绘制的实数结果。' };
  } catch {
    return { message: '公式无效。可使用 x、π（pi）、e 和常见数学函数。' };
  }
}

function currentRange(points) {
  if (!points.length) return [-5, 5];
  const low = Math.min(...points.map(p => p.x));
  const high = Math.max(...points.map(p => p.x));
  return low === high ? [low - 1, high + 1] : [low, high];
}

const exportBackground = {
  id: 'labmate-white-background',
  beforeDraw(chart) {
    const { ctx, width, height } = chart;
    ctx.save();
    ctx.globalCompositeOperation = 'destination-over';
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  },
};

const instrumentErrorBars = {
  id: 'instrument-error-bars',
  beforeDatasetDraw({ ctx, scales, data }, { index }) {
    const { instrumentLimit: limit, data: points } = data.datasets[index];
    if (!(limit > 0)) return;
    ctx.save();
    ctx.strokeStyle = '#08795f';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const { x, y } of points) {
      const center = scales.x.getPixelForValue(x);
      const top = scales.y.getPixelForValue(y + limit);
      const bottom = scales.y.getPixelForValue(y - limit);
      ctx.moveTo(center, top);
      ctx.lineTo(center, bottom);
      ctx.moveTo(center - 4, top);
      ctx.lineTo(center + 4, top);
      ctx.moveTo(center - 4, bottom);
      ctx.lineTo(center + 4, bottom);
    }
    ctx.stroke();
    ctx.restore();
  },
};

export function mountDataWorkspace(root, { experiment, record, onSave, notify = () => {}, icon = () => '' } = {}) {
  const saved = record?.payload ?? {};
  const baseColumns = [
    { key: 'x', label: 'X', unit: '' },
    { key: 'y', label: 'Y', unit: '' },
  ];
  const presetColumns = experiment?.columns?.length >= 2 ? experiment.columns : baseColumns;
  const columns = (saved.columns?.length >= 2 ? saved.columns : presetColumns)
    .slice(0, maxColumns).map(column => ({ ...column }));
  const rows = (saved.rows?.length ? saved.rows : Array.from({ length: 5 }, () => ({})))
    .slice(0, maxRows).map(row => ({ ...row }));
  const validKey = (key, fallback) => columns.some(column => column.key === key) ? key : columns[fallback].key;
  const state = {
    columns, rows,
    xKey: validKey(saved.xKey ?? experiment?.xKey, 0),
    yKey: validKey(saved.yKey ?? experiment?.yKey, 1),
    fit: fitModes.some(([key]) => key === (saved.fit ?? experiment?.fit)) ? saved.fit ?? experiment.fit : 'linear',
    formula: String(saved.formula ?? ''),
    min: String(saved.min ?? ''),
    max: String(saved.max ?? ''),
    measured: String(saved.measured ?? ''),
    reference: String(saved.reference ?? experiment?.reference?.value ?? ''),
    instrumentLimits: Object.fromEntries(Object.entries(saved.instrumentLimits ?? {})
      .filter(([key]) => columns.some(column => column.key === key))
      .map(([key, value]) => [key, String(value)])),
  };

  const toolbarButton = (action, symbol, label, attrs = '') =>
    `<button type="button" class="dw-icon" data-dw-action="${action}" title="${label}" aria-label="${label}" ${attrs}>${icon(symbol)}</button>`;
  const title = record?.title ?? experiment?.title ?? experiment?.name ?? '新建数据处理';
  const reference = experiment?.reference;
  const compiledColumns = new Map();
  if (globalThis.math) {
    const columnKeys = new Set(columns.map(column => column.key));
    for (const column of columns.filter(column => column.compute)) {
      try {
        compiledColumns.set(column.key, compileScalar(column.compute, columnKeys));
      } catch {
        // A stored formula can be outdated if its input column was removed.
      }
    }
  }
  let chart;
  let raf = 0;
  let lastFit;
  let disposed = false;
  const controller = new AbortController();

  root.innerHTML = `
    <div class="dw">
      <header class="dw-header">
        <div class="dw-title-group">
          <label for="dw-title" class="dw-eyebrow">实验数据处理</label>
          <input id="dw-title" class="dw-title" type="text" value="${escape(title)}" maxlength="100" aria-label="工作台名称">
        </div>
        <button class="dw-save" data-dw-action="save" type="button">${icon('save')}<span>保存</span></button>
      </header>
      <div class="dw-panes">
        <section class="dw-table-pane" aria-labelledby="dw-table-title">
          <div class="dw-bar">
            <h2 id="dw-table-title">数据表</h2>
            <div class="dw-actions">
              ${toolbarButton('add-row', 'list-plus', '添加一行')}
              ${toolbarButton('add-column', 'columns-3', '添加一列')}
              ${toolbarButton('import', 'upload', '导入 CSV 或 TSV')}
              ${experiment?.sampleRows?.length ? toolbarButton('sample', 'flask-conical', '载入示例数据') : ''}
              <input id="dw-import" hidden type="file" accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain" aria-label="导入数据文件">
            </div>
          </div>
          <div class="dw-grid" tabindex="0" aria-label="可编辑实验表格">
            <table id="dw-table"></table>
          </div>
          <div class="dw-table-footer">
            <span id="dw-row-count"></span>
            <button type="button" class="dw-text-button" data-dw-action="add-row">${icon('plus')}添加一行</button>
          </div>
          <div id="dw-table-status" class="dw-status" role="status"></div>
          <section class="dw-error" aria-labelledby="dw-error-title">
            <div class="dw-bar">
              <h2 id="dw-error-title">误差计算</h2>
              <button class="dw-text-button" data-dw-action="use-slope" type="button" disabled>${icon('arrow-down-to-line')}取拟合斜率</button>
            </div>
            <div class="dw-form-row">
              <label>测量值 <input data-dw-field="measured" type="text" inputmode="decimal" placeholder="填写测量值" value="${escape(state.measured)}"></label>
              <label>${escape(reference?.label ?? '参考值')}${reference?.unit ? `（${escape(reference.unit)}）` : ''} <input data-dw-field="reference" type="text" inputmode="decimal" placeholder="填写参考值" value="${escape(state.reference)}"></label>
            </div>
            <dl class="dw-metrics dw-error-result">
              <div><dt>绝对误差</dt><dd id="dw-absolute">—</dd></div>
              <div><dt>相对误差</dt><dd id="dw-relative">—</dd></div>
            </dl>
            <div id="dw-error-status" class="dw-status" role="status"></div>
          </section>
          <details class="dw-uncertainty" data-dw-uncertainty></details>
        </section>
        <section class="dw-plot-pane" aria-labelledby="dw-plot-title">
          <div class="dw-bar">
            <h2 id="dw-plot-title">图表与拟合</h2>
            <div class="dw-actions">${toolbarButton('download', 'download', '下载图表 PNG', 'disabled')}</div>
          </div>
          <div class="dw-form-row dw-chart-controls">
            <label>X 轴 <select data-dw-field="xKey"></select></label>
            <label>Y 轴 <select data-dw-field="yKey"></select></label>
            <label>拟合方式 <select data-dw-field="fit">${fitModes.map(([key, label]) => `<option value="${key}"${state.fit === key ? ' selected' : ''}>${label}</option>`).join('')}</select></label>
          </div>
          <div class="dw-calc-frame">
            <canvas id="dw-plot" role="img" aria-label="实验数据散点、拟合曲线和公式曲线"></canvas>
            <div id="dw-plot-empty" class="dw-empty">
              ${icon('chart-no-axes-combined')}
              <span>填写数据或输入公式以绘图</span>
            </div>
          </div>
          <div class="dw-form-row dw-formula-controls">
            <label>公式 <input data-dw-field="formula" type="text" placeholder="例如 y = 2x + 1" maxlength="150" value="${escape(state.formula)}"></label>
            <label>X 起点 <input data-dw-field="min" type="text" inputmode="decimal" placeholder="自动" value="${escape(state.min)}"></label>
            <label>X 终点 <input data-dw-field="max" type="text" inputmode="decimal" placeholder="自动" value="${escape(state.max)}"></label>
          </div>
          <div id="dw-formula-status" class="dw-status" role="status"></div>
          <section class="dw-fit-result" aria-labelledby="dw-fit-title">
            <div class="dw-bar">
              <h2 id="dw-fit-title">拟合结果</h2>
              <span id="dw-points-count" class="dw-count"></span>
            </div>
            <div id="dw-equation" class="dw-equation"></div>
            <dl id="dw-fit-metrics" class="dw-metrics"></dl>
            <details id="dw-residuals" hidden>
              <summary>各数据点残差</summary>
              <div class="dw-residual-grid" id="dw-residual-grid"></div>
            </details>
          </section>
        </section>
      </div>
    </div>`;

  const get = selector => root.querySelector(selector);
  const table = get('#dw-table');
  const canvas = get('#dw-plot');
  const downloadButton = get('[data-dw-action="download"]');
  const slopeButton = get('[data-dw-action="use-slope"]');
  const renderUncertainty = mountUncertainty(get('[data-dw-uncertainty]'), {
    numeric, display, icon, notify,
    onLimitChange: value => {
      state.instrumentLimits[state.yKey] = value;
      scheduleResults();
    },
  });

  function materializeRows() {
    for (const row of state.rows) {
      for (const column of state.columns) {
        if (!column.compute) continue;
        row[column.key] = '';
        const compiled = compiledColumns.get(column.key);
        if (!compiled) continue;
        const inputs = [...compiled.variables].map(key => [key, numeric(row[key])]);
        if (inputs.some(([, value]) => value === null)) continue;
        try {
          const value = compiled.expression.evaluate(new Map(inputs));
          if (typeof value === 'number' && Number.isFinite(value)) row[column.key] = value;
        } catch {
          // Some input combinations are outside the real domain.
        }
      }
    }
  }

  function renderAxes() {
    for (const name of ['xKey', 'yKey']) {
      const select = get(`[data-dw-field="${name}"]`);
      select.innerHTML = state.columns.map(column =>
        `<option value="${escape(column.key)}"${state[name] === column.key ? ' selected' : ''}>${escape(axisLabel(column))}</option>`
      ).join('');
    }
  }

  function renderRows() {
    table.innerHTML = `
      <thead><tr><th scope="col" class="dw-row-number">#</th>
        ${state.columns.map((column, index) => `
          <th scope="col">
            <div class="dw-column">
              <input type="text" data-dw-col="${index}" data-dw-prop="label" value="${escape(column.label)}" placeholder="列 ${index + 1}" maxlength="32" aria-label="第 ${index + 1} 列表头">
              <input type="text" data-dw-col="${index}" data-dw-prop="unit" value="${escape(column.unit)}" placeholder="单位" maxlength="14" aria-label="第 ${index + 1} 列单位">
              ${!experiment && state.columns.length > 2 ? toolbarButton(`column:${index}`, 'x', '删除该列') : ''}
            </div>
          </th>`).join('')}
        <th scope="col" class="dw-row-action"><span class="dw-sr-only">行操作</span></th>
      </tr></thead>
      <tbody>${state.rows.map((row, rowIndex) => `
        <tr><th scope="row" class="dw-row-number">${rowIndex + 1}</th>
          ${state.columns.map((column, index) => `
            <td><input type="text" inputmode="decimal" value="${escape(column.compute && row[column.key] !== '' ? display(row[column.key], 9) : row[column.key])}" data-dw-cell="${rowIndex},${index}" maxlength="40" aria-label="第 ${rowIndex + 1} 行第 ${index + 1} 列" ${column.compute ? 'readonly title="计算列"' : ''}></td>`
          ).join('')}
          <td class="dw-row-action">${toolbarButton(`row:${rowIndex}`, 'trash-2', '删除这一行')}</td>
        </tr>`).join('')}</tbody>`;
    get('#dw-row-count').textContent = `${state.rows.length} 行 · ${state.columns.length} 列`;
  }

  function errorState() {
    const autoMeasure = reference && state.fit === 'linear' && state.xKey === experiment.xKey && state.yKey === experiment.yKey;
    const slope = autoMeasure ? lastFit?.coefficients?.[0]?.value ?? null : null;
    const measuredInput = get('[data-dw-field="measured"]');
    measuredInput.placeholder = slope === null ? '填写测量值' : display(slope, 8);
    const measured = state.measured.trim() ? numeric(state.measured) : slope;
    const referenceValue = numeric(state.reference);
    const absolute = measured === null || referenceValue === null ? null : Math.abs(measured - referenceValue);
    const relative = absolute === null || referenceValue === 0 ? null : 100 * (absolute / Math.abs(referenceValue));
    get('#dw-absolute').textContent = absolute === null ? '—' : `${display(absolute)}${reference?.unit ? ` ${reference.unit}` : ''}`;
    get('#dw-relative').textContent = relative === null ? '—' : `${display(relative)}%`;
    const badInput = (state.measured.trim() && measured === null) || (state.reference.trim() && referenceValue === null);
    get('#dw-error-status').textContent = badInput
      ? '请输入有效数字。'
      : absolute !== null && referenceValue === 0 ? '参考值为 0，无法计算相对误差。' : '';
  }

  function renderChart(points, fit, formula, range) {
    const empty = get('#dw-plot-empty');
    const hasData = points.length || formula.points?.length;
    const xColumn = state.columns.find(column => column.key === state.xKey);
    const yColumn = state.columns.find(column => column.key === state.yKey);
    empty.hidden = Boolean(hasData && globalThis.Chart);
    empty.querySelector('span').textContent = globalThis.Chart ? '填写数据或输入公式以绘图' : '图表组件未加载。';
    downloadButton.disabled = !(hasData && globalThis.Chart);

    if (!globalThis.Chart) return;
    const datasets = [];
    const limit = numeric(state.instrumentLimits[state.yKey]);
    const showBars = limit > 0 && points.length && points.every(point =>
      Number.isFinite(point.y - limit) && Number.isFinite(point.y + limit));
    const lowerBound = showBars ? Math.min(...points.map(point => point.y - limit)) : undefined;
    const upperBound = showBars ? Math.max(...points.map(point => point.y + limit)) : undefined;
    if (points.length) {
      const interval = showBars ? '（±' + display(limit) + (yColumn?.unit ? ' ' + yColumn.unit : '') + '）' : '';
      datasets.push({
        label: '实验数据' + interval, data: points, pointRadius: 4.5, pointHoverRadius: 6,
        backgroundColor: '#08795f', instrumentLimit: showBars ? limit : null,
      });
    }
    if (fit.estimate) {
      datasets.push({
        label: '拟合曲线', data: curvePoints(fit.estimate, ...range), showLine: true, pointRadius: 0,
        borderColor: '#2256a1', borderWidth: 2, spanGaps: false,
      });
    }
    if (formula.points) {
      datasets.push({
        label: '自定义公式', data: formula.points, showLine: true, pointRadius: 0,
        borderColor: '#a94056', borderWidth: 2, borderDash: [5, 3], spanGaps: false,
      });
    }

    if (!chart) {
      chart = new Chart(canvas, {
        type: 'scatter',
        data: { datasets },
        plugins: [exportBackground, instrumentErrorBars],
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          interaction: { mode: 'nearest', intersect: true },
          scales: {
            x: {
              type: 'linear', position: 'bottom', title: { display: true, text: axisLabel(xColumn), color: '#354e47' },
              grid: { color: '#e6ece8' }, ticks: { color: '#52655f', maxTicksLimit: 8 },
            },
            y: {
              type: 'linear', title: { display: true, text: axisLabel(yColumn), color: '#354e47' },
              suggestedMin: lowerBound, suggestedMax: upperBound,
              grid: { color: '#e6ece8' }, ticks: { color: '#52655f', maxTicksLimit: 7 },
            },
          },
          plugins: {
            legend: { labels: { boxWidth: 12, boxHeight: 8, usePointStyle: true, color: '#354e47' } },
            tooltip: {
              callbacks: { label: item => `${item.dataset.label} (${display(item.parsed.x)}, ${display(item.parsed.y)})` },
            },
          },
        },
      });
      return;
    }

    chart.data.datasets = datasets;
    chart.options.scales.x.title.text = axisLabel(xColumn);
    chart.options.scales.y.title.text = axisLabel(yColumn);
    chart.options.scales.y.suggestedMin = lowerBound;
    chart.options.scales.y.suggestedMax = upperBound;
    chart.update('none');
  }

  function renderFit(fit, count) {
    get('#dw-points-count').textContent = `${count} 个有效点`;
    get('#dw-equation').textContent = fit.equation ?? fit.message ?? (state.fit === 'none' ? '仅显示散点' : '');
    const fitMetrics = get('#dw-fit-metrics');
    fitMetrics.innerHTML = fit.equation ? [
      ...fit.coefficients,
      { name: '决定系数 R²', value: fit.r2 },
      { name: '均方根误差 RMSE', value: fit.rmse },
    ].map(item => `<div><dt>${item.name}</dt><dd>${display(item.value)}</dd></div>`).join('') : '';
    slopeButton.disabled = !(fit.equation && state.fit === 'linear');
    get('#dw-residuals').hidden = !fit.results;
    const residualGrid = get('#dw-residual-grid');
    if (fit.results) {
      residualGrid.innerHTML = `<table>
        <thead><tr><th scope="col">数据行</th><th scope="col">实测值</th><th scope="col">拟合值</th><th scope="col">残差</th></tr></thead>
        <tbody>${fit.results.map(item => `<tr><th scope="row">${item.row}</th><td>${display(item.y)}</td><td>${display(item.predicted)}</td><td>${display(item.residual)}</td></tr>`).join('')}</tbody>
      </table>`;
    } else {
      residualGrid.replaceChildren();
    }
  }

  function updateResults() {
    raf = 0;
    materializeRows();
    for (const input of table.querySelectorAll('input[readonly]')) {
      const [row, column] = input.dataset.dwCell.split(',').map(Number);
      const value = state.rows[row][state.columns[column].key];
      input.value = value === '' ? '' : display(value, 9);
    }
    const { points, incomplete } = getPairs(state.rows, state.xKey, state.yKey);
    const range = currentRange(points);
    lastFit = fitData(points, state.fit);
    const formula = formulaData(state.formula, state.min, state.max, range);
    get('#dw-formula-status').textContent = formula.message ?? '';
    get('#dw-table-status').textContent = incomplete ? `${incomplete} 行的 X 或 Y 缺少有效数字。` : '';
    renderChart(points, lastFit, formula, range);
    renderFit(lastFit, points.length);
    errorState();
    const yColumn = state.columns.find(column => column.key === state.yKey);
    renderUncertainty({
      column: yColumn, rows: state.rows,
      limit: Object.hasOwn(state.instrumentLimits, state.yKey) ? state.instrumentLimits[state.yKey] : '',
    });
  }

  function scheduleResults() {
    if (!raf) raf = requestAnimationFrame(updateResults);
  }

  function refreshTable() {
    materializeRows();
    renderRows();
    renderAxes();
    scheduleResults();
  }

  function loadGrid(values, firstRow = 0, firstColumn = 0) {
    if (!values.length) return;
    const imported = values.slice(0, maxRows - firstRow);
    const width = Math.max(...imported.map(row => row.length));
    let newKey = 0;
    const needed = Math.min(maxColumns, width + firstColumn);
    while (state.columns.length < needed) {
      while (state.columns.some(column => column.key === `c${newKey}`)) newKey++;
      state.columns.push({ key: `c${newKey}`, label: `列 ${state.columns.length + 1}`, unit: '' });
    }
    const allColumns = state.columns.slice(firstColumn);
    const inputColumns = allColumns.filter(column => !column.compute);
    const targetColumns = width <= inputColumns.length ? inputColumns : allColumns;
    imported.forEach((row, index) => {
      const target = state.rows[firstRow + index] ?? (state.rows[firstRow + index] = {});
      row.slice(0, targetColumns.length).forEach((value, offset) => {
        const column = targetColumns[offset];
        if (!column.compute) target[column.key] = value.slice(0, 40);
      });
    });
    refreshTable();
  }

  root.addEventListener('input', event => {
    const target = event.target;
    if (!target.matches('input, select')) return;
    if (target.dataset.dwCell) {
      const [row, column] = target.dataset.dwCell.split(',').map(Number);
      state.rows[row][state.columns[column].key] = target.value;
      target.setAttribute('aria-invalid', Boolean(target.value.trim() && numeric(target.value) === null));
    }
    if (target.dataset.dwProp) {
      const index = Number(target.dataset.dwCol);
      const value = target.value.trim() || (target.dataset.dwProp === 'label' ? `列 ${index + 1}` : '');
      state.columns[index][target.dataset.dwProp] = value;
      renderAxes();
    }
    if (target.dataset.dwField) state[target.dataset.dwField] = target.value;
    scheduleResults();
  }, { signal: controller.signal });

  root.addEventListener('change', async event => {
    const target = event.target;
    if (target.id !== 'dw-import') return;
    const file = target.files[0];
    target.value = '';
    if (!file) return;
    if (file.size > 1_000_000) return notify('数据文件需小于 1 MB。');
    try {
      const source = await file.text();
      const values = parseTable(source).filter(row => row.some(Boolean));
      if (!values.length) return notify('文件中没有数据。');
      if (disposed) return;
      const headers = values[0].every(value => value && numeric(value) === null) ? values.shift() : null;
      state.rows = [];
      if (!values.length) state.rows.push({});
      loadGrid(values.length ? values : [headers.map(() => '')]);
      headers?.slice(0, maxColumns).forEach((label, index) => { state.columns[index].label = label.slice(0, 32); });
      refreshTable();
      notify('已导入数据文件。');
    } catch {
      notify('读取文件失败。');
    }
  }, { signal: controller.signal });

  root.addEventListener('paste', event => {
    if (!event.target.dataset.dwCell || event.target.readOnly) return;
    const text = event.clipboardData?.getData('text/plain');
    if (!text || !/[\t\n\r,]/.test(text)) return;
    event.preventDefault();
    const [row, column] = event.target.dataset.dwCell.split(',').map(Number);
    loadGrid(parseTable(text), row, column);
  }, { signal: controller.signal });

  root.addEventListener('keydown', event => {
    if (event.key !== 'Enter' || !event.target.dataset.dwCell) return;
    event.preventDefault();
    const [row, column] = event.target.dataset.dwCell.split(',').map(Number);
    if (row === state.rows.length - 1 && state.rows.length < maxRows) {
      state.rows.push({});
      refreshTable();
    }
    get(`[data-dw-cell="${row + 1},${column}"]`)?.focus();
  }, { signal: controller.signal });

  root.addEventListener('click', async event => {
    const button = event.target.closest('[data-dw-action]');
    if (!button) return;
    const action = button.dataset.dwAction;

    if (action === 'add-row') {
      if (state.rows.length >= maxRows) return notify(`最多 ${maxRows} 行。`);
      state.rows.push({});
      refreshTable();
      get(`[data-dw-cell="${state.rows.length - 1},0"]`)?.focus();
    } else if (action === 'add-column') {
      if (state.columns.length >= maxColumns) return notify(`最多 ${maxColumns} 列。`);
      let suffix = state.columns.length + 1;
      while (state.columns.some(column => column.key === `column-${suffix}`)) suffix++;
      state.columns.push({ key: `column-${suffix}`, label: `列 ${state.columns.length + 1}`, unit: '' });
      refreshTable();
      get(`[data-dw-col="${state.columns.length - 1}"][data-dw-prop="label"]`)?.select();
    } else if (action.startsWith('row:')) {
      state.rows.splice(Number(action.split(':')[1]), 1);
      if (!state.rows.length) state.rows.push({});
      refreshTable();
    } else if (action.startsWith('column:')) {
      const [removed] = state.columns.splice(Number(action.split(':')[1]), 1);
      if (state.xKey === removed.key) state.xKey = state.columns.find(col => col.key !== state.yKey).key;
      if (state.yKey === removed.key) state.yKey = state.columns.find(col => col.key !== state.xKey).key;
      for (const row of state.rows) delete row[removed.key];
      delete state.instrumentLimits[removed.key];
      refreshTable();
    } else if (action === 'sample') {
      if (state.rows.some(row => Object.values(row).some(value => String(value ?? '').trim())) &&
          !window.confirm('载入示例数据将替换当前表格数据。继续吗？')) return;
      state.rows = experiment.sampleRows.map(row => ({ ...row }));
      refreshTable();
      notify('已载入示例数据。');
    } else if (action === 'import') {
      if (state.rows.some(row => Object.values(row).some(value => String(value ?? '').trim())) &&
          !window.confirm('导入文件将替换当前表格数据。继续吗？')) return;
      get('#dw-import').click();
    } else if (action === 'use-slope') {
      if (!lastFit?.coefficients?.length || state.fit !== 'linear') return;
      const isPresetSlope = reference && state.xKey === experiment.xKey && state.yKey === experiment.yKey;
      state.measured = isPresetSlope ? '' : String(lastFit.coefficients[0].value);
      get('[data-dw-field="measured"]').value = state.measured;
      errorState();
    } else if (action === 'download') {
      if (!chart || downloadButton.disabled) return;
      const anchor = document.createElement('a');
      anchor.href = chart.toBase64Image();
      anchor.download = `${get('#dw-title').value.trim().replace(/[\\/:*?"<>|]/g, '_') || '实验图表'}.png`;
      anchor.click();
    } else if (action === 'save' && onSave) {
      button.disabled = true;
      try {
        materializeRows();
        await onSave({
          title: get('#dw-title').value.trim() || '新建数据处理',
          experimentId: experiment?.id ?? record?.experimentId ?? null,
          payload: structuredClone(state),
        });
      } catch (error) {
        notify(error.message || '保存失败，请重试。');
      } finally {
        button.disabled = false;
      }
    }
  }, { signal: controller.signal });

  refreshTable();
  const dispose = () => {
    disposed = true;
    controller.abort();
    if (raf) cancelAnimationFrame(raf);
    chart?.destroy();
  };
  dispose.capture = () => {
    materializeRows();
    return { title: get('#dw-title').value, payload: structuredClone(state) };
  };
  return dispose;
}
