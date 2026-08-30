/**
 * Page-oriented Renderer module.
 * Migrated from the former monolithic app/bootstrap.js using the reviewed ownership map.
 */
'use strict';
/* eslint-disable no-undef, no-unused-vars */
const Repositories = window.CuigengjiModules.repositories;
const Preferences = window.CuigengjiPreferences;
const AutomationRuntime = window.AutomationRuntimePort;

// ==================== State ====================
const defaultAiConfig = {
    provider: 'anthropic',
    apiKey: '',
    endpoint: '',
    model: 'claude-sonnet-4-6',
    temperature: 0.7,
    maxTokens: 4096,
    maxTokensPct: 5,
    topP: 0.9,
    memoryBudget: 15,
    maxContext: 0,
};

const state = {
    currentNovel: { id: 'default', title: '未命名小说' },
    currentChapter: null,
    chapters: [],
    outline: [],
    outlineRevision: 0,
    outlineContentHash: '',
    worldBook: { entries: {} },
    characters: [],
    promptTemplates: [],
    promptOrder: [],
    enabledTemplates: {},
    selectedPromptTemplates: {},
    regexBindings: [],
    writingReference: {
        worldbookMode: 'all',
        selectedWorldbookGroups: [],
        characterMode: 'auto',
        selectedCharacters: [],
    },
    sessions: [],
    writingContextAnchor: null,
    presets: {},
    presetName: '',
    aiConfig: { ...defaultAiConfig },
    appSettings: {
        theme: 'auto',
        editorFont: 'serif',
        editorFontSize: 17,
        editorLineHeight: 2,
        autoSaveDelay: 2000,
    },
    isDirty: false,
    // Covers delayed workspace-aggregate saves (settings, world book,
    // characters, prompts and layout).  `isDirty` remains the chapter-editor
    // draft flag; keeping both lets collaboration reloads protect every local
    // change without changing the existing chapter UX.
    workspaceDirty: false,
    workspaceRevision: 0,
    workspaceContentHash: '',
    externalChange: null,
    isConnected: false,
    isGenerating: false,
    hasSavedApiKey: false,
    hasSavedVertexServiceAccount: false,
    aiUsed: false,  // Track whether user has successfully used AI
    workspaceLoaded: false,
    // Monotonic renderer-side lifecycle tokens.  Async reads/writes compare
    // these before applying a result so a late response from another project
    // or chapter cannot mutate the active view.
    workspaceActionToken: 0,
    chapterMutationToken: 0,
    outlineMutationToken: 0,
    summaryRequestToken: 0,
    chapterContextToken: 0,
    editorSaveToken: 0,
    // Invalidates long-running AI/automation calls when the active project
    // or chapter changes.  The request itself may not be cancellable, so the
    // response must be ignored instead of being applied to the new view.
    automationRequestToken: 0,
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);
let workspaceLoadController = null;
let workspaceLoadVersion = 0;
let autoConnectInFlight = false;
const extractionJobs = new Map();
const extractionJobNotices = new Set();
let extractionJobPollTimer = null;

// ==================== Initialization ====================
