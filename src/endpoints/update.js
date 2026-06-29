import express from 'express';
import { APP_SIGNATURE } from '../app-signature.js';

export const router = express.Router();

const LATEST_RELEASE_URL = 'https://api.github.com/repos/mistnest/cuigengji/releases/latest';

router.get('/check', async (_req, res) => {
    try {
        const latest = await fetchLatestRelease();
        const latestVersion = normalizeVersion(latest.tag_name || latest.name || '');
        const currentVersion = normalizeVersion(APP_SIGNATURE.version);

        if (latest.notFound) {
            return res.json({
                currentVersion: APP_SIGNATURE.version,
                latestVersion: '',
                tagName: '',
                hasUpdate: false,
                releaseName: '',
                releaseNotes: '暂未找到 GitHub Release。发布正式版本后，这里会显示最新版本。',
                publishedAt: '',
                htmlUrl: APP_SIGNATURE.repository + '/releases',
                assets: [],
            });
        }

        return res.json({
            currentVersion: APP_SIGNATURE.version,
            latestVersion: latestVersion || latest.tag_name || '',
            tagName: latest.tag_name || '',
            hasUpdate: latestVersion
                ? compareVersions(latestVersion, currentVersion) > 0
                : false,
            releaseName: latest.name || latest.tag_name || '',
            releaseNotes: latest.body || '',
            publishedAt: latest.published_at || '',
            htmlUrl: latest.html_url || APP_SIGNATURE.repository + '/releases/latest',
            assets: Array.isArray(latest.assets)
                ? latest.assets.map(asset => ({
                    name: asset.name,
                    size: asset.size,
                    downloadUrl: asset.browser_download_url,
                }))
                : [],
        });
    } catch (err) {
        res.status(502).json({
            error: err.message || '检查更新失败',
            currentVersion: APP_SIGNATURE.version,
            htmlUrl: APP_SIGNATURE.repository + '/releases/latest',
        });
    }
});

async function fetchLatestRelease() {
    const response = await fetch(LATEST_RELEASE_URL, {
        headers: {
            'Accept': 'application/vnd.github+json',
            'User-Agent': `${APP_SIGNATURE.name}/${APP_SIGNATURE.version}`,
        },
    });
    if (!response.ok) {
        if (response.status === 404) return { notFound: true };
        throw new Error(`GitHub Releases 返回 ${response.status}`);
    }
    return response.json();
}

function normalizeVersion(version = '') {
    return String(version || '')
        .trim()
        .replace(/^v/i, '')
        .replace(/[^\d.-].*$/, '');
}

function compareVersions(a = '', b = '') {
    const left = normalizeVersion(a).split(/[.-]/).map(part => Number(part) || 0);
    const right = normalizeVersion(b).split(/[.-]/).map(part => Number(part) || 0);
    const len = Math.max(left.length, right.length);
    for (let i = 0; i < len; i++) {
        const diff = (left[i] || 0) - (right[i] || 0);
        if (diff !== 0) return diff > 0 ? 1 : -1;
    }
    return 0;
}
