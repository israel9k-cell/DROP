// ============================================================
// Epic Universe - Fullscreen Map with GPS Navigation
// Uses Leaflet.js + Google Maps satellite tiles
// ============================================================

// Epic Universe REAL coordinates (1001 Epic Blvd, Orlando FL 32819)
const PARK_CENTER = [28.4396, -81.4465];
const PARK_ZOOM = 17;

// World area centers based on real layout:
// Entrance faces SOUTH. Clockwise from entrance:
// SW = Super Nintendo, NW = Dark Universe, NE = Potter, SE = Dragon
// Center = Celestial Park
const WORLD_COORDS = {
    "Celestial Park":           [28.4396, -81.4465],
    "Super Nintendo World":     [28.4386, -81.4482],
    "Dark Universe":            [28.4410, -81.4482],
    "The Wizarding World":      [28.4410, -81.4448],
    "How to Train Your Dragon": [28.4386, -81.4448],
    "Isle of Berk":             [28.4386, -81.4448],
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
let headingMarker = null;
let accuracyCircle = null;
let routeLine = null;
let attractionMarkers = [];
let userPosition = null;
let watchId = null;
let mapVisible = false;
let targetAttraction = null;
let gpsAsked = false;
let gpsRetryCount = 0;

// Kalman filter state for GPS smoothing
let kalman = null;

// Position history for heading calculation
let posHistory = [];

// ============================================================
// Kalman Filter - smooths GPS noise for precise positioning
// ============================================================

class KalmanFilter {
    constructor() {
        this.lat = null;
        this.lng = null;
        this.variance = -1; // uninitialized
        // Process noise: how much we expect position to change per second
        // (walking speed ~1.4 m/s => ~0.0000126 degrees/s)
        this.qMetersPerSecond = 1.5;
        this.timestamp = null;
    }

    // accuracy in meters
    update(lat, lng, accuracy, timestamp) {
        if (this.variance < 0) {
            // First reading - initialize
            this.lat = lat;
            this.lng = lng;
            this.variance = accuracy * accuracy;
            this.timestamp = timestamp;
            return { lat, lng };
        }

        // Time delta in seconds
        const dt = (timestamp - this.timestamp) / 1000;
        if (dt <= 0) return { lat: this.lat, lng: this.lng };
        this.timestamp = timestamp;

        // Predict step: increase variance based on time elapsed
        this.variance += dt * this.qMetersPerSecond * this.qMetersPerSecond;

        // Update step: Kalman gain
        const measurementVariance = accuracy * accuracy;
        const K = this.variance / (this.variance + measurementVariance);

        // Apply gain
        this.lat += K * (lat - this.lat);
        this.lng += K * (lng - this.lng);
        this.variance *= (1 - K);

        return { lat: this.lat, lng: this.lng };
    }

    getAccuracy() {
        return this.variance > 0 ? Math.sqrt(this.variance) : 999;
    }
}

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
    stopCompass();

    const btn = document.getElementById("map-toggle-btn");
    btn.classList.remove("active");
    btn.innerHTML = '&#128506; Mapa';
}

// ============================================================
// GPS - High precision with Kalman filtering + heading
// ============================================================

function requestDeviceLocation() {
    if (!navigator.geolocation) {
        updateGpsStatus("error", "Tu dispositivo no soporta GPS");
        return;
    }

    // Reset filter for fresh session
    kalman = new KalmanFilter();
    posHistory = [];
    gpsRetryCount = 0;

    updateGpsStatus("searching", "\uD83D\uDCE1 Buscando senal GPS...");

    // Phase 1: Quick coarse fix (cached OK, fast response)
    navigator.geolocation.getCurrentPosition(
        onGpsRawReading,
        onGpsFirstError,
        { enableHighAccuracy: false, maximumAge: 30000, timeout: 8000 }
    );

    // Phase 2: High accuracy continuous watch (fresh readings only)
    startPreciseWatch();

    // Listen to device compass if available (iOS)
    startCompass();
}

function startPreciseWatch() {
    stopGeolocation();

    watchId = navigator.geolocation.watchPosition(
        onGpsRawReading,
        onGpsWatchError,
        {
            enableHighAccuracy: true,
            maximumAge: 0,        // Force fresh readings, no cache
            timeout: 15000,
        }
    );
}

