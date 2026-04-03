// ============================================================
// Universal Orlando - Wait Time Tracker & Smart Ride Planner
// Uses the free Queue-Times.com API for real-time wait data
// ============================================================

const PARKS = {
    islands: { id: 64, name: "Islands of Adventure" },
    studios: { id: 65, name: "Universal Studios Florida" },
    epicuniverse: { id: 334, name: "Epic Universe" }
};

const API_BASE = "https://queue-times.com/parks";

// Detect if running from Node server (has /api/waits) or static hosting
const LOCAL_API = `${window.location.origin}/api/waits`;

// State
let currentPark = "islands";
let attractions = [];
let doneSet = new Set(JSON.parse(localStorage.getItem("done_rides") || "[]"));
let currentFilter = "all";
let currentSort = "wait";
let refreshInterval = null;
let countdown = 60;
let useLocalProxy = true; // will flip to false if local proxy not available

// ============================================================
// API - Fetch wait times (local proxy -> CORS fallbacks)
// ============================================================

async function tryFetch(url) {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return resp;
}

async function fetchQueueTimesData(parkId) {
    const directUrl = `${API_BASE}/${parkId}/queue_times.json`;
    const errors = [];

    // Strategy 1: Local server proxy (same-origin, no CORS issues)
    if (useLocalProxy) {
        try {
            const resp = await tryFetch(`${LOCAL_API}?park=${parkId}`);
            return await resp.json();
        } catch (e) {
            errors.push(`local: ${e.message}`);
            useLocalProxy = false; // don't try again
            console.warn("Local proxy not available, falling back to CORS proxies");
        }
    }

    // Strategy 2: corsproxy.io
    try {
        const resp = await tryFetch(`https://corsproxy.io/?${encodeURIComponent(directUrl)}`);
        return await resp.json();
    } catch (e) { errors.push(`corsproxy.io: ${e.message}`); }

    // Strategy 3: allorigins (wrapped JSON)
    try {
        const resp = await tryFetch(`https://api.allorigins.win/get?url=${encodeURIComponent(directUrl)}`);
        const wrapper = await resp.json();
        if (wrapper.contents) return JSON.parse(wrapper.contents);
        throw new Error("No contents");
    } catch (e) { errors.push(`allorigins: ${e.message}`); }

    // Strategy 4: cors.lol
    try {
        const resp = await tryFetch(`https://api.cors.lol/?url=${encodeURIComponent(directUrl)}`);
        return await resp.json();
    } catch (e) { errors.push(`cors.lol: ${e.message}`); }

    // Strategy 5: thingproxy
    try {
        const resp = await tryFetch(`https://thingproxy.freeboard.io/fetch/${directUrl}`);
        return await resp.json();
    } catch (e) { errors.push(`thingproxy: ${e.message}`); }

    // Strategy 6: direct
    try {
        const resp = await tryFetch(directUrl);
        return await resp.json();
    } catch (e) { errors.push(`direct: ${e.message}`); }

    console.error("All strategies failed:", errors);
    throw new Error("All fetch strategies failed");
}

function parseQueueTimesResponse(data) {
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
}

async function fetchWaitTimes(parkKey) {
    const park = PARKS[parkKey];
    try {
        const data = await fetchQueueTimesData(park.id);
        return parseQueueTimesResponse(data);
    } catch (err) {
        console.error("Error fetching wait times:", err);
        showToast("Error al obtener datos. Reintentando...");
        return null;
    }
}

// ============================================================
// Rendering
// ============================================================

// World icon/color mapping for Epic Universe lands
const WORLD_THEMES = {
    "Celestial Park":                { icon: "&#10024;",  color: "#c8a84e" },
    "Super Nintendo World":          { icon: "&#127918;", color: "#e60012" },
    "Dark Universe":                 { icon: "&#128123;", color: "#7b7b9e" },
    "The Wizarding World of Harry Potter": { icon: "&#9889;", color: "#5c2d91" },
    "The Wizarding World":           { icon: "&#9889;",   color: "#5c2d91" },
    "How to Train Your Dragon":      { icon: "&#128009;", color: "#e65100" },
    "Isle of Berk":                  { icon: "&#128009;", color: "#e65100" },
};

function getWorldTheme(area) {
    for (const [key, theme] of Object.entries(WORLD_THEMES)) {
        if (area.includes(key) || key.includes(area)) return theme;
    }
    return { icon: "&#127760;", color: "#c8a84e" };
}

let currentWorld = "all";

function getWaitClass(wait) {
    if (wait <= 20) return "wait-low";
    if (wait <= 45) return "wait-med";
    return "wait-high";
}

function renderAttractions() {
    const list = document.getElementById("attractions-list");

    let filtered = [...attractions];

    // World filter
    if (currentWorld !== "all") {
        filtered = filtered.filter(a => a.area.includes(currentWorld));
    }

    // Status filter
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
        const theme = getWorldTheme(a.area);
        return `
        <div class="attraction-card ${isDone ? 'done' : ''} ${isRec ? 'recommended' : ''}"
             data-id="${a.id}" onclick="toggleDone(${a.id})">
            <div class="world-accent" style="background:${theme.color}"></div>
            <div class="attraction-check">${isDone ? '&#10003;' : ''}</div>
            <div class="attraction-info">
                <div class="attraction-name">${a.name}</div>
                <div class="attraction-area"><span class="area-icon">${theme.icon}</span> ${a.area}</div>
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
            new Notification("Epic Universe GO", {
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
    btn.innerHTML = "&#8635; Actualizar";
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
        currentWorld = "all";
        // Show/hide worlds bar (only for Epic Universe)
        document.getElementById("worlds-bar").style.display =
            currentPark === "epicuniverse" ? "flex" : "none";
        document.querySelectorAll(".world-chip").forEach(c => c.classList.remove("active"));
        document.querySelector('.world-chip[data-world="all"]').classList.add("active");
        // Reset done set per park
        doneSet = new Set(JSON.parse(localStorage.getItem(`done_rides_${currentPark}`) || "[]"));
        showLoading();
        refreshData();
    });
});

// Worlds filter (Epic Universe lands)
document.querySelectorAll(".world-chip").forEach(chip => {
    chip.addEventListener("click", () => {
        document.querySelectorAll(".world-chip").forEach(c => c.classList.remove("active"));
        chip.classList.add("active");
        currentWorld = chip.dataset.world;
        renderAttractions();
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
