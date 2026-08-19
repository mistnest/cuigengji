/**
 * Page-oriented Renderer module.
 * Migrated from the former monolithic app/bootstrap.js using the reviewed ownership map.
 */
'use strict';
/* eslint-disable no-undef, no-unused-vars */
async function readSseCompletion(response) {
    if (Array.isArray(response?.events)) {
        let reply = '';
        let meta = {};
        for (const event of response.events) {
            if (event.type === 'chunk') reply += event.content || '';
            if (event.type === 'meta') {
                meta = {
                    context: event.context,
                    memory: event.memory,
                    contextDebug: event.contextDebug,
                };
            }
            if (event.type === 'done') return { ...meta, reply: event.reply || reply };
            if (event.type === 'error') throw new Error(event.message || 'Automation failed');
        }
        return { ...meta, reply };
    }
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/event-stream')) {
        return response.json();
    }
    const reader = response.body?.getReader?.();
    if (!reader) return { reply: '' };
    const decoder = new TextDecoder();
    let buffer = '';
    let reply = '';
    let meta = {};
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split('\n\n');
        buffer = blocks.pop() || '';
        for (const block of blocks) {
            const data = block
                .split(/\r?\n/)
                .filter(line => line.startsWith('data:'))
                .map(line => line.slice(5).trimStart())
                .join('\n');
            if (!data) continue;
            const event = JSON.parse(data);
            if (event.type === 'chunk') reply += event.content || '';
            if (event.type === 'meta') {
                meta = {
                    context: event.context,
                    memory: event.memory,
                    contextDebug: event.contextDebug,
                };
            }
            if (event.type === 'done') return { ...meta, reply: event.reply || reply };
            if (event.type === 'error') throw new Error(event.message || 'Stream error');
        }
    }
    return { ...meta, reply };
}

async function onContinue() {
    const text = $('#chapter-editor').value;
    if (!text.trim()) { setStatus('请先编写正文再续写', 'warn'); return; }
    if (!hasConfiguredAiCredentials()) {
        setStatus('请先配置 API Key', 'error'); return;
    }
    if (state.isGenerating) return;

    state.isGenerating = true;
    setStatus('AI 正在续写...', 'loading');
    const btnC = $('#btn-continue'); if (btnC) { btnC.disabled = true; btnC.textContent = '⏳ 生成中...'; }

    try {
        const response = await AutomationRuntime.openStream('writing.continue', {
                message: '请从当前正文结尾自然续写下一段，只输出小说正文，不要解释。',
                history: [],
                config: { ...state.aiConfig, stream: true },
                context: {
                    currentText: text,
                    worldBookEntries: Object.values(getReferencedWorldBook().entries || {}),
                    characters: getReferencedCharacters(text),
                    outline: getIncompleteOutline(),
                    styleGuide: state.currentNovel?.styleGuide || '',
                    novelId: state.currentNovel?.id,
                    novelTitle: state.currentNovel?.title || '',
                    chapterTitle: state.currentChapter?.title || '',
                    chapterId: state.currentChapter?.id || '',
                    chapterOrder: state.currentChapter?.order ?? null,
                    chapterWindowAnchor: ensureChapterWindowAnchor(),
                },
                presetName: state.presetName || '__default__',
                promptTemplates: (state.promptTemplates || [])
                    .filter(template => state.enabledTemplates?.[template.identifier] !== false),
                promptOrder: state.promptOrder || [],
        });

        const data = await readSseCompletion(response);
        if (!data.reply?.trim()) throw new Error('模型没有返回正文，请提高单次输出长度后重试');
        const editor = $('#chapter-editor');
        // Append generated content
        editor.value = text + '\n\n' + data.reply;
        editor.scrollTop = editor.scrollHeight;
        state.isDirty = true;
        updateWordCount();
        state.aiUsed = true;
        updateStatusBar();
        updateContextInfo(data.context, data.memory, data.contextDebug);
        showToast('续写完成!', 'success');
    } catch (err) {
        setStatus(`续写失败: ${err.message}`, 'error');
    } finally {
        state.isGenerating = false;
        const btnC2 = $('#btn-continue'); if (btnC2) { btnC2.disabled = false; btnC2.textContent = '续写正文'; }
    }
}

