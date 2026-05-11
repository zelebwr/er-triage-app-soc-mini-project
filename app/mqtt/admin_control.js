const mqtt = require('mqtt');
const crypto = require('crypto');

const client = mqtt.connect('mqtt://localhost', {
    protocolVersion: 5,
    clientId: 'admin_control_node',
    will: {
        topic: 'er/admin/status',
        paylod: JSON.stringify({ status: 'OFFLINE', reason: 'Connection lost' }),
        qos: 1,
        retain: true
    }
});

client.on('connect', () => {
    console.log('[Admin Control] Connected.');
    // Overwrite any existing offline LWT state immediately upon successful connection
    client.publish('er/admin/status', JSON.stringify({ status: 'ONLINE' }), { qos: 1, retain: true }); 
    // Subscribe to the dynamically allocated or predefined response queue.
    client.subscribe('er/admin/response', { qos: 1 });

    setInterval(() => {
        const correlationId = crypto.randomBytes(4).toString('hex'); 
        const reqPayload = JSON.stringify({ comand: 'SYSTEM_DIAGNOSTIC' });

        client.publish('er/admin/request', reqPayload, {
            qos: 1,
            properties: {
                responseTopic: 'er/admin/response',
                correlationData: Buffer.from(correlationId)
            }
        });
        console.log(`[REQ SENT] ID: ${correlationId}, Cmd: SYSTEM_DIAGNOSTIC`);
    }, 10000);
});

client.on('message', (topic, message, packet) => {
    if (topic === 'er/admin/response') {
        const correlationData = packet.properties?.correlationData?.toString();
        console.log(`[RES RECV] ID: ${correlationData}, Data: ${message.toString()}`);
    }
});