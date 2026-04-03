// Vercel Serverless Function - proxies Queue-Times API (no CORS issues)
export default async function handler(req, res) {
    const parkId = req.query.park;

    if (!parkId || !/^\d+$/.test(parkId)) {
        return res.status(400).json({ error: "Missing or invalid park ID" });
    }

    try {
        const response = await fetch(
            `https://queue-times.com/parks/${parkId}/queue_times.json`,
            { headers: { "User-Agent": "UniversalGO/1.0", "Accept": "application/json" } }
        );

        const data = await response.text();

        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Cache-Control", "public, s-maxage=120, stale-while-revalidate=60");
        res.status(response.status).send(data);
    } catch (err) {
        res.status(502).json({ error: "Failed to fetch wait times" });
    }
}