async function onPlotSuggestions() {
    const text = $('#chapter-editor').value;
    if (!text.trim()) { setStatus('请先编写正文', 'warn'); return; }
    if (!hasConfiguredAiCredentials()) {
        setStatus('请先配置 API Key', 'error'); return;
    }
    if (state.isGenerating) return;

    state.isGenerating = true;
    setStatus('正在生成情节候选...', 'loading');
    const ps = $('#btn-plot-suggestions'); if (ps) ps.disabled = true;

    try {
        const data = await AutomationRuntime.execute('ideas.plotSuggestions', {
                text,
                config: state.aiConfig,
                worldBook: getReferencedWorldBook(),
                characters: getReferencedCharacters(text),
                outline: getIncompleteOutline(),
                presetName: state.presetName || '__default__',
        });
        if (data.candidates?.length > 0) {
            PlotCandidates.show(data.candidates, (selected) => {
                // Insert selected direction as guidance
                const editor = $('#chapter-editor');
                const guidance = `// 情节方向: ${selected.direction}\n// 冲突: ${selected.conflict || '无'}\n\n`;
                editor.value = editor.value + '\n\n' + guidance;
                editor.scrollTop = editor.scrollHeight;
                state.isDirty = true;
                setStatus(`已选择情节方向: ${selected.direction.substring(0, 30)}...`, 'success');
            });
            setStatus(`生成了 ${data.candidates.length} 条情节候选`, 'success');
        } else {
            setStatus('未能生成有效的情节候选，请重试', 'warn');
        }
    } catch (err) {
        setStatus(`情节生成失败: ${err.message}`, 'error');
    } finally {
        state.isGenerating = false;
        const ps2 = $('#btn-plot-suggestions'); if (ps2) ps2.disabled = false;
    }
}

async function onInspire() {
    const text = $('#chapter-editor').value;
    if (!hasConfiguredAiCredentials()) {
        setStatus('请先配置 API Key', 'error'); return;
    }
    if (state.isGenerating) return;

    state.isGenerating = true;
    setStatus('正在生成灵感...', 'loading');
    const bi = $('#btn-inspire'); if (bi) bi.disabled = true;

    try {
        const data = await AutomationRuntime.execute('ideas.inspire', {
                text,
                config: state.aiConfig,
                worldBook: getReferencedWorldBook(),
                characters: getReferencedCharacters(text),
                presetName: state.presetName || '__default__',
        });
        PlotCandidates.showInspiration(data);
        setStatus('灵感已生成', 'success');
    } catch (err) {
        setStatus(`灵感生成失败: ${err.message}`, 'error');
    } finally {
        state.isGenerating = false;
        const bi2 = $('#btn-inspire'); if (bi2) bi2.disabled = false;
    }
}

async function onExtractSetting() {
    if (!hasConfiguredAiCredentials()) {
        setStatus('请先配置 API Key', 'error'); return;
    }
    showExtractionLauncher();
}

function showExtractionLauncher() {
    const text = $('#chapter-editor').value;
    const textChapters = getOrderedTextChapters();
    const minOrder = 1;
    const maxOrder = Math.max(1, textChapters.length);
    document.getElementById('extract-launcher-overlay')?.remove();
    const overlay = document.createElement('div');
    overlay.id = 'extract-launcher-overlay';
    overlay.className = 'plot-modal-overlay';
    overlay.innerHTML = `
        <div class="plot-modal extraction-launcher-modal">
            <div class="plot-modal-header">
                <div>
                    <h3>提取设定</h3>
                    <p class="settings-subtitle">从正文中提取角色、世界书和章节摘要。项目逐章扫描会按章节逐步更新进度。</p>
                </div>
                <button class="plot-modal-close" aria-label="关闭">×</button>
            </div>
            <div class="plot-modal-body extraction-launcher-body">
                <section class="settings-group extraction-launcher-section">
                    <h4>当前章节</h4>
                    <p class="settings-subtitle">适合刚写完一章后快速补充角色和世界书。</p>
                    <button type="button" class="ai-btn-primary extract-current-btn extraction-action-btn"${text.trim() ? '' : ' disabled'}>提取当前章节</button>
                </section>
                <section class="settings-group extraction-launcher-section">
                    <h4>项目逐章扫描</h4>
                    <p class="settings-subtitle">适合导入长篇后，从已有章节逐章建立或更新设定库。</p>
                    <div class="extraction-range-fields">
                        <label>开始章节序号<input id="extract-project-start" class="ai-input" type="number" min="1" value="${minOrder}"></label>
                        <label>结束章节序号<input id="extract-project-end" class="ai-input" type="number" min="1" value="${maxOrder}"></label>
                        <button type="button" class="ai-btn-secondary extract-project-btn extraction-action-btn"${textChapters.length ? '' : ' disabled'}>逐章扫描</button>
                    </div>
                    <div id="extract-project-progress" class="extract-project-progress"></div>
                </section>
            </div>
            <div class="plot-modal-footer">
                <button class="ai-btn-secondary extract-launcher-close">取消</button>
            </div>
        </div>`;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.querySelector('.plot-modal-close')?.addEventListener('click', close);
    overlay.querySelector('.extract-launcher-close')?.addEventListener('click', close);
    overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
    overlay.querySelector('.extract-current-btn')?.addEventListener('click', () => runCurrentExtractionBackground(overlay));
    overlay.querySelector('.extract-project-btn')?.addEventListener('click', () => runProjectExtractionBackground(overlay));
    requestAnimationFrame(() => overlay.classList.add('active'));
}

