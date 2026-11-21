const reportLevels = [['brief', '简略'], ['detailed', '详细']];
const imageTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const supportedFiles = new Set(['pdf', 'docx', 'txt', 'md', 'jpg', 'jpeg', 'png', 'webp', 'gif']);
const fileLimit = 5 * 1024 * 1024;
const vendorAsset = name => new URL(`./vendor/${name}`, import.meta.url).href;
let mammothLoader;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
}

function textList(value) {
  return (Array.isArray(value) ? value : String(value ?? '').split('\n')).map(String).filter(Boolean);
}

function listHtml(items, ordered = false) {
  if (!items.length) return '';
  const tag = ordered ? 'ol' : 'ul';
  return `<${tag}>${items.map(text => `<li>${escapeHtml(text)}</li>`).join('')}</${tag}>`;
}

function segmentHtml(name, items, selected, label) {
  return `<div class="lr-segment" role="group" aria-label="${label}">${items.map(([value, title]) =>
    `<button type="button" data-${name}="${value}" aria-pressed="${value === selected}">${title}</button>`).join('')}</div>`;
}

function experimentContext(experiment) {
  if (!experiment) return '本科物理实验报告';
  return [
    `实验：${experiment.title}（${experiment.category}）`,
    `目标：${textList(experiment.aim).join('；')}`,
    `原理：${experiment.description || experiment.summary || ''}`,
    `步骤：${textList(experiment.steps).join('；')}`,
    `数据处理：${textList(experiment.process).join('；')}`,
    `数据列：${(experiment.columns || []).map(column => `${column.label} ${column.unit || ''}`.trim()).join('，')}`,
  ].join('\n');
}

