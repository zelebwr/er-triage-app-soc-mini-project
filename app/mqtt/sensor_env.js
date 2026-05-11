const mqtt = require('mqtt');

const client = mqtt.connect('mqtt://localhost', {
    protocolVersion: 5,
    clientId: 'sensor_env_pub'
});

client.on('connect', () => {
    console.log('[Sensor Env] Connected. Emitting ER environmental metrics.');
    setInterval(() => {
        const payload = JSON.stringify({
            temp: (Math.random() * 5 + 20).toFixed(1), // Random temp between 20.0 and 25.0
            humidity: (Math.random() * 10 + 40).toFixed(1) // Random humidity between 40.0 and 50.0
        })
        client.publish('er/room1/env',payload, {
            qos: 1,
            retain: true,
            properties: {
                messageExpiryInterval: 60, // Message expires after 60 seconds
                userProperties: {
                    'sensor-model': 'DHT22',
                    'location': 'Triage-Zone-A',
                    'calibration-status': 'valid'
                }
            }
        });
        console.log(`[ENV PUBLISH] ${payload} (Retained. Expires in 60s)`);
    }, 5000); // Publish every 5 seconds
});

client.on('error', (err) => {
    console.error('[ERROR]', err.message); 
});
