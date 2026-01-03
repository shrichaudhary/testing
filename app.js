/* ================= DEBUGGER (CRITICAL) ================= */
function logProgress(msg) {
    console.log("[System]:", msg);
    const loader = document.getElementById('app-loader');
    if(loader) {
        let p = loader.querySelector('p');
        if(!p) { p = document.createElement('p'); loader.querySelector('div').appendChild(p); }
        p.innerText = msg;
    }
}

// Catches script errors
window.onerror = function(msg, url, line) {
    const errorBox = document.getElementById('app-loader');
    if(errorBox) {
        errorBox.innerHTML = `
            <div style="padding:20px; background:white; color:red; text-align:center; border-radius:8px;">
                <h3>⚠️ Critical Error</h3>
                <p>${msg}</p>
                <p style="font-size:12px">Line: ${line}</p>
                <button class="btn btn-primary" onclick="location.reload()">Reload Page</button>
            </div>
        `;
    }
    console.error("Critical Error:", msg, "at line:", line);
};

// SAFETY TIMEOUT: If app hangs for 8 seconds, force show UI
setTimeout(() => {
    const loader = document.getElementById('app-loader');
    if (loader && loader.style.display !== 'none') {
        loader.innerHTML = `
            <div style="padding:20px; background:white; color:#333; text-align:center; border-radius:8px;">
                <h3>⏳ Connection Timeout</h3>
                <p>Server is taking too long to respond.</p>
                <div style="display:flex; flex-direction:column; gap:10px;">
                    <button class="btn btn-primary" onclick="location.reload()">Retry Connection</button>
                    <button class="btn btn-outline" style="color:#333; border:1px solid #ccc;" onclick="document.getElementById('app-loader').style.display='none'">Continue Anyway</button>
                </div>
            </div>
        `;
    }
}, 8000);

logProgress("Loading Firebase SDKs...");

/* ================= IMPORTS (STABLE 10.12.2) ================= */
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-analytics.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, collection, addDoc, doc, deleteDoc, onSnapshot, setDoc, updateDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/* ================= CONFIGURATION ================= */
const GEMINI_API_KEY = "AIzaSyDzRs8QaqasDy-C32jiClSvtXWP9BHP1iA"; 
const firebaseConfig = {
    apiKey: "AIzaSyAatemUbTeI7UedzvDmpK69tk3iwYi1I3M",
    authDomain: "test-site-ba3e3.firebaseapp.com",
    projectId: "test-site-ba3e3",
    storageBucket: "test-site-ba3e3.firebasestorage.app",
    messagingSenderId: "1059082248354",
    appId: "1:1059082248354:web:c0d216abae6fe04b9df7fb",
    measurementId: "G-RZ8Y3RP96R"
};

/* ================= FIREBASE INIT ================= */
logProgress("Initializing App...");
let app;
try {
    if (!getApps().length) {
        app = initializeApp(firebaseConfig);
        try { getAnalytics(app); } catch (e) { console.log("Analytics skipped"); }
    } else {
        app = getApps()[0];
    }
} catch (e) {
    throw new Error("Firebase Init Failed: " + e.message);
}

const auth = getAuth(app);
const db = getFirestore(app);
const appId = "test-site"; 
const getColl = (name) => collection(db, 'artifacts', appId, 'public', 'data', name);

/* ================= STATE MANAGEMENT ================= */
let appData = { quizzes: [], users: [], pendingReviews: [], publishedResults: [], admins: [], sessions: [] };
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
        'section-result', 'section-admin-students', 'section-student-profile', 'section-manage-admins'
    ];
    sections.forEach(id => {
        const el = document.getElementById(id);
        if(el) el.classList.add('hidden');
    });
};

/* ================= 1. STARTUP & SYNC ================= */
logProgress("Setting up Auth Listener...");

onAuthStateChanged(auth, (user) => {
    const loader = document.getElementById('app-loader');
    if(loader) loader.style.display = 'none';

    if (user) {
        console.log("User detected:", user.uid);
        startLiveSync();
    } else {
        console.log("No user, redirected to Home");
        window.goToHome();
    }
});

async function initApp() {
    try {
        logProgress("Authenticating...");
        await signInAnonymously(auth);
        if(typeof window.initSpyMode === 'function') window.initSpyMode(); 
    } catch (error) {
        console.error("Auth failed", error);
        const loader = document.getElementById('app-loader');
        if(loader) {
            loader.innerHTML = `
                <div style='text-align:center; padding:20px; background:white; border-radius:8px;'>
                    <h3 style='color:red'>Auth Error</h3>
                    <p>${error.message}</p>
                    <button class="btn btn-primary" onclick="location.reload()">Retry</button>
                </div>`;
        }
    }
}

function startLiveSync() {
    console.log("Starting Live Sync...");
    
    const safeSnapshot = (colName, targetProp, callback) => {
        onSnapshot(getColl(colName), (snap) => {
            appData[targetProp] = snap.docs.map(d => ({ firestoreId: d.id, ...d.data() }));
            if(callback) callback();
        }, (err) => {
            console.warn(`Sync warning for ${colName}:`, err.message);
        });
    };

    safeSnapshot('quizzes', 'quizzes', () => {
        renderQuizList();
        if(!document.getElementById('section-admin-dashboard').classList.contains('hidden')) renderAdminDashboard();
    });

    safeSnapshot('users', 'users', () => {
        if(!document.getElementById('section-admin-students').classList.contains('hidden')) window.filterStudents();
    });

    safeSnapshot('pending_reviews', 'pendingReviews', () => {
        if(!document.getElementById('section-admin-dashboard').classList.contains('hidden')) renderAdminDashboard();
        if(currentUser) renderUserDashboard(); 
    });

    safeSnapshot('results', 'publishedResults', () => {
        if(currentUser) renderUserDashboard();
    });

    safeSnapshot('admins', 'admins');
    
    safeSnapshot('quiz_sessions', 'sessions', () => checkResumeStatus());

    const savedUser = localStorage.getItem('cHub_currentUser');
    if(savedUser) {
        try {
            currentUser = JSON.parse(savedUser);
            window.checkUserLoginStatus();
        } catch(e) { console.error("User parse error"); }
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
    const chk = document.getElementById('show-archived-chk');
    const showArchived = chk ? chk.checked : false;

    const qList = document.getElementById('admin-quiz-list');
    qList.innerHTML = '';
    
    appData.quizzes.forEach(q => {
        const isArchived = q.status === 'archived';
        if (showArchived && !isArchived) return; 
        if (!showArchived && isArchived) return; 

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
    currentUser = { username: "Admin_Preview" }; 
    window.initiateQuiz(fid);
};

function renderQuizList() {
    const con = document.getElementById('quiz-list-container');
    if(!con) return;
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
    quizStartTime = Date.now(); 
    
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
