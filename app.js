import { initializeApp } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-analytics.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, collection, addDoc, doc, deleteDoc, onSnapshot, setDoc, updateDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

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
let app;
if (!getApps().length) {
    app = initializeApp(firebaseConfig);
    try { getAnalytics(app); } catch (e) { }
} else {
    app = getApps()[0];
}

const auth = getAuth(app);
const db = getFirestore(app);
const appId = "test-site"; 
const getColl = (name) => collection(db, 'artifacts', appId, 'public', 'data', name);

/* ================= STATE MANAGEMENT ================= */
let appData = { quizzes: [], users: [], pendingReviews: [], publishedResults: [], admins: [] };
let currentUser = null; 
let currentQuiz = null;
let currentQIndex = 0;
let userResponses = {}; 
let timerInterval = null;
let currentGradingId = null;
let newQuestionsBuffer = [];
let quizStartTime = 0; // NEW: Track time
const ADMIN_USER = "admin";
const ADMIN_PASS = "admin123";

/* ================= HELPERS: UI & NAVIGATION ================= */
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

/* ================= 1. AUTHENTICATION & STARTUP ================= */
async function initApp() {
    try {
        await signInAnonymously(auth);
        if(window.initSpyMode) window.initSpyMode(); 
    } catch (error) {
        console.error("Auth failed", error);
        document.getElementById('app-loader').innerHTML = `
            <div style='text-align:center; padding:20px; background:white; border-radius:8px;'>
                <h3 style='color:red'>Connection Failed</h3>
                <p>${error.message}</p>
                <button class='btn btn-primary' onclick='location.reload()'>Retry</button>
            </div>`;
    }
}

onAuthStateChanged(auth, (user) => {
    if (user) {
        document.getElementById('app-loader').style.display = 'none';
        startLiveSync();
    }
});

function startLiveSync() {
    onSnapshot(getColl('quizzes'), (snap) => {
        appData.quizzes = snap.docs.map(d => ({ firestoreId: d.id, ...d.data() }));
        renderQuizList();
        if(!document.getElementById('section-admin-dashboard').classList.contains('hidden')) renderAdminDashboard();
    });

    onSnapshot(getColl('users'), (snap) => {
        appData.users = snap.docs.map(d => ({ firestoreId: d.id, ...d.data() }));
        if(!document.getElementById('section-admin-students').classList.contains('hidden')) window.filterStudents();
    });

    onSnapshot(getColl('pending_reviews'), (snap) => {
        appData.pendingReviews = snap.docs.map(d => ({ firestoreId: d.id, ...d.data() }));
        if(!document.getElementById('section-admin-dashboard').classList.contains('hidden')) renderAdminDashboard();
        if(currentUser) renderUserDashboard(); 
    });

    onSnapshot(getColl('results'), (snap) => {
        appData.publishedResults = snap.docs.map(d => ({ firestoreId: d.id, ...d.data() }));
        if(currentUser) renderUserDashboard();
    });

    onSnapshot(getColl('admins'), (snap) => {
        appData.admins = snap.docs.map(d => ({ firestoreId: d.id, ...d.data() }));
    });

    const savedUser = localStorage.getItem('cHub_currentUser');
    if(savedUser) {
        currentUser = JSON.parse(savedUser);
        window.checkUserLoginStatus();
    }
}

/* ================= 2. USER AUTH FUNCTIONS ================= */
window.switchAuthTab = (tab) => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.getElementById('tab-' + tab).classList.add('active');
    if(tab === 'login') {
        document.getElementById('auth-form-login').classList.remove('hidden');
        document.getElementById('auth-form-register').classList.add('hidden');
    } else {
        document.getElementById('auth-form-login').classList.add('hidden');
        document.getElementById('auth-form-register').classList.remove('hidden');
    }
};

window.showUserAuth = () => { hideAll(); document.getElementById('section-user-auth').classList.remove('hidden'); window.switchAuthTab('login'); };

