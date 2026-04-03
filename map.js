// ============================================================
// Epic Universe - Interactive Map with GPS Navigation
// Uses Leaflet.js (free, no API key) + OpenStreetMap tiles
// ============================================================

// Epic Universe center coordinates (4700 W Sand Lake Rd, Orlando)
const PARK_CENTER = [28.4735, -81.4685];
const PARK_ZOOM = 16.5;

// Approximate coordinates for each world/land area center
// Based on hub-and-spoke layout: Celestial Park center,
// Nintendo=NW, Dark Universe=NE, Potter=SE, Dragon=SW
const WORLD_COORDS = {
    "Celestial Park":       [28.4735, -81.4685],
    "Super Nintendo World": [28.4748, -81.4705],
    "Dark Universe":        [28.4748, -81.4665],
    "The Wizarding World":  [28.4720, -81.4665],
    "How to Train Your Dragon": [28.4720, -81.4705],
    "Isle of Berk":         [28.4720, -81.4705],
};

// Map colors per world
const WORLD_MAP_COLORS = {
    "Celestial Park":       "#c8a84e",
    "Super Nintendo World": "#e60012",
    "Dark Universe":        "#7b7b9e",
    "The Wizarding World":  "#5c2d91",
    "How to Train Your Dragon": "#e65100",
    "Isle of Berk":         "#e65100",
};

const WORLD_EMOJIS = {
    "Celestial Park":       "\u2728",
    "Super Nintendo World": "\uD83C\uDFAE",
    "Dark Universe":        "\uD83D\uDC7B",
    "The Wizarding World":  "\u26A1",
    "How to Train Your Dragon": "\uD83D\uDC09",
    "Isle of Berk":         "\uD83D\uDC09",
};

// State
let map = null;
let userMarker = null;
let routeLine = null;
let attractionMarkers = [];
let userPosition = null;
let watchId = null;
let mapVisible = false;
let targetAttraction = null;

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

    // Dark-themed map tiles
    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
        maxZoom: 20,
        subdomains: "abcd",
    }).addTo(map);

    // Zoom control bottom-right
    L.control.zoom({ position: "bottomright" }).addTo(map);

    // Attribution
    L.control.attribution({ position: "bottomleft", prefix: false })
        .addAttribution('&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> | <a href="https://carto.com/">CARTO</a>')
        .addTo(map);
}

// ============================================================
// Geolocation
// ============================================================

function startGeolocation() {
    if (!navigator.geolocation) {
        showToast("Tu navegador no soporta GPS");
        return;
    }

    watchId = navigator.geolocation.watchPosition(
        (pos) => {
            userPosition = [pos.coords.latitude, pos.coords.longitude];
            updateUserMarker();
            updateRoute();
            updateWalkingTime();
        },
        (err) => {
            console.warn("Geolocation error:", err.message);
            if (err.code === 1) showToast("Activa el GPS para navegacion");
        },
        { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
    );
}

function stopGeolocation() {
    if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
    }
}

function updateUserMarker() {
    if (!map || !userPosition) return;

    if (!userMarker) {
        const userIcon = L.divIcon({
            className: "user-marker",
            html: `<div class="user-dot"><div class="user-dot-inner"></div><div class="user-pulse"></div></div>`,
            iconSize: [24, 24],
            iconAnchor: [12, 12],
        });
        userMarker = L.marker(userPosition, { icon: userIcon, zIndexOffset: 1000 }).addTo(map);
    } else {
        userMarker.setLatLng(userPosition);
    }
}

// ============================================================
// Attraction markers on map
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

    // Spread rides within each world area with deterministic offset based on ride id
    const seed = attraction.id * 137;
    const offsetLat = ((seed % 100) - 50) * 0.00003;
    const offsetLng = (((seed * 7) % 100) - 50) * 0.00003;

    return [base[0] + offsetLat, base[1] + offsetLng];
}

