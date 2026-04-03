// ============================================================
// Epic Universe - Fullscreen Map with GPS Navigation
// Uses Leaflet.js (free) + CARTO dark tiles
// ============================================================

// Epic Universe coordinates (4700 W Sand Lake Rd, Orlando)
const PARK_CENTER = [28.4735, -81.4685];
const PARK_ZOOM = 16.5;

// World area centers (hub-and-spoke: Celestial=center, NW/NE/SE/SW)
const WORLD_COORDS = {
    "Celestial Park":           [28.4735, -81.4685],
    "Super Nintendo World":     [28.4748, -81.4705],
    "Dark Universe":            [28.4748, -81.4665],
    "The Wizarding World":      [28.4720, -81.4665],
    "How to Train Your Dragon": [28.4720, -81.4705],
    "Isle of Berk":             [28.4720, -81.4705],
};

const WORLD_MAP_COLORS = {
    "Celestial Park":           "#c8a84e",
    "Super Nintendo World":     "#e60012",
    "Dark Universe":            "#7b7b9e",
    "The Wizarding World":      "#5c2d91",
    "How to Train Your Dragon": "#e65100",
    "Isle of Berk":             "#e65100",
};

const WORLD_EMOJIS = {
    "Celestial Park":           "\u2728",
    "Super Nintendo World":     "\uD83C\uDFAE",
    "Dark Universe":            "\uD83D\uDC7B",
    "The Wizarding World":      "\u26A1",
    "How to Train Your Dragon": "\uD83D\uDC09",
    "Isle of Berk":             "\uD83D\uDC09",
};

// State
let map = null;
let userMarker = null;
let accuracyCircle = null;
let routeLine = null;
let attractionMarkers = [];
let userPosition = null;
let watchId = null;
let mapVisible = false;
let targetAttraction = null;
let gpsAsked = false;
let gpsRetryCount = 0;

// ============================================================
// Toggle map - always show GPS modal first time
// ============================================================

function toggleMap() {
    if (mapVisible) {
        closeFullscreenMap();
        return;
    }

    mapVisible = true;
    const btn = document.getElementById("map-toggle-btn");
    btn.classList.add("active");
    btn.innerHTML = '&#128506; Cerrar Mapa';

    if (!gpsAsked) {
        // First time: show permission modal
        document.getElementById("gps-modal").style.display = "flex";
    } else {
        openFullscreenMap(false);
    }
}

function acceptGpsPermission() {
    document.getElementById("gps-modal").style.display = "none";
    gpsAsked = true;
    openFullscreenMap(true);
}

function skipGpsPermission() {
    document.getElementById("gps-modal").style.display = "none";
    gpsAsked = true;
    openFullscreenMap(false);
}

window.toggleMap = toggleMap;
window.acceptGpsPermission = acceptGpsPermission;
window.skipGpsPermission = skipGpsPermission;

// ============================================================
// Open / close fullscreen map
// ============================================================

function openFullscreenMap(requestGps) {
    const mapSection = document.getElementById("map-section");
    mapSection.style.display = "block";
    document.body.style.overflow = "hidden";

    setTimeout(() => {
        initMap();
        map.invalidateSize();
        updateMapMarkers();

        if (requestGps) {
            requestDeviceLocation();
        } else if (!userPosition) {
            updateGpsStatus("", "\uD83D\uDCCD GPS desactivado");
        }

        // Auto-navigate to best ride
        const best = getBestRecommendationForMap();
        if (best) navigateToRide(best.id);
    }, 150);
}

function closeFullscreenMap() {
    document.getElementById("map-section").style.display = "none";
    document.body.style.overflow = "";
    mapVisible = false;
    stopGeolocation();

    const btn = document.getElementById("map-toggle-btn");
    btn.classList.remove("active");
    btn.innerHTML = '&#128506; Mapa';
}

// ============================================================
// GPS - Request device location (works on iOS Safari + Android)
// ============================================================

