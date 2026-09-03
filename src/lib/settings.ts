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
export function renderTemplate(template: string, vars: Record<string, string | number | null | undefined>) {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, k) => String(vars[k] ?? ""));
}