function setExtractionLauncherBusy(overlay, busy, label = '') {
    overlay?.querySelectorAll('button, input').forEach(el => { el.disabled = busy; });
    const progress = overlay?.querySelector('#extract-project-progress');
    if (progress && label) progress.innerHTML = `<div>${escHtml(label)}</div>`;
}

// eslint-disable-next-line no-unused-vars
async function runCurrentExtraction(launcherOverlay) {
    const text = $('#chapter-editor').value;
    if (!text.trim()) { setStatus('请先编写正文再提取设定', 'warn'); return; }
    if (state.isGenerating) return;
    state.isGenerating = true;
    $('#btn-extract-setting').disabled = true;
    setExtractionLauncherBusy(launcherOverlay, true, '正在分析当前章节...');
    setStatus('正在分析正文提取设定...', 'loading');
    showToast('AI 正在提取角色和世界观...', 'loading', 0);
    try {
        const data = await AutomationRuntime.execute('extraction.analyze', {
                text: text.slice(-12000),
                config: state.aiConfig,
                presetName: state.presetName || '__default__',
        });
        document.querySelectorAll('.toast-item').forEach(e => e.remove());
        launcherOverlay?.remove();
        showExtractionResults(data);
    } catch (err) {
        document.querySelectorAll('.toast-item').forEach(e => e.remove());
        setStatus(`提取失败: ${err.message}`, 'error');
    } finally {
        state.isGenerating = false;
        $('#btn-extract-setting').disabled = false;
        setExtractionLauncherBusy(launcherOverlay, false);
    }
}

// eslint-disable-next-line no-unused-vars
async function runProjectExtraction(launcherOverlay) {
    if (!state.currentNovel?.id) { setStatus('请先打开项目', 'warn'); return; }
    if (state.isGenerating) return;
    const startOrder = Number(launcherOverlay.querySelector('#extract-project-start')?.value || 1);
    const endOrder = Number(launcherOverlay.querySelector('#extract-project-end')?.value || startOrder);
    state.isGenerating = true;
    $('#btn-extract-setting').disabled = true;
    setExtractionLauncherBusy(launcherOverlay, true, '正在连接逐章扫描...');
    setStatus('正在逐章扫描项目设定...', 'loading');
    try {
        const resp = await AutomationRuntime.openStream('extraction.project', {
                novelId: state.currentNovel.id,
                config: state.aiConfig,
                presetName: state.presetName || '__default__',
                startOrder,
                endOrder,
        });
        const data = await readProjectExtractionStream(resp, launcherOverlay.querySelector('#extract-project-progress'));
        launcherOverlay?.remove();
        showExtractionResults(data);
        setStatus('项目逐章扫描完成', 'success');
    } catch (err) {
        setStatus(`逐章扫描失败: ${err.message}`, 'error');
        const progress = launcherOverlay?.querySelector('#extract-project-progress');
        if (progress) progress.insertAdjacentHTML('beforeend', `<div class="error">失败：${escHtml(err.message)}</div>`);
    } finally {
        state.isGenerating = false;
        $('#btn-extract-setting').disabled = false;
        setExtractionLauncherBusy(launcherOverlay, false);
    }
}

async function runCurrentExtractionBackground(launcherOverlay) {
    const text = $('#chapter-editor').value;
    if (!text.trim()) { setStatus('请先编写正文再提取设定', 'warn'); return; }
    setExtractionLauncherBusy(launcherOverlay, true, '正在创建后台任务...');
    setStatus('正在创建设定提取任务...', 'loading');
    try {
        const job = await createExtractionJob({
            type: 'current',
            text: text.slice(-12000),
            novelId: state.currentNovel?.id || '',
            chapterId: state.currentChapter?.id || '',
            chapterTitle: state.currentChapter?.title || '',
            chapterOrder: state.currentChapter?.order ?? null,
        });
        launcherOverlay?.remove();
        trackExtractionJob(job);
        showToast('设定提取已挂到后台，可从左下角查看进度。', 'success');
        setStatus('设定提取已在后台执行', 'success');
    } catch (err) {
        setStatus(`提取任务创建失败: ${err.message}`, 'error');
        const progress = launcherOverlay?.querySelector('#extract-project-progress');
        if (progress) progress.insertAdjacentHTML('beforeend', `<div class="error">失败：${escHtml(err.message)}</div>`);
    } finally {
        setExtractionLauncherBusy(launcherOverlay, false);
    }
}

