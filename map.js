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
let routeLine = null;
let attractionMarkers = [];
let userPosition = null;
let watchId = null;
let mapVisible = false;
let targetAttraction = null;
let gpsGranted = false;

// ============================================================
// GPS Permission Flow
// ============================================================

function toggleMap() {
    mapVisible = !mapVisible;
    const mapSection = document.getElementById("map-section");
    const btn = document.getElementById("map-toggle-btn");

    if (mapVisible) {
        // Check if we need to ask GPS permission
        if (!gpsGranted && navigator.permissions) {
            navigator.permissions.query({ name: "geolocation" }).then(result => {
                if (result.state === "granted") {
                    gpsGranted = true;
                    openFullscreenMap();
                } else if (result.state === "prompt") {
                    // Show our custom modal first
                    document.getElementById("gps-modal").style.display = "flex";
                } else {
                    // Denied - open map without GPS
                    openFullscreenMap();
                    updateGpsStatus("error", "GPS denegado - Activalo en Ajustes");
                }
            }).catch(() => {
                // Permissions API not supported, show modal
                document.getElementById("gps-modal").style.display = "flex";
            });
        } else {
            openFullscreenMap();
        }

        btn.classList.add("active");
        btn.innerHTML = '&#128506; Cerrar Mapa';
    } else {
        closeFullscreenMap();
        btn.classList.remove("active");
        btn.innerHTML = '&#128506; Mapa';
    }
}

function acceptGpsPermission() {
    document.getElementById("gps-modal").style.display = "none";
    gpsGranted = true;
    openFullscreenMap();
}

function skipGpsPermission() {
    document.getElementById("gps-modal").style.display = "none";
    openFullscreenMap();
    updateGpsStatus("error", "GPS desactivado");
}

window.toggleMap = toggleMap;
window.acceptGpsPermission = acceptGpsPermission;
window.skipGpsPermission = skipGpsPermission;

function openFullscreenMap() {
    const mapSection = document.getElementById("map-section");
    mapSection.style.display = "block";

    // Prevent body scroll behind map
    document.body.style.overflow = "hidden";

    setTimeout(() => {
        initMap();
        map.invalidateSize();
        updateMapMarkers();

        if (gpsGranted) {
            startGeolocation();
        }

        // Auto-navigate to recommended ride
        const best = getBestRecommendationForMap();
        if (best) navigateToRide(best.id);
    }, 100);
}

function closeFullscreenMap() {
    const mapSection = document.getElementById("map-section");
    mapSection.style.display = "none";
    document.body.style.overflow = "";
    mapVisible = false;
    stopGeolocation();
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

    // Dark tiles
    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
        maxZoom: 20,
        subdomains: "abcd",
    }).addTo(map);

    L.control.zoom({ position: "bottomright" }).addTo(map);

    L.control.attribution({ position: "bottomleft", prefix: false })
        .addAttribution('&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>')
        .addTo(map);

    // Draw world zone circles
    for (const [name, coords] of Object.entries(WORLD_COORDS)) {
        if (name === "Isle of Berk") continue; // duplicate
        const color = WORLD_MAP_COLORS[name] || "#c8a84e";
        L.circle(coords, {
            radius: 80,
            color: color,
            fillColor: color,
            fillOpacity: 0.06,
            weight: 1,
            opacity: 0.3,
            dashArray: "4,6",
        }).addTo(map);

        // World label
        const emoji = WORLD_EMOJIS[name] || "";
        const shortName = name.replace("Super Nintendo World", "Nintendo")
            .replace("How to Train Your Dragon", "Dragons")
            .replace("The Wizarding World", "Potter");
        L.marker(coords, {
            icon: L.divIcon({
                className: "world-label",
                html: `<div style="color:${color};font-size:10px;font-weight:700;text-align:center;white-space:nowrap;text-shadow:0 1px 4px rgba(0,0,0,0.8)">${emoji} ${shortName}</div>`,
                iconSize: [100, 20],
                iconAnchor: [50, -30],
            }),
            interactive: false,
        }).addTo(map);
    }
}

// ============================================================
// Geolocation
// ============================================================

function startGeolocation() {
    if (!navigator.geolocation) {
        updateGpsStatus("error", "GPS no disponible");
        return;
    }

    updateGpsStatus("", "\uD83D\uDCE1 Buscando senal GPS...");

    watchId = navigator.geolocation.watchPosition(
        (pos) => {
            userPosition = [pos.coords.latitude, pos.coords.longitude];
            const accuracy = Math.round(pos.coords.accuracy);
            updateGpsStatus("active", `\uD83D\uDCCD GPS activo (${accuracy}m)`);
            updateUserMarker();
            updateRoute();
            updateWalkingTime();
        },
        (err) => {
            console.warn("GPS error:", err.message);
            if (err.code === 1) {
                updateGpsStatus("error", "GPS denegado - Activalo en Ajustes");
            } else if (err.code === 2) {
                updateGpsStatus("error", "Senal GPS no disponible");
            } else {
                updateGpsStatus("error", "GPS timeout - Reintentando...");
            }
        },
        {
            enableHighAccuracy: true,
            maximumAge: 3000,
            timeout: 20000,
        }
    );
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

function updateUserMarker() {
    if (!map || !userPosition) return;

    if (!userMarker) {
        const icon = L.divIcon({
            className: "user-marker",
            html: '<div class="user-dot"><div class="user-dot-inner"></div><div class="user-pulse"></div></div>',
            iconSize: [24, 24],
            iconAnchor: [12, 12],
        });
        userMarker = L.marker(userPosition, { icon, zIndexOffset: 1000 }).addTo(map);
    } else {
        userMarker.setLatLng(userPosition);
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
            className: "ride-marker-wrap",
            html,
            iconSize: [36, 36],
            iconAnchor: [18, 18],
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
// Navigation
// ============================================================

function navigateToRide(rideId) {
    const ride = attractions.find(a => a.id === rideId);
    if (!ride) return;

    targetAttraction = ride;
    updateRoute();

    const coords = getAttractionCoords(ride);
    if (userPosition) {
        map.fitBounds(L.latLngBounds([userPosition, coords]), { padding: [80, 80] });
    } else {
        map.setView(coords, 18);
    }

    updateMapMarkers();
    updateNavPanel(ride);

    // Close any open popups
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
        color: "#c8a84e",
        weight: 4,
        dashArray: "10, 14",
        opacity: 0.85,
    }).addTo(map);
}

function updateWalkingTime() {
    if (!userPosition || !targetAttraction) return;
    const targetCoords = getAttractionCoords(targetAttraction);
    const dist = getDistance(userPosition, targetCoords);
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
// Center on user
// ============================================================

function centerOnUser() {
    if (userPosition && map) {
        map.setView(userPosition, 18, { animate: true });
    } else if (!gpsGranted) {
        document.getElementById("gps-modal").style.display = "flex";
    } else {
        showToast("Esperando senal GPS...");
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

    // Auto-update nav if target wait time changed
    if (targetAttraction) {
        const updated = attractions.find(a => a.id === targetAttraction.id);
        if (updated) {
            targetAttraction = updated;
            updateNavPanel(updated);
        }
    }

    // Check if a better ride appeared
    const best = getBestRecommendationForMap();
    if (best && (!targetAttraction || best.waitTime < targetAttraction.waitTime - 10)) {
        navigateToRide(best.id);
    }
};
