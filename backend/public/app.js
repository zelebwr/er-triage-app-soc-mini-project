// ── State ──────────────────────────────────────────────────────────────
let alertCount = 0;
let totalPatients = 0;
let queueData = []; // Store current queue for modal/suggestions
let criticalAlerts = new Map(); // patient_id -> { bpm, element }
let currentPage = 1;
let itemsPerPage = 10;
let searchQuery = '';
let toastCounter = 0;

// ── DOM Refs ───────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const wsStatus          = $('wsStatus');
const queueTable        = $('queueTable');
const alertDom          = $('alertDom');
const logDom            = $('logDom');
const statTotal         = $('statTotal');
const statQueue         = $('statQueue');
const statCritical      = $('statCritical');
const statAlerts        = $('statAlerts');
const queueCount        = $('queueCount');
const clockEl           = $('clock');
const patientModal     = $('patientModal');
const modalHeader      = $('modalHeader');
const modalBody        = $('modalBody');
const btnCloseModal    = $('btnCloseModal');
const patientSuggestions = $('patientSuggestions');
const suggestionList    = $('suggestionList');
const queueSearch      = $('queueSearch');
const paginationRow    = $('paginationRow');
const paginationInfo   = $('paginationInfo');
const btnPrevPage      = $('btnPrevPage');
const btnNextPage      = $('btnNextPage');
const pageIndicator    = $('pageIndicator');
const toastContainer   = $('toastContainer');

// ── Clock ──────────────────────────────────────────────────────────────
function updateClock() {
    clockEl.textContent = new Date().toLocaleTimeString('id-ID', { hour12: false });
}
setInterval(updateClock, 1000);
updateClock();