async function runProjectExtractionBackground(launcherOverlay) {
    if (!state.currentNovel?.id) { setStatus('请先打开项目', 'warn'); return; }
    const startOrder = Number(launcherOverlay.querySelector('#extract-project-start')?.value || 1);
    const endOrder = Number(launcherOverlay.querySelector('#extract-project-end')?.value || startOrder);
    setExtractionLauncherBusy(launcherOverlay, true, '正在创建逐章扫描任务...');
    setStatus('正在创建逐章扫描任务...', 'loading');
    try {
        const job = await createExtractionJob({
            type: 'project',
            novelId: state.currentNovel.id,
            startOrder,
            endOrder,
        });
        launcherOverlay?.remove();
        trackExtractionJob(job);
        showToast('逐章扫描已挂到后台，可从左下角查看进度。', 'success');
        setStatus('逐章扫描已在后台执行', 'success');
    } catch (err) {
        setStatus(`逐章扫描任务创建失败: ${err.message}`, 'error');
        const progress = launcherOverlay?.querySelector('#extract-project-progress');
        if (progress) progress.insertAdjacentHTML('beforeend', `<div class="error">失败：${escHtml(err.message)}</div>`);
    } finally {
        setExtractionLauncherBusy(launcherOverlay, false);
    }
}

async function createExtractionJob(payload) {
    const data = await AutomationRuntime.execute('extraction.jobs.create', {
            ...payload,
            config: state.aiConfig,
            presetName: state.presetName || '__default__',
    });
    return data.job;
}

function initExtractionJobDock() {
    if (document.getElementById('extract-job-dock')) return;
    const dock = document.createElement('div');
    dock.id = 'extract-job-dock';
    dock.hidden = true;
    dock.innerHTML = `
        <button type="button" class="extract-job-toggle" title="查看设定提取任务">
            <span class="extract-job-dot"></span>
            <span class="extract-job-toggle-text">设定提取</span>
        </button>
        <div class="extract-job-panel" hidden>
            <div class="extract-job-panel-head">
                <div>
                    <strong>设定提取任务</strong>
                    <small>后台运行中，可继续写作</small>
                </div>
                <button type="button" class="extract-job-panel-close" aria-label="关闭">×</button>
            </div>
            <div class="extract-job-list"></div>
        </div>`;
    document.body.appendChild(dock);
    dock.querySelector('.extract-job-toggle')?.addEventListener('click', () => {
        const panel = dock.querySelector('.extract-job-panel');
        if (panel) panel.hidden = !panel.hidden;
    });
    dock.querySelector('.extract-job-panel-close')?.addEventListener('click', () => {
        const panel = dock.querySelector('.extract-job-panel');
        if (panel) panel.hidden = true;
    });
    dock.querySelector('.extract-job-list')?.addEventListener('click', event => {
        const button = event.target.closest('button[data-action]');
        if (!button) return;
        const id = button.closest('.extract-job-item')?.dataset.jobId;
        if (!id) return;
        if (button.dataset.action === 'view') void openExtractionJobResult(id);
        if (button.dataset.action === 'remove') void removeExtractionJob(id);
    });
}

async function refreshExtractionJobs() {
    try {
        const data = await AutomationRuntime.execute('extraction.jobs.list');
        (data.jobs || []).forEach(handleExtractionJobUpdate);
        renderExtractionJobDock();
        if ([...extractionJobs.values()].some(isExtractionJobActive)) startExtractionJobPolling();
    } catch {}
}

function trackExtractionJob(job) {
    handleExtractionJobUpdate(job);
    renderExtractionJobDock();
    startExtractionJobPolling();
}

function handleExtractionJobUpdate(job) {
    if (!job?.id) return;
    const prev = extractionJobs.get(job.id);
    extractionJobs.set(job.id, { ...(prev || {}), ...job });
    const wasActive = prev && isExtractionJobActive(prev);
    const isFinished = ['done', 'error'].includes(job.status);
    if (wasActive && isFinished && !extractionJobNotices.has(job.id)) {
        extractionJobNotices.add(job.id);
        if (job.status === 'done') {
            applyExtractionChapterSummary(job.result);
            void refreshChaptersAfterExtraction(job.result);
        }
        showToast(job.status === 'done' ? '设定提取完成，点击左下角查看结果。' : `设定提取失败：${job.error || '未知错误'}`, job.status === 'done' ? 'success' : 'error');
    }
}

