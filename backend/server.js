const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const crypto = require('crypto');
const { exec } = require('child_process');
const express = require('express');
const http = require('http');
const WebSocket = require('ws');

// Load proto
const packageDefinition = protoLoader.loadSync('triage.proto', {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true
});
const triageProto = grpc.loadPackageDefinition(packageDefinition).triage;

// State
const patientsState = new Map();
let triageQueue = [];
const dashboardStreams = new Set();

function broadcastQueueUpdate() {
    const htmlPayload = JSON.stringify(triageQueue);
    for (const stream of dashboardStreams) {
        stream.write({ raw_html_queue: htmlPayload });
    }
}

// Track critical patients for alert persistence
const criticalPatients = new Map(); // patient_id -> { bpm, alertLevel, message, timestamp }

// VULNERABLE: Command Injection via patient name
function registerPatient(call, callback) {
    const { name, age, complaint } = call.request;
    if (!name) {
        return callback({ code: grpc.status.INVALID_ARGUMENT, details: "Name required" });
    }
    // ===== COMMAND INJECTION HOLE =====
    exec(`echo "New patient: ${name}" >> /tmp/registrations.log`, (error) => {
        if (error) console.error("Exec error:", error);
    });
    // =================================
    const patientId = 'P-' + crypto.randomBytes(2).toString('hex').toUpperCase();
    patientsState.set(patientId, { id: patientId, name, age, complaint, priority: 'Normal', bpm: 0 });
    triageQueue.push(patientsState.get(patientId));
    broadcastQueueUpdate();
    callback(null, { patient_id: patientId, status: "Admitted" });
}

function monitorVitals(call) {
    call.on('data', (vitalsRequest) => {
        const { patient_id, bpm } = vitalsRequest;
        const patient = patientsState.get(patient_id);
        if (!patient) return;
        patient.bpm = bpm;
        
        // Skip alerts if BPM is 0 (IoT device not connected/no data)
        if (bpm === 0) return;
        
        if (bpm < 50 || bpm > 120) {
            patient.priority = 'CRITICAL';
            triageQueue = triageQueue.filter(p => p.id !== patient_id);
            triageQueue.unshift(patient);
            broadcastQueueUpdate();
            // Store critical alert for persistence
            const alertMsg = bpm < 50 
                ? `⚠️ Tekanan Jantung Sangat Rendah: ${bpm} BPM`
                : `🔴 Tekanan Jantung Tinggi: ${bpm} BPM`;
            criticalPatients.set(patient_id, {
                bpm,
                alert_level: 'RED',
                message: alertMsg,
                timestamp: new Date().toISOString()
            });
            call.write({ patient_id, alert_level: 'RED', message: alertMsg, bpm });
        } else if (criticalPatients.has(patient_id)) {
            // Patient returned to normal - clear stored alert
            criticalPatients.delete(patient_id);
            const normalMsg = `✅ Tekanan Jantung Kembali Normal: ${bpm} BPM`;
            call.write({ patient_id, alert_level: 'GREEN', message: normalMsg, bpm });
        }
    });
    call.on('end', () => call.end());
}

function streamQueue(call) {
    dashboardStreams.add(call);
    call.write({ raw_html_queue: JSON.stringify(triageQueue) });
    call.on('cancelled', () => dashboardStreams.delete(call));
}

// gRPC server
const grpcServer = new grpc.Server();
grpcServer.addService(triageProto.AdmissionService.service, { RegisterPatient: registerPatient });
grpcServer.addService(triageProto.VitalsService.service, { MonitorVitals: monitorVitals });
grpcServer.addService(triageProto.DashboardService.service, { StreamQueue: streamQueue });
grpcServer.bindAsync('0.0.0.0:50051', grpc.ServerCredentials.createInsecure(), () => {
    console.log("gRPC listening on 0.0.0.0:50051");
});

// HTTP & WebSocket gateway
const app = express();
app.use(express.static('public'));
const httpServer = http.createServer(app);
const wss = new WebSocket.Server({ server: httpServer });

const localAdmissionClient = new triageProto.AdmissionService('localhost:50051', grpc.credentials.createInsecure());
const localVitalsClient = new triageProto.VitalsService('localhost:50051', grpc.credentials.createInsecure());
const localDashboardClient = new triageProto.DashboardService('localhost:50051', grpc.credentials.createInsecure());

const vitalsStream = localVitalsClient.MonitorVitals();
vitalsStream.on('data', (alert) => {
    wss.clients.forEach(client => client.readyState === WebSocket.OPEN &&
        client.send(JSON.stringify({ type: 'VITALS_ALERT', data: alert })));
});

const dashboardStream = localDashboardClient.StreamQueue({ client_id: 'WS_GATEWAY' });
dashboardStream.on('data', (queueUpdate) => {
    wss.clients.forEach(client => client.readyState === WebSocket.OPEN &&
        client.send(JSON.stringify({ type: 'QUEUE_UPDATE', data: JSON.parse(queueUpdate.raw_html_queue) })));
});

wss.on('connection', (ws) => {
    ws.on('message', (message) => {
        const parsedMsg = JSON.parse(message);
        if (parsedMsg.action === 'REGISTER') {
            localAdmissionClient.RegisterPatient(parsedMsg.payload, (err, response) => {
                if (err) return ws.send(JSON.stringify({ type: 'ERROR', data: err.details }));
                ws.send(JSON.stringify({ type: 'REGISTER_SUCCESS', data: response }));
            });
        } else if (parsedMsg.action === 'TRANSMIT_VITALS') {
            vitalsStream.write(parsedMsg.payload);
        } else if (parsedMsg.action === 'FETCH_QUEUE') {
            // Send complete queue data with BPM and priority sync
            const queueWithBpm = triageQueue.map(p => ({
                ...p,
                bpm: p.bpm || 0,
                priority: criticalPatients.has(p.id) ? 'CRITICAL' : p.priority
            }));
            ws.send(JSON.stringify({ type: 'QUEUE_UPDATE', data: queueWithBpm }));
            
            // Send all active critical alerts with small delay
            setTimeout(() => {
                criticalPatients.forEach((alert, patientId) => {
                    ws.send(JSON.stringify({
                        type: 'VITALS_ALERT',
                        data: {
                            patient_id: patientId,
                            alert_level: alert.alert_level,
                            message: alert.message,
                            bpm: alert.bpm
                        }
                    }));
                });
            }, 100);
        }
    });
});

httpServer.listen(8080, '0.0.0.0', () => {
    console.log("WebSocket gateway on http://0.0.0.0:8080");
});

module.exports = { grpcServer, triageQueue, patientsState };