window.registerUser = async () => {
    const e = document.getElementById('regEmail').value.trim();
    const u = document.getElementById('regUser').value.trim();
    const p = document.getElementById('regPass').value.trim();
    if(!e || !u || !p) return alert("Fill all fields");
    if(appData.users.find(user => user.username === u)) return alert("Username taken!");
    
    // Note: Storing password in plain text as requested for admin visibility
    await addDoc(getColl('users'), { email: e, username: u, password: p, isBlocked: false });
    alert("Registered! Please Login.");
    window.switchAuthTab('login');
};

window.loginUser = () => {
    const u = document.getElementById('loginEmail').value.trim(); 
    const p = document.getElementById('loginPass').value.trim();
    
    if (!u || !p) return alert("Please enter Email/Username and Password");

    // 1. Backdoor for Testing
    if (u === "student" && p === "student123") {
        currentUser = { username: "student", password: "student123" };
        localStorage.setItem('cHub_currentUser', JSON.stringify(currentUser));
        window.checkUserLoginStatus();
        return;
    }

    // 2. Real Database Check
    const user = appData.users.find(usr => (usr.username === u || usr.email === u) && usr.password === p);
    
    if(user) {
        if(user.isBlocked) {
            alert("🚫 Access Denied: Your account has been suspended by the Admin.");
            return;
        }
        currentUser = user;
        localStorage.setItem('cHub_currentUser', JSON.stringify(currentUser));
        window.checkUserLoginStatus();
    } else {
        alert("Invalid Credentials!");
    }
};

window.logoutUser = () => {
    currentUser = null;
    localStorage.removeItem('cHub_currentUser');
    window.checkUserLoginStatus();
};

