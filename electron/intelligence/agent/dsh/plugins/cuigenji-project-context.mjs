import fs from 'node:fs';

export const name = 'cuigenji-project-context';
export const inject = ['systemPrompt'];

export function apply(ctx) {
    ctx.effect(() => ctx.systemPrompt.context({
        name: 'cuigenji:project-context',
        order: 10,
        text: () => readProjectContext(),
    }), 'cuigenji.project-context');
}

function readProjectContext() {
    const file = process.env.CUIGENGJI_DSH_CONTEXT_FILE;
    if (!file) return '催更姬尚未提供项目上下文。';
    try {
        const snapshot = JSON.parse(fs.readFileSync(file, 'utf8'));
        return typeof snapshot.promptText === 'string'
            ? snapshot.promptText
            : '催更姬项目上下文格式无效。';
    } catch {
        return '催更姬项目上下文暂时不可读取，请返回主编辑器后重新打开 DSH 工作台。';
    }
}