// ── Toast Notification System ───────────────────────────────────────────
function showToast(message, type = 'info', duration = 4000) {
    const id = `toast-${++toastCounter}`;
    const colors = {
        info:    'bg-primary-600',
        success: 'bg-med-600',
        error:   'bg-critical-600',
        warning: 'bg-yellow-500'
    };
    const icons = { info: 'ℹ️', success: '✅', error: '🚨', warning: '⚠️' };

    const toast = document.createElement('div');
    toast.id = id;
    toast.className = `${colors[type] || colors.info} text-white px-4 py-3 rounded-lg shadow-lg pointer-events-auto flex items-start gap-3 animate-[slideIn_0.3s_ease-out]`;
    toast.innerHTML = `
        <span class="text-lg shrink-0">${icons[type] || 'ℹ️'}</span>
        <div class="flex-1">
            <p class="text-sm font-medium">${message}</p>
        </div>
    `;
    toastContainer.prepend(toast);

    setTimeout(() => {
        toast.classList.add('opacity-0', 'translate-x-full');
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

// Add slide-in animation via style if not exists
if (!document.getElementById('toast-animation-style')) {
    const style = document.createElement('style');
    style.id = 'toast-animation-style';
    style.textContent = `
        @keyframes slideIn {
            from { transform: translateX(100%); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
        }
        .animate-\\[slideIn_0\\.3s_ease-out\\] {
            animation: slideIn 0.3s ease-out;
        }
    `;
    document.head.appendChild(style);
}

// ── Logging Helper ─────────────────────────────────────────────────────
function addLog(msg, level = 'info') {
    const li = document.createElement('li');
    const colors = {
        info:    'border-primary-400 bg-primary-50 text-primary-700',
        success: 'border-med-400 bg-med-50 text-med-700',
        error:   'border-critical-400 bg-critical-50 text-critical-700',
        warning: 'border-yellow-400 bg-yellow-50 text-yellow-700',
    };
    const icons = { info: 'ℹ️', success: '✅', error: '❌', warning: '⚠️' };
    li.className = `py-1 px-2 border-l-2 rounded-r ${colors[level] || colors.info} flex items-start gap-1.5`;
    const time = new Date().toLocaleTimeString('id-ID', { hour12: false });
    li.innerHTML = `<span class="opacity-60 shrink-0">${time}</span> <span>${icons[level] || ''} ${msg}</span>`;
    logDom.prepend(li);
    // Keep max 50 entries
    while (logDom.children.length > 50) logDom.removeChild(logDom.lastChild);
}

// ── Priority Badge ─────────────────────────────────────────────────────
function priorityBadge(priority) {
    if (priority === 'CRITICAL') {
        return `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-critical-100 text-critical-700 ring-1 ring-critical-500 animate-pulse">🔴 CRITICAL</span>`;
    }
    return `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-med-100 text-med-700 ring-1 ring-med-300">🟢 Normal</span>`;
}

// ── BPM Badge ──────────────────────────────────────────────────────────
function bpmBadge(bpm) {
    const n = parseInt(bpm) || 0;
    if (n === 0) return `<span class="text-slate-400">—</span>`;
    let cls = 'bg-med-100 text-med-700'; // normal
    if (n < 50 || n > 120) cls = 'bg-critical-100 text-critical-700 font-bold';
    return `<span class="inline-block px-2 py-0.5 rounded-md text-xs ${cls}">${n} BPM</span>`;
}

// ── Render Queue Table (clickable rows, with pagination + search) ───────────────────────────────
function renderQueue(data) {
    queueData = data || []; // Store for suggestions/modal

    // Apply search filter
    let filteredData = data || [];
    if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        filteredData = data.filter(p =>
            p.id.toLowerCase().includes(q) ||
            p.name.toLowerCase().includes(q) ||
            (p.complaint && p.complaint.toLowerCase().includes(q))
        );
    }

    // Pagination
    const totalPages = Math.ceil(filteredData.length / itemsPerPage) || 1;
    if (currentPage > totalPages) currentPage = totalPages;

    const startIdx = (currentPage - 1) * itemsPerPage;
    const paginatedData = filteredData.slice(startIdx, startIdx + itemsPerPage);

    // Show/hide pagination
    if (filteredData.length > itemsPerPage) {
        paginationRow.classList.remove('hidden');
        paginationRow.classList.add('flex');
        paginationInfo.textContent = `Menampilkan ${startIdx + 1}-${Math.min(startIdx + itemsPerPage, filteredData.length)} dari ${filteredData.length} pasien`;
        pageIndicator.textContent = `${currentPage}/${totalPages}`;
        btnPrevPage.disabled = currentPage === 1;
        btnNextPage.disabled = currentPage === totalPages;
    } else {
        paginationRow.classList.add('hidden');
        paginationRow.classList.remove('flex');
    }

    if (!filteredData.length) {
        queueTable.innerHTML = `
            <tr><td colspan="7" class="px-3 py-10 text-center text-slate-400">
                <div class="flex flex-col items-center gap-2">
                    <svg class="w-10 h-10 text-slate-300" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"/></svg>
                    ${searchQuery.trim() ? 'Tidak ada hasil pencarian' : 'Menunggu data antrian…'}
                </div>
            </td></tr>`;
        patientSuggestions.classList.add('hidden');
        return;
    }

    queueTable.innerHTML = paginatedData.map((p, i) => `
        <tr class="border-b border-slate-100 hover:bg-slate-50 transition-colors cursor-pointer ${p.priority === 'CRITICAL' ? 'bg-critical-50/50' : ''}"
            data-patient-id="${escapeHtml(p.id)}">
            <td class="px-3 py-2.5 text-slate-500 font-mono text-xs">${startIdx + i + 1}</td>
            <td class="px-3 py-2.5">${priorityBadge(p.priority)}</td>
            <td class="px-3 py-2.5 font-mono font-semibold text-primary-700 text-xs">${escapeHtml(p.id)}</td>
            <td class="px-3 py-2.5 font-medium">${escapeHtml(p.name)}</td>
            <td class="px-3 py-2.5 hidden sm:table-cell text-slate-500">${p.age || '—'}</td>
            <td class="px-3 py-2.5 hidden md:table-cell text-slate-500 text-xs max-w-[180px] truncate">${escapeHtml(p.complaint || '—')}</td>
            <td class="px-3 py-2.5">${bpmBadge(p.bpm)}</td>
        </tr>
    `).join('');

    // Update suggestions for vitals form
    updateSuggestions();

    // Add click listeners
    document.querySelectorAll('#queueTable tr[data-patient-id]').forEach(row => {
        row.addEventListener('click', () => openPatientModal(row.dataset.patientId));
    });
}

// ── Stats Update ───────────────────────────────────────────────────────
function updateStats(data) {
    const count = data ? data.length : 0;
    const criticals = data ? data.filter(p => p.priority === 'CRITICAL').length : 0;
    statTotal.textContent    = totalPatients;
    statQueue.textContent    = count;
    statCritical.textContent = criticals;
    statAlerts.textContent   = criticalAlerts.size; // Active critical alerts
    queueCount.textContent   = count;
}

// ── Patient ID Suggestions ──────────────────────────────────────────────
function updateSuggestions() {
    if (!queueData || queueData.length === 0) {
        patientSuggestions.classList.add('hidden');
        return;
    }
    patientSuggestions.classList.remove('hidden');
    suggestionList.innerHTML = queueData.map(p => `
        <button type="button" class="px-2 py-1 text-xs font-mono bg-slate-100 hover:bg-med-100 hover:text-med-700 rounded-md transition border border-slate-200 hover:border-med-300"
            onclick="selectPatientId('${escapeHtml(p.id)}')">
            ${escapeHtml(p.id)}
        </button>
    `).join('');
}

function selectPatientId(id) {
    $('vId').value = id;
    $('vBpm').focus();
}

// ── Patient Detail Modal ─────────────────────────────────────────────────
function openPatientModal(patientId) {
    const patient = queueData.find(p => p.id === patientId);
    if (!patient) return;

    const isCritical = patient.priority === 'CRITICAL';
    modalHeader.className = `px-6 py-4 flex items-center justify-between ${isCritical ? 'bg-critical-600' : 'bg-primary-600'}`;

    modalBody.innerHTML = `
        <div class="space-y-4">
            <div class="flex items-center gap-4">
                <div class="w-20 h-20 rounded-xl ${isCritical ? 'bg-critical-100' : 'bg-primary-100'} flex items-center justify-center text-4xl">
                    ${isCritical ? '🚨' : '👤'}
                </div>
                <div>
                    <p class="text-xs text-slate-500 uppercase tracking-wide font-semibold">Patient ID</p>
                    <p class="font-mono text-lg font-bold text-slate-800">${escapeHtml(patient.id)}</p>
                    <p class="text-xs text-slate-500 uppercase tracking-wide font-semibold mt-2">Status</p>
                    ${priorityBadge(patient.priority)}
                </div>
            </div>
            <div class="grid grid-cols-2 gap-3">
                <div class="bg-slate-50 rounded-lg p-3">
                    <p class="text-xs text-slate-500 uppercase tracking-wide font-semibold">Nama Lengkap</p>
                    <p class="font-medium text-slate-800 mt-0.5">${escapeHtml(patient.name)}</p>
                </div>
                <div class="bg-slate-50 rounded-lg p-3">
                    <p class="text-xs text-slate-500 uppercase tracking-wide font-semibold">Usia</p>
                    <p class="font-medium text-slate-800 mt-0.5">${patient.age || '—'} tahun</p>
                </div>
            </div>
            <div class="bg-slate-50 rounded-lg p-3">
                <p class="text-xs text-slate-500 uppercase tracking-wide font-semibold">Keluhan Utama</p>
                <p class="font-medium text-slate-800 mt-0.5">${escapeHtml(patient.complaint || '—')}</p>
            </div>
            <div class="bg-slate-50 rounded-lg p-3">
                <p class="text-xs text-slate-500 uppercase tracking-wide font-semibold">Vitals Terkini</p>
                <div class="flex items-center gap-3 mt-0.5">
                    ${bpmBadge(patient.bpm)}
                    <span class="text-xs text-slate-500">
                        ${patient.bpm < 50 ? '💔 Bradikardia' : patient.bpm > 120 ? '❤️ Takikardia' : patient.bpm > 0 ? '💓 Normal' : '— Belum ada data'}
                    </span>
                </div>
            </div>
            ${isCritical ? `
            <div class="bg-critical-50 border border-critical-200 rounded-lg p-3 flex items-center gap-2">
                <span class="text-xl">⚠️</span>
                <p class="text-sm text-critical-800 font-medium">Pasien dalam kondisi kritis — perlu tindakan segera</p>
            </div>
            ` : ''}
        </div>
    `;

    patientModal.style.display = 'flex';
}

function closeModal() {
    patientModal.style.display = 'none';
}

// ── HTML Escape ────────────────────────────────────────────────────────
function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
}

// ── WebSocket Connection ───────────────────────────────────────────────
const ws = new WebSocket('ws://' + window.location.host);

ws.addEventListener('open', () => {
    wsStatus.innerHTML = `
        <span class="w-2.5 h-2.5 rounded-full bg-green-400"></span>
        <span class="text-green-300">Connected</span>`;
    addLog('WebSocket terhubung ke server', 'success');
    
    // Clear UI state before fetching fresh data
    queueData = [];
    criticalAlerts.clear();
    alertDom.innerHTML = `
        <div class="flex items-center justify-center py-8 text-slate-400">
            <div class="flex flex-col items-center gap-2">
                <span class="text-3xl">✅</span>
                <span class="text-sm">Tidak ada alert aktif</span>
            </div>
        </div>`;
    currentPage = 1;
    searchQuery = '';
    queueSearch.value = '';
    
    // Request initial queue data from server
    setTimeout(() => {
        ws.send(JSON.stringify({ action: 'FETCH_QUEUE' }));
    }, 100);
});

ws.addEventListener('close', () => {
    wsStatus.innerHTML = `
        <span class="w-2.5 h-2.5 rounded-full bg-red-400"></span>
        <span class="text-red-300">Disconnected</span>`;
    addLog('WebSocket terputus dari server', 'error');
});

ws.addEventListener('error', () => {
    wsStatus.innerHTML = `
        <span class="w-2.5 h-2.5 rounded-full bg-red-500"></span>
        <span class="text-red-300">Error</span>`;
    addLog('WebSocket error', 'error');
});

ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);

    if (msg.type === 'QUEUE_UPDATE') {
        queueData = msg.data || []; // Update queueData state first
        renderQueue(msg.data);
        updateStats(msg.data);

        // Check for patients who returned to normal (clear their alerts)
        const normalPatients = msg.data.filter(p => {
            const bpm = parseInt(p.bpm) || 0;
            const wasCritical = criticalAlerts.has(p.id);
            return bpm >= 50 && bpm <= 120 && wasCritical;
        });
        normalPatients.forEach(p => {
            const alertData = criticalAlerts.get(p.id);
            if (alertData && alertData.element && alertData.element.parentNode) {
                alertData.element.remove();
            }
            criticalAlerts.delete(p.id);
            showToast(`Pasien ${p.id} vitals kembali normal (${p.bpm} BPM)`, 'success');
            addLog(`✅ Pasien ${p.id} vitals kembali normal (${p.bpm} BPM)`, 'success');
        });

        // Check for NEW critical patients and create alerts for them
        msg.data.forEach(p => {
            const bpm = parseInt(p.bpm) || 0;
            const isCritical = bpm < 50 || bpm > 120;
            const hasAlert = criticalAlerts.has(p.id);
            
            if (isCritical && !hasAlert) {
                // New critical patient - create alert
                const emptyState = alertDom.querySelector('.text-center');
                if (emptyState) emptyState.remove();
                
                const el = document.createElement('div');
                el.className = 'flex items-start gap-2 p-3 rounded-lg bg-critical-50 border border-critical-200 text-critical-800 text-sm animate-pulse';
                el.dataset.patientId = p.id;
                el.innerHTML = `
                    <span class="text-lg shrink-0">🚨</span>
                    <div class="flex-1">
                        <div class="flex items-center justify-between gap-2">
                            <div>
                                <p class="font-bold">CRITICAL — ${escapeHtml(p.id)}</p>
                                <p class="text-xs opacity-75">${escapeHtml(p.name)}</p>
                            </div>
                            <span class="text-xs font-bold bg-critical-200 px-2 py-0.5 rounded-full text-nowrap">${bpm} BPM</span>
                        </div>
                        <p class="text-xs mt-0.5">BPM di luar range normal (50-120)</p>
                    </div>`;
                alertDom.prepend(el);
                criticalAlerts.set(p.id, { bpm, element: el });
                showToast(`🚨 Alert: ${escapeHtml(p.name)} — BPM ${bpm}`, 'error');
                addLog(`⚠️ New Alert: ${p.id} (${escapeHtml(p.name)}) — BPM: ${bpm}`, 'error');
            } else if (hasAlert && isCritical) {
                // Update existing alert's BPM if changed
                const alertData = criticalAlerts.get(p.id);
                if (alertData.bpm !== bpm) {
                    alertData.bpm = bpm;
                    if (alertData.element) {
                        const bpmDisplay = alertData.element.querySelector('.font-bold.bg-critical-200');
                        if (bpmDisplay) bpmDisplay.textContent = `${bpm} BPM`;
                    }
                    addLog(`🔄 Alert Update: ${p.id} — BPM: ${bpm}`, 'info');
                }
            }
        });

        // Hide "no alerts" message if no critical patients
        if (criticalAlerts.size === 0 && alertDom.querySelector('.text-center') === null) {
            alertDom.innerHTML = `
                <div class="flex items-center justify-center py-8 text-slate-400">
                    <div class="flex flex-col items-center gap-2">
                        <span class="text-3xl">✅</span>
                        <span class="text-sm">Tidak ada alert aktif</span>
                    </div>
                </div>`;
        }

        addLog('Antrian triage tersinkronisasi', 'info');

    } else if (msg.type === 'VITALS_ALERT') {
        const alert = msg.data;
        const patientId = alert.patient_id;
        const bpm = parseInt(alert.bpm) || 0; // Ensure BPM is number, not '?'

        // Get patient name from queueData
        const patient = queueData.find(p => p.id === patientId);
        const patientName = patient ? escapeHtml(patient.name) : patientId;

        // Check alert level to determine critical vs normalization
        const isCritical = alert.alert_level === 'RED';

        if (isCritical && !criticalAlerts.has(patientId)) {
            // New CRITICAL alert
            const emptyState = alertDom.querySelector('.text-center');
            if (emptyState) emptyState.remove();
            
            const el = document.createElement('div');
            el.className = 'flex items-start gap-3 p-4 rounded-lg bg-critical-50 border-2 border-critical-300 text-critical-800 text-sm shadow-md';
            el.dataset.patientId = patientId;
            el.innerHTML = `
                <span class="text-2xl shrink-0 animate-pulse">🚨</span>
                <div class="flex-1 min-w-0">
                    <p class="font-bold text-base">${escapeHtml(alert.message)}</p>
                    <p class="text-xs opacity-80 mt-1">${patientName} (${escapeHtml(patientId)})</p>
                    <div class="flex items-center justify-between mt-2 pt-2 border-t border-critical-200">
                        <span class="text-xs font-semibold">Tekanan Jantung:</span>
                        <span class="text-lg font-bold text-critical-700">${bpm} BPM</span>
                    </div>
                </div>`;
            alertDom.prepend(el);

            criticalAlerts.set(patientId, { bpm, element: el });
            showToast(`🚨 ${patientName}: ${alert.message}`, 'error');
            addLog(`🚨 CRITICAL ALERT: ${patientName} (${patientId}) — ${bpm} BPM`, 'error');

        } else if (isCritical && criticalAlerts.has(patientId)) {
            // Update existing CRITICAL alert with new BPM
            const existing = criticalAlerts.get(patientId);
            if (existing.bpm !== bpm) {
                existing.bpm = bpm;
                if (existing.element) {
                    const bpmDisplay = existing.element.querySelector('.text-lg.font-bold.text-critical-700');
                    if (bpmDisplay) bpmDisplay.textContent = `${bpm} BPM`;
                    const msgDisplay = existing.element.querySelector('.font-bold.text-base');
                    if (msgDisplay) msgDisplay.textContent = escapeHtml(alert.message);
                }
                addLog(`🔄 Alert Update: ${patientName} — ${bpm} BPM`, 'warning');
            }

        } else if (!isCritical && criticalAlerts.has(patientId)) {
            // NORMALIZATION - alert_level is GREEN
            const alertData = criticalAlerts.get(patientId);
            if (alertData && alertData.element && alertData.element.parentNode) {
                alertData.element.remove();
            }
            criticalAlerts.delete(patientId);
            
            // If no more alerts, show empty state
            if (criticalAlerts.size === 0) {
                alertDom.innerHTML = `
                    <div class="flex items-center justify-center py-8 text-slate-400">
                        <div class="flex flex-col items-center gap-2">
                            <span class="text-3xl">✅</span>
                            <span class="text-sm">Semua pasien dalam kondisi stabil</span>
                        </div>
                    </div>`;
            }
            
            showToast(`✅ ${patientName}: ${alert.message}`, 'success');
            addLog(`✅ NORMALIZED: ${patientName} — ${bpm} BPM`, 'success');
        }

    } else if (msg.type === 'REGISTER_SUCCESS') {
        totalPatients++;
        showToast(`Pasien terdaftar: ${escapeHtml(msg.data.patient_id)}`, 'success');
        addLog(`Pasien terdaftar: <strong>${escapeHtml(msg.data.patient_id)}</strong> — Status: ${escapeHtml(msg.data.status)}`, 'success');

    } else if (msg.type === 'ERROR') {
        addLog(`Error: ${escapeHtml(msg.data)}`, 'error');
    }
});