function startExtractionJobPolling() {
    if (extractionJobPollTimer) return;
    extractionJobPollTimer = setInterval(() => { void pollExtractionJobs(); }, 1500);
    void pollExtractionJobs();
}

async function pollExtractionJobs() {
    const activeJobs = [...extractionJobs.values()].filter(isExtractionJobActive);
    if (!activeJobs.length) {
        clearInterval(extractionJobPollTimer);
        extractionJobPollTimer = null;
        renderExtractionJobDock();
        return;
    }
    await Promise.all(activeJobs.map(async job => {
        try {
            const data = await AutomationRuntime.execute(
                'extraction.jobs.get',
                undefined,
                { jobId: job.id },
            );
            handleExtractionJobUpdate(data.job);
        } catch {}
    }));
    renderExtractionJobDock();
}

function isExtractionJobActive(job) {
    return ['queued', 'running'].includes(job?.status);
}

function renderExtractionJobDock() {
    const dock = document.getElementById('extract-job-dock');
    if (!dock) return;
    const jobs = [...extractionJobs.values()].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    dock.hidden = !jobs.length;
    const activeJobs = jobs.filter(isExtractionJobActive);
    const erroredJobs = jobs.filter(job => job.status === 'error');
    dock.classList.toggle('is-active', activeJobs.length > 0);
    dock.classList.toggle('has-error', erroredJobs.length > 0);
    const toggleText = dock.querySelector('.extract-job-toggle-text');
    if (toggleText) {
        toggleText.textContent = activeJobs.length
            ? `设定提取 ${activeJobs.length}`
            : jobs.some(job => job.status === 'done') ? '提取完成' : '设定提取';
    }
    const list = dock.querySelector('.extract-job-list');
    if (!list) return;
    list.innerHTML = jobs.map(renderExtractionJobItem).join('') || '<div class="extract-job-empty">暂无任务</div>';
}

function renderExtractionJobItem(job) {
    const labelMap = { queued: '等待中', running: '运行中', done: '已完成', error: '失败' };
    const percent = getExtractionJobPercent(job);
    const recent = (job.progress || []).slice(-4)
        .map(item => `<div>${escHtml(item.message || '')}</div>`)
        .join('');
    const current = job.current?.title ? `<div class="extract-job-current">当前：${escHtml(job.current.title)}</div>` : '';
    const error = job.error ? `<div class="extract-job-error">${escHtml(job.error)}</div>` : '';
    const viewBtn = job.status === 'done'
        ? '<button type="button" class="ai-btn-primary" data-action="view">查看结果</button>'
        : '';
    return `
        <div class="extract-job-item status-${escAttr(job.status || '')}" data-job-id="${escAttr(job.id)}">
            <div class="extract-job-item-head">
                <b>${escHtml(job.title || '设定提取')}</b>
                <span>${escHtml(labelMap[job.status] || job.status || '')}</span>
            </div>
            <div class="extract-job-progress"><i style="width:${percent}%"></i></div>
            ${current}
            <div class="extract-job-recent">${recent}</div>
            ${error}
            <div class="extract-job-actions">
                ${viewBtn}
                <button type="button" class="ai-btn-secondary" data-action="remove">清除</button>
            </div>
        </div>`;
}

function getExtractionJobPercent(job) {
    if (job.status === 'done') return 100;
    if (job.status === 'error') return 100;
    const total = Number(job.range?.total || 0);
    const processed = Number(job.range?.processed || 0);
    if (total > 0) return Math.max(8, Math.min(98, Math.round((processed / total) * 100)));
    return job.status === 'running' ? 35 : 8;
}

async function openExtractionJobResult(id) {
    try {
        const data = await AutomationRuntime.execute(
            'extraction.jobs.get',
            undefined,
            { jobId: id },
        );
        handleExtractionJobUpdate(data.job);
        renderExtractionJobDock();
        if (!data.job?.result) throw new Error('任务还没有可查看的结果');
        applyExtractionChapterSummary(data.job.result);
        void refreshChaptersAfterExtraction(data.job.result);
        showExtractionResults(data.job.result);
    } catch (err) {
        setStatus(`查看提取结果失败: ${err.message}`, 'error');
    }
}