function requestDeviceLocation() {
    if (!navigator.geolocation) {
        updateGpsStatus("error", "Tu dispositivo no soporta GPS");
        return;
    }

    updateGpsStatus("searching", "\uD83D\uDCE1 Buscando senal GPS...");
    gpsRetryCount = 0;

    // First: get a quick position (even if rough)
    navigator.geolocation.getCurrentPosition(
        onGpsSuccess,
        onGpsFirstError,
        { enableHighAccuracy: false, maximumAge: 60000, timeout: 8000 }
    );

    // Then: start watching with high accuracy
    startHighAccuracyWatch();
}

function startHighAccuracyWatch() {
    stopGeolocation(); // clear any previous watch

    watchId = navigator.geolocation.watchPosition(
        onGpsSuccess,
        onGpsWatchError,
        { enableHighAccuracy: true, maximumAge: 2000, timeout: 30000 }
    );
}

function onGpsSuccess(pos) {
    gpsRetryCount = 0;
    userPosition = [pos.coords.latitude, pos.coords.longitude];
    const acc = Math.round(pos.coords.accuracy);

    let statusText;
    if (acc <= 10) {
        statusText = `\uD83D\uDCCD GPS preciso (${acc}m)`;
    } else if (acc <= 30) {
        statusText = `\uD83D\uDCCD GPS activo (${acc}m)`;
    } else {
        statusText = `\uD83D\uDCCD GPS aprox. (${acc}m)`;
    }
    updateGpsStatus("active", statusText);

    updateUserMarker(pos.coords.accuracy);
    updateRoute();
    updateWalkingTime();

    // First fix: center map on user if near the park
    if (!userMarker._hasCentered) {
        userMarker._hasCentered = true;
        const distToPark = getDistance(userPosition, PARK_CENTER);
        if (distToPark < 2000) {
            // Within 2km of park, show user + park
            map.fitBounds(L.latLngBounds([userPosition, PARK_CENTER]), { padding: [60, 60] });
        }
    }
}

function onGpsFirstError(err) {
    console.warn("GPS getCurrentPosition error:", err.code, err.message);

    if (err.code === 1) {
        // PERMISSION_DENIED
        updateGpsStatus("error", "GPS denegado - Activa ubicacion en Ajustes > Safari");
        stopGeolocation();
    } else {
        // POSITION_UNAVAILABLE or TIMEOUT - watchPosition may still work
        updateGpsStatus("searching", "\uD83D\uDCE1 Buscando senal GPS...");
    }
}

function onGpsWatchError(err) {
    console.warn("GPS watch error:", err.code, err.message);

    if (err.code === 1) {
        updateGpsStatus("error", "GPS denegado - Activa ubicacion en Ajustes");
        stopGeolocation();
        return;
    }

    if (err.code === 3 && gpsRetryCount < 3) {
        // Timeout - retry
        gpsRetryCount++;
        updateGpsStatus("searching", `\uD83D\uDCE1 Reintentando GPS (${gpsRetryCount}/3)...`);
        stopGeolocation();
        setTimeout(() => startHighAccuracyWatch(), 2000);
        return;
    }

    if (err.code === 2) {
        updateGpsStatus("error", "No hay senal GPS - Sal al exterior");
    } else {
        updateGpsStatus("error", "GPS no disponible - Intenta de nuevo");
    }
}

function stopGeolocation() {
    if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
    }
}

function updateGpsStatus(state, text) {
    const el = document.getElementById("map-gps-status");
    if (!el) return;
    el.textContent = text;
    el.className = "map-gps-status" + (state ? ` ${state}` : "");
}

// ============================================================
// Map initialization
// ============================================================

function initMap() {
    if (map) return;

    map = L.map("map-container", {
        center: PARK_CENTER,
        zoom: PARK_ZOOM,
        zoomControl: false,
        attributionControl: false,
    });

    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
        maxZoom: 20,
        subdomains: "abcd",
    }).addTo(map);

    L.control.zoom({ position: "bottomright" }).addTo(map);
    L.control.attribution({ position: "bottomleft", prefix: false })
        .addAttribution('&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>')
        .addTo(map);

    // World zone circles + labels
    for (const [name, coords] of Object.entries(WORLD_COORDS)) {
        if (name === "Isle of Berk") continue;
        const color = WORLD_MAP_COLORS[name] || "#c8a84e";

        L.circle(coords, {
            radius: 80, color, fillColor: color,
            fillOpacity: 0.06, weight: 1, opacity: 0.3, dashArray: "4,6",
        }).addTo(map);

        const emoji = WORLD_EMOJIS[name] || "";
        const short = name.replace("Super Nintendo World", "Nintendo")
            .replace("How to Train Your Dragon", "Dragons")
            .replace("The Wizarding World", "Potter");
        L.marker(coords, {
            icon: L.divIcon({
                className: "world-label",
                html: `<div style="color:${color};font-size:10px;font-weight:700;text-align:center;white-space:nowrap;text-shadow:0 1px 4px rgba(0,0,0,0.8)">${emoji} ${short}</div>`,
                iconSize: [100, 20], iconAnchor: [50, -30],
            }),
            interactive: false,
        }).addTo(map);
    }
}