function updateMapMarkers() {
    // Clear existing
    attractionMarkers.forEach(m => map.removeLayer(m));
    attractionMarkers = [];

    if (!map) return;

    attractions.forEach(a => {
        const isDone = window.doneSet ? window.doneSet.has(a.id) : doneSet.has(a.id);
        const coords = getAttractionCoords(a);
        const worldKey = getWorldKey(a.area);
        const color = WORLD_MAP_COLORS[worldKey] || "#c8a84e";
        const emoji = WORLD_EMOJIS[worldKey] || "\uD83C\uDF10";
        const isTarget = targetAttraction && targetAttraction.id === a.id;

        const markerHtml = isDone
            ? `<div class="map-marker done-marker" style="border-color:${color}">&#10003;</div>`
            : `<div class="map-marker ${isTarget ? 'target-marker' : ''}" style="background:${color};border-color:${color}">
                   <span class="marker-wait">${a.isOpen ? a.waitTime : '---'}</span>
               </div>`;

        const icon = L.divIcon({
            className: "ride-marker-wrap",
            html: markerHtml,
            iconSize: [36, 36],
            iconAnchor: [18, 18],
        });

        const marker = L.marker(coords, { icon }).addTo(map);

        // Popup with ride info
        marker.bindPopup(`
            <div class="map-popup">
                <strong>${emoji} ${a.name}</strong><br>
                <span style="color:${color}">${a.area}</span><br>
                ${a.isOpen
                    ? `<span class="popup-wait">${a.waitTime} min de espera</span>`
                    : '<span style="color:#999">CERRADA</span>'
                }
                <br>
                <button onclick="navigateToRide(${a.id})" class="popup-nav-btn">
                    Navegar aqui &#10148;
                </button>
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
    const coords = getAttractionCoords(ride);

    // Update route line
    updateRoute();

    // Pan map to show both user and target
    if (userPosition) {
        const bounds = L.latLngBounds([userPosition, coords]);
        map.fitBounds(bounds, { padding: [60, 60] });
    } else {
        map.setView(coords, 18);
    }

    // Update markers to highlight target
    updateMapMarkers();
    updateNavPanel(ride);
    showToast(`Navegando a ${ride.name}`);
}

// Make it globally accessible
window.navigateToRide = navigateToRide;

function updateRoute() {
    if (!map) return;

    // Remove old route
    if (routeLine) {
        map.removeLayer(routeLine);
        routeLine = null;
    }

    if (!userPosition || !targetAttraction) return;

    const targetCoords = getAttractionCoords(targetAttraction);

    // Draw a dashed line from user to target
    routeLine = L.polyline([userPosition, targetCoords], {
        color: "#c8a84e",
        weight: 3,
        dashArray: "8, 12",
        opacity: 0.8,
    }).addTo(map);
}

function updateWalkingTime() {
    if (!userPosition || !targetAttraction) return;

    const targetCoords = getAttractionCoords(targetAttraction);
    const dist = getDistance(userPosition, targetCoords);
    const walkMinutes = Math.max(1, Math.round(dist / 70)); // ~70m/min walking

    const el = document.getElementById("nav-walk-time");
    if (el) el.textContent = `${walkMinutes} min caminando (${Math.round(dist)}m)`;
}

function getDistance([lat1, lon1], [lat2, lon2]) {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLon/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function updateNavPanel(ride) {
    const panel = document.getElementById("nav-panel");
    if (!ride) {
        panel.style.display = "none";
        return;
    }

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
        document.getElementById("nav-walk-time").textContent = "Activando GPS...";
    }

    panel.style.display = "flex";
}

function getWaitClass(wait) {
    if (wait <= 20) return "wait-low";
    if (wait <= 45) return "wait-med";
    return "wait-high";
}

// ============================================================
// Toggle map view
// ============================================================

function toggleMap() {
    const mapSection = document.getElementById("map-section");
    const btn = document.getElementById("map-toggle-btn");

    mapVisible = !mapVisible;

    if (mapVisible) {
        mapSection.style.display = "block";
        btn.classList.add("active");
        btn.innerHTML = '&#128506; Cerrar Mapa';

        // Init map after DOM is visible
        setTimeout(() => {
            initMap();
            map.invalidateSize();
            updateMapMarkers();
            startGeolocation();

            // Auto-navigate to recommended ride
            const best = getBestRecommendationForMap();
            if (best) navigateToRide(best.id);
        }, 100);
    } else {
        mapSection.style.display = "none";
        btn.classList.remove("active");
        btn.innerHTML = '&#128506; Mapa';
        stopGeolocation();
    }
}

function getBestRecommendationForMap() {
    // Re-use the global function from app.js if available
    if (typeof getBestRecommendation === "function") return getBestRecommendation();
    const candidates = attractions
        .filter(a => !doneSet.has(a.id) && a.isOpen && a.waitTime >= 0)
        .sort((a, b) => a.waitTime - b.waitTime);
    return candidates.length > 0 ? candidates[0] : null;
}

// Center on user
function centerOnUser() {
    if (userPosition && map) {
        map.setView(userPosition, 18);
    } else {
        showToast("Esperando senal GPS...");
    }
}

window.toggleMap = toggleMap;
window.centerOnUser = centerOnUser;

// ============================================================
// Auto-navigate to best recommendation when it changes
// ============================================================

function onRecommendationChanged() {
    if (!mapVisible) return;
    const best = getBestRecommendationForMap();
    if (best && (!targetAttraction || targetAttraction.id !== best.id)) {
        navigateToRide(best.id);
    }
    updateMapMarkers();
}

// Expose for app.js to call after render
window.onMapNeedsUpdate = function() {
    if (!mapVisible) return;
    updateMapMarkers();
    onRecommendationChanged();
};