function applyExtractionChapterSummary(result = {}) {
    const brief = result.chapterSummary?.brief || result.chapterSummary || '';
    if (!brief || result.mode !== 'current') return;
    if (!state.currentChapter?.id || String(result.chapterId || '') !== String(state.currentChapter.id)) return;
    state.currentChapter.summary = brief;
    state.currentChapter.summaryGenerator = 'ai-v1';
    state.currentChapter.summaryUpdatedAt = Date.now();
    if (!state.currentChapter.aiSummary || typeof state.currentChapter.aiSummary !== 'object') {
        state.currentChapter.aiSummary = {};
    }
    state.currentChapter.aiSummary.brief = brief;
    const input = $('#chapter-summary-input');
    if (input) input.value = brief;
    const hint = $('#summary-hint');
    if (hint) hint.textContent = 'AI 生成 · 设定提取';
    updateStatusBar();
}

async function refreshChaptersAfterExtraction(result = {}) {
    if (!['current', 'project'].includes(result.mode) || !state.currentNovel?.id) return;
    try {
        const data = await Repositories.chapters.list(state.currentNovel.id);
        const nextChapters = Array.isArray(data) ? data : [];
        if (!nextChapters.length) return;
        state.chapters = nextChapters.map(chapter => {
            if (chapter.id !== state.currentChapter?.id) return chapter;
            return { ...state.currentChapter, ...chapter, content: state.currentChapter.content };
        });
        if (state.currentChapter?.id) {
            const latestMeta = nextChapters.find(chapter => chapter.id === state.currentChapter.id);
            const latest = await Repositories.chapters.get(
                state.currentNovel.id,
                state.currentChapter.id,
            ).catch(() => latestMeta);
            if (latest) {
                Object.assign(state.currentChapter, {
                    summary: latest.summary || state.currentChapter.summary || '',
                    aiSummary: latest.aiSummary || state.currentChapter.aiSummary,
                    summaryGenerator: latest.summaryGenerator || state.currentChapter.summaryGenerator,
                    summaryUpdatedAt: latest.summaryUpdatedAt || state.currentChapter.summaryUpdatedAt,
                });
                showChapterSummary(state.currentChapter);
            }
        }
        refreshChapterTree();
        updateStatusBar();
    } catch (err) {
        console.warn('[Extraction] Failed to refresh chapter summaries:', err.message);
    }
}

async function removeExtractionJob(id) {
    extractionJobs.delete(id);
    extractionJobNotices.delete(id);
    renderExtractionJobDock();
    try {
        await AutomationRuntime.execute('extraction.jobs.delete', undefined, { jobId: id });
    } catch {}
}

// eslint-disable-next-line no-unused-vars
async function readProjectExtractionStream(response, progressEl) {
    if (Array.isArray(response?.events)) {
        let finalData = null;
        const pushProgress = text => {
            if (!progressEl || !text) return;
            progressEl.insertAdjacentHTML('beforeend', `<div>${escHtml(text)}</div>`);
            progressEl.scrollTop = progressEl.scrollHeight;
        };
        for (const event of response.events) {
            if (event.type === 'accepted') pushProgress(event.message || '已开始');
            if (event.type === 'start') pushProgress(`开始扫描 ${event.total || 0} 章`);
            if (event.type === 'chapter_start') pushProgress(`第 ${event.index}/${event.total} 章：${event.title || ''}`);
            if (event.type === 'chapter_done') pushProgress(`完成：${event.title || ''}`);
            if (event.type === 'done') finalData = event;
            if (event.type === 'error') throw new Error(event.message || 'Project extraction failed');
        }
        return finalData || { characters: [], worldEntries: [], summary: '逐章扫描完成。' };
    }
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/event-stream')) return response.json();
    const reader = response.body?.getReader?.();
    if (!reader) throw new Error('后端未返回流式响应');
    const decoder = new TextDecoder();
    let buffer = '';
    let finalData = null;
    const pushProgress = text => {
        if (!progressEl || !text) return;
        progressEl.insertAdjacentHTML('beforeend', `<div>${escHtml(text)}</div>`);
        progressEl.scrollTop = progressEl.scrollHeight;
    };
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split('\n\n');
        buffer = blocks.pop() || '';
        for (const block of blocks) {
            const data = block.split(/\r?\n/)
                .filter(line => line.startsWith('data:'))
                .map(line => line.slice(5).trimStart())
                .join('\n');
            if (!data) continue;
            const event = JSON.parse(data);
            if (event.type === 'accepted') pushProgress(event.message || '已开始');
            if (event.type === 'start') pushProgress(`开始扫描 ${event.total || 0} 章`);
            if (event.type === 'chapter_start') pushProgress(`第 ${event.index}/${event.total} 章：${event.title || ''}`);
            if (event.type === 'chapter_done') pushProgress(`完成：${event.title || ''}（角色 ${event.characters || 0}，世界书 ${event.worldEntries || 0}）`);
            if (event.type === 'done') finalData = event;
            if (event.type === 'error') throw new Error(event.message || 'Project extraction failed');
        }
    }
    return finalData || { characters: [], worldEntries: [], summary: '逐章扫描完成，但后端未返回结果。' };
}

