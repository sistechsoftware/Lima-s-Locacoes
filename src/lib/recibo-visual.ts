/**
 * Utilidades de renderizacao do recibo.
 *
 * Fica fora de recibos.ts (que e server-only) para que testes e componentes
 * de tela compartilhem as mesmas funcoes sem arrastar o acesso a banco.
 * Nada aqui toca em dados: sao funcoes puras de formatacao.
 */

const UNIDADES = ["", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove"];
const ESPECIAIS = ["dez", "onze", "doze", "treze", "quatorze", "quinze", "dezesseis", "dezessete", "dezoito", "dezenove"];
const DEZENAS = ["", "", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta", "oitenta", "noventa"];
const CENTENAS = ["", "cento", "duzentos", "trezentos", "quatrocentos", "quinhentos", "seiscentos", "setecentos", "oitocentos", "novecentos"];

/** Número por extenso até 999.999.999.999, sem dependências. */
function extensoInteiro(n: number): string {
  if (n === 0) return "zero";
  if (n === 100) return "cem";
  if (n < 10) return UNIDADES[n];
  if (n < 20) return ESPECIAIS[n - 10];
  if (n < 100) {
    const d = Math.floor(n / 10);
    const u = n % 10;
    return u ? `${DEZENAS[d]} e ${UNIDADES[u]}` : DEZENAS[d];
  }
  if (n < 1000) {
    const c = Math.floor(n / 100);
    const resto = n % 100;
    return resto ? `${CENTENAS[c]} e ${extensoInteiro(resto)}` : CENTENAS[c];
  }
  const grupos: { divisor: number; singular: string; plural: string }[] = [
    { divisor: 1_000_000_000, singular: "bilhão", plural: "bilhões" },
    { divisor: 1_000_000, singular: "milhão", plural: "milhões" },
    { divisor: 1_000, singular: "mil", plural: "mil" },
  ];
  for (const g of grupos) {
    if (n >= g.divisor) {
      const q = Math.floor(n / g.divisor);
      const resto = n % g.divisor;
      const sufixo = g.divisor === 1_000 && q === 1 ? "mil" : `${extensoInteiro(q)} ${q === 1 ? g.singular : g.plural}`;
      if (!resto) return sufixo;
      // Portuguese comercial: "mil e cem", "mil e vinte", but "mil duzentos e cinquenta"
      // — "e" between group and remainder only for exact hundreds or below a hundred
      const ligacao = resto < 100 || resto % 100 === 0 ? " e " : " ";
      return `${sufixo}${ligacao}${extensoInteiro(resto)}`;
    }
  }
  return String(n);
}

/** Valor monetário por extenso: 125080 -> "mil duzentos e cinquenta reais e oitenta centavos". */
export function valorPorExtenso(cents: number | null | undefined): string {
  const n = Math.max(0, Math.round(cents ?? 0));
  const reais = Math.floor(n / 100);
  const centavos = n % 100;
  const partes: string[] = [];
  if (reais > 0 || centavos === 0) {
    partes.push(`${extensoInteiro(reais)} ${reais === 1 ? "real" : "reais"}`);
  }
  if (centavos > 0) {
    partes.push(`${extensoInteiro(centavos)} ${centavos === 1 ? "centavo" : "centavos"}`);
  }
  return partes.join(" e ");
}

/** Rótulo legível da forma de pagamento gravada no lançamento. */
export const FORMA_LABEL: Record<string, string> = {
  pix: "Pix",
  dinheiro: "Dinheiro",
  cartao: "Cartão",
  transferencia: "Transferência",
  outros: "Outros",
};

export function formaLabel(method: string | null | undefined): string {
  if (!method) return "Não informada";
  return FORMA_LABEL[method] ?? method;
}

/** Tira acentos e símbolos para o nome do arquivo PDF (mesma regra do orçamento). */
export function sanitizarNomeArquivo(texto: string | null | undefined): string {
  return (texto ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}
