import "jsr:@supabase/functions-js/edge-runtime.d.ts";

type NominatimPlace = {
  osm_type: string;
  osm_id: number;
  lat: string;
  lon: string;
  name?: string;
  display_name: string;
  category?: string;
  type?: string;
  namedetails?: Record<string, string>;
};

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "accept, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Cache-Control": "public, max-age=300",
  "Content-Type": "application/json; charset=utf-8",
};

const TOKYO_CENTER = { lat: 35.6812, lng: 139.7671 };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: CORS_HEADERS });
}

function searchQuery(query: string) {
  const normalized = query.normalize("NFKC").trim();
  if (/六本木.*森(?:ビル|大厦|大樓)|森(?:ビル|大厦|大樓).*六本木/i.test(normalized)) {
    return "六本木ヒルズ森タワー";
  }
  if (/东京大学|東京大学|东大|東大/i.test(normalized)) {
    return "東京大学 本郷キャンパス";
  }
  return normalized;
}

function haversineMeters(lat: number, lng: number, targetLat: number, targetLng: number) {
  const radians = (value: number) => value * Math.PI / 180;
  const latDelta = radians(targetLat - lat);
  const lngDelta = radians(targetLng - lng);
  const value = Math.sin(latDelta / 2) ** 2
    + Math.cos(radians(lat)) * Math.cos(radians(targetLat)) * Math.sin(lngDelta / 2) ** 2;
  return Math.round(12_742_000 * Math.asin(Math.sqrt(value)));
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);

  const requestUrl = new URL(request.url);
  const rawQuery = requestUrl.searchParams.get("q")?.trim() ?? "";
  if (rawQuery.length < 2) return json({ suggestions: [] });
  if (rawQuery.length > 80) return json({ error: "Query is too long" }, 400);

  const latParam = requestUrl.searchParams.get("lat");
  const lngParam = requestUrl.searchParams.get("lng");
  const requestedLat = latParam === null ? Number.NaN : Number(latParam);
  const requestedLng = lngParam === null ? Number.NaN : Number(lngParam);
  const center = Number.isFinite(requestedLat) && Number.isFinite(requestedLng)
    ? { lat: requestedLat, lng: requestedLng }
    : TOKYO_CENTER;
  const query = searchQuery(rawQuery);
  const language = request.headers.get("accept-language")?.slice(0, 40) || "ja,en";
  const upstreamUrl = new URL("https://nominatim.openstreetmap.org/search");
  upstreamUrl.searchParams.set("q", query);
  upstreamUrl.searchParams.set("format", "jsonv2");
  upstreamUrl.searchParams.set("countrycodes", "jp");
  upstreamUrl.searchParams.set("limit", "10");
  upstreamUrl.searchParams.set("addressdetails", "1");
  upstreamUrl.searchParams.set("namedetails", "1");
  upstreamUrl.searchParams.set("accept-language", language);
  upstreamUrl.searchParams.set(
    "viewbox",
    `${center.lng - 0.25},${center.lat + 0.2},${center.lng + 0.25},${center.lat - 0.2}`,
  );

  try {
    const response = await fetch(upstreamUrl, {
      headers: {
        Accept: "application/json",
        "User-Agent": "TokyoCommuteFinderDemo/1.0 (https://github.com/jiahuicui394-alt/ddd)",
      },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return json({ error: `Geocoding provider returned HTTP ${response.status}` }, 502);

    const places = await response.json() as NominatimPlace[];
    const normalizedQuery = query.normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, "");
    const suggestions = places.map((place) => {
      const lat = Number(place.lat);
      const lng = Number(place.lon);
      const preferredName = place.namedetails?.["name:ja"]
        || place.namedetails?.name
        || place.name
        || place.display_name.split(",")[0];
      const distanceMeters = haversineMeters(center.lat, center.lng, lat, lng);
      return {
        id: `osm:${place.osm_type}:${place.osm_id}`,
        name: preferredName,
        address: place.display_name,
        category: place.type || place.category || "place",
        lat,
        lng,
        distanceMeters,
        source: "openstreetmap",
      };
    }).filter((place) =>
      Number.isFinite(place.lat)
      && Number.isFinite(place.lng)
      && place.distanceMeters <= 50_000
    )
      .sort((left, right) => {
        const leftName = left.name.normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, "");
        const rightName = right.name.normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, "");
        const leftMatch = leftName === normalizedQuery ? 2 : leftName.includes(normalizedQuery) ? 1 : 0;
        const rightMatch = rightName === normalizedQuery ? 2 : rightName.includes(normalizedQuery) ? 1 : 0;
        return rightMatch - leftMatch || left.distanceMeters - right.distanceMeters;
      });

    return json({ suggestions });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Geocoding failed";
    return json({ error: message }, 502);
  }
});
