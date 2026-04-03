// ============================================================
// Universal Orlando - Wait Time Tracker & Smart Ride Planner
// Uses the free Queue-Times.com API for real-time wait data
// ============================================================

const PARKS = {
    islands: { id: 64, name: "Islands of Adventure" },
    studios: { id: 65, name: "Universal Studios Florida" },
    epicuniverse: { id: 223, name: "Epic Universe" }
};

const API_BASE = "https://queue-times.com/parks";

// State
let currentPark = "islands";
let attractions = [];
let doneSet = new Set(JSON.parse(localStorage.getItem("done_rides") || "[]"));
let currentFilter = "all";
let currentSort = "wait";
let refreshInterval = null;
let countdown = 60;

// ============================================================
// API - Fetch wait times from Queue-Times
// ============================================================

async function fetchWaitTimes(parkKey) {
    const park = PARKS[parkKey];
    const url = `${API_BASE}/${park.id}/queue_times.json`;

    try {
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();

        // The API returns { lands: [ { name, rides: [ { name, wait_time, is_open, last_updated } ] } ] }
        const rides = [];
        if (data.lands) {
            for (const land of data.lands) {
                for (const ride of land.rides) {
                    rides.push({
                        id: ride.id,
                        name: ride.name,
                        area: land.name,
                        waitTime: ride.is_open ? ride.wait_time : -1,
                        isOpen: ride.is_open,
                        lastUpdated: ride.last_updated
                    });
                }
            }
        }
        return rides;
    } catch (err) {
        console.error("Error fetching wait times:", err);
        showToast("Error al obtener datos. Reintentando...");
        return null;
    }
}

// ============================================================
// Rendering
// ============================================================

function getWaitClass(wait) {
    if (wait <= 20) return "wait-low";
    if (wait <= 45) return "wait-med";
    return "wait-high";
}

function renderAttractions() {
    const list = document.getElementById("attractions-list");

    let filtered = [...attractions];

    // Filter
    if (currentFilter === "pending") {
        filtered = filtered.filter(a => !doneSet.has(a.id));
    } else if (currentFilter === "done") {
        filtered = filtered.filter(a => doneSet.has(a.id));
    }

    // Sort
    filtered.sort((a, b) => {
        if (currentSort === "wait") {
            const aW = doneSet.has(a.id) ? 9999 : (a.isOpen ? a.waitTime : 9998);
            const bW = doneSet.has(b.id) ? 9999 : (b.isOpen ? b.waitTime : 9998);
            return aW - bW;
        }
        if (currentSort === "name") return a.name.localeCompare(b.name);
        if (currentSort === "area") return a.area.localeCompare(b.area) || a.name.localeCompare(b.name);
        return 0;
    });

    const bestRide = getBestRecommendation();

    list.innerHTML = filtered.map(a => {
        const isDone = doneSet.has(a.id);
        const isRec = bestRide && bestRide.id === a.id && !isDone;
        return `
        <div class="attraction-card ${isDone ? 'done' : ''} ${isRec ? 'recommended' : ''}"
             data-id="${a.id}" onclick="toggleDone(${a.id})">
            <div class="attraction-check">${isDone ? '&#10003;' : ''}</div>
            <div class="attraction-info">
                <div class="attraction-name">${a.name}</div>
                <div class="attraction-area">${a.area}</div>
            </div>
            <div class="wait-badge">
                ${a.isOpen
                    ? `<div class="wait-time ${getWaitClass(a.waitTime)}">${a.waitTime}</div>
                       <div class="wait-label">min</div>`
                    : `<div class="wait-closed">CERRADA</div>`
                }
            </div>
        </div>`;
    }).join("");

    updateStats();
    updateRecommendation();
}

function updateStats() {
    const total = attractions.length;
    const done = attractions.filter(a => doneSet.has(a.id)).length;
    const remaining = total - done;
    const openPending = attractions.filter(a => !doneSet.has(a.id) && a.isOpen && a.waitTime >= 0);
    const avgWait = openPending.length > 0
        ? Math.round(openPending.reduce((s, a) => s + a.waitTime, 0) / openPending.length)
        : 0;

    document.getElementById("stat-done").textContent = done;
    document.getElementById("stat-remaining").textContent = remaining;
    document.getElementById("stat-avg-wait").textContent = avgWait + " min";
    document.getElementById("progress-fill").style.width =
        total > 0 ? `${Math.round((done / total) * 100)}%` : "0%";
}

function getBestRecommendation() {
    const candidates = attractions
        .filter(a => !doneSet.has(a.id) && a.isOpen && a.waitTime >= 0)
        .sort((a, b) => a.waitTime - b.waitTime);
    return candidates.length > 0 ? candidates[0] : null;
}