// eslint-disable-next-line no-unused-vars
function showExtractionResultsLegacy(data) {
    const chars = data.characters || [];
    const entries = data.worldEntries || [];
    const overlay = document.createElement('div');
    overlay.className = 'plot-modal-overlay';
    const charRows = chars.map((c, i) => `<div class="extract-check-row"><input type="checkbox" class="extract-char-check" data-idx="${i}" checked><span><b>${escHtml(c.name)}</b> — ${escHtml(c.description?.substring(0, 60) || '')}</span></div>`).join('');
    const entryRows = entries.map((e, i) => `<div class="extract-check-row"><input type="checkbox" class="extract-entry-check" data-idx="${i}" checked><span><b>${escHtml(e.comment || e.key?.[0] || '条目')}</b> [${escHtml(e.group || '')}] — ${escHtml((e.key || []).join(', '))}</span></div>`).join('');
    const logRows = (data.extractionLog || []).map(log => `<div class="extract-check-row"><span><b>${escHtml(log.chapter || log.title || '章节')}</b>：角色 ${Number(log.characters || 0)}，世界书 ${Number(log.worldEntries || 0)}</span></div>`).join('');
    overlay.innerHTML = `<div class="plot-modal" style="max-width:700px;max-height:80vh;"><div class="plot-modal-header"><h3>提取结果</h3><p class="settings-subtitle">${data.summary || ''}</p><button class="plot-modal-close">×</button></div>
    <div class="plot-modal-body" style="max-height:55vh;overflow-y:auto;padding:16px;">
    <h4>角色 (${chars.length})</h4>${charRows || '<p style="color:var(--text-muted)">未提取到角色</p>'}
    <h4 style="margin-top:16px;">世界观条目 (${entries.length})</h4>${entryRows || '<p style="color:var(--text-muted)">未提取到世界观</p>'}
    ${logRows ? `<h4 style="margin-top:16px;">逐章扫描记录</h4>${logRows}` : ''}
    </div>
    <div class="plot-modal-footer"><div style="display:flex;gap:8px;"><label><input type="checkbox" id="extract-import-full" checked> 包含内容到正文</label></div><button class="ai-btn-secondary extract-close-btn">取消</button><button class="ai-btn-primary extract-import-btn">导入选中</button></div></div>`;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.querySelector('.plot-modal-close')?.addEventListener('click', close);
    overlay.querySelector('.extract-close-btn')?.addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    overlay.querySelector('.extract-import-btn')?.addEventListener('click', () => {
        const selChars = overlay.querySelectorAll('.extract-char-check:checked');
        const selEntries = overlay.querySelectorAll('.extract-entry-check:checked');
        if (!chars.length && !entries.length) { close(); return; }
        // Import selected characters
        selChars.forEach(cb => {
            const c = chars[parseInt(cb.dataset.idx)];
            if (c) state.characters.push({ _source: 'AI提取', spec: 'chara_card_v3', spec_version: '3.0', data: { name: c.name, description: c.description || '', personality: c.personality || '', scenario: c.scenario || '', first_mes: c.first_mes || '', mes_example: '', creator_notes: '', system_prompt: '', post_history_instructions: '', tags: [], group: c.group || '', character_book: { entries: [] } } });
        });
        // Import selected world entries
        selEntries.forEach(cb => {
            const e = entries[parseInt(cb.dataset.idx)];
            if (e) {
                if (!state.worldBook) state.worldBook = { entries: {} };
                const uid = Date.now() + Math.random();
                state.worldBook.entries[uid] = { _source: 'AI提取', folder: 'AI提取', sourceGroup: e.group || '', group: e.group || '', uid, key: e.key || [], keysecondary: [], content: e.content || '', comment: e.comment || '', constant: false, selective: true, order: 100, position: 0, disable: false, probability: 100, depth: 4 };
            }
        });
        renderCharacterList();
        renderWorldBookList();
        autoSave();
        close();
        showToast(`已导入 ${selChars.length} 个角色 + ${selEntries.length} 条世界书`, 'success');
    });
    requestAnimationFrame(() => overlay.classList.add('active'));
}

