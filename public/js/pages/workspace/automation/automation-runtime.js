(function () {
    'use strict';

    const automation = window.DesktopApi?.automation;
    if (!automation?.available || !automation.operations) {
        throw new Error('DesktopApi.automation is required');
    }

    class AutomationRuntimePort {
        get kind() {
            return 'electron-ipc-automation';
        }

        execute(operation, payload, options = {}) {
            return automation.operations.run(operation, payload, options);
        }

        openStream(operation, payload, options = {}) {
            return automation.operations.run(operation, payload, options);
        }

        cancel(operationId) {
            return automation.operations.cancel(operationId);
        }
    }

    window.AutomationRuntimePort = Object.freeze(new AutomationRuntimePort());
}());
