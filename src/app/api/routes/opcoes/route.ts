import { getCloudflareContext } from "@opennextjs/cloudflare";
import { apiUser, rateLimit, smallJson } from "@/lib/api-security";
import { getSettings } from "@/lib/settings";
import { freightConfig } from "@/lib/freight-config";
import { calculateRouteOptions, calculatorAddresses, RouteError } from "@/lib/routes";
import { openMapServices } from "@/lib/map-services";
import { one, run } from "@/lib/db";

/**
 * Opcoes de rota para a calculadora de frete: base → destino → base.
 * Origem e sempre o endereco-base ja cadastrado; nada de chaves no frontend.
 */
export async function POST(request: Request) {
  const user = await apiUser(request, true);
  if (!user) return Response.json({ error: "Sessão expirada ou origem inválida." }, { status: 401 });
  try {
    if (!await rateLimit(`maps:${user.id}`, 30)) throw new RouteError("Muitas consultas. Aguarde um minuto.", 429);
    const input = await smallJson(request);
    const env = getCloudflareContext().env;
    const config = freightConfig(await getSettings(), input.tipo === "locacao" ? "locacao" : "comum");
    const destination = String(input.destination ?? "");
    const addresses = calculatorAddresses(config.baseAddress, destination);
    const bytes = new TextEncoder().encode(JSON.stringify([config.baseAddress, addresses, env.NOMINATIM_URL, env.OSRM_URL]));
    const cacheKey = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))).map(x => x.toString(16).padStart(2, "0")).join("");
    const now = Math.floor(Date.now() / 1000);
    const cached = await one<{ payload: string }>("SELECT payload FROM route_cache WHERE cache_key=? AND expires_at>?", [cacheKey, now]);
    if (cached) return Response.json(JSON.parse(cached.payload), { headers: { "Cache-Control": "no-store" } });
    // Lease curto no D1 agrupa calculos identicos concorrentes entre isolates.
    if (!await rateLimit(`route:${cacheKey}`, 1, 15)) throw new RouteError("Esta rota ja esta sendo calculada. Tente novamente em alguns segundos.", 429);
    if (!await rateLimit("maps:daily", 300, 86400)) throw new RouteError("Limite diário de cálculos atingido. Use o valor manual ou tente amanhã.", 429);
    const options = await calculateRouteOptions(config, destination, openMapServices(env.NOMINATIM_URL, env.OSRM_URL));
    await run("INSERT INTO route_cache(cache_key,payload,expires_at) VALUES (?,?,?) ON CONFLICT(cache_key) DO UPDATE SET payload=excluded.payload,expires_at=excluded.expires_at", [cacheKey, JSON.stringify(options), now + 86400]);
    return Response.json(options, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof RouteError ? error.message : "Não foi possível consultar a rota. Confira os dados e tente novamente." }, { status: error instanceof RouteError ? error.status : 400 });
  }
}