// ── Button Handlers ────────────────────────────────────────────────────
$('btnReg').addEventListener('click', () => {
    const name      = $('pName').value.trim();
    const age       = parseInt($('pAge').value);
    const complaint = $('pComplaint').value.trim();

    if (!name) {
        addLog('Nama pasien wajib diisi!', 'warning');
        $('pName').focus();
        return;
    }
    if (isNaN(age) || age < 0) {
        addLog('Usia tidak valid!', 'warning');
        $('pAge').focus();
        return;
    }

    ws.send(JSON.stringify({
        action: 'REGISTER',
        payload: { name, age, complaint }
    }));

    $('pName').value = '';
    $('pAge').value = '';
    $('pComplaint').value = '';
    addLog(`Mengirim registrasi: ${name}…`, 'info');
});

$('btnVit').addEventListener('click', () => {
    const patient_id = $('vId').value.trim();
    const bpm        = parseInt($('vBpm').value);

    if (!patient_id) {
        addLog('Patient ID wajib diisi!', 'warning');
        $('vId').focus();
        return;
    }
    if (isNaN(bpm) || bpm < 0) {
        addLog('BPM tidak valid!', 'warning');
        $('vBpm').focus();
        return;
    }

    ws.send(JSON.stringify({
        action: 'TRANSMIT_VITALS',
        payload: { patient_id, bpm }
    }));

    addLog(`Mengirim vitals: ${patient_id} → ${bpm} BPM`, 'info');
});

