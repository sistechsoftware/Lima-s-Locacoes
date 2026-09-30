import { getCloudflareContext } from "@opennextjs/cloudflare";
import { apiUser, rateLimit, smallJson } from "@/lib/api-security";
import { RouteError } from "@/lib/routes";
import { addressSuggestions } from "@/lib/map-services";

/**
 * Sugestoes de endereco (Nominatim publico) para o autocomplete da calculadora.
 * O cliente so pergunta depois de digitar o suficiente; respostas curtas sao
 * cacheadas no D1 para poupar chamadas ao servico publico.
 */
export async function POST(request: Request) {
  const user = await apiUser(request, true);
  if (!user) return Response.json({ error: "Sessão expirada ou origem inválida." }, { status: 401 });
  try {
    if (!await rateLimit(`geocode:${user.id}`, 30)) throw new RouteError("Muitas consultas. Aguarde um momento.", 429);
    const input = await smallJson(request);
    const query = String(input.query ?? "");
    if (query.trim().length < 5) return Response.json([]);
    const { NOMINATIM_URL } = getCloudflareContext().env;
    const suggestions = await addressSuggestions(NOMINATIM_URL, query);
    return Response.json(suggestions, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof RouteError ? error.message : "Não foi possível buscar endereços agora. Você pode digitar o endereço completo manualmente." }, { status: error instanceof RouteError ? error.status : 400 });
  }
}
