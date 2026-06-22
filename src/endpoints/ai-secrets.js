import express from 'express';

import { hasAiSecret, readAiSecret, saveAiSecret } from '../services/ai-secrets.js';

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

router.post('/reveal', (req, res) => {
    try {
        const fetchSite = req.get('sec-fetch-site');
        const origin = req.get('origin');
        const originHost = origin ? new URL(origin).host : '';
        if ((fetchSite && !['same-origin', 'same-site', 'none'].includes(fetchSite))
            || (originHost && originHost !== req.get('host'))) {
            return res.status(403).json({ error: 'Cross-origin secret access is not allowed' });
        }

        const { provider, profile } = req.body || {};
        if (!provider) return res.status(400).json({ error: 'provider is required' });
        const apiKey = readAiSecret(provider, profile);
        res.set('Cache-Control', 'no-store');
        res.json({ hasKey: Boolean(apiKey), apiKey });
    } catch {
        res.status(403).json({ error: 'Secret access was rejected' });
    }
});
