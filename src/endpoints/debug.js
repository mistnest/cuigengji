import express from 'express';
import { readLastApiCall, readRecentApiCalls, readRecentFullApiCalls } from '../services/api-call-logger.js';

export const router = express.Router();

let lastRequest = null;

export function captureRequest(req) {
    lastRequest = { ...req, capturedAt: Date.now() };
}

export const capturePrompt = captureRequest;

router.get('/last-prompt', (_req, res) => {
    if (!lastRequest) return res.json({ empty: true, message: 'No prompt has been captured yet.' });
    res.json(lastRequest);
});

router.get('/last-api-call', async (_req, res) => {
    const call = await readLastApiCall();
    if (!call) return res.json({ empty: true, message: 'No provider API calls have been logged yet.' });
    res.json(call);
});

router.get('/api-calls', async (req, res) => {
    const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 20));
    res.json({ calls: await readRecentApiCalls(limit) });
});

router.get('/recent-api-calls', async (_req, res) => {
    res.json({ calls: await readRecentFullApiCalls() });
});
