import { dateTimeBR, nowLocal, toISODateTime } from "./format";

/** All business timestamps are minute-precision wall clocks in America/Sao_Paulo. */
export function normalizeStamp(value: string | string[] | null | undefined, fallbackTime = "00:00"): string {
  if (!value) return "";
  // URL com o mesmo parametro repetido chega como array no App Router.
  // Vale o ULTIMO valor: e o clique mais recente (presets de periodo antigos
  // gravavam inicio/fim duplicados na URL). Sem isto, value.trim() quebrava
  // com "trim is not a function" e derrubava a tela inteira.
  const bruto = Array.isArray(value) ? value[value.length - 1] ?? "" : value;
  if (!bruto) return "";
  let input = bruto.trim().replace(" ", "T");
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) input += `T${fallbackTime}`;
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?(Z|[+-]\d{2}:\d{2})?$/.exec(input);
  if (!m || Number(m[2]) > 23 || Number(m[3]) > 59 || Number(m[4] || 0) !== 0 || Number(m[5] || 0) !== 0) {
    throw new Error("Informe data e horario validos, com precisao de minutos.");
  }
  const anchor = new Date(`${m[1]}T${m[2]}:${m[3]}:00Z`);
  if (!Number.isFinite(anchor.getTime()) || anchor.toISOString().slice(0, 10) !== m[1]) throw new Error("Data invalida.");
  if (m[6]) {
    const instant = new Date(input);
    if (!Number.isFinite(instant.getTime())) throw new Error("Fuso horario invalido.");
    return toISODateTime(instant);
  }
  return `${m[1]}T${m[2]}:${m[3]}`;
}

/** Calendar arithmetic, never dependent on the browser/Worker host timezone. */
export function addMinutes(value: string, minutes: number): string {
  const stamp = normalizeStamp(value);
  const date = new Date(`${stamp}:00Z`);
  date.setUTCMinutes(date.getUTCMinutes() + minutes);
  return date.toISOString().slice(0, 16);
}

export function timeWindow(from: string | string[], to: string | string[], allowPoint = false) {
  const start = normalizeStamp(from);
  const end = normalizeStamp(to);
  if (!start || !end) throw new Error("Informe a entrega e a retirada, com data e horario.");
  if (end < start || (!allowPoint && end === start)) throw new Error("A retirada deve ser posterior a entrega.");
  return { from: start, to: end };
}

export function windowError(from: string, to: string): string | null {
  try { timeWindow(from, to); return null; } catch (e) { return (e as Error).message; }
}

export function preparationValue(value: unknown): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 0 || n > 10080) throw new Error("Informe de 0 a 10080 minutos inteiros de preparacao.");
  return n;
}

export type AvailabilityParams = {
  inicio?: string | string[];
  fim?: string | string[];
  preparo?: string | string[];
  consulta?: string | string[];
  data?: string | string[];
  ate?: string | string[];
};
export type AvailabilityQuery = { from: string; to: string; considerPreparation: boolean; label: string; queryString: string };

/** Ultimo valor quando a URL repete o parametro (o clique mais recente vence). */
function ultimo(valor: string | string[] | undefined): string | undefined {
  if (Array.isArray(valor)) return valor.length ? valor[valor.length - 1] : undefined;
  return valor;
}

export function availabilityQuery(sp: AvailabilityParams = {}, now = nowLocal()): AvailabilityQuery {
  // Legacy date-only links now select an explicit time, not a hidden full day.
  const inicio = ultimo(sp.inicio);
  const data = ultimo(sp.data);
  const fim = ultimo(sp.fim);
  const ate = ultimo(sp.ate);
  const consulta = ultimo(sp.consulta);
  const preparo = ultimo(sp.preparo);
  const from = normalizeStamp(inicio || (data ? `${data}T${now.slice(11, 16)}` : now));
  const to = normalizeStamp(fim || (ate ? `${ate}T${from.slice(11, 16)}` : from));
  timeWindow(from, to, true);
  const considerPreparation = consulta === "1" ? preparo === "1" : preparo !== "0";
  const qs = new URLSearchParams({ inicio: from, fim: to === from ? "" : to, preparo: considerPreparation ? "1" : "0", consulta: "1" });
  return { from, to, considerPreparation, label: from === to ? `Disponibilidade em ${dateTimeBR(from)}` : `Disponibilidade garantida de ${dateTimeBR(from)} até ${dateTimeBR(to)}`, queryString: qs.toString() };
}
