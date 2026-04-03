const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;

const MIME_TYPES = {
    ".html": "text/html",
    ".css": "text/css",
    ".js": "application/javascript",
    ".json": "application/json",
    ".png": "image/png",
    ".ico": "image/x-icon",
};

function serveStatic(res, filePath) {
    const ext = path.extname(filePath);
    const mime = MIME_TYPES[ext] || "application/octet-stream";

    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(404);
            res.end("Not found");
            return;
        }
        res.writeHead(200, { "Content-Type": mime });
        res.end(data);
    });
}

function proxyQueueTimes(res, parkId) {
    if (!/^\d+$/.test(parkId)) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid park ID" }));
        return;
    }

    const url = `https://queue-times.com/parks/${parkId}/queue_times.json`;

    https.get(url, { headers: { "User-Agent": "UniversalGO/1.0", "Accept": "application/json" } }, (proxyRes) => {
        let body = "";
        proxyRes.on("data", (chunk) => (body += chunk));
        proxyRes.on("end", () => {
            res.writeHead(proxyRes.statusCode, {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*",
                "Cache-Control": "public, max-age=120",
            });
            res.end(body);
        });
    }).on("error", (err) => {
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Failed to fetch: " + err.message }));
    });
}

const server = http.createServer((req, res) => {
    const parsed = new URL(req.url, `http://localhost:${PORT}`);

    // API proxy endpoint
    if (parsed.pathname === "/api/waits") {
        const parkId = parsed.searchParams.get("park");
        proxyQueueTimes(res, parkId);
        return;
    }

    // Static files
    let filePath = parsed.pathname === "/" ? "/index.html" : parsed.pathname;
    filePath = path.join(__dirname, filePath);

    // Prevent directory traversal
    if (!filePath.startsWith(__dirname)) {
        res.writeHead(403);
        res.end("Forbidden");
        return;
    }

    serveStatic(res, filePath);
});

server.listen(PORT, "0.0.0.0", () => {
    console.log(`\n  Universal GO server running!`);
    console.log(`  Local:   http://localhost:${PORT}`);

    // Show network IP for phone access
    const nets = require("os").networkInterfaces();
    for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
            if (net.family === "IPv4" && !net.internal) {
                console.log(`  Network: http://${net.address}:${PORT}`);
            }
        }
    }
    console.log(`\n  Open the Network URL on your iPhone (same WiFi)\n`);
});
