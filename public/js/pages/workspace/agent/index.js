/**
 * Page-oriented Renderer module.
 * Migrated from the former monolithic app/bootstrap.js using the reviewed ownership map.
 */
'use strict';
/* eslint-disable no-undef, no-unused-vars */
function bindAgentWorkbench() {
    window.AgentWorkbenchFeature?.mount({
        root: $('#agent-sidebar-root'),
        getContext: () => ({
            projectId: state.workspaceLoaded ? state.currentNovel?.id : '',
            chapterId: state.currentChapter?.id || '',
        }),
        beforeOpen: async () => {
            if (state.isDirty && !await onSave({ silent: true })) {
                throw new Error('当前章节保存失败，已停止打开工作台');
            }
            await saveWorkspaceState({ silent: true });
        },
        onStatus: detail => {
            setStatus(detail.message, detail.type);
            if (detail.type === 'warn' || detail.type === 'error') {
                showToast(detail.message, detail.type);
            }
        },
    });
    window.AgentWorkbenchFeature?.setEnabled(state.workspaceLoaded);
}
