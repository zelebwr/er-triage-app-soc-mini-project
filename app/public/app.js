// Architecture: Event-Driven WebSocket UI Controller.
// Why: Translates bidirectional gateway streams into stateless DOM mutations.
const ws = new WebSocket('ws://'  window.location.host);

const queueDom = document.getElementById('queueDom');
const alertDom = document.getElementById('alertDom');
const logDom = document.getElementById('logDom');

// Mechanism: Asynchronous Listener -> Server-Initiated Events router.
ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);

    // Logic: Maps specific gateway actions to the 3 mandatory dynamic UI components.
    if (msg.type === 'QUEUE_UPDATE') {
        // Mutation 1: Real-time Priority Indicator.
        queueDom.innerHTML = msg.data.map(p =>
            `<li>[${p.priority}] ${p.id} - ${p.name} (${p.bpm} BPM)</li>`
        ).join('');
        logDom.innerHTML = `<li>System: Triage queue synchronized with gRPC state.</li>`;
    } else if (msg.type === 'VITALS_ALERT') {
        // Mutation 2: Server-initiated visual alarm injection.
        alertDom.innerHTML = `<span style="color:red; font-weight:bold;">EMERGENCY: Patient ${msg.data.patient_id} - ${msg.data.message}</span>`;
        logDom.innerHTML = `<li><span style="color:red">Critical Vitals Alert Received.</span></li>`;
    } else if (msg.type === 'REGISTER_SUCCESS') {
        // Mutation 3: Activity log append operation.
        logDom.innerHTML = `<li>Registration successful. Target ID: ${msg.data.patient_id}</li>`;
    }
};

// Mechanism: Command & Control Bridge Transmitters.
document.getElementById('btnReg').onclick = () => {
    const payload = {
        name: document.getElementById('pName').value,
        age: parseInt(document.getElementById('pAge').value),
        complaint: document.getElementById('pComplaint').value
    };
    ws.send(JSON.stringify({ action: 'REGISTER', payload }));
};

document.getElementById('btnVit').onclick = () => {
    const payload = {
        patient_id: document.getElementById('vId').value,
        bpm: parseInt(document.getElementById('vBpm').value)
    };
    ws.send(JSON.stringify({ action: 'TRANSMIT_VITALS', payload }));
};