function updateRecommendation() {
    const best = getBestRecommendation();
    const nameEl = document.getElementById("rec-name");
    const waitEl = document.getElementById("rec-wait");
    const areaEl = document.getElementById("rec-area");
    const goBtn = document.getElementById("rec-go-btn");

    if (!best) {
        nameEl.textContent = attractions.length > 0
            ? "Todas completadas!"
            : "Cargando...";
        waitEl.textContent = "--";
        areaEl.textContent = "";
        goBtn.style.display = "none";
        return;
    }

    nameEl.textContent = best.name;
    waitEl.textContent = best.waitTime + " min";
    areaEl.textContent = best.area;
    goBtn.style.display = "block";
    goBtn.onclick = (e) => {
        e.stopPropagation();
        toggleDone(best.id);
        showToast(`Marcada: ${best.name}`);
    };
}

function showLoading() {
    const list = document.getElementById("attractions-list");
    list.innerHTML = Array(6).fill('<div class="skeleton"></div>').join("");
}

// ============================================================
// Interactions
// ============================================================

function toggleDone(id) {
    if (doneSet.has(id)) {
        doneSet.delete(id);
    } else {
        doneSet.add(id);
        const ride = attractions.find(a => a.id === id);
        if (ride) showToast(`${ride.name} completada!`);
    }
    localStorage.setItem("done_rides", JSON.stringify([...doneSet]));
    renderAttractions();

    // Check if a better ride is now available
    checkForBetterRide();
}

let lastRecommendedId = null;

function checkForBetterRide() {
    const best = getBestRecommendation();
    if (best && best.id !== lastRecommendedId) {
        lastRecommendedId = best.id;
        if (Notification.permission === "granted") {
            new Notification("Universal Orlando Guide", {
                body: `Ve a ${best.name} - Solo ${best.waitTime} min de espera!`,
                icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🎢</text></svg>"
            });
        }
    }
}

function showToast(msg) {
    const toast = document.getElementById("toast");
    document.getElementById("toast-msg").textContent = msg;
    toast.classList.add("show");
    setTimeout(() => toast.classList.remove("show"), 2500);
}

// ============================================================
// Data Refresh Loop
// ============================================================

async function refreshData() {
    const btn = document.getElementById("refresh-btn");
    btn.disabled = true;
    btn.textContent = "Cargando...";

    const data = await fetchWaitTimes(currentPark);
    if (data) {
        const previousBest = getBestRecommendation();
        attractions = data;
        renderAttractions();

        // Notify if recommendation changed
        const newBest = getBestRecommendation();
        if (newBest && previousBest && newBest.id !== previousBest.id) {
            showToast(`Nueva recomendacion: ${newBest.name} (${newBest.waitTime} min)`);
        }
    }

    btn.disabled = false;
    btn.textContent = "Actualizar Ahora";
    countdown = 60;
}

function startCountdown() {
    if (refreshInterval) clearInterval(refreshInterval);
    countdown = 60;
    refreshInterval = setInterval(() => {
        countdown--;
        document.getElementById("refresh-countdown").textContent = countdown;
        if (countdown <= 0) {
            refreshData();
            countdown = 60;
        }
    }, 1000);
}

// ============================================================
// Event Listeners
// ============================================================

// Park selector
document.querySelectorAll(".park-btn").forEach(btn => {
    btn.addEventListener("click", () => {
        document.querySelectorAll(".park-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        currentPark = btn.dataset.park;
        // Reset done set per park
        doneSet = new Set(JSON.parse(localStorage.getItem(`done_rides_${currentPark}`) || "[]"));
        showLoading();
        refreshData();
    });
});

// Filter tabs
document.querySelectorAll(".filter-btn").forEach(btn => {
    btn.addEventListener("click", () => {
        document.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        currentFilter = btn.dataset.filter;
        renderAttractions();
    });
});

// Sort buttons
document.querySelectorAll(".sort-btn").forEach(btn => {
    btn.addEventListener("click", () => {
        document.querySelectorAll(".sort-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        currentSort = btn.dataset.sort;
        renderAttractions();
    });
});

// Refresh button
document.getElementById("refresh-btn").addEventListener("click", () => {
    refreshData();
});

// Save done per park
const origToggle = toggleDone;
window.toggleDone = function(id) {
    if (doneSet.has(id)) {
        doneSet.delete(id);
    } else {
        doneSet.add(id);
        const ride = attractions.find(a => a.id === id);
        if (ride) showToast(`${ride.name} completada!`);
    }
    localStorage.setItem(`done_rides_${currentPark}`, JSON.stringify([...doneSet]));
    renderAttractions();
    checkForBetterRide();
};

// ============================================================
// Notifications Permission
// ============================================================

function requestNotificationPermission() {
    if ("Notification" in window && Notification.permission === "default") {
        Notification.requestPermission();
    }
}

// ============================================================
// Init
// ============================================================

async function init() {
    // Register Service Worker for PWA / offline support
    if ("serviceWorker" in navigator) {
        navigator.serviceWorker.register("/sw.js").catch(() => {});
    }

    requestNotificationPermission();
    doneSet = new Set(JSON.parse(localStorage.getItem(`done_rides_${currentPark}`) || "[]"));
    showLoading();
    await refreshData();
    startCountdown();
}

init();
