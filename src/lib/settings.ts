import "server-only";
import { all, run } from "./db";

export type Settings = Record<string, string>;

export const DEFAULT_CONTRACT = `TERMO DE RESPONSABILIDADE E CONTRATO DE LOCACAO

LOCADORA: {{empresa}}, CNPJ {{cnpj}}, com endereco em {{endereco_empresa}}, telefone {{telefone_empresa}}.
LOCATARIO(A): {{cliente}}, CPF/CNPJ {{cliente_doc}}, telefone {{cliente_telefone}}, residente em {{cliente_endereco}}.

CONTRATO N. {{contrato}} - RESERVA {{reserva}}

1. OBJETO
A LOCADORA cede em locacao ao LOCATARIO os equipamentos relacionados abaixo, para uso no evento do dia {{data_evento}}, no endereco {{endereco_evento}}.

{{itens}}

2. PRAZO
Entrega prevista para {{data_entrega}} e retirada prevista para {{data_retirada}}. A permanencia dos equipamentos alem do prazo acordado, sem autorizacao previa, implica cobranca de nova diaria.

3. VALORES
Locacao dos itens: {{valor_itens}}
Frete: {{valor_frete}}
Montagem: {{valor_montagem}}
Desmontagem: {{valor_desmontagem}}
Outros servicos: {{valor_outros}}
Desconto: {{valor_desconto}}
TOTAL: {{valor_total}}
Caucao: {{valor_caucao}}

4. CAUCAO
A caucao e distinta do valor da locacao e sera devolvida integralmente em ate 5 dias uteis apos a retirada, desde que os equipamentos sejam devolvidos na mesma quantidade e estado em que foram entregues. Havendo avaria, falta ou sujeira excessiva, o valor correspondente sera retido, com discriminacao por escrito.

5. RESPONSABILIDADE
O LOCATARIO responde pela guarda e conservacao dos equipamentos desde a entrega ate a retirada, incluindo furto, extravio, quebra e danos causados por terceiros presentes no evento. Os equipamentos nao podem ser sublocados, transportados para outro endereco ou utilizados de forma diversa da sua finalidade.

6. AVARIAS E REPOSICAO
Itens danificados ou nao devolvidos serao cobrados pelo valor de reposicao vigente na tabela da LOCADORA.

7. CANCELAMENTO
O cancelamento com menos de 48 horas de antecedencia nao gera direito a devolucao do sinal pago.

8. FORO
Fica eleito o foro da comarca de {{cidade_empresa}} para dirimir eventuais duvidas oriundas deste contrato.

{{cidade_empresa}}, {{data_hoje}}.


_______________________________          _______________________________
{{empresa}}                               {{cliente}}
LOCADORA                                  LOCATARIO`;

export const DEFAULT_SETTINGS: Settings = {
  stock_preparation_minutes: "0",
  company_name: "Lima's Locacoes",
  company_tagline: "Gestao de Locacoes e Eventos",
  company_doc: "",
  company_phone: "",
  company_whatsapp: "",
  company_email: "",
  company_address: "",
  company_city: "",
  company_logo: "",
  pix_key: "",
  bank_info: "",
  contract_template: DEFAULT_CONTRACT,
  default_deposit_cents: "0",

  /*
   * Calculadora de frete. Ficam aqui, na tabela settings, em vez de numa tabela
   * nova: sao parametros unicos da empresa, o mesmo formato dos demais ajustes.
   */
  freight_fuel_type: "Etanol",
  freight_fuel_price_cents: "332",
  freight_consumption: "10",
  freight_cost_per_km_cents: "50",
  freight_margin_percent: "30",
  freight_minimum_cents: "3000",
  freight_rounding_cents: "500",
  freight_labor_cents: "0",
  wa_confirm:
    "Ola, {{cliente}}! Sua locacao na {{empresa}} esta confirmada para o dia {{data_evento}}. Reserva {{reserva}}. Qualquer duvida e so chamar!",
  wa_delivery:
    "Ola, {{cliente}}! Passando para confirmar nossa entrega hoje as {{hora_entrega}} no endereco {{endereco_evento}}.",
  wa_pickup:
    "Ola, {{cliente}}! Nossa equipe fara a retirada dos equipamentos hoje as {{hora_retirada}}. Pedimos que os itens estejam reunidos no local.",
  wa_payment:
    "Ola, {{cliente}}! Identificamos um saldo de {{saldo}} referente a sua locacao {{reserva}}. Pix: {{pix}}",
  wa_quote:
    "Ola, {{cliente}}! Segue o orcamento {{orcamento}} da {{empresa}} para o dia {{data_evento}}:\n{{itens}}\nTotal: {{valor_total}}",
};

export async function getSettings(): Promise<Settings> {
  const rows = await all<{ key: string; value: string }>("SELECT key, value FROM settings");
  const out: Settings = { ...DEFAULT_SETTINGS };
  for (const r of rows) if (r.value !== null && r.value !== undefined) out[r.key] = r.value;
  return out;
}

export async function getSetting(key: string): Promise<string> {
  return (await getSettings())[key] ?? "";
}

export async function setSettings(values: Settings) {
  for (const [key, value] of Object.entries(values)) {
    await run("INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [
      key,
      value ?? "",
    ]);
  }
}

/** Substitui {{chave}} pelos valores fornecidos. */
/**
 * Largura da linha de preenchimento manual, por variavel.
 *
 * Serve tambem de lista explicita: so as variaveis daqui viram linha quando
 * nao ha dado cadastrado. Qualquer outra continua com o comportamento antigo,
 * para nao transformar em linha algo calculado, como itens ou totais.
 */
const LARGURA_LINHA: Record<string, number> = {
  cnpj: 32,
  cliente_doc: 32,
  cliente_rg: 28,
  cliente: 46,
  empresa: 46,
  cliente_telefone: 22,
  telefone_empresa: 22,
  cliente_email: 34,
  cliente_cep: 14,
  cliente_endereco: 58,
  endereco_empresa: 58,
  endereco_evento: 58,
  cidade_empresa: 30,
  cliente_cidade: 30,
  cliente_bairro: 30,
  cliente_numero: 12,
};

/** Ha dado utilizavel? Nulo, ausente, vazio ou so espacos contam como vazio. */
function temValor(v: string | number | null | undefined): boolean {
  return v !== null && v !== undefined && String(v).trim() !== "";
}

export type EstrategiaVazio = "vazio" | "linha";

/**
 * Substitui {{variavel}} pelos valores informados.
 *
 * Com a estrategia "linha", uma variavel conhecida e sem dado cadastrado vira
 * um espaco sublinhado para preencher a mao no documento impresso, em vez de
 * sair em branco ou como "-". Isso vale so na renderizacao: o modelo salvo em
 * configuracoes continua guardando {{variavel}} e pode ser reaproveitado.
 *
 * A estrategia padrao continua sendo "vazio", que e o comportamento usado
 * pelas mensagens de WhatsApp, onde uma linha de underscores nao faria sentido.
 */
export function renderTemplate(
  template: string,
  vars: Record<string, string | number | null | undefined>,
  opts: { vazio?: EstrategiaVazio } = {},
) {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, k) => {
    const v = vars[k];
    if (temValor(v)) return String(v);
    if (opts.vazio === "linha" && k in LARGURA_LINHA) return "_".repeat(LARGURA_LINHA[k]);
    return "";
  });
}
