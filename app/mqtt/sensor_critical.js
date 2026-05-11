const mqtt = require("mqtt");

const client = mqtt.connect("mqtt://localhost", {
    protocolVersion: 5,
    clientId: "sensor_critical_pub",
    properties: {
        receiveMaximum: 10,
    },
});

const PATIENT_ID = "P-CRIT-01";
const TOPIC = `er/${PATIENT_ID}/vitals`;
const ALIAS_ID = 1;
let isFirstPublish = true;

client.on("connect", () => {
    console.log(
        `[Sensor Critical] Connected. Emitting telemetry for %{PATIENT_ID}`,
    );
    setInterval(() => {
        const bpm = Math.floor(Math.random() * (130 - 40 + 1)) + 40; // Random BPM between 40 and 130
        const payload = JSON.stringify({ bpm });
        if (isFirstPublish) {
            client.publish(TOPIC, payload, {
                qos: 1,
                properties: { topicAlias: ALIAS_ID },
            });
            console.log(
                `[REGISTER ALIAS] Topic: ${TOPIC}, Alias: ${ALIAS_ID}, Payload: ${payload}`,
            );
            isFirstPublish = false;
        } else {
            client.publish("", payload, {
                qos: 1,
                properties: { topicAlias: ALIAS_ID },
            });
            console.log(`[USE ALIAS] Alias: ${ALIAS_ID}, Payload: ${payload}`);
        }
    }, 1000); // Publish every 1 second
});

client.on("error", (err) => {
    console.error("[ERROR]", err.message);
});
