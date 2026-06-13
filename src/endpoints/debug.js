/**
 * Novel AI Editor — [DEBUG] Prompt Inspector
 * 在 API 调用前截取完整的 system prompt + user message
 * 正式版删除此文件
 */
import express from 'express';
export const router = express.Router();

// In-memory store for the last API request
let lastRequest = null;

export function captureRequest(req) {
    lastRequest = { ...req, capturedAt: Date.now() };
}

// Legacy alias
export const capturePrompt = captureRequest;

// GET /api/debug/last-prompt — Retrieve the last API request
router.get('/last-prompt', (_req, res) => {
    if (!lastRequest) return res.json({ empty: true, message: '还没有发送过请求' });
    res.json(lastRequest);
});
