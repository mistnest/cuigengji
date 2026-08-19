// Compatibility facade for the legacy HTTP agent runtime. New code belongs to
// the settings domain and renderer code must use the versioned Electron API.
export {
    VERTEX_SERVICE_ACCOUNT_PROVIDER,
    applyAiSecret,
    clearAiSecretProtection,
    configureAiSecretProtection,
    deleteAiSecret,
    hasAiSecret,
    migrateAiConfigSecrets,
    readAiSecret,
    sanitizeAiConfig,
    sanitizePresetSecrets,
    saveAiSecret,
} from '../../../backend/foundation/configuration/index.js';
