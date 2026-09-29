import { mapJson, geocodeAddress, roadLegs, roadRouteOptions, RouteError, type MapServices, type Place, type RouteOption } from "./routes";
import { one, run } from "./db";

/** App-wide persistent gate: >=1.1s between public-service requests, across isolates. */
async function gate(service: string) {
  await run("INSERT OR IGNORE INTO api_rate_limits(bucket,count,expires_at) VALUES (?,0,?)", [service, Math.floor(Date.now()/1000)+60]);
  for (let attempt = 0; attempt < 15; attempt++) {
    const now = Date.now();
    const result = await run("UPDATE api_rate_limits SET count=?,expires_at=? WHERE bucket=? AND count<=?", [now+1100, Math.floor(now/1000)+60, service, now]);
    if (result.meta.changes) return;
    await new Promise(resolve => setTimeout(resolve, 1100));
  }
  throw new RouteError("Mapas ocupados. Aguarde alguns segundos e tente novamente.", 429);
}
export function openMapServices(nominatim: string, osrm: string): MapServices {
  return {
    async geocode(address) {
      const key = `geocode:${nominatim}:${address.toLowerCase()}`;
      const cached = await one<{ payload: string }>("SELECT payload FROM route_cache WHERE cache_key=? AND expires_at>?", [key, Math.floor(Date.now()/1000)]);
      if (cached) return JSON.parse(cached.payload) as Place;
      await gate("nominatim:gate");
      const place = await geocodeAddress(address, nominatim);
      await run("INSERT INTO route_cache(cache_key,payload,expires_at) VALUES (?,?,?) ON CONFLICT(cache_key) DO UPDATE SET payload=excluded.payload,expires_at=excluded.expires_at", [key, JSON.stringify(place), Math.floor(Date.now()/1000)+2592000]);
      return place;
    },
    async route(points) { await gate("osrm:gate"); return roadLegs(points, osrm); },
    async routeOptions(points) {
      const key = `routeoptions:${osrm}:${points.map(p => `${p.lat.toFixed(6)},${p.lon.toFixed(6)}`).join(";")}`;
      const cached = await one<{ payload: string }>("SELECT payload FROM route_cache WHERE cache_key=? AND expires_at>?", [key, Math.floor(Date.now()/1000)]);
      if (cached) return JSON.parse(cached.payload) as RouteOption[];
      await gate("osrm:gate");
      const options = await roadRouteOptions(points, osrm);
      await run("INSERT INTO route_cache(cache_key,payload,expires_at) VALUES (?,?,?) ON CONFLICT(cache_key) DO UPDATE SET payload=excluded.payload,expires_at=excluded.expires_at", [key, JSON.stringify(options), Math.floor(Date.now()/1000)+86400]);
      return options;
    },
  };
}

/** Sugestoes de endereco para o autocomplete: respostas curtas, cacheadas. */
export async function addressSuggestions(nominatim: string, query: string): Promise<Place[]> {
  if (query.trim().length < 5) return [];
  const key = `suggest:${nominatim}:${query.trim().toLowerCase()}`;
  const cached = await one<{ payload: string }>("SELECT payload FROM route_cache WHERE cache_key=? AND expires_at>?", [key, Math.floor(Date.now()/1000)]);
  if (cached) return JSON.parse(cached.payload) as Place[];
  await gate("nominatim:gate");
  const url = new URL("search", nominatim.endsWith("/") ? nominatim : nominatim + "/");
  url.search = new URLSearchParams({ q: query.trim(), format: "jsonv2", countrycodes: "br", limit: "5", addressdetails: "1", "accept-language": "pt-BR" }).toString();
  const data = await mapJson(url) as Array<Record<string, unknown>>;
  const suggestions: Place[] = [];
  for (const item of data) {
    const lat = Number(item.lat), lon = Number(item.lon);
    const label = typeof item.display_name === "string" ? item.display_name : "";
    const hasStreet = !!(item.address as Record<string, unknown> | undefined)?.road || !!(item.address as Record<string, unknown> | undefined)?.pedestrian;
    if (!label || !Number.isFinite(lat) || !Number.isFinite(lon) || !hasStreet) continue;
    suggestions.push({ label, lat, lon });
  }
  await run("INSERT INTO route_cache(cache_key,payload,expires_at) VALUES (?,?,?) ON CONFLICT(cache_key) DO UPDATE SET payload=excluded.payload,expires_at=excluded.expires_at", [key, JSON.stringify(suggestions), Math.floor(Date.now()/1000)+86400]);
  return suggestions;
}