// ============================================================
// User marker with accuracy circle
// ============================================================

function updateUserMarker(accuracy) {
    if (!map || !userPosition) return;

    if (!userMarker) {
        const icon = L.divIcon({
            className: "user-marker",
            html: '<div class="user-dot"><div class="user-dot-inner"></div><div class="user-pulse"></div></div>',
            iconSize: [24, 24],
            iconAnchor: [12, 12],
        });
        userMarker = L.marker(userPosition, { icon, zIndexOffset: 1000 }).addTo(map);
        userMarker._hasCentered = false;
    } else {
        userMarker.setLatLng(userPosition);
    }

    // Accuracy circle
    if (accuracy && accuracy < 200) {
        if (!accuracyCircle) {
            accuracyCircle = L.circle(userPosition, {
                radius: accuracy,
                color: "#4285f4",
                fillColor: "#4285f4",
                fillOpacity: 0.1,
                weight: 1,
                opacity: 0.3,
            }).addTo(map);
        } else {
            accuracyCircle.setLatLng(userPosition);
            accuracyCircle.setRadius(accuracy);
        }
    }
}

// ============================================================
// Attraction markers
// ============================================================

function getWorldKey(area) {
    for (const key of Object.keys(WORLD_COORDS)) {
        if (area.includes(key) || key.includes(area)) return key;
    }
    return "Celestial Park";
}

function getAttractionCoords(attraction) {
    const worldKey = getWorldKey(attraction.area);
    const base = WORLD_COORDS[worldKey] || PARK_CENTER;
    const seed = attraction.id * 137;
    const offsetLat = ((seed % 100) - 50) * 0.00003;
    const offsetLng = (((seed * 7) % 100) - 50) * 0.00003;
    return [base[0] + offsetLat, base[1] + offsetLng];
}

function updateMapMarkers() {
    attractionMarkers.forEach(m => map.removeLayer(m));
    attractionMarkers = [];
    if (!map) return;

    attractions.forEach(a => {
        const isDone = doneSet.has(a.id);
        const coords = getAttractionCoords(a);
        const worldKey = getWorldKey(a.area);
        const color = WORLD_MAP_COLORS[worldKey] || "#c8a84e";
        const emoji = WORLD_EMOJIS[worldKey] || "\uD83C\uDF10";
        const isTarget = targetAttraction && targetAttraction.id === a.id;

        const html = isDone
            ? `<div class="map-marker done-marker" style="border-color:${color}">&#10003;</div>`
            : `<div class="map-marker ${isTarget ? 'target-marker' : ''}" style="background:${color};border-color:${color}">
                   <span class="marker-wait">${a.isOpen ? a.waitTime : '---'}</span>
               </div>`;

        const icon = L.divIcon({
            className: "ride-marker-wrap", html,
            iconSize: [36, 36], iconAnchor: [18, 18],
        });

        const marker = L.marker(coords, { icon }).addTo(map);
        marker.bindPopup(`
            <div class="map-popup">
                <strong>${emoji} ${a.name}</strong><br>
                <span style="color:${color}">${a.area}</span><br>
                ${a.isOpen
                    ? `<span class="popup-wait">${a.waitTime} min de espera</span>`
                    : '<span style="color:#999">CERRADA</span>'}
                <br>
                <button onclick="navigateToRide(${a.id})" class="popup-nav-btn">Navegar aqui &#10148;</button>
            </div>
        `, { className: "dark-popup" });

        attractionMarkers.push(marker);
    });
}

