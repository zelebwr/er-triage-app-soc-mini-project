const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const crypto = require('crypto');

// Synchronous blocking load of Protocol Buffer definition
const packageDefinition = protoLoader.loadSync('triage.proto', {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true
});
const triageProto = grpc.loadPackageDefinition(packageDefinition).triage;

// In-memory state management.
const patientsState = new Map();
let triageQueue = [];
const dashboardStreams = new Set();

// Broadcasts mutated state to all active Dashboard (server-side stream)
function broadcastQueueUpdate() {
    const htmlPayload = JSON.stringify(triageQueue);
    for (const stream of dashboardStreams) {
        stream.write({ raw_html_queue: htmlPayload});
    }
}

/**
 * Unary RPC
 * * Validates input -> allocates UUID -> push to state -> ack
 */
function registerPatient(call, callback) {
    const { name, age, complaint } = call.request;
    if (!name) {
        return callback ({
            code: grpc.status.INVALID_ARGUMENT,
            details: "Name required"
        });
    }
    const patientID = 'P-' + crypto.randomBytes(2).toString('hex').toUpperCase();

    patientState.set(patientId, {
        id: patientId, name, age, complaint,
        priority: 'Normal',
        bpm: 0
    });
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
        
        if (bpm < 50 || bpm > 120) {
          patient.priority = 'CRITICAL';
          // Mutates global queue order. Shifts critical patient to index 0.
          triageQueue = triageQueue.filter(p => p.id !== patient_id);
          triageQueue.unshift(patient);
          broadcastQueueUpdate();
          
          // Asynchronous push alert back to the specific transmitting IoT client
          call.write({ patient_id, alert_level: "RED", message: `CRITICAL BPM: ${bpm}` });
        }
    });
    call.on('end', () => call.end());
}

// Server-side RPC. Client connects -> Added to pool -> Awaits pushed state mutations[cite: 3].
function streamQueue(call) {
  dashboardStreams.add(call);
  call.write({ raw_html_queue: JSON.stringify(triageQueue) }); // Send initial state
  
  call.on('cancelled', () => {
    dashboardStreams.delete(call);
  });
}

// Architecture: Port Binding and Server Initialization.
const server = new grpc.Server();
server.addService(triageProto.AdmissionService.service, {
    // Binds the unary registration logic to the Admission microservice
    RegisterPatient: registerPatient
});

server.addService(triageProto.VitalsService.service, {
    // Binds the bi-directional streaming logic to the Vitals microservice[cite: 3].
    MonitorVitals: monitorVitals
});

server.addService(triageProto.DashboardService.service, {
    // Binds the server-side push logic to the Dashboard microservice[cite: 3].
    StreamQueue: streamQueue
 });

server.bindAsync('0.0.0.0:50051', grpc.ServerCredentials.createInsecure(), () => {
    // Starts the gRPC listener on standard unencrypted port.
    console.log("gRPC Microservice active on 0.0.0.0:50051");
});

module.exports = { server, triageQueue, patientsState, broadcastQueueUpdate };

const express = require('express');
const http = require('http');
const WebSocket = require('ws');


const app = express();
app.use(express.static('public'));
const httpServer = http.createServer(app);
const wss = new WebSocket.Server({ server: httpServer });

// LocalgRPC Client Stub -> Proxies WS JSON into ProtoBuf RPCs on loopback interface
const localAdmissionClient = new triageProto.AdmissionService('127.0.0.1:50051', grpc.credentials.createInsecure());
const localVitalsClient = new triageProto.VitalsService('127.0.0.1:50051', grpc.credentials.createInsecure());
const localDashboardClient = new triageProto.DashboardService('127.0.0.1:50051', grpc.credentials.createInsecure());

const vitalsStream = localVitalsClient.MonitorVitals();
vitalsStream.on('data', (alert) => {
    wss.clients.forEach(client => client.readyState === WebSocket.OPEN && client.send(JSON.stringify({
        type: 'VITALS_ALERT',
        data: alert
    })));
});

const dashboardStream = localDashboardClient.StreamQueue({ client_id: 'WS_GATEWAY' });
dashboardStream.on('data', (queueUpdate) => {
    wss.clients.forEach(client => client.readyState === WebSocket.OPEN && client.send(JSON.stringify({
        type: 'QUEUE_UPDATE',
        data: JSON.parse(queueUpdate.raw_html_queue)
    })));
});

wss.on('connection', (ws) => {
    ws.on('message', (message) => {
        const parsedMsg = JSON.parse(message);

        // Command & Control Bridge -> Browser instructions trigger native gRPC executions.
        if (parsedMsg.action === 'REGISTER') {
            localAdmissionClient.RegisterPatient(parsedMsg.payload, (err, response) => {
                if (err) return ws.send(JSON.stringify({ type: 'ERROR', data: err.details }));
                ws.send(JSON.stringify({ type: 'REGISTER_SUCCESS', data: response }));
            });
        } else if (parsedMsg.action === 'TRANSMIT_VITALS') {
            // Pipes simulated IoT sensor data from browser into the active gRPC bi-directional stream
            vitalsStream.write(parsedMsg.payload);
        }
    });
});

httpServer.listen(8080, '0.0.0.0', () => {
    // Starts the Web/WebSocket gateway on port 8080 for Nginx/ModSecurity edge ingestion.
    console.log("WebSocket Gateway active on 0.0.0.0:8080");
});

