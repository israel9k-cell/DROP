// Cloudflare Worker - CORS Proxy for Queue-Times API
// Deploy: npx wrangler deploy
// Free tier: 100,000 requests/day

export default {
    async fetch(request) {
        const url = new URL(request.url);
        const parkId = url.searchParams.get("park");

        if (!parkId || !/^\d+$/.test(parkId)) {
            return new Response(JSON.stringify({ error: "Missing or invalid park ID" }), {
                status: 400,
                headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
            });
        }

        const apiUrl = `https://queue-times.com/parks/${parkId}/queue_times.json`;

        try {
            const resp = await fetch(apiUrl, {
                headers: { "User-Agent": "UniversalGO-App/1.0", "Accept": "application/json" }
            });
            const data = await resp.text();

            return new Response(data, {
                status: resp.status,
                headers: {
                    "Content-Type": "application/json",
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Methods": "GET",
                    "Cache-Control": "public, max-age=120"
                }
            });
        } catch (err) {
            return new Response(JSON.stringify({ error: "Failed to fetch from Queue-Times" }), {
                status: 502,
                headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
            });
        }
    }
};