function tableHtml(experiment, showExamples) {
  const columns = experiment?.columns || [];
  if (!columns.length) return '';
  const rows = showExamples ? (experiment.sampleRows || []).slice(0, 4) : [{}, {}, {}];
  return `<div class="lr-table-scroll"><table>
    <caption>${showExamples ? '模拟数据' : '数据记录表'}</caption>
    <thead><tr><th scope="col">序号</th>${columns.map(column => `<th scope="col">${escapeHtml(column.label)}${column.unit ? ` <span>${escapeHtml(column.unit)}</span>` : ''}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((row, index) => `<tr><th scope="row">${index + 1}</th>${columns.map(column => `<td>${escapeHtml(row[column.key] ?? '—')}</td>`).join('')}</tr>`).join('')}</tbody>
  </table></div>`;
}

function referenceSections(experiment) {
  const aims = textList(experiment?.aim);
  const steps = textList(experiment?.steps);
  const process = textList(experiment?.process);
  const aim = { title: '实验目的', brief: aims.slice(0, 2), detail: aims };
  const detail = [experiment?.description || experiment?.summary];
  if (experiment?.formula) detail.push(`主要公式：${experiment.formula}`);
  if (experiment?.apparatus) detail.push(`主要仪器：${textList(experiment.apparatus).join('、')}`);
  const principle = { title: '实验原理与仪器', brief: [experiment?.summary || experiment?.description], detail };
  const procedure = { title: '实验步骤', brief: steps.slice(0, 3), detail: steps, ordered: true };
  const data = { title: '实验过程与数据', brief: [], detail: [], data: true };
  const analysis = { title: '数据处理与误差分析', brief: process.slice(0, 2), detail: process, ordered: true };
  const finish = { title: '实验结论', brief: ['说明实际测量结果和主要误差来源。'], detail: ['用实际数据报告测量值，并说明拟合参数的物理意义。', '结合图表、残差或重复测量判断结果是否符合预期。', '比较参考值并说明主要偏差及可行的改进办法。'] };
  return [aim, principle, procedure, data, analysis, finish];
}

function referenceHtml(experiment, level, showExamples, icon) {
  return referenceSections(experiment).map(section => {
    const content = (level === 'detailed' ? section.detail : section.brief).filter(Boolean);
    const hasTable = section.data && experiment.columns?.length;
    if (!content.length && !hasTable) return '';
    const body = content.length === 1 && !section.ordered ? `<p>${escapeHtml(content[0])}</p>` : listHtml(content, section.ordered);
    const actions = hasTable ? `<div class="lr-table-actions">
      ${experiment.sampleRows?.length ? `<label class="lr-check"><input type="checkbox" data-action="examples" ${showExamples ? 'checked' : ''}> 显示模拟数据</label>` : ''}
      <button class="lr-button" type="button" data-action="data">${icon('chart-no-axes-combined')}<span>打开数据处理</span></button>
    </div>` : '';
    return `<section class="lr-reference-section">
      <h3>${section.title}</h3>
      ${body}${hasTable ? tableHtml(experiment, showExamples) + actions : ''}
    </section>`;
  }).join('');
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('无法读取附件，请重新选择。'));
    reader.readAsDataURL(file);
  });
}

function loadMammoth() {
  if (globalThis.mammoth?.extractRawText) return Promise.resolve(globalThis.mammoth);
  if (!mammothLoader) {
    mammothLoader = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = vendorAsset('mammoth.browser.min.js');
      script.onload = () => globalThis.mammoth?.extractRawText ? resolve(globalThis.mammoth) : reject(new Error('Word 解析组件不可用'));
      script.onerror = () => { script.remove(); reject(new Error('Word 解析组件加载失败')); };
      document.head.append(script);
    }).catch(error => { mammothLoader = undefined; throw error; });
  }
  return mammothLoader;
}

function plainPdfPage(items) {
  let output = '';
  let prior = null;
  for (const item of items) {
    if (typeof item.str !== 'string') continue;
    const [x, y] = item.transform?.slice(4) || [];
    if (prior && !output.endsWith('\n')) {
      if (Math.abs(prior.y - y) > Math.max(item.height * 0.5, 3)) output += '\n';
      else if (x - prior.end > Math.max(item.height * 0.25, 2)) output += ' ';
    }
    output += item.str;
    if (item.hasEOL) output += '\n';
    prior = { y, end: x + item.width };
  }
  return output.trim();
}

async function extractDocument(file, extension) {
  if (extension === 'txt' || extension === 'md') return (await file.text()).trim();
  if (extension === 'docx') {
    const mammoth = await loadMammoth();
    const { value } = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    return value.trim();
  }
  if (extension === 'pdf') {
    const pdf = await import(vendorAsset('pdf.mjs'));
    pdf.GlobalWorkerOptions.workerSrc = vendorAsset('pdf.worker.mjs');
    const task = pdf.getDocument({
      data: await file.arrayBuffer(),
      isEvalSupported: false,
      cMapPacked: true,
      cMapUrl: vendorAsset('cmaps/'),
      standardFontDataUrl: vendorAsset('standard_fonts/'),
    });
    const pages = [];
    try {
      const doc = await task.promise;
      for (let index = 1; index <= doc.numPages; index++) {
        const page = await doc.getPage(index);
        const content = await page.getTextContent();
        pages.push(plainPdfPage(content.items));
        page.cleanup();
      }
      return pages.filter(Boolean).join('\n\n');
    } finally {
      await task.destroy();
    }
  }
  return '';
}

function downloadAttachment(attachment) {
  const [metadata, encoded] = attachment.dataUrl.split(',', 2);
  if (!encoded) return;
  const type = /^data:([^;]+)/.exec(metadata)?.[1] || 'application/octet-stream';
  const bytes = Uint8Array.from(atob(encoded), char => char.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = attachment.name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function printReport(title, body, notify) {
  document.querySelector('[data-lr-print-document]')?.remove();
  const frame = document.createElement('iframe');
  frame.title = '打印实验报告';
  frame.setAttribute('aria-hidden', 'true');
  frame.dataset.lrPrintDocument = '';
  frame.srcdoc = `<!doctype html><html lang="zh-CN"><head>
    <meta charset="utf-8"><title>${escapeHtml(title)}</title>
    <style>
      @page { size: A4; margin: 18mm 18mm 20mm; }
      html { color-scheme: light; background: #fff; color: #161616; }
      body { margin: 0; font: 11pt/1.65 system-ui, "Microsoft YaHei", sans-serif; overflow-wrap: anywhere; }
      h1 { margin: 0 0 8mm; font-size: 19pt; line-height: 1.35; break-after: avoid; }
      main { white-space: pre-wrap; }
    </style>
    </head><body><h1>${escapeHtml(title)}</h1><main>${escapeHtml(body)}</main></body></html>`;
  frame.addEventListener('load', () => {
    const printable = frame.contentWindow;
    try {
      printable.addEventListener('afterprint', () => frame.remove(), { once: true });
      printable.focus();
      printable.print();
    } catch {
      frame.remove();
      notify('无法打开打印窗口，请检查浏览器设置。');
    }
  }, { once: true });
  document.body.append(frame);
}

export function mountReportWorkspace(root, {
  experiment, record, onSave, notify, icon, askAI, onData, goSettings, toggleFavorite, isFavorite,
}) {
  const previous = record?.payload || {};
  const kind = previous.kind === 'preview' ? 'preview' : 'report';
  let level = 'detailed';
  let favorite = typeof isFavorite === 'function' ? Boolean(isFavorite(experiment?.id)) : Boolean(isFavorite);
  let attachment = previous.attachment?.dataUrl ? previous.attachment : null;
  let showExamples = false;
  let active = true;
  let requestRunning = false;
  let uploadSequence = 0;
  let latestRewrite = null;
  const answers = [];
  const title = record?.title || (experiment ? `${experiment.title} 实验报告` : '未命名报告');
  const symbol = name => icon?.(name) || '';

  root.innerHTML = `<div class="lr-workspace">
    <header class="lr-heading">
      <div>
        ${experiment?.category ? `<p class="lr-course">${escapeHtml(experiment.category)}</p>` : ''}
        <h1>${escapeHtml(experiment?.title || '新建报告')}</h1>
        ${experiment?.summary ? `<p class="lr-summary">${escapeHtml(experiment.summary)}</p>` : ''}
      </div>
      <div class="lr-heading-actions">
        ${experiment ? `<button class="lr-icon" type="button" data-action="favorite" title="收藏" aria-label="收藏" aria-pressed="${favorite}">${symbol('bookmark')}</button>` : ''}
        <button class="lr-button" type="button" data-action="draft-focus">${symbol('pencil-line')}<span>写报告</span></button>
      </div>
    </header>
    <div class="lr-layout${experiment ? '' : ' lr-layout--draft-only'}">
      ${experiment ? `<article class="lr-reference" aria-labelledby="lr-example-title">
        <div class="lr-toolbar">
          <h2 id="lr-example-title">实验报告示例</h2>
          <div data-report-levels></div>
        </div>
        <div data-report-reference></div>
        ${experiment?.source ? `<footer class="lr-source"><p>${escapeHtml(experiment.source)}</p>
          ${(experiment.references || []).filter(source => /^https:\/\//i.test(source.url)).map(source => `<a href="${escapeHtml(source.url)}" target="_blank" rel="noreferrer">${escapeHtml(source.label)}</a>`).join(' ')}</footer>` : ''}
      </article>` : ''}
      <aside class="lr-tools" aria-label="报告草稿和 AI 助手">
        <section class="lr-draft">
          <div class="lr-panel-heading">
            <h2>${symbol('file-pen-line')}我的报告</h2>
            <div class="lr-draft-actions">
              <button class="lr-icon" type="button" data-action="print" title="打印或另存为 PDF" aria-label="打印或另存为 PDF" disabled>${symbol('printer')}</button>
              <button class="lr-icon lr-save" type="button" data-action="save" title="保存报告" aria-label="保存报告">${symbol('save')}</button>
            </div>
          </div>
          <label class="lr-input-label">报告标题<input data-report-title value="${escapeHtml(title)}" maxlength="120" autocomplete="off"></label>
          <label class="lr-input-label">报告正文<textarea data-report-draft rows="7" placeholder="记录你的实验过程、数据分析和结论">${escapeHtml(previous.draft || '')}</textarea></label>
          <div class="lr-upload-row">
            <button class="lr-icon" type="button" data-action="camera" title="拍摄报告" aria-label="拍摄报告">${symbol('camera')}</button>
            <button class="lr-button" type="button" data-action="attach">${symbol('paperclip')}<span>上传报告</span></button>
            <input data-report-file type="file" accept="image/jpeg,image/png,image/webp,image/gif,.pdf,.docx,.txt,.md" hidden>
            <input data-report-camera type="file" accept="image/*" capture="environment" hidden>
          </div>
          <div data-report-attachment></div>
        </section>
        <section class="lr-assistant">
          <div class="lr-panel-heading">
            <h2>${symbol('sparkles')}AI 实验助手</h2>
            <button class="lr-icon" type="button" data-action="settings" title="接入 DeepSeek" aria-label="接入 DeepSeek">${symbol('settings')}</button>
          </div>
          <div class="lr-ai-actions">
            <button class="lr-button" type="button" data-action="review">${symbol('message-square-text')}<span>批注建议</span></button>
            <button class="lr-button" type="button" data-action="rewrite">${symbol('wand-sparkles')}<span>润色正文</span></button>
          </div>
          <form class="lr-question">
            <input data-report-question aria-label="实验问题" placeholder="输入实验问题" maxlength="1000" required>
            <button class="lr-icon lr-send" type="submit" title="发送问题" aria-label="发送问题">${symbol('send')}</button>
          </form>
          <p class="lr-status" data-report-status role="status" hidden></p>
          <div class="lr-messages" aria-live="polite" data-report-answers></div>
        </section>
      </aside>
    </div>
  </div>`;

  const titleInput = root.querySelector('[data-report-title]');
  const draft = root.querySelector('[data-report-draft]');
  const question = root.querySelector('[data-report-question]');
  const status = root.querySelector('[data-report-status]');
  const fileInput = root.querySelector('[data-report-file]');
  const cameraInput = root.querySelector('[data-report-camera]');
  const printButton = root.querySelector('[data-action="print"]');

  function syncPrintButton() {
    printButton.disabled = !draft.value.trim();
  }

  function setStatus(message, error = false) {
    status.hidden = !message;
    status.textContent = message || '';
    status.classList.toggle('lr-error', error);
  }

  function renderReference() {
    if (!experiment) return;
    root.querySelector('[data-report-levels]').innerHTML = segmentHtml('report-level', reportLevels, level, '示例详略');
    root.querySelector('[data-report-reference]').innerHTML = referenceHtml(experiment, level, showExamples, symbol);
  }

  function renderAttachment() {
    const destination = root.querySelector('[data-report-attachment]');
    if (!attachment) {
      destination.replaceChildren();
      return;
    }
    const photo = imageTypes.has(attachment.type) && /^data:image\/(jpeg|png|webp|gif);base64,/i.test(attachment.dataUrl);
    destination.innerHTML = `<div class="lr-attachment">
      ${photo ? `<img alt="已上传的报告照片" src="${escapeHtml(attachment.dataUrl)}">` : `<span class="lr-attachment-icon">${symbol('file-text')}</span>`}
      <span class="lr-attachment-label" title="${escapeHtml(attachment.name)}">${escapeHtml(attachment.name)}</span>
      <button type="button" class="lr-icon" data-action="download-attachment" title="下载附件" aria-label="下载附件">${symbol('download')}</button>
      <button type="button" class="lr-icon" data-action="remove-attachment" title="移除附件" aria-label="移除附件">${symbol('x')}</button>
    </div>${attachment.extraction === 'empty' ? '<p class="lr-file-note">未提取到文字。可上传页面照片，或粘贴需要批注的段落。</p>' : ''}`;
  }

  function renderAnswers() {
    root.querySelector('[data-report-answers]').innerHTML = answers.map((answer, index) =>
      `<div class="lr-answer">
        <h3>${escapeHtml(answer.title)}</h3>
        <div>${escapeHtml(answer.text)}</div>
        ${latestRewrite?.index === index ? `<button class="lr-button" type="button" data-action="apply">${symbol('check')}<span>${latestRewrite.hasText ? '应用到正文' : '插入正文'}</span></button>` : ''}
      </div>`).join('');
  }

  async function handleFile(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const extension = file.name.split('.').at(-1)?.toLowerCase();
    if (file.size > fileLimit || !supportedFiles.has(extension) && !imageTypes.has(file.type)) {
      setStatus('请选择 5 MB 以内的照片、PDF、DOCX 或文本文件。', true);
      return;
    }
    const sequence = ++uploadSequence;
    const canExtract = ['pdf', 'docx', 'txt', 'md'].includes(extension);
    try {
      const dataUrl = await readAsDataUrl(file);
      if (!active || sequence !== uploadSequence) return;
      const detectedType = dataUrl.match(/^data:([^;]+);/)?.[1];
      attachment = { name: file.name, type: detectedType || file.type, size: file.size, dataUrl };
      setStatus(canExtract ? '正在提取报告文字…' : '');
      renderAttachment();
      if (!canExtract) return;
      const importedText = await extractDocument(file, extension).catch(() => '');
      if (!active || sequence !== uploadSequence) return;
      attachment.extraction = importedText ? 'text' : 'empty';
      const draftText = draft.value.trim();
      if (importedText && !draftText.includes(importedText)) {
        draft.value = [draftText, importedText].filter(Boolean).join('\n\n');
        syncPrintButton();
      }
      renderAttachment();
      setStatus(importedText ? '已将附件文字导入正文。' : '');
    } catch (error) {
      if (active && sequence === uploadSequence) setStatus(error.message, true);
    }
  }

  async function request(task) {
    if (requestRunning) return;
    const start = draft.selectionStart;
    const end = draft.selectionEnd;
    const documentText = draft.value;
    const selectedText = documentText.slice(start, end);
    const fullText = documentText.trim();
    const hasSelection = Boolean(selectedText.trim());
    const originalText = hasSelection ? selectedText : fullText;
    const userQuestion = question.value.trim();
    const photo = imageTypes.has(attachment?.type) ? attachment.dataUrl : undefined;
    if (task === 'question' && !userQuestion) return;
    if (task !== 'question' && !fullText && !photo) {
      setStatus('请填写报告正文或上传报告照片。', true);
      draft.focus();
      return;
    }
    if (task !== 'question' && originalText.length > 18_000) {
      setStatus('正文较长，请选中不超过 18,000 个字符的段落后再提交。', true);
      draft.focus();
      return;
    }
    requestRunning = true;
    const aiButtons = root.querySelectorAll('.lr-ai-actions button, .lr-send');
    aiButtons.forEach(button => { button.disabled = true; });
    setStatus(task === 'question' ? '正在回答…' : '正在分析报告…');
    try {
      const response = await askAI({
        task,
        context: experimentContext(experiment),
        text: task === 'question' ? userQuestion : originalText,
        image: task === 'question' || task === 'rewrite' && fullText ? undefined : photo,
      });
      if (!active) return;
      const output = typeof response === 'string' ? response.trim() : '';
      if (!output) throw new Error('AI 暂未返回内容，请重试。');
      if (task === 'rewrite') {
        latestRewrite = { text: output, documentText, start: hasSelection ? start : 0,
          end: hasSelection ? end : documentText.length, index: answers.length, hasText: Boolean(fullText) };
      }
      answers.push({ title: task === 'question' ? userQuestion : task === 'review' ? '批注建议' : '润色结果', text: output });
      if (task === 'question') question.value = '';
      setStatus('');
      renderAnswers();
    } catch (error) {
      if (active) setStatus(error.message || 'AI 调用失败，请重试。', true);
    } finally {
      requestRunning = false;
      if (active) aiButtons.forEach(button => { button.disabled = false; });
    }
  }

  async function saveReport(button) {
    if (!draft.value.trim() && !attachment) {
      notify('请添加报告正文或附件。');
      draft.focus();
      return;
    }
    button.disabled = true;
    try {
      await onSave({
        title: titleInput.value.trim() || '未命名报告',
        experimentId: experiment?.id || record?.experimentId || null,
        payload: { kind, draft: draft.value, attachment },
      });
    } catch (error) {
      if (active) notify(error.message || '报告保存失败，请重试。');
    } finally {
      if (active) button.disabled = false;
    }
  }

  const actions = {
    attach: () => fileInput.click(),
    camera: () => cameraInput.click(),
    data: () => onData?.(experiment),
    settings: () => goSettings?.(),
    review: () => request('review'),
    rewrite: () => request('rewrite'),
    save: saveReport,
    print: () => {
      const body = draft.value.trim();
      if (body) printReport(titleInput.value.trim() || '未命名报告', body, notify);
    },
    'draft-focus': () => draft.focus(),
    'download-attachment': () => attachment && downloadAttachment(attachment),
    'remove-attachment': () => { uploadSequence += 1; attachment = null; setStatus(''); renderAttachment(); },
    favorite: async button => {
      button.disabled = true;
      try {
        const next = await toggleFavorite?.(experiment.id);
        favorite = typeof next === 'boolean' ? next : !favorite;
        button.setAttribute('aria-pressed', String(favorite));
        button.title = favorite ? '取消收藏' : '收藏';
        button.setAttribute('aria-label', button.title);
      } catch (error) {
        notify(error.message || '收藏操作失败，请重试。');
      } finally {
        button.disabled = false;
      }
    },
    apply: () => {
      if (!latestRewrite) return;
      if (draft.value !== latestRewrite.documentText) {
        setStatus('正文已修改，请手动复制建议，或基于当前内容重新润色。', true);
        return;
      }
      const { start, end, text } = latestRewrite;
      draft.setRangeText(text, start, end, 'select');
      syncPrintButton();
      latestRewrite = null;
      renderAnswers();
      draft.focus();
    },
  };

  function onClick(event) {
    const button = event.target.closest('button');
    if (!button) return;
    const { reportLevel, action } = button.dataset;
    if (reportLevel) {
      level = reportLevel;
      renderReference();
      root.querySelector(`[data-report-level="${level}"]`).focus();
    } else if (action) {
      actions[action]?.(button);
    }
  }

  function onChange(event) {
    if (event.target.dataset.action === 'examples') {
      showExamples = event.target.checked;
      renderReference();
      root.querySelector('[data-action="examples"]')?.focus();
    }
  }

  function onSubmit(event) {
    event.preventDefault();
    request('question');
  }

  const form = root.querySelector('.lr-question');
  root.addEventListener('click', onClick);
  root.addEventListener('change', onChange);
  fileInput.addEventListener('change', handleFile);
  cameraInput.addEventListener('change', handleFile);
  draft.addEventListener('input', syncPrintButton);
  form.addEventListener('submit', onSubmit);
  renderReference();
  renderAttachment();
  syncPrintButton();
  const dispose = () => {
    active = false;
    root.removeEventListener('click', onClick);
    root.removeEventListener('change', onChange);
    fileInput.removeEventListener('change', handleFile);
    cameraInput.removeEventListener('change', handleFile);
    draft.removeEventListener('input', syncPrintButton);
    form.removeEventListener('submit', onSubmit);
  };
  dispose.capture = () => ({
    title: titleInput.value,
    payload: { kind, draft: draft.value, attachment },
  });
  return dispose;
}