function showExtractionResults(data) {
    const chars = data.characters || [];
    const entries = data.worldEntries || [];
    const overlay = document.createElement('div');
    overlay.className = 'plot-modal-overlay';
    const charRows = chars.map((c, i) => {
        const detail = (c.summary || c.description || '').substring(0, 120);
        return `<label class="extract-check-row"><input type="checkbox" class="extract-char-check" data-idx="${i}" checked><span><b>${escHtml(c.name || '未命名角色')}</b><em>${escHtml(detail)}</em></span></label>`;
    }).join('');
    const entryRows = entries.map((e, i) => {
        const detail = [
            e.group ? `分组：${e.group}` : '',
            (e.summary || (e.key || []).join(', ')).substring(0, 120),
        ].filter(Boolean).join(' · ');
        return `<label class="extract-check-row"><input type="checkbox" class="extract-entry-check" data-idx="${i}" checked><span><b>${escHtml(e.comment || e.key?.[0] || '条目')}</b><em>${escHtml(detail)}</em></span></label>`;
    }).join('');
    const logRows = (data.extractionLog || []).map(log => `<div class="extract-log-row"><b>${escHtml(log.chapter || log.title || '章节')}</b><span>角色 ${Number(log.characters || 0)}，世界书 ${Number(log.worldEntries || 0)}${log.chapterSummary ? ` · ${escHtml(log.chapterSummary.substring(0, 80))}` : ''}</span></div>`).join('');
    overlay.innerHTML = `<div class="plot-modal extraction-result-modal"><div class="plot-modal-header"><h3>提取结果</h3><p class="settings-subtitle">${escHtml(data.summary || '')}</p><button class="plot-modal-close">×</button></div>
    <div class="plot-modal-body extraction-result-body">
        <section class="extract-result-section"><h4>角色</h4><p class="settings-subtitle">共识别 ${chars.length} 个角色候选，可勾选后导入角色卡。</p></section>
        <section class="extract-result-section"><h4>提取的角色条目</h4><div class="extract-result-list">${charRows || '<p class="extract-empty">未提取到角色</p>'}</div></section>
        <section class="extract-result-section"><h4>世界观</h4><p class="settings-subtitle">共识别 ${entries.length} 条世界书候选，可勾选后导入世界书。</p></section>
        <section class="extract-result-section"><h4>提取的世界观条目</h4><div class="extract-result-list">${entryRows || '<p class="extract-empty">未提取到世界观</p>'}</div></section>
        ${logRows ? `<section class="extract-result-section"><h4>逐章扫描记录</h4><div class="extract-result-list">${logRows}</div></section>` : '<section class="extract-result-section"><h4>逐章扫描记录</h4><p class="extract-empty">当前不是逐章扫描任务</p></section>'}
    </div>
    <div class="plot-modal-footer"><button class="ai-btn-secondary extract-close-btn">取消</button><button class="ai-btn-primary extract-import-btn">导入选中</button></div></div>`;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.querySelector('.plot-modal-close')?.addEventListener('click', close);
    overlay.querySelector('.extract-close-btn')?.addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    overlay.querySelector('.extract-import-btn')?.addEventListener('click', () => {
        const selChars = overlay.querySelectorAll('.extract-char-check:checked');
        const selEntries = overlay.querySelectorAll('.extract-entry-check:checked');
        if (!chars.length && !entries.length) { close(); return; }
        selChars.forEach(cb => {
            const c = chars[parseInt(cb.dataset.idx)];
            if (c) state.characters.push({ _source: 'AI提取', spec: 'chara_card_v3', spec_version: '3.0', data: { name: c.name, summary: c.summary || '', description: c.description || '', personality: c.personality || '', scenario: c.scenario || '', first_mes: c.first_mes || '', mes_example: '', creator_notes: '', system_prompt: '', post_history_instructions: '', tags: [], group: c.group || '', character_book: { entries: [] } } });
        });
        selEntries.forEach(cb => {
            const e = entries[parseInt(cb.dataset.idx)];
            if (e) {
                if (!state.worldBook) state.worldBook = { entries: {} };
                const uid = Date.now() + Math.random();
                state.worldBook.entries[uid] = { _source: 'AI提取', folder: 'AI提取', sourceGroup: e.group || '', group: e.group || '', uid, key: e.key || [], keysecondary: [], summary: e.summary || '', content: e.content || '', comment: e.comment || '', constant: false, selective: true, order: 100, position: 0, disable: false, probability: 100, depth: 4 };
            }
        });
        renderCharacterList();
        renderWorldBookList();
        autoSave();
        close();
        showToast(`已导入 ${selChars.length} 个角色 + ${selEntries.length} 条世界书`, 'success');
    });
    requestAnimationFrame(() => overlay.classList.add('active'));
}