// ============================================================
// Navigation / routing
// ============================================================

function navigateToRide(rideId) {
    const ride = attractions.find(a => a.id === rideId);
    if (!ride) return;

    targetAttraction = ride;
    updateRoute();

    const coords = getAttractionCoords(ride);
    if (userPosition) {
        map.fitBounds(L.latLngBounds([userPosition, coords]), { padding: [80, 120] });
    } else {
        map.setView(coords, 18);
    }

    updateMapMarkers();
    updateNavPanel(ride);
    map.closePopup();
    showToast(`Navegando a ${ride.name}`);
}

window.navigateToRide = navigateToRide;

function updateRoute() {
    if (!map) return;
    if (routeLine) { map.removeLayer(routeLine); routeLine = null; }
    if (!userPosition || !targetAttraction) return;

    const targetCoords = getAttractionCoords(targetAttraction);
    routeLine = L.polyline([userPosition, targetCoords], {
        color: "#c8a84e", weight: 4, dashArray: "10, 14", opacity: 0.85,
    }).addTo(map);
}

function updateWalkingTime() {
    if (!userPosition || !targetAttraction) return;
    const coords = getAttractionCoords(targetAttraction);
    const dist = getDistance(userPosition, coords);
    const walkMin = Math.max(1, Math.round(dist / 70));
    const el = document.getElementById("nav-walk-time");
    if (el) el.textContent = `${walkMin} min caminando (${Math.round(dist)}m)`;
}

function getDistance([lat1, lon1], [lat2, lon2]) {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLon/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function getWaitClass(w) {
    if (w <= 20) return "wait-low";
    if (w <= 45) return "wait-med";
    return "wait-high";
}

function updateNavPanel(ride) {
    const panel = document.getElementById("nav-panel");
    if (!ride) { panel.style.display = "none"; return; }

    const worldKey = getWorldKey(ride.area);
    const color = WORLD_MAP_COLORS[worldKey] || "#c8a84e";
    const emoji = WORLD_EMOJIS[worldKey] || "\uD83C\uDF10";

    document.getElementById("nav-ride-name").textContent = `${emoji} ${ride.name}`;
    document.getElementById("nav-ride-area").textContent = ride.area;
    document.getElementById("nav-ride-area").style.color = color;
    document.getElementById("nav-ride-wait").textContent = ride.isOpen ? `${ride.waitTime} min` : "CERRADA";
    document.getElementById("nav-ride-wait").className = ride.isOpen ? `nav-wait ${getWaitClass(ride.waitTime)}` : "nav-wait";

    if (userPosition) {
        const dist = getDistance(userPosition, getAttractionCoords(ride));
        const walkMin = Math.max(1, Math.round(dist / 70));
        document.getElementById("nav-walk-time").textContent = `${walkMin} min caminando (${Math.round(dist)}m)`;
    } else {
        document.getElementById("nav-walk-time").textContent = "Esperando GPS...";
    }
    panel.style.display = "flex";
}

// ============================================================
// Center on user / retry GPS
// ============================================================

function centerOnUser() {
    if (userPosition && map) {
        map.setView(userPosition, 18, { animate: true });
    } else if (navigator.geolocation) {
        // Retry GPS
        requestDeviceLocation();
    } else {
        showToast("GPS no disponible");
    }
}

window.centerOnUser = centerOnUser;

// ============================================================
// Sync with app.js
// ============================================================

function getBestRecommendationForMap() {
    if (typeof getBestRecommendation === "function") return getBestRecommendation();
    const candidates = attractions
        .filter(a => !doneSet.has(a.id) && a.isOpen && a.waitTime >= 0)
        .sort((a, b) => a.waitTime - b.waitTime);
    return candidates.length > 0 ? candidates[0] : null;
}

window.onMapNeedsUpdate = function () {
    if (!mapVisible || !map) return;
    updateMapMarkers();

    if (targetAttraction) {
        const updated = attractions.find(a => a.id === targetAttraction.id);
        if (updated) { targetAttraction = updated; updateNavPanel(updated); }
    }

    const best = getBestRecommendationForMap();
    if (best && (!targetAttraction || best.waitTime < targetAttraction.waitTime - 10)) {
        navigateToRide(best.id);
    }
};
