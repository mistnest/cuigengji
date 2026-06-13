import express from 'express';

import { hasAiSecret, saveAiSecret } from '../services/ai-secrets.js';

export const router = express.Router();

router.post('/', (req, res) => {
    try {
        const { provider, apiKey, profile } = req.body;
        if (!provider || typeof apiKey !== 'string' || !apiKey.trim()) {
            return res.status(400).json({ error: 'provider and apiKey are required' });
        }
        saveAiSecret({ provider, apiKey, profile });
        res.json({ success: true, hasKey: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/status', (req, res) => {
    try {
        const { provider, profile } = req.query;
        res.json({ hasKey: hasAiSecret(provider, profile) });
    } catch (err) {
        res.status(500).json({ error: err.message, hasKey: false });
    }
});
