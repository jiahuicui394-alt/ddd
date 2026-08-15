import "server-only";

import type { PlaceSuggestion } from "./commute-types";
import {
  searchTravelTimeGeocoding,
  type TravelTimeGeocodingFeature,
} from "./commute-provider";

type Coordinates = { lat: number; lng: number };

type PhotonFeature = {
  geometry: { coordinates: [number, number] };
  properties: {
    osm_type?: string;
    osm_id?: number;
    osm_value?: string;
    name?: string;
    street?: string;
    locality?: string;
    district?: string;
    city?: string;
    state?: string;
    postcode?: string;
    countrycode?: string;
  };
};

type PhotonResponse = { features?: PhotonFeature[] };

type PoiIntent = {
  pattern: RegExp;
  photonQuery: string;
  category: string;
};

const POI_INTENTS: PoiIntent[] = [
  { pattern: /麦当劳|麥當勞|マクドナルド/i, photonQuery: "マクドナルド", category: "餐饮" },
  { pattern: /药妆店?|藥妝店?|ドラッグストア|薬局/i, photonQuery: "マツモトキヨシ", category: "药妆" },
  { pattern: /星巴克|スターバックス/i, photonQuery: "スターバックス", category: "咖啡" },
  { pattern: /便利店|コンビニ/i, photonQuery: "コンビニ", category: "便利店" },
];

const CACHE_TTL_MS = 5 * 60 * 1000;
const TOKYO_POI_RADIUS_KM = 2.5;

const cacheHost = globalThis as typeof globalThis & {
  destinationSuggestionCache?: Map<
    string,
    { expiresAt: number; suggestions: PlaceSuggestion[] }
  >;
};
const suggestionCache =
  cacheHost.destinationSuggestionCache ??
  new Map<string, { expiresAt: number; suggestions: PlaceSuggestion[] }>();
cacheHost.destinationSuggestionCache = suggestionCache;