function onGpsRawReading(pos) {
    gpsRetryCount = 0;
    const rawLat = pos.coords.latitude;
    const rawLng = pos.coords.longitude;
    const rawAcc = pos.coords.accuracy;
    const ts = pos.timestamp || Date.now();
    const speed = pos.coords.speed;       // m/s or null
    const heading = pos.coords.heading;   // degrees or null

    // Discard very inaccurate readings (> 100m)
    if (rawAcc > 100) {
        updateGpsStatus("searching", `\uD83D\uDCE1 Mejorando precision (${Math.round(rawAcc)}m)...`);
        return;
    }

    // Apply Kalman filter
    const filtered = kalman.update(rawLat, rawLng, rawAcc, ts);
    const filteredAcc = Math.round(kalman.getAccuracy());

    userPosition = [filtered.lat, filtered.lng];

    // Track position history for movement-based heading
    posHistory.push({ lat: filtered.lat, lng: filtered.lng, ts });
    if (posHistory.length > 10) posHistory.shift();

    // Calculate heading from movement if GPS heading not available
    let userHeading = null;
    if (heading !== null && !isNaN(heading) && speed > 0.3) {
        userHeading = heading;
    } else if (posHistory.length >= 3) {
        userHeading = calcMovementHeading();
    }

    // Status
    let statusText, statusState;
    if (filteredAcc <= 8) {
        statusText = `\uD83C\uDFAF GPS preciso (${filteredAcc}m)`;
        statusState = "active";
    } else if (filteredAcc <= 20) {
        statusText = `\uD83D\uDCCD GPS bueno (${filteredAcc}m)`;
        statusState = "active";
    } else if (filteredAcc <= 50) {
        statusText = `\uD83D\uDCCD GPS activo (${filteredAcc}m)`;
        statusState = "active";
    } else {
        statusText = `\uD83D\uDCE1 GPS aprox. (${filteredAcc}m)`;
        statusState = "searching";
    }
    updateGpsStatus(statusState, statusText);

    // Update visuals
    updateUserMarker(filteredAcc, userHeading);
    updateRoute();
    updateWalkingTime();

    // First fix: center map on user
    if (userMarker && !userMarker._hasCentered) {
        userMarker._hasCentered = true;
        const distToPark = getDistance(userPosition, PARK_CENTER);
        if (distToPark < 2000) {
            map.fitBounds(L.latLngBounds([userPosition, PARK_CENTER]), { padding: [60, 60] });
        }
    }
}

function calcMovementHeading() {
    // Use last few positions to determine direction of travel
    if (posHistory.length < 3) return null;
    const recent = posHistory.slice(-3);
    const first = recent[0];
    const last = recent[recent.length - 1];

    const dist = getDistance([first.lat, first.lng], [last.lat, last.lng]);
    if (dist < 2) return null; // Not enough movement

    const dLat = last.lat - first.lat;
    const dLng = last.lng - first.lng;
    let angle = Math.atan2(dLng, dLat) * 180 / Math.PI;
    if (angle < 0) angle += 360;
    return angle;
}

// ============================================================
// Device compass (iOS DeviceOrientation)
// ============================================================

let deviceHeading = null;

function startCompass() {
    // iOS 13+ requires permission for DeviceOrientation
    if (typeof DeviceOrientationEvent !== "undefined" &&
        typeof DeviceOrientationEvent.requestPermission === "function") {
        DeviceOrientationEvent.requestPermission()
            .then(state => {
                if (state === "granted") {
                    window.addEventListener("deviceorientationabsolute", onCompass, true);
                    window.addEventListener("deviceorientation", onCompass, true);
                }
            })
            .catch(() => {});
    } else {
        window.addEventListener("deviceorientationabsolute", onCompass, true);
        window.addEventListener("deviceorientation", onCompass, true);
    }
}

function stopCompass() {
    window.removeEventListener("deviceorientationabsolute", onCompass, true);
    window.removeEventListener("deviceorientation", onCompass, true);
}

function onCompass(e) {
    // webkitCompassHeading for iOS, alpha for Android
    if (e.webkitCompassHeading !== undefined) {
        deviceHeading = e.webkitCompassHeading;
    } else if (e.alpha !== null) {
        deviceHeading = 360 - e.alpha;
    }
}

// ============================================================
// Error handling with retry
// ============================================================

