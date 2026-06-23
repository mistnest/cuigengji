const DEFAULT_FORBIDDEN_TERMS = [
    '一丝',
    '一丝微笑',
    '不易察觉',
    '难以察觉',
    '鲜明对比',
    '不是……而是……',
    '石子落入湖面',
    '湖面的涟漪',
    '喉结',
    '锁骨',
    '指节发白',
    '睫毛颤动',
];

const SELF_CORRECTION_RE = /[^\n。！？]*?(?:不易察觉|难以察觉|一丝微笑|一丝|鲜明对比|石子落入湖面|湖面的涟漪|喉结|锁骨|指节发白|睫毛颤动)[^\n。！？]*?(?:不对|禁词|不能用|别用|毙了)[^\n。！？]*?[。！？]\s*/g;
const EXPLICIT_SELF_CORRECTION_RE = /[^\n。！？]*?(?:不对|禁词|不能用|别用|毙了)[^\n。！？]*?[。！？]\s*/g;

export function applyWritingOutputGuard(reply = '', options = {}) {
    const forbiddenTerms = collectForbiddenTerms(options.promptTemplates);
    const before = String(reply || '');
    let cleaned = stripPseudoToolCalls(before);
    let removedSelfCorrections = 0;

    cleaned = cleaned.replace(SELF_CORRECTION_RE, () => {
        removedSelfCorrections += 1;
        return '';
    });
    cleaned = cleaned.replace(EXPLICIT_SELF_CORRECTION_RE, (match) => {
        if (!/禁词|不能用|别用|毙了/.test(match)) return match;
        removedSelfCorrections += 1;
        return '';
    });

    const remainingForbiddenTerms = forbiddenTerms.filter(term => term && cleaned.includes(term));

    return {
        reply: cleaned,
        debug: {
            changed: cleaned !== before,
            removedSelfCorrections,
            forbiddenTerms,
            remainingForbiddenTerms,
        },
    };
}

export function collectForbiddenTerms(promptTemplates = []) {
    const found = new Set(DEFAULT_FORBIDDEN_TERMS);
    for (const template of promptTemplates || []) {
        const name = `${template?.identifier || ''} ${template?.name || ''}`;
        const content = String(template?.content || '');
        if (!/禁词|禁止|forbidden/i.test(name + content)) continue;
        for (const line of content.split(/\r?\n/)) {
            const normalized = line.trim();
            if (!normalized.startsWith('-')) continue;
            const item = normalized
                .replace(/^-\s*/, '')
                .replace(/（[\s\S]*?）/g, '')
                .replace(/\([\s\S]*?\)/g, '')
                .trim();
            for (const part of item.split(/[\/、，,]/)) {
                const term = part.trim();
                if (term) found.add(term);
            }
        }
    }
    return [...found].sort((a, b) => b.length - a.length);
}

export function stripPseudoToolCalls(text = '') {
    return String(text || '')
        .replace(/<\s*[|｜]{2}\s*DSML\s*[|｜]{2}\s*tool_calls\s*>[\s\S]*?<\s*\/\s*[|｜]{2}\s*DSML\s*[|｜]{2}\s*tool_calls\s*>/gi, '')
        .replace(/<\s*tool_calls\s*>[\s\S]*?<\s*\/\s*tool_calls\s*>/gi, '')
        .replace(/```(?:json|xml)?\s*[\s\S]*?(?:tool_calls|get_reference_detail|search_reference|get_scene_context)[\s\S]*?```/gi, '')
        .trim();
}

export function stripReasoningBlocks(text = '') {
    return String(text || '')
        .replace(/\[REASONING\][\s\S]*?\[\/REASONING\]/gi, '')
        .replace(/\[THINKING\][\s\S]*?\[\/THINKING\]/gi, '')
        .replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi, '')
        .replace(/<thinking\b[^>]*>[\s\S]*?<\/thinking>/gi, '')
        .trim();
}