window.checkUserLoginStatus = () => {
    const navAuth = document.getElementById('nav-auth-buttons');
    const navProfile = document.getElementById('nav-user-profile');
    const heroBtn = document.getElementById('hero-action-btn');

    if(currentUser) {
        navAuth.classList.add('hidden');
        navProfile.classList.remove('hidden');
        document.getElementById('nav-username').innerText = currentUser.username;
        heroBtn.innerText = "Go to Dashboard";
        heroBtn.onclick = () => renderUserDashboard();
        renderUserDashboard();
    } else {
        navAuth.classList.remove('hidden');
        navProfile.classList.add('hidden');
        heroBtn.innerText = "Login / Register";
        heroBtn.onclick = () => window.showUserAuth();
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
    userPending.forEach(p => {
        pList.innerHTML += `<div style="padding:10px; border-bottom:1px solid #eee;"><strong>${p.quizTitle}</strong> <span class="status-pending">Wait...</span></div>`;
    });

    const hList = document.getElementById('dash-history-list');
    hList.innerHTML = userHistory.length ? '' : '<p style="color:#777">No attempts yet.</p>';
    userHistory.forEach((h) => {
        hList.innerHTML += `
            <div style="padding:10px; border-bottom:1px solid #eee; display:flex; justify-content:space-between; align-items:center;">
                <div><strong>${h.quizTitle}</strong></div>
                <div>
                    <span class="status-completed">${h.score}/${h.max}</span>
                    <button class="btn btn-outline" style="color:#555; border:1px solid #ccc; font-size:10px;" onclick="window.viewResultByIndex('${h.firestoreId}')">View</button>
                </div>
            </div>`;
    });
}

window.viewResultByIndex = (fid) => {
    const res = appData.publishedResults.find(r => r.firestoreId === fid);
    if(!res) return;
    hideAll();
    document.getElementById('section-result').classList.remove('hidden');
    document.getElementById('res-status-title').innerText = "Result Archive";
    document.getElementById('res-pending-msg').classList.add('hidden');
    document.getElementById('res-score-box').classList.remove('hidden');
    document.getElementById('res-details-card').classList.remove('hidden');
    document.getElementById('res-score').innerText = res.score;
    document.getElementById('res-total').innerText = res.max;
    document.getElementById('detailed-report').innerHTML = res.reportHTML;
};

/* ================= 3. ADMIN FUNCTIONS ================= */
window.toggleAdminAuth = () => {
    if(document.getElementById('section-admin-dashboard').classList.contains('hidden')) {
        hideAll(); document.getElementById('section-admin-login').classList.remove('hidden');
    } else window.goToAdminDashboard();
};

window.verifyAdmin = () => {
    const u = document.getElementById('adminEmail').value;
    const p = document.getElementById('adminPass').value;

    const dbAdmin = appData.admins.find(a => a.email === u && a.password === p);

    if ((u === ADMIN_USER && p === ADMIN_PASS) || dbAdmin) {
        if(window.disableSpyMode) window.disableSpyMode();
        window.goToAdminDashboard();
    } else {
        alert("Wrong credentials!");
    }
};

window.logoutAdmin = () => { 
    if(window.initSpyMode) window.initSpyMode(); 
    window.goToHome(); 
};

window.goToAdminDashboard = () => {
    hideAll(); document.getElementById('section-admin-dashboard').classList.remove('hidden');
    renderAdminDashboard();
};

function renderAdminDashboard() {
    // 1. Quizzes
    const qList = document.getElementById('admin-quiz-list');
    qList.innerHTML = appData.quizzes.length ? '' : '<p>No active quizzes.</p>';
    appData.quizzes.forEach(q => {
        qList.innerHTML += `<div class="report-row"><span>${q.title}</span> <button class="btn btn-danger" style="padding:2px 8px; font-size:12px;" onclick="window.deleteQuiz('${q.firestoreId}')">Delete</button></div>`;
    });

    // 2. Pending Reviews
    const pList = document.getElementById('pending-eval-list');
    document.getElementById('admin-pending-count').innerText = appData.pendingReviews.length;
    pList.innerHTML = appData.pendingReviews.length ? '' : '<p style="color:#666;">No pending submissions.</p>';
    appData.pendingReviews.forEach(sub => {
        pList.innerHTML += `
            <div class="report-row" style="background:white; border:1px solid #ddd; margin-bottom:5px;">
                <div><strong>${sub.studentName}</strong> - ${sub.quizTitle}</div>
                <button class="btn btn-warning" onclick="window.openGrading('${sub.firestoreId}')">Grade</button>
            </div>`;
    });

    // 3. Management Controls (Inject if not present)
    const container = document.getElementById('section-admin-dashboard').querySelector('.auth-box');
    if(!document.getElementById('admin-nav-controls')) {
        const div = document.createElement('div');
        div.id = 'admin-nav-controls';
        div.style.marginTop = "20px";
        div.style.paddingTop = "20px";
        div.style.borderTop = "1px solid #ccc";
        div.innerHTML = `
            <h3>🛠️ Admin Tools</h3>
            <div style="display:flex; gap:10px; flex-wrap:wrap;">
                <button class="btn btn-primary" onclick="window.showStudentManager()">Manage Students</button>
                <button class="btn btn-outline" onclick="window.showAdminManager()">Manage Admins</button>
            </div>
        `;
        container.appendChild(div);
    }
}

window.deleteQuiz = async (fid) => {
    if(confirm("Delete this quiz globally?")) {
        await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'quizzes', fid));
    }
};

/* ================= 4. AI & QUIZ CREATION ================= */
window.askGemini = async () => {
    const input = document.getElementById('ai-doubt-input');
    const prompt = input.value.trim();
    if (!prompt) return alert("Please type a doubt!");
    
    if (!GEMINI_API_KEY || GEMINI_API_KEY.includes("YOUR_")) return alert("API Key Missing");

    const responseBox = document.getElementById('ai-response');
    const loading = document.getElementById('ai-loading');
    
    input.disabled = true;
    loading.classList.remove('hidden');
    responseBox.classList.add('hidden');

    try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: "Explain this commerce concept simply: " + prompt }] }]
            })
        });

        const data = await response.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "No response.";
        responseBox.innerHTML = `<strong>🤖 AI Answer:</strong><br>${text.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br>')}`;
        responseBox.classList.remove('hidden');
    } catch (error) {
        alert("AI Error: " + error.message);
    } finally {
        input.disabled = false;
        loading.classList.add('hidden');
    }
};