function haversineKm(a: Coordinates, b: Coordinates) {
  const radians = (value: number) => (value * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const latDelta = radians(b.lat - a.lat);
  const lngDelta = radians(b.lng - a.lng);
  const value =
    Math.sin(latDelta / 2) ** 2 +
    Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(lngDelta / 2) ** 2;
  return 2 * earthRadiusKm * Math.asin(Math.sqrt(value));
}

function travelTimeSuggestion(
  feature: TravelTimeGeocodingFeature,
  index: number,
  query: string,
): PlaceSuggestion {
  const fullName = feature.properties.name || feature.properties.label || "东京地点";
  const [featureName, ...addressParts] = fullName.split(",").map((part) => part.trim());
  const [lng, lat] = feature.geometry.coordinates;
  const isRailway = feature.properties.category === "railway";
  const stationName = query.endsWith("站") || query.endsWith("駅") ? query : `${query}站`;

  return {
    id: `traveltime:${lat.toFixed(6)}:${lng.toFixed(6)}:${index}`,
    name: isRailway
      ? `${stationName} · 定位 ${index + 1}`
      : featureName || fullName,
    address:
      addressParts.join(" · ") ||
      feature.properties.label ||
      [feature.properties.district, feature.properties.city].filter(Boolean).join(" · ") ||
      "Tokyo, Japan",
    category: isRailway ? "车站 / 出入口" : "地点",
    lat: Number(lat),
    lng: Number(lng),
    source: "traveltime",
  };
}

async function searchPhotonPoi(
  query: string,
  category: string,
  center: Coordinates,
) {
  const url = new URL("https://photon.komoot.io/api/");
  const lngDelta = 0.03;
  const latDelta = 0.025;
  url.searchParams.set("q", query);
  url.searchParams.set("limit", "20");
  url.searchParams.set(
    "bbox",
    [
      center.lng - lngDelta,
      center.lat - latDelta,
      center.lng + lngDelta,
      center.lat + latDelta,
    ].join(","),
  );

  const response = await fetch(url, {
    headers: { "User-Agent": "TokyoCommuteFinderDemo/0.1" },
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) return [];

  const data = (await response.json()) as PhotonResponse;
  return (data.features ?? [])
    .filter((feature) => feature.properties.countrycode === "JP")
    .map((feature) => {
      const [lng, lat] = feature.geometry.coordinates;
      const address = [
        feature.properties.street,
        feature.properties.locality,
        feature.properties.district,
        feature.properties.city,
        feature.properties.postcode,
      ].filter(Boolean);
      return {
        suggestion: {
          id: `osm:${feature.properties.osm_type ?? "x"}:${feature.properties.osm_id ?? `${lat}:${lng}`}`,
          name: feature.properties.name || query,
          address: [...new Set(address)].join(" · ") || "Tokyo, Japan",
          category,
          lat: Number(lat),
          lng: Number(lng),
          distanceMeters: Math.round(
            haversineKm(center, { lat: Number(lat), lng: Number(lng) }) * 1000,
          ),
          source: "openstreetmap" as const,
        },
        distance: haversineKm(center, { lat: Number(lat), lng: Number(lng) }),
      };
    })
    .filter((item) => item.distance <= TOKYO_POI_RADIUS_KM)
    .sort((a, b) => a.distance - b.distance)
    .map((item) => item.suggestion);
}

function deduplicate(suggestions: PlaceSuggestion[]) {
  const seen = new Set<string>();
  return suggestions.filter((suggestion) => {
    const key = `${suggestion.name}|${suggestion.address}|${suggestion.lat.toFixed(4)}|${suggestion.lng.toFixed(4)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function searchDestinationSuggestions(rawQuery: string) {
  const query = rawQuery.trim().slice(0, 80);
  if (query.length < 2) return [];

  const cacheKey = `v3:${query.normalize("NFKC").toLocaleLowerCase()}`;
  const cached = suggestionCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.suggestions;

  const matchedIntent = POI_INTENTS.find((intent) => intent.pattern.test(query));
  const areaQuery = matchedIntent
    ? query.replace(matchedIntent.pattern, "").trim() || "东京"
    : query;
  const travelTimeFeatures = await searchTravelTimeGeocoding(areaQuery, 5);
  const travelTimeSuggestions = deduplicate(
    travelTimeFeatures.map((feature, index) =>
      travelTimeSuggestion(feature, index, areaQuery),
    ),
  ).slice(0, 2);
  const firstFeature = travelTimeFeatures[0];

  if (!firstFeature) return [];

  const center = {
    lng: Number(firstFeature.geometry.coordinates[0]),
    lat: Number(firstFeature.geometry.coordinates[1]),
  };
  const positionedTravelTimeSuggestions = travelTimeSuggestions.map((suggestion) => ({
    ...suggestion,
    distanceMeters: Math.round(
      haversineKm(center, { lat: suggestion.lat, lng: suggestion.lng }) * 1000,
    ),
  }));
  const shouldSuggestNearbyPoi =
    Boolean(matchedIntent) || firstFeature.properties.category === "railway";
  const poiIntents = matchedIntent
    ? [matchedIntent]
    : shouldSuggestNearbyPoi
      ? [POI_INTENTS[0], POI_INTENTS[1]]
      : [];
  const poiResults = await Promise.allSettled(
    poiIntents.map((intent) =>
      searchPhotonPoi(intent.photonQuery, intent.category, center),
    ),
  );
  const nearbyPoi = poiResults.flatMap((result) =>
    result.status === "fulfilled" ? result.value.slice(0, 3) : [],
  );

  const suggestions = deduplicate([
    ...positionedTravelTimeSuggestions,
    ...nearbyPoi,
  ]).slice(0, 8);
  suggestionCache.set(cacheKey, {
    expiresAt: Date.now() + CACHE_TTL_MS,
    suggestions,
  });

  return suggestions;
}
