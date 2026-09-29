/**
 * Janela evento → entrega prevista → retirada prevista.
 *
 * Regras unicas para Novo Orçamento e Nova Reserva:
 *  - Data do evento preenche a DATA da entrega (mesmo dia) e da retirada (+1
 *    dia), sem tocar em horario nenhum.
 *  - Horario da entrega e sempre espelhado na retirada, preservando a data dela.
 *  - Campos vazios nao geram horario: a hora fica pendente de preenchimento.
 *
 * Data e horario ficam separados no estado porque o input datetime-local do
 * navegador nao exibe "data sem hora" (sanitiza para vazio). Na submissao,
 * carimboDe() compoe "YYYY-MM-DDTHH:MM" (ou so a data) para os campos ocultos;
 * o servidor ja normaliza com stamp(valor, horaPadrao).
 *
 * O +1 dia usa addDays (calendario por campos UTC): virada de mes/ano e fuso
 * horario nao deslocam a data.
 */
import { addDays } from "./format";

export type JanelaState = {
  eventDate: string;
  deliveryDate: string;
  deliveryTime: string;
  pickupDate: string;
  pickupTime: string;
};
export type CampoJanela = keyof JanelaState;

const SO_DATA = /^\d{4}-\d{2}-\d{2}$/;
const SO_HORA = /^\d{2}:\d{2}$/;

/** HH:MM de um carimbo ("2026-09-29T10:00" → "10:00"); vazio se nao tiver hora. */
export function timeOf(carimbo: string): string {
  const m = /[T ](\d{2}:\d{2})/.exec(carimbo || "");
  return m ? m[1] : "";
}

/** YYYY-MM-DD de um carimbo; vazio se nao tiver data. */
export function dateOf(carimbo: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(carimbo || "");
  return m ? m[1] : "";
}

/** Quebra um carimbo salvo em data e hora para o estado inicial do formulario. */
export function dividirCarimbo(carimbo: string): { data: string; hora: string } {
  return { data: dateOf(carimbo), hora: timeOf(carimbo) };
}

/** Estado inicial a partir do que veio do banco (event_date + carimbos). */
export function janelaInicial(eventDate: string, deliveryAt: string, pickupAt: string): JanelaState {
  const entrega = dividirCarimbo(deliveryAt);
  const retirada = dividirCarimbo(pickupAt);
  return {
    eventDate: dateOf(eventDate),
    deliveryDate: entrega.data,
    deliveryTime: entrega.hora,
    pickupDate: retirada.data,
    pickupTime: retirada.hora,
  };
}

/** Compoem o valor para o servidor: "T10:00" quando houver hora, so a data senao. */
export function carimboDe(data: string, hora: string): string {
  if (!SO_DATA.test(data)) return "";
  return SO_HORA.test(hora) ? `${data}T${hora}` : data;
}

/** Retirada prevista: sempre o dia seguinte ao evento, pelo calendario local. */
export function pickupDateFor(eventDate: string): string {
  return addDays(eventDate, 1);
}

/**
 * Transicao pura do formulario: recebe o estado atual, o campo que o usuario
 * mexeu e o novo valor, e devolve o estado resultante. Datas e horario da
 * retirada editados à mao nunca sao reescritos por outra automatizacao.
 */
export function proximaJanela(estado: JanelaState, campo: CampoJanela, valor: string): JanelaState {
  const atual: JanelaState = { ...estado, [campo]: valor };

  if (campo === "eventDate") {
    // Evento vazio ou incompleto: nao calcular nada.
    if (!SO_DATA.test(valor)) return atual;
    // Datas seguem o evento; horarios seguem intocados.
    atual.deliveryDate = valor;
    atual.pickupDate = pickupDateFor(valor);
    return atual;
  }

  if (campo === "deliveryTime") {
    // Espelha o horario na retirada (inclusive ao limpar).
    atual.pickupTime = valor;
    // Retirada sem data ganha o dia seguinte ao evento (ou ao da entrega).
    if (valor && !atual.pickupDate) atual.pickupDate = pickupDateFor(estado.eventDate || atual.deliveryDate);
    return atual;
  }

  return atual;
}
