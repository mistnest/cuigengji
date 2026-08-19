import { defineObjectSchema } from '../core/schema.js';

const projectId = { type: 'string', required: true, maxLength: 200 };
const chapterId = { type: 'string', required: true, maxLength: 200 };

export const PROJECT_INPUT_SCHEMAS = Object.freeze({
    listProjects: defineObjectSchema('project.projects.list', {}, { allowUndefined: true }),
    createProject: defineObjectSchema('project.projects.create', {
        title: { type: 'string', required: true, maxLength: 200 },
    }),
    requestDelete: defineObjectSchema('project.projects.requestDelete', { projectId }),
    deleteProject: defineObjectSchema('project.projects.delete', {
        projectId,
        confirmationToken: { type: 'string', required: true, maxLength: 500 },
    }),
    listChapters: defineObjectSchema('project.chapters.list', { projectId }),
    getChapter: defineObjectSchema('project.chapters.get', { projectId, chapterId }),
    createChapter: defineObjectSchema('project.chapters.create', {
        projectId, chapter: { type: 'object', required: true },
    }),
    updateChapter: defineObjectSchema('project.chapters.update', {
        projectId, chapterId, patch: { type: 'object', required: true },
    }),
    deleteChapter: defineObjectSchema('project.chapters.delete', {
        projectId, chapterId, confirmed: { type: 'boolean' },
    }),
    getOutline: defineObjectSchema('project.outlines.get', { projectId }),
    createOutlineNode: defineObjectSchema('project.outlines.createNode', {
        projectId, node: { type: 'object', required: true },
    }),
    updateOutlineNode: defineObjectSchema('project.outlines.updateNode', {
        projectId,
        nodeId: { type: 'string', required: true, maxLength: 200 },
        patch: { type: 'object', required: true },
    }),
    reorderOutline: defineObjectSchema('project.outlines.reorder', {
        projectId, command: { type: 'object', required: true },
    }),
    deleteOutlineNode: defineObjectSchema('project.outlines.deleteNode', {
        projectId,
        nodeId: { type: 'string', required: true, maxLength: 200 },
        confirmed: { type: 'boolean' },
        expectedRevision: { type: 'number' },
    }),
    getWorkspace: defineObjectSchema('project.workspace.get', { projectId }),
    saveWorkspace: defineObjectSchema('project.workspace.save', {
        projectId, workspace: { type: 'object', required: true },
    }),
});