function onGpsFirstError(err) {
    console.warn("GPS getCurrentPosition error:", err.code, err.message);
    if (err.code === 1) {
        updateGpsStatus("error", "GPS denegado - Activa ubicacion en Ajustes > Safari");
        stopGeolocation();
    } else {
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

    if (err.code === 3 && gpsRetryCount < 5) {
        gpsRetryCount++;
        updateGpsStatus("searching", `\uD83D\uDCE1 Reintentando GPS (${gpsRetryCount}/5)...`);
        stopGeolocation();
        setTimeout(() => startPreciseWatch(), 1500);
        return;
    }

    if (err.code === 2) {
        updateGpsStatus("error", "No hay senal GPS - Sal al exterior");
    } else {
        updateGpsStatus("error", "GPS timeout - Toca la diana para reintentar");
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
// Map initialization with illustrated park overlay
// ============================================================

// Illustrated park map image URL (official Universal map hosted publicly)
const PARK_MAP_URL = "https://www.universalorlando.com/webdata/k2/en/us/files/Documents/Images/epic-universe-park-map.jpg";
// Fallback map URLs
const PARK_MAP_FALLBACKS = [
    "https://s3.amazonaws.com/cms.universalorlando.com/images/epic-universe-park-map.jpg",
    "https://cache.undercovertourist.com/media_file/universal-epic-universe-1073767-198eeb234b6.jpg",
];

// Approximate geographic bounds where the park map image should be placed
// These bounds cover the entire Epic Universe footprint
const MAP_BOUNDS = [
    [28.4365, -81.4500], // Southwest corner
    [28.4430, -81.4430], // Northeast corner
];

function initMap() {
    if (map) return;

    map = L.map("map-container", {
        center: PARK_CENTER,
        zoom: PARK_ZOOM,
        zoomControl: false,
        attributionControl: false,
        maxZoom: 21,
        minZoom: 14,
    });

    // Google Maps satellite base
    L.tileLayer("https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}", {
        maxZoom: 21,
    }).addTo(map);

    // Google Maps labels (roads, place names)
    L.tileLayer("https://mt1.google.com/vt/lyrs=h&x={x}&y={y}&z={z}", {
        maxZoom: 21,
        opacity: 0.6,
    }).addTo(map);

    L.control.zoom({ position: "bottomright" }).addTo(map);
    L.control.attribution({ position: "bottomleft", prefix: false })
        .addAttribution('&copy; Google Maps')
        .addTo(map);

    // Draw detailed park zones with colored polygons
    drawParkZones();

    // World labels
    for (const [name, coords] of Object.entries(WORLD_COORDS)) {
        if (name === "Isle of Berk") continue;
        const color = WORLD_MAP_COLORS[name] || "#c8a84e";

        const emoji = WORLD_EMOJIS[name] || "";
        const short = name.replace("Super Nintendo World", "Nintendo")
            .replace("How to Train Your Dragon", "Dragons")
            .replace("The Wizarding World", "Potter");
        L.marker(coords, {
            icon: L.divIcon({
                className: "world-label",
                html: `<div style="color:${color};font-size:12px;font-weight:700;text-align:center;white-space:nowrap;text-shadow:0 0 6px rgba(0,0,0,1),0 0 12px rgba(0,0,0,0.8),0 1px 3px rgba(0,0,0,1);letter-spacing:0.5px">${emoji} ${short}</div>`,
                iconSize: [120, 24], iconAnchor: [60, -15],
            }),
            interactive: false,
        }).addTo(map);
    }
}

// Draw colored park zones as polygons over the satellite imagery
function drawParkZones() {
    const zones = [
        {
            name: "Celestial Park",
            color: "#c8a84e",
            // Center hub - circular area
            coords: [
                [28.4403, -81.4473], [28.4406, -81.4469],
                [28.4405, -81.4462], [28.4402, -81.4458],
                [28.4397, -81.4456], [28.4392, -81.4457],
                [28.4389, -81.4461], [28.4388, -81.4467],
                [28.4390, -81.4473], [28.4394, -81.4476],
                [28.4399, -81.4476],
            ]
        },
        {
            name: "Super Nintendo World",
            color: "#e60012",
            // Southwest area
            coords: [
                [28.4389, -81.4476], [28.4394, -81.4476],
                [28.4396, -81.4479], [28.4394, -81.4490],
                [28.4390, -81.4495], [28.4382, -81.4495],
                [28.4378, -81.4490], [28.4378, -81.4480],
                [28.4382, -81.4476],
            ]
        },
        {
            name: "Dark Universe",
            color: "#6a6a8e",
            // Northwest area
            coords: [
                [28.4403, -81.4476], [28.4406, -81.4473],
                [28.4410, -81.4477], [28.4415, -81.4483],
                [28.4418, -81.4490], [28.4415, -81.4495],
                [28.4408, -81.4495], [28.4404, -81.4490],
                [28.4401, -81.4482],
            ]
        },
        {
            name: "Wizarding World",
            color: "#5c2d91",
            // Northeast area
            coords: [
                [28.4405, -81.4462], [28.4406, -81.4458],
                [28.4410, -81.4453], [28.4415, -81.4448],
                [28.4418, -81.4443], [28.4418, -81.4437],
                [28.4412, -81.4435], [28.4406, -81.4440],
                [28.4402, -81.4448], [28.4402, -81.4456],
            ]
        },
        {
            name: "Isle of Berk",
            color: "#e65100",
            // Southeast area
            coords: [
                [28.4392, -81.4457], [28.4396, -81.4456],
                [28.4398, -81.4450], [28.4396, -81.4443],
                [28.4392, -81.4438], [28.4385, -81.4436],
                [28.4380, -81.4440], [28.4379, -81.4448],
                [28.4382, -81.4455], [28.4387, -81.4458],
            ]
        },
    ];

    zones.forEach(zone => {
        L.polygon(zone.coords, {
            color: zone.color,
            fillColor: zone.color,
            fillOpacity: 0.20,
            weight: 2,
            opacity: 0.7,
        }).addTo(map);
    });

    // Draw pathways connecting zones (Celestial Park spokes)
    const pathStyle = { color: "#c8a84e", weight: 2, opacity: 0.4, dashArray: "6,8" };
    const center = WORLD_COORDS["Celestial Park"];
    ["Super Nintendo World", "Dark Universe", "The Wizarding World", "How to Train Your Dragon"].forEach(name => {
        L.polyline([center, WORLD_COORDS[name]], pathStyle).addTo(map);
    });

    // Park entrance marker
    const entranceCoords = [28.4375, -81.4465];
    L.marker(entranceCoords, {
        icon: L.divIcon({
            className: "world-label",
            html: '<div style="color:#f5d76e;font-size:13px;font-weight:900;text-align:center;text-shadow:0 0 8px rgba(0,0,0,1),0 0 16px rgba(0,0,0,0.9);letter-spacing:1px">ENTRADA</div>',
            iconSize: [100, 24], iconAnchor: [50, 12],
        }),
        interactive: false,
    }).addTo(map);
}

// ============================================================
// User marker with accuracy circle + heading arrow
// ============================================================

function updateUserMarker(accuracy, heading) {
    if (!map || !userPosition) return;

    // Use GPS heading > movement heading > compass heading
    const finalHeading = heading !== null ? heading : deviceHeading;

    if (!userMarker) {
        const icon = L.divIcon({
            className: "user-marker",
            html: buildUserMarkerHtml(finalHeading),
            iconSize: [48, 48],
            iconAnchor: [24, 24],
        });
        userMarker = L.marker(userPosition, { icon, zIndexOffset: 1000 }).addTo(map);
        userMarker._hasCentered = false;
    } else {
        userMarker.setLatLng(userPosition);
        // Update heading arrow
        const el = userMarker.getElement();
        if (el) el.innerHTML = buildUserMarkerHtml(finalHeading);
    }

    // Accuracy circle (only show if > 10m, otherwise clutters)
    if (accuracy && accuracy > 10 && accuracy < 150) {
        if (!accuracyCircle) {
            accuracyCircle = L.circle(userPosition, {
                radius: accuracy,
                color: "#4285f4", fillColor: "#4285f4",
                fillOpacity: 0.08, weight: 1, opacity: 0.25,
            }).addTo(map);
        } else {
            accuracyCircle.setLatLng(userPosition);
            accuracyCircle.setRadius(accuracy);
        }
    } else if (accuracyCircle && accuracy <= 10) {
        // Very precise - hide accuracy circle
        map.removeLayer(accuracyCircle);
        accuracyCircle = null;
    }
}

function buildUserMarkerHtml(heading) {
    const arrowHtml = heading !== null
        ? `<div class="user-heading" style="transform:rotate(${heading}deg)">
               <div class="user-heading-cone"></div>
           </div>`
        : '';
    return `
        <div class="user-dot-wrap">
            ${arrowHtml}
            <div class="user-dot-outer"></div>
            <div class="user-dot-inner"></div>
            <div class="user-pulse"></div>
        </div>`;
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
