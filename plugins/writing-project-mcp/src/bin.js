#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createWritingProjectServer } from './server.js';

const bridgeUrl = process.env.WRITING_PROJECT_BRIDGE_URL?.trim();
const token = process.env.WRITING_PROJECT_BRIDGE_TOKEN?.trim();
const projectId = process.env.WRITING_PROJECT_ID?.trim();
if (!bridgeUrl || !token || !projectId) {
    process.stderr.write('writing-project-mcp: bridge URL, token and project id are required\n');
    process.exitCode = 2;
} else {
    const server = createWritingProjectServer({ bridgeUrl, token, projectId });
    await server.connect(new StdioServerTransport());
}
