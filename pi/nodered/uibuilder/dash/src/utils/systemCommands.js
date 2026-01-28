// System command utilities

export function createSystemCommandManager(store, uibuilder) {
    const cmdMap = {
        'clearErrors': { topic: 'sendCommand', fPort: 13 },
        'reset': { topic: 'sendCommand', fPort: 10 },
        'reboot': { topic: 'sendCommand', fPort: 12 },
        'forceReg': { topic: 'sendCommand', fPort: 14 },
        'setInterval': { topic: 'sendCommand', fPort: 11 },
        'requestStatus': { topic: 'sendCommand', fPort: 15 }
    };

    return {
        sendSystemCommand(data) {
            const cmdInfo = cmdMap[data.command];
            if (!cmdInfo) {
                console.warn('Unknown command:', data.command);
                return;
            }

            const payload = {
                eui: data.eui || store.selectedDevice,
                fPort: cmdInfo.fPort,
                command: data.command
            };

            // Add value for setInterval command
            if (data.command === 'setInterval' && data.value) {
                payload.value = data.value;
            }

            // Track command before sending
            store.addCommandHistory({
                eui: payload.eui,
                type: 'system',
                command: data.command,
                value: data.value,
                source: 'user',
                status: 'pending',
                ts: Date.now()
            });

            console.log('Sending system command:', payload);
            uibuilder.send({
                topic: cmdInfo.topic,
                payload
            });
        }
    };
}