$('btnClearLog').addEventListener('click', () => {
    logDom.innerHTML = '';
    addLog('Log dibersihkan', 'info');
});

// ── Modal Event Listeners ────────────────────────────────────────────
btnCloseModal.addEventListener('click', closeModal);
patientModal.addEventListener('click', (e) => {
    if (e.target === patientModal) closeModal();
});
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && patientModal.style.display === 'flex') closeModal();
});

// ── Enter-key Submit Support ───────────────────────────────────────────
['pName', 'pAge', 'pComplaint'].forEach(id => {
    $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btnReg').click(); });
});
['vId', 'vBpm'].forEach(id => {
    $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btnVit').click(); });
});

// ── Search Functionality ───────────────────────────────────────────────
queueSearch.addEventListener('input', (e) => {
    searchQuery = e.target.value;
    currentPage = 1; // Reset to page 1 on search
    renderQueue(queueData); // Re-render with filter
});

// ── Pagination ───────────────────────────────────────────────────────
btnPrevPage.addEventListener('click', () => {
    if (currentPage > 1) {
        currentPage--;
        renderQueue(queueData);
    }
});

btnNextPage.addEventListener('click', () => {
    const totalPages = Math.ceil((queueData.filter(p =>
        searchQuery ? (
            p.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
            p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            (p.complaint && p.complaint.toLowerCase().includes(searchQuery.toLowerCase()))
        ) : true
    ).length) / itemsPerPage);
    if (currentPage < totalPages) {
        currentPage++;
        renderQueue(queueData);
    }
});