window.generateAIQuiz = async () => {
    const topic = document.getElementById('aiQuizTopic').value.trim();
    if (!topic) return alert("Enter a topic first!");

    const loading = document.getElementById('ai-quiz-loading');
    loading.classList.remove('hidden');

    const prompt = `Generate a quiz on '${topic}' in strictly valid JSON format. 
    Structure: { "title": "Title", "time": 10, "totalMarks": 5, "instructions": "Rules", "questions": [ { "type": "mcq", "text": "Q?", "options": ["A", "B", "C", "D"], "correct": "CorrectOpt", "marks": 1 } ] }. 
    Generate 5 MCQs. No extra text.`;

    try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        });

        const data = await response.json();
        let text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        text = text.replace(/```json/g, '').replace(/```/g, '').trim();
        
        const quizData = JSON.parse(text);
        document.getElementById('newQuizTitle').value = quizData.title;
        document.getElementById('newQuizTime').value = quizData.time;
        document.getElementById('newQuizMarks').value = quizData.totalMarks;
        document.getElementById('newQuizInstructions').value = quizData.instructions;
        newQuestionsBuffer = quizData.questions;
        window.updateBufferDisplay();
        alert(`✨ Quiz generated on ${topic}.`);
    } catch (error) {
        alert("Failed to generate quiz.");
    } finally {
        loading.classList.add('hidden');
    }
};

window.uploadQuizJSON = (input) => {
    if(!input.files.length) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const quizData = JSON.parse(e.target.result);
            if (!quizData.title || !Array.isArray(quizData.questions)) throw new Error("Invalid JSON");
            await addDoc(getColl('quizzes'), {
                title: quizData.title,
                time: quizData.duration || quizData.time || 60,
                totalMarks: quizData.totalMarks || quizData.questions.length,
                instructions: quizData.instructions || "Instructions",
                questions: quizData.questions,
                createdAt: Date.now()
            });
            alert("✅ Quiz uploaded!");
            input.value = ""; 
            window.goToAdminDashboard();
        } catch (error) {
            alert("Error: " + error.message);
        }
    };
    reader.readAsText(input.files[0]);
};

window.showQuizCreator = () => {
    document.getElementById('newQuizTitle').value = "";
    document.getElementById('newQuizTime').value = "";
    document.getElementById('newQuizMarks').value = "";
    newQuestionsBuffer = [];
    window.updateBufferDisplay();
    hideAll(); document.getElementById('section-quiz-creator').classList.remove('hidden');
};

window.renderAnswerInputs = () => {
    const type = document.getElementById('qType').value;
    const area = document.getElementById('answer-inputs-area');
    area.innerHTML = "";
    
    if (type === 'text') {
        area.innerHTML = `<textarea id="correctTextAns" class="input-field" placeholder="Model Answer"></textarea>`;
    } else if (type === 'image') {
        area.innerHTML = `<p style="color:#d35400; font-size:0.9em;">Student will upload images.</p><textarea id="correctTextAns" class="input-field" placeholder="Model Solution Description"></textarea>`;
    } else {
        ['A','B','C','D'].forEach((opt, i) => {
            area.innerHTML += `<div class="row" style="margin-bottom:5px;"><input type="text" class="input-field opt-inp" placeholder="Option ${opt}"><input type="${type==='mcq'?'radio':'checkbox'}" name="correctOpt" value="${i}"></div>`;
        });
    }
};

