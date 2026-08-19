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
    referenceMode: 'tool',
    compactReference: false,
    referenceTools: false,
    enableReferenceTools: false,
};

const state = {
    currentNovel: { id: 'default', title: '未命名小说' },
    currentChapter: null,
    chapters: [],
    outline: [],
    outlineRevision: 0,
    worldBook: { entries: {} },
    characters: [],
    promptTemplates: [],
    promptOrder: [],
    enabledTemplates: {},
    selectedPromptTemplates: {},
    specialPrompts: {},
    formatStrings: {},
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
    isConnected: false,
    isGenerating: false,
    hasSavedApiKey: false,
    hasSavedVertexServiceAccount: false,
    aiUsed: false,  // Track whether user has successfully used AI
    workspaceLoaded: false,
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
