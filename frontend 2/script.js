// ==== Globals & DOM ====
const form = document.getElementById('prediction-form');
const resultContent = document.getElementById('result-content');
const loadingSpinner = document.getElementById('loading-spinner');
const emptyState = document.getElementById('empty-state');
const offlineToast = document.getElementById('offline-toast');

let currentAuditData = null; // Store last successful request payload

// ==== Initialization & State ====
document.addEventListener('DOMContentLoaded', () => {
    initHeader();
    renderDashboardTable();
    updateDashboardMetrics();
    
    // Default open dashboard
    switchTab('dashboard');
});

// ==== Header logic ====
function initHeader() {
    setInterval(() => {
        const now = new Date();
        document.getElementById('header-timestamp').innerHTML = `<i class="fa-solid fa-clock"></i> ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    }, 1000);
}

function generateTxId() {
    const hex = Math.random().toString(16).substring(2, 6).toUpperCase();
    const num = Math.floor(Math.random() * 900) + 100;
    return `CR-${hex}-${num}`;
}

// ==== Tab Navigation ====
const navItems = document.querySelectorAll('.nav-item');
const tabPanes = document.querySelectorAll('.tab-pane');
const pageTitle = document.getElementById('page-title');

function switchTab(targetId) {
    navItems.forEach(i => i.classList.remove('active'));
    tabPanes.forEach(p => p.classList.remove('active'));

    const activeNav = document.querySelector(`.nav-item[data-target="${targetId}"]`);
    const activePane = document.getElementById(`tab-${targetId}`);

    if (activeNav) activeNav.classList.add('active');
    if (activePane) activePane.classList.add('active');
    
    const titles = {
        'dashboard': 'Operational Dashboard',
        'assessment': 'Risk Assessment Engine',
        'intelligence': 'Intelligence & Insights'
    };
    if (pageTitle && titles[targetId]) {
        pageTitle.textContent = titles[targetId];
    }
}

navItems.forEach(item => {
    item.addEventListener('click', () => switchTab(item.getAttribute('data-target')));
});

// ==== Counters & Sliders ====
function updateCounter(id, change) {
    const el = document.getElementById(id);
    let val = parseInt(el.value) || 0;
    val = Math.max(0, val + change);
    el.value = val;
}

const utilSlider = document.getElementById('revolving_util');
const utilVal = document.getElementById('util_val');
if (utilSlider) {
    utilSlider.addEventListener('input', (e) => {
        utilVal.textContent = e.target.value;
        // Optionally update timeline live
        if (currentAuditData) {
            renderIntelligenceTimeline(e.target.value);
        }
    });
}

// ==== PDF Download ====
document.getElementById('pdf-btn').addEventListener('click', () => {
    const assessmentTab = document.getElementById('tab-assessment');
    const txIdText = document.getElementById('header-txid').innerText.replace('ID: ', '').trim();
    const filename = `Alt-Credit-Report-${txIdText}.pdf`;

    if (typeof html2pdf === 'undefined') {
        alert("PDF library is loading, please try again in a moment.");
        return;
    }

    // Hide the PDF button during capture
    const pdfBtnEl = document.getElementById('pdf-btn');
    pdfBtnEl.style.display = 'none';

    // Open all <details> so content is visible in the PDF
    const detailsEls = assessmentTab.querySelectorAll('details');
    detailsEls.forEach(d => d.setAttribute('open', ''));

    const opt = {
        margin:       0.4,
        filename:     filename,
        image:        { type: 'jpeg', quality: 0.98 },
        html2canvas:  { scale: 2, useCORS: true, backgroundColor: '#0a0d14', scrollY: 0, windowWidth: 1200 },
        jsPDF:        { unit: 'in', format: 'a3', orientation: 'landscape' }
    };

    html2pdf().set(opt).from(assessmentTab).save().then(() => {
        pdfBtnEl.style.display = '';
    });
});

// ==== Form Submission & Engine API ====
form.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    // UI State
    form.querySelector('button[type="submit"]').disabled = true;
    resultContent.classList.add('hidden');
    loadingSpinner.classList.remove('hidden');
    document.getElementById('header-txid').innerHTML = `<i class="fa-solid fa-cookie-bite fa-spin"></i> Processing...`;

    // Data collection
    const payload = {
        MonthlyIncome: parseFloat(document.getElementById('monthly_income').value),
        DebtRatio: parseFloat(document.getElementById('debt_ratio').value),
        RevolvingUtilizationOfUnsecuredLines: parseFloat(document.getElementById('revolving_util').value) / 100,
        NumberOfOpenCreditLinesAndLoans: parseInt(document.getElementById('open_lines').value),
        "NumberOfTime30-59DaysPastDueNotWorse": parseInt(document.getElementById('late_30_59').value),
        NumberOfTimes90DaysLate: parseInt(document.getElementById('late_90').value),
        age: parseInt(document.getElementById('age').value)
    };

    currentAuditData = payload; // save for intelligence tab

    try {
        const response = await fetch('http://127.0.0.1:8000/predict', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) throw new Error("Offline");

        const result = await response.json();
        
        setTimeout(() => {
            processSuccessfulAudit(result, payload);
        }, 600); // UI delay for effect

    } catch (err) {
        console.error(err);
        showOfflineToast();
        loadingSpinner.classList.add('hidden');
        form.querySelector('button[type="submit"]').disabled = false;
        document.getElementById('header-txid').innerHTML = `<i class="fa-solid fa-fingerprint"></i> ID: OFFLINE`;
    }
});

function showOfflineToast() {
    offlineToast.classList.remove('hidden');
    setTimeout(() => { offlineToast.classList.add('hidden'); }, 4000);
}

// ==== Core Result Processing ====
async function processSuccessfulAudit(result, payload) {
    const prob = (result.default_probability * 100).toFixed(1);
    const isApproved = result.approved;
    
    const txId = generateTxId();
    document.getElementById('header-txid').innerHTML = `<i class="fa-solid fa-fingerprint"></i> ID: ${txId}`;

    // 1. Save to Local Storage
    saveAuditToStorage({
        id: txId,
        date: new Date().toLocaleString(),
        prob: parseFloat(prob),
        approved: isApproved
    });

    // 2. Update Dashboard Metrics
    updateDashboardMetrics();
    renderDashboardTable();

    // 3. Render Assessment UI
    renderAssessmentResult(prob, isApproved);
    await renderDecisionDrivers(payload, parseFloat(prob));
    
    if (!isApproved) {
        await renderApprovalPath(payload, parseFloat(prob));
    } else {
        document.getElementById('simulation-list').innerHTML = '<li style="color:var(--emerald-green);"><i class="fa-solid fa-check"></i> Profile is fully optimized.</li>';
    }

    // 4. Render Intelligence View
    renderIntelligenceTimeline(payload.RevolvingUtilizationOfUnsecuredLines * 100);
    renderPeerBenchmark(payload, parseFloat(prob));
    renderSensitivityMatrix(payload, parseFloat(prob));

    // Release button
    form.querySelector('button[type="submit"]').disabled = false;
}

// ==== ASSESSMENT PANE ====
function renderAssessmentResult(prob, isApproved) {
    loadingSpinner.classList.add('hidden');
    resultContent.classList.remove('hidden');

    const badge = document.getElementById('decision-badge');
    const badgeText = document.getElementById('decision-text');
    const badgeIcon = badge.querySelector('i');

    badge.className = 'decision-badge ' + (isApproved ? 'badge-approved' : 'badge-rejected');
    badgeText.textContent = isApproved ? 'LOAN APPROVED' : 'HIGH RISK PROFILE';
    badgeIcon.className = isApproved ? 'fa-solid fa-check-double' : 'fa-solid fa-triangle-exclamation';

    const gauge = document.getElementById('prob-gauge');
    const gaugeColor = isApproved ? 'var(--emerald-green)' : 'var(--crimson-red)';
    
    gauge.style.setProperty('--value', 0);
    setTimeout(() => {
        gauge.style.setProperty('--gauge-color', gaugeColor);
        gauge.style.setProperty('--value', Math.min(prob, 100));
        document.getElementById('prob-value').textContent = `${prob}%`;
    }, 100);
}

// ==== DATA PERSISTENCE ====
function getAudits() {
    try {
        const data = localStorage.getItem('credit_audits');
        return data ? JSON.parse(data) : [];
    } catch { return []; }
}

function saveAuditToStorage(auditRec) {
    let audits = getAudits();
    audits.unshift(auditRec);
    if (audits.length > 10) audits.pop(); // Keep 10
    localStorage.setItem('credit_audits', JSON.stringify(audits));
}

function updateDashboardMetrics() {
    const audits = getAudits();
    document.getElementById('metric-audits').textContent = audits.length;
    
    if (audits.length === 0) return;

    const totalRisk = audits.reduce((sum, a) => sum + a.prob, 0);
    const avgRisk = (totalRisk / audits.length).toFixed(1);
    document.getElementById('metric-risk').textContent = `${avgRisk}%`;

    const approvedCount = audits.filter(a => a.approved).length;
    const approvalRate = Math.round((approvedCount / audits.length) * 100);
    
    document.getElementById('metric-approval-bar').style.width = `${approvalRate}%`;
    document.getElementById('metric-approval-text').textContent = `${approvalRate}% Approved`;
}

function renderDashboardTable(filterText = "") {
    const audits = getAudits();
    const tbody = document.getElementById('audit-table-body');
    tbody.innerHTML = '';

    if (audits.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:var(--text-muted);">No records found. Run an assessment.</td></tr>';
        return;
    }

    const filtered = audits.filter(a => a.id.toLowerCase().includes(filterText.toLowerCase()));
    
    filtered.forEach(a => {
        const riskLevel = a.prob > 40 ? 'High' : 'Low';
        const riskPill = a.prob > 40 ? 'pill-high' : 'pill-low';
        const decisionText = a.approved ? 'Approved' : 'Rejected';
        const decisionPill = a.approved ? 'pill-approved' : 'pill-rejected';

        tbody.innerHTML += `
            <tr>
                <td style="font-family:monospace; color:var(--electric-blue);">${a.id}</td>
                <td style="font-size:0.85rem; color:var(--text-muted);">${a.date}</td>
                <td><span class="status-pill ${riskPill}">${riskLevel} (${a.prob}%)</span></td>
                <td style="font-weight:600;" class="${decisionPill}">${decisionText}</td>
            </tr>
        `;
    });
}

document.getElementById('search-audit').addEventListener('input', (e) => {
    renderDashboardTable(e.target.value);
});

// ==== INTELLIGENCE VISUALISATIONS ====
function renderIntelligenceTimeline(currentUtilStr) {
    const container = document.getElementById('intell-timeline');
    container.innerHTML = '';
    const util = Math.round(parseFloat(currentUtilStr));
    
    let history = [util];
    let temp = util;
    for(let i=0; i<5; i++){
        temp += Math.floor(Math.random()*20) - 10;
        temp = Math.max(0, Math.min(100, temp));
        history.push(temp);
    }
    history.reverse();

    const labels = ['M-5','M-4','M-3','M-2','M-1','Now'];

    history.forEach((val, i) => {
        const height = Math.max(val, 5);
        const color = val > 60 ? 'var(--crimson-red)' : (val > 30 ? 'var(--amber-warning)' : 'var(--electric-blue)');
        const glow = val > 60 ? 'var(--crimson-red-glow)' : (val > 30 ? 'rgba(255,234,0,0.3)' : 'var(--electric-blue-glow)');

        container.innerHTML += `
            <div class="timeline-bar-wrapper">
                <span class="timeline-label">${val}%</span>
                <div class="timeline-bar" style="height: 0%; background:${color}; box-shadow:0 0 10px ${glow}" data-height="${height}%"></div>
                <span class="timeline-label" style="color:#fff;">${labels[i]}</span>
            </div>
        `;
    });

    setTimeout(() => {
        container.querySelectorAll('.timeline-bar').forEach(bar => {
            bar.style.height = bar.getAttribute('data-height');
        });
    }, 100);
}

function renderPeerBenchmark(payload, userProb) {
    const chart = document.getElementById('benchmark-chart');
    
    // Simulate peer group
    let peerRisk = 30.0;
    if(payload.age < 30) peerRisk += 10;
    if(payload.MonthlyIncome > 8000) peerRisk -= 10;
    peerRisk = Math.max(5, Math.min(95, peerRisk + (Math.random()*8-4))).toFixed(1);

    const max = Math.max(userProb, peerRisk, 50);
    const uWidth = (userProb / max)*100;
    const pWidth = (peerRisk / max)*100;
    
    const uColor = userProb > peerRisk ? 'negative' : 'positive';

    chart.innerHTML = `
        <div class="driver-bar-container">
            <div>Peer Avg</div>
            <div class="driver-bar-wrapper">
                <div class="driver-bar peer" style="width:0%;" data-w="${pWidth}%"></div>
            </div>
            <div>${peerRisk}%</div>
        </div>
        <div class="driver-bar-container" style="color:#fff; font-weight:600; margin-top:1rem;">
            <div>This Audit</div>
            <div class="driver-bar-wrapper">
                <div class="driver-bar ${uColor}" style="width:0%;" data-w="${uWidth}%"></div>
            </div>
            <div>${userProb}%</div>
        </div>
    `;

    setTimeout(() => {
        chart.querySelectorAll('.driver-bar').forEach(bar => {
            bar.style.width = bar.getAttribute('data-w');
        });
    }, 50);
}

function renderSensitivityMatrix(payload, baseProb) {
    // We mock the heatmap grid based on base probability
    // X axis: Debt Ratio (-10%, 0, +10%), Y axis: Income (+10%, 0, -10%)
    const matrix = document.getElementById('sensitivity-matrix');
    matrix.innerHTML = '';
    
    // Values relative to center (0=center, negative=better/lower risk, positive=worse/higher risk)
    const deltas = [
        [-2.5,  -1.0,   1.5],  // Income +10%
        [-1.5,   0.0,   2.5],  // Income  0%
        [ 1.0,   3.0,   5.5]   // Income -10%
    ];

    deltas.forEach((rowDeltas, rIndex) => {
        rowDeltas.forEach((d, cIndex) => {
            const cellProb = Math.max(0, Math.min(100, baseProb + d)).toFixed(1);
            let heatClass = 'heat-med';
            if (cellProb < 20) heatClass = 'heat-low';
            if (cellProb > 50) heatClass = 'heat-high';
            
            const isCenter = (rIndex===1 && cIndex===1) ? 'heat-center' : '';

            matrix.innerHTML += `
                <div class="heatmap-cell ${heatClass} ${isCenter}">
                    <span>${cellProb}%</span>
                </div>
            `;
        });
    });
}

// ==== SIMULATIONS & DRIVERS ====
async function renderDecisionDrivers(basePayload, baseProb) {
    const chart = document.getElementById('drivers-chart');
    chart.innerHTML = '<p class="mock-text"><i class="fa-solid fa-spinner fa-spin"></i> Mining drivers...</p>';
    
    const features = [
        { k: 'RevolvingUtilizationOfUnsecuredLines', n: 'Utilization', b: 0.1, cur: basePayload.RevolvingUtilizationOfUnsecuredLines },
        { k: 'DebtRatio', n: 'Debt Ratio', b: 0.2, cur: basePayload.DebtRatio },
        { k: 'NumberOfTime30-59DaysPastDueNotWorse', n: 'Late (30d)', b: 0, cur: basePayload['NumberOfTime30-59DaysPastDueNotWorse'] }
    ];

    const impacts = [];
    for(let f of features) {
        if (f.cur === f.b) continue;
        const p = {...basePayload};
        p[f.k] = f.b;
        try {
            const res = await fetch('http://127.0.0.1:8000/predict', { method: 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(p) });
            if (res.ok) {
                const data = await res.json();
                const delta = baseProb - parseFloat((data.default_probability*100).toFixed(1));
                if (Math.abs(delta) > 0.5) impacts.push({ name: f.n, delta });
            }
        } catch(e){}
    }

    chart.innerHTML = '';
    if (impacts.length === 0) {
        chart.innerHTML = '<p class="mock-text">No major isolated drivers.</p>';
        return;
    }

    const max = Math.max(...impacts.map(i => Math.abs(i.delta)), 5);
    impacts.forEach(i => {
        const width = (Math.abs(i.delta)/max)*100;
        const cls = i.delta > 0 ? 'negative' : 'positive';
        const sign = i.delta > 0 ? '+' : '';
        chart.innerHTML += `
            <div class="driver-bar-container">
                <div>${i.name}</div>
                <div class="driver-bar-wrapper">
                    <div class="driver-bar ${cls}" style="width:0%" data-w="${width}%"></div>
                </div>
                <div>${sign}${i.delta.toFixed(1)}%</div>
            </div>
        `;
    });

    setTimeout(() => {
        chart.querySelectorAll('.driver-bar').forEach(b => b.style.width = b.getAttribute('data-w'));
    }, 50);
}

async function renderApprovalPath(basePayload, baseProb) {
    const list = document.getElementById('simulation-list');
    list.innerHTML = '<p class="mock-text"><i class="fa-solid fa-spinner fa-spin"></i> Finding paths...</p>';
    
    const p1 = {...basePayload}; p1.DebtRatio = Math.max(0, basePayload.DebtRatio * 0.5);
    const p2 = {...basePayload}; p2.RevolvingUtilizationOfUnsecuredLines = 0.05;
    const p3 = {...basePayload}; p3.MonthlyIncome = basePayload.MonthlyIncome * 1.5;

    const scenarios = [
        { n: `Reduce Debt Ratio ${basePayload.DebtRatio} → ${p1.DebtRatio.toFixed(2)}`, p: p1 },
        { n: `Lower Utilization ${(basePayload.RevolvingUtilizationOfUnsecuredLines*100).toFixed(0)}% → 5%`, p: p2 },
        { n: `Increase Income $${basePayload.MonthlyIncome.toLocaleString()} → $${p3.MonthlyIncome.toLocaleString()}`, p: p3 }
    ];

    const paths = [];
    for(let test of scenarios) {
        try {
            const res = await fetch('http://127.0.0.1:8000/predict', { method: 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(test.p) });
            if (res.ok) {
                const data = await res.json();
                const prob = (data.default_probability*100).toFixed(1);
                if (prob < baseProb) paths.push({ name: test.n, prob, app: data.approved });
            }
        } catch(e){}
    }

    list.innerHTML = '';
    if(paths.length === 0) {
        list.innerHTML = '<p class="mock-text">No immediate path found.</p>';
        return;
    }
    
    paths.sort((a,b) => parseFloat(a.prob) - parseFloat(b.prob));

    paths.forEach(p => {
        const badge = p.app ? '<span class="status-pill pill-approved" style="font-size:0.7em; margin-left:0.5rem; border:1px solid">APPROVED</span>' : '';
        list.innerHTML += `
            <li>
                <span><i class="fa-solid fa-bolt" style="color:var(--amber-warning);"></i> ${p.name} ${badge}</span>
                <span style="font-weight:600;"><i class="fa-solid fa-arrow-right"></i> ${p.prob}%</span>
            </li>
        `;
    });
}