window.addQuestionToBuffer = () => {
    const type = document.getElementById('qType').value;
    const text = document.getElementById('qText').value;
    const marks = parseInt(document.getElementById('qMarks').value) || 1;
    if(!text) return alert("Add text");
    
    let q = { type, text, marks };
    if(type === 'text' || type === 'image') {
        q.modelAnswer = document.getElementById('correctTextAns').value || "";
    } else {
        const opts = []; const correct = []; 
        document.querySelectorAll('.opt-inp').forEach(inp => opts.push(inp.value));
        document.querySelectorAll('input[name="correctOpt"]:checked').forEach(chk => {
            const idx = parseInt(chk.value);
            if(opts[idx]) correct.push(opts[idx]);
        });
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
    
    await addDoc(getColl('quizzes'), { 
        title, 
        time: document.getElementById('newQuizTime').value, 
        totalMarks: document.getElementById('newQuizMarks').value, 
        instructions: document.getElementById('newQuizInstructions').value, 
        questions: newQuestionsBuffer,
        createdAt: Date.now()
    });
    window.goToAdminDashboard();
};

/* ================= 5. QUIZ TAKING & SUBMISSION ================= */
window.goToHome = () => { hideAll(); document.getElementById('section-home').classList.remove('hidden'); renderQuizList(); };

function renderQuizList() {
    const con = document.getElementById('quiz-list-container');
    con.innerHTML = appData.quizzes.length ? '' : '<p class="muted">No active quizzes.</p>';
    appData.quizzes.forEach(q => {
        con.innerHTML += `<div class="card"><h3>${q.title}</h3><p>⏳ ${q.time} Mins | 📝 ${q.questions.length} Qs</p><button class="btn btn-success" onclick="window.initiateQuiz('${q.firestoreId}')">Attempt</button></div>`;
    });
}

window.initiateQuiz = (fid) => {
    if(!currentUser) return alert("Please Login first!");
    currentQuiz = appData.quizzes.find(q => q.firestoreId === fid);
    document.getElementById('ins-title').innerText = currentQuiz.title;
    document.getElementById('ins-text').innerText = currentQuiz.instructions || "Standard Rules";
    document.getElementById('ins-time').innerText = currentQuiz.time;
    document.getElementById('ins-marks').innerText = currentQuiz.totalMarks;
    document.getElementById('ins-student-name').innerText = currentUser.username;
    hideAll(); document.getElementById('section-instructions').classList.remove('hidden');
};

window.startTest = () => {
    currentQIndex = 0; userResponses = {};
    quizStartTime = Date.now(); // START TIMER
    let timeRemaining = currentQuiz.time * 60;
    if(timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(() => {
        timeRemaining--;
        document.getElementById('timer-display').innerText = `${Math.floor(timeRemaining/60)}:${(timeRemaining%60).toString().padStart(2,'0')}`;
        if(timeRemaining<=0) window.submitTest();
    }, 1000);
    hideAll(); document.getElementById('section-active-quiz').classList.remove('hidden');
    loadQuestion();
};

function loadQuestion() {
    const q = currentQuiz.questions[currentQIndex];
    document.getElementById('active-q-num').innerText = currentQIndex + 1;
    document.getElementById('active-q-type').innerText = q.type.toUpperCase();
    document.getElementById('active-question-text').innerText = q.text;
    const area = document.getElementById('active-options-area');
    area.innerHTML = "";

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
    document.getElementById('btn-prev').style.visibility = currentQIndex===0?'hidden':'visible';
    document.getElementById('btn-next').style.display = currentQIndex===currentQuiz.questions.length-1?'none':'block';
    document.getElementById('btn-submit').style.display = currentQIndex===currentQuiz.questions.length-1?'block':'none';
}

window.saveTextResp = (val) => { userResponses[currentQIndex] = val; };
window.saveOpt = (type) => {
    const chk = document.querySelectorAll('input[name="qOpt"]:checked');
    if(type === 'mcq') { if(chk.length) userResponses[currentQIndex] = chk[0].value; }
    else { let arr=[]; chk.forEach(c=>arr.push(c.value)); userResponses[currentQIndex]=arr; }
};

window.handleImageUpload = async (input) => {
    if (input.files && input.files.length > 0) {
        if (!Array.isArray(userResponses[currentQIndex])) userResponses[currentQIndex] = [];
        const previewBox = input.nextElementSibling;
        if (previewBox.innerHTML.includes('<p')) previewBox.innerHTML = '';
        
        for (const file of Array.from(input.files)) {
            const compressed = await new Promise(resolve => {
                const reader = new FileReader();
                reader.onload = (e) => {
                    const img = new Image();
                    img.src = e.target.result;
                    img.onload = () => {
                        const canvas = document.createElement('canvas');
                        const ctx = canvas.getContext('2d');
                        // Simple compression
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
        }
    }
};

window.changeQuestion = (d) => { currentQIndex+=d; loadQuestion(); };

window.submitTest = async () => {
    clearInterval(timerInterval);
    const timeTakenSeconds = Math.floor((Date.now() - quizStartTime) / 1000);
    const timeString = `${Math.floor(timeTakenSeconds/60)}m ${timeTakenSeconds%60}s`;
    
    const needsGrading = currentQuiz.questions.some(q => q.type === 'text' || q.type === 'image');
    const submissionData = { 
        studentName: currentUser.username, 
        quizTitle: currentQuiz.title, 
        quizId: currentQuiz.firestoreId, 
        timestamp: Date.now(),
        timeTaken: timeString
    };

    if(needsGrading) {
        await addDoc(getColl('pending_reviews'), { ...submissionData, questions: currentQuiz.questions, responses: userResponses, totalMaxMarks: currentQuiz.totalMarks });
        hideAll(); document.getElementById('section-result').classList.remove('hidden');
        document.getElementById('res-status-title').innerText = "Submitted!";
        document.getElementById('res-pending-msg').classList.remove('hidden');
    } else {
        let score = 0; let report = "";
        currentQuiz.questions.forEach((q,i) => {
            let ans = userResponses[i]; let correct = false;
            if(q.type === 'mcq' && ans === q.correct) correct = true;
            if(q.type === 'msq' && ans && JSON.stringify(ans.sort())===JSON.stringify(q.correct.sort())) correct = true;
            if(correct) score += q.marks;
            
            // Detailed Report Construction
            report += `<div class="report-row">
                <div>Q${i+1}: ${q.text}<br>
                <span class="${correct?'correct-ans':'wrong-ans'}">Your: ${ans||'-'}</span>
                ${!correct ? `<br><span style="color:green; font-size:0.8em">Correct: ${q.correct}</span>` : ''}
                </div>
                <div>${correct?'+'+q.marks:'0'}</div>
            </div>`;
        });
        await addDoc(getColl('results'), { ...submissionData, score: score, max: currentQuiz.totalMarks, reportHTML: report });
        hideAll(); document.getElementById('section-result').classList.remove('hidden');
        document.getElementById('res-status-title').innerText = "Result";
        document.getElementById('res-score-box').classList.remove('hidden');
        document.getElementById('res-details-card').classList.remove('hidden');
        document.getElementById('res-score').innerText = score;
        document.getElementById('res-total').innerText = currentQuiz.totalMarks;
        document.getElementById('detailed-report').innerHTML = report;
    }
};

/* ================= 6. GRADING LOGIC ================= */
window.openGrading = (fid) => {
    currentGradingId = fid; 
    const sub = appData.pendingReviews.find(p => p.firestoreId === fid);
    if(!sub) return;
    hideAll(); document.getElementById('section-admin-grading').classList.remove('hidden');
    document.getElementById('grade-student-name').innerText = sub.studentName;
    document.getElementById('grade-quiz-title').innerText = sub.quizTitle;
    const area = document.getElementById('grading-area');
    area.innerHTML = "";
    
    sub.questions.forEach((q, i) => {
        let ans = sub.responses[i];
        let autoScore = 0;
        let html = `<div class="grading-card"><p><strong>Q${i+1}</strong> (${q.type})</p>`;

        if (q.type === 'mcq' || q.type === 'msq') {
             if((q.type==='mcq' && ans===q.correct) || (q.type==='msq' && ans && JSON.stringify(ans.sort())===JSON.stringify(q.correct.sort()))) autoScore = q.marks;
             html += `<p>Ans: <span style="color:blue">${ans||'-'}</span></p><input type="number" class="grading-input manual-grade" value="${autoScore}" readonly style="background:#eee;">`;
        }
        else if (q.type === 'text') {
            html += `<p>Ans: <span style="color:blue">${ans||'-'}</span></p><p class="muted">Model: ${q.modelAnswer}</p><input type="number" class="grading-input manual-grade" value="0" onchange="window.updateTotalGrade()"> / ${q.marks}`;
        }
        else if (q.type === 'image') {
            html += `<p>Images:</p><div class="img-preview-box">`;
            if (Array.isArray(ans)) ans.forEach((src, idx) => html += `<div class="img-card"><img src="${src}" class="uploaded-img"><a href="${src}" download="Ans_${i}.jpg" class="download-link">⬇️</a></div>`);
            else html += `<span style="color:red">No Image</span>`;
            html += `</div><input type="number" class="grading-input manual-grade" value="0" onchange="window.updateTotalGrade()"> / ${q.marks}`;
        }
        area.innerHTML += html + `</div>`;
    });
    window.updateTotalGrade();
};

window.updateTotalGrade = () => {
    let t = 0; document.querySelectorAll('.manual-grade').forEach(i => t += parseFloat(i.value)||0);
    document.getElementById('grading-total-score').innerText = t;
};

window.publishGradedResult = async () => {
    const sub = appData.pendingReviews.find(p => p.firestoreId === currentGradingId);
    let report = "";
    const inputs = document.querySelectorAll('.manual-grade');
    sub.questions.forEach((q,i) => {
        report += `<div class="report-row"><div>Q${i+1}: ${q.text}</div><div>${inputs[i].value}/${q.marks}</div></div>`;
    });
    await addDoc(getColl('results'), {
        studentName: sub.studentName, quizTitle: sub.quizTitle,
        score: document.getElementById('grading-total-score').innerText, 
        max: sub.totalMaxMarks, 
        reportHTML: report,
        timestamp: Date.now(),
        timeTaken: sub.timeTaken || "N/A"
    });
    await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'pending_reviews', currentGradingId));
    window.goToAdminDashboard();
};

/* ================= 7. ADMIN: STUDENT MANAGEMENT ================= */
window.showStudentManager = () => {
    hideAll();
    document.getElementById('section-admin-students').classList.remove('hidden');
    window.filterStudents();
};

window.filterStudents = () => {
    const query = document.getElementById('student-search').value.toLowerCase();
    const tbody = document.getElementById('admin-student-list');
    tbody.innerHTML = "";

    appData.users.forEach(u => {
        if(u.username.toLowerCase().includes(query) || u.email.toLowerCase().includes(query)) {
            const isBlocked = u.isBlocked === true;
            tbody.innerHTML += `
                <tr style="border-bottom:1px solid #eee;">
                    <td style="padding:10px;">${u.username}</td>
                    <td style="padding:10px;">${u.email}</td>
                    <td style="padding:10px; font-family:monospace; color:#e74c3c;">${u.password}</td>
                    <td style="padding:10px;">${isBlocked ? '<span style="color:red; font-weight:bold;">BLOCKED</span>' : '<span style="color:green">Active</span>'}</td>
                    <td style="padding:10px;">
                        <button class="btn btn-outline" style="font-size:12px; padding:2px 5px;" onclick="window.viewStudentProfile('${u.firestoreId}')">View</button>
                        <button class="btn ${isBlocked ? 'btn-success' : 'btn-danger'}" style="font-size:12px; padding:2px 5px;" onclick="window.toggleBlockUser('${u.firestoreId}', ${!isBlocked})">
                            ${isBlocked ? 'Unblock' : 'Block'}
                        </button>
                    </td>
                </tr>
            `;
        }
    });
};

window.toggleBlockUser = async (uid, blockStatus) => {
    if(confirm(blockStatus ? "Block this user?" : "Unblock this user?")) {
        await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'users', uid), { isBlocked: blockStatus }, { merge: true });
        alert(blockStatus ? "User Blocked!" : "User Activated!");
    }
};

window.viewStudentProfile = (uid) => {
    const user = appData.users.find(u => u.firestoreId === uid);
    if(!user) return;

    hideAll();
    document.getElementById('section-student-profile').classList.remove('hidden');
    document.getElementById('profile-name').innerText = user.username + "'s Profile";

    // Get Student History
    const history = appData.publishedResults.filter(r => r.studentName === user.username);
    
    // Stats
    document.getElementById('profile-tests-count').innerText = history.length;
    let avg = 0;
    if(history.length > 0) {
        let totalPct = 0;
        history.forEach(h => totalPct += (h.score / h.max) * 100);
        avg = (totalPct / history.length).toFixed(1);
    }
    document.getElementById('profile-avg-score').innerText = avg + "%";

    // List
    const list = document.getElementById('profile-history-list');
    list.innerHTML = history.length ? "" : "<p>No tests taken yet.</p>";
    
    history.forEach(h => {
        const date = h.timestamp ? new Date(h.timestamp).toLocaleDateString() : 'N/A';
        const timeTaken = h.timeTaken || "N/A";
        list.innerHTML += `
            <div class="card" style="margin-bottom:10px; display:flex; justify-content:space-between; align-items:center;">
                <div>
                    <h4 style="margin:0">${h.quizTitle}</h4>
                    <p class="muted" style="margin:0; font-size:0.8em">📅 ${date} | ⏱️ Time: ${timeTaken}</p>
                </div>
                <div style="text-align:right;">
                    <span style="font-weight:bold; font-size:1.2em; color:${(h.score/h.max)>0.4?'#2ecc71':'#e74c3c'}">${h.score}/${h.max}</span>
                    <br>
                    <button style="background:none; border:none; color:blue; cursor:pointer; font-size:0.8em;" onclick="window.viewAdminResult('${h.firestoreId}')">View Report</button>
                </div>
            </div>
        `;
    });
};

window.viewAdminResult = (fid) => {
    const res = appData.publishedResults.find(r => r.firestoreId === fid);
    hideAll();
    document.getElementById('section-result').classList.remove('hidden');
    
    document.getElementById('res-status-title').innerText = "Admin View: " + res.studentName;
    document.getElementById('res-pending-msg').classList.add('hidden');
    document.getElementById('res-score-box').classList.remove('hidden');
    document.getElementById('res-details-card').classList.remove('hidden');
    document.getElementById('res-score').innerText = res.score;
    document.getElementById('res-total').innerText = res.max;
    document.getElementById('detailed-report').innerHTML = res.reportHTML;
    
    // Add temporary back button
    const container = document.getElementById('section-result').querySelector('.auth-box');
    const existingBack = document.getElementById('temp-admin-back');
    if(existingBack) existingBack.remove();

    const backBtn = document.createElement('button');
    backBtn.id = 'temp-admin-back';
    backBtn.innerText = "Back to Profile";
    backBtn.className = "btn btn-outline";
    backBtn.style.marginTop = "20px";
    backBtn.onclick = () => { 
        document.getElementById('section-result').classList.add('hidden'); 
        document.getElementById('section-student-profile').classList.remove('hidden'); 
    };
    container.appendChild(backBtn);
};

/* ================= 8. ADMIN: MANAGE ADMINS ================= */
window.showAdminManager = () => {
    hideAll();
    document.getElementById('section-manage-admins').classList.remove('hidden');
    renderAdminList();
};

window.addNewAdmin = async () => {
    const u = document.getElementById('newAdminEmail').value.trim();
    const p = document.getElementById('newAdminPass').value.trim();
    if(!u || !p) return alert("Fill details");
    
    await addDoc(getColl('admins'), { email: u, password: p });
    document.getElementById('newAdminEmail').value = "";
    document.getElementById('newAdminPass').value = "";
    alert("Admin Added!");
};

function renderAdminList() {
    const div = document.getElementById('admin-list-display');
    div.innerHTML = "<h4>Current Admins:</h4>";
    appData.admins.forEach(a => {
        div.innerHTML += `
            <div style="display:flex; justify-content:space-between; border-bottom:1px solid #eee; padding:5px;">
                <span>${a.email}</span>
                <button style="color:red; background:none; border:none; cursor:pointer;" onclick="window.removeAdmin('${a.firestoreId}')">Remove</button>
            </div>`;
    });
}

window.removeAdmin = async (fid) => {
    if(confirm("Remove this admin?")) {
        await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'admins', fid));
    }
};

initApp();