import "server-only";
import { all, insert, scalar } from "./db";

/**
 * Codigo automatico de produto.
 *
 * Os codigos do cadastro sao digitados livremente (MESA, CAD, PULA...) e nao
 * existe contador no banco. Para gerar o proximo codigo sem inventar um padrao
 * novo, este modulo le os codigos REAIS existentes e procura uma familia no
 * formato PREFIXO + NUMERO, com ou sem hifen:
 *
 *   MES001 MES002 CAD001  -> proximo da familia mais usada: MES003
 *   P-001  P-002          -> P-003 (mesmo formato das numeracoes do sistema)
 *
 * Empate entre familias: vence a de maior numero; empatando de novo, a com
 * hifen (mesmo estilo de LIMA-001, FRT-001, ORC-001...). Sem familia alguma,
 * usa o prefixo PROD no mesmo formato (PROD-001, PROD-002...).
 *
 * O codigo calculado e sempre verificado contra o banco antes de ser devolvido,
 * e o INSERT da acao confia na constraint UNIQUE de products.code: se outro
 * cadastro (outra aba / outro usuario / outra requisicao) gravar o mesmo codigo
 * primeiro, a acao gera o proximo codigo e tenta de novo. O banco e a fonte de
 * verdade; nao existe contador em memoria.
 *
 * Codigos que nao seguem o formato PREFIXO+NUMERO (ex.: MESA, KIT-MC4) nao
 * definem o padrao, mas continuam bloqueados como codigos ocupados.
 */

const LIMITE_PREFIXO = 12;
const TENTATIVAS_GERACAO = 1000;
const PREFIXO_PADRAO = "PROD";

export type PadraoCodigos = {
  prefixo: string;
  hifen: boolean;
  /** Proximo numero livre da familia (maior numero visto + 1). */
  proximoNumero: number;
  /** Largura numerica observada no codigo de maior numero (ex.: 3 em P-001). */
  largura: number;
};

/** Formata o codigo da familia para o numero informado. */
export function formatarCodigo(p: PadraoCodigos, numero: number): string {
  return `${p.prefixo}${p.hifen ? "-" : ""}${String(numero).padStart(p.largura, "0")}`;
}

/**
 * Analisa os codigos existentes e devolve a familia predominante, ou null
 * quando nenhum codigo segue o formato PREFIXO+NUMERO.
 */
export function analisarPadraoCodigos(codes: string[]): PadraoCodigos | null {
  type Familia = { numeros: number[]; larguraPorNumero: Map<number, number> };
  // O hifen faz parte da identidade da familia: MES-1 e MES1 sao familias distintas.
  const familias = new Map<string, Familia>();

  for (const raw of codes) {
    const code = String(raw ?? "").trim().toUpperCase();
    let hifen = true;
    let m = new RegExp(`^([A-Z]{1,${LIMITE_PREFIXO}})-(\\d+)$`).exec(code);
    if (!m) {
      hifen = false;
      m = new RegExp(`^([A-Z]{1,${LIMITE_PREFIXO}})(\\d+)$`).exec(code);
    }
    if (!m) continue;
    const key = `${hifen ? "-" : ""}${m[1]}`;
    const numero = Number(m[2]);
    const f = familias.get(key) ?? { numeros: [], larguraPorNumero: new Map<number, number>() };
    f.numeros.push(numero);
    f.larguraPorNumero.set(numero, m[2].length);
    familias.set(key, f);
  }

  let melhor: { key: string; maxNum: number; qtd: number; hifen: boolean; largura: number } | null = null;
  for (const [key, f] of familias) {
    const maxNum = Math.max(...f.numeros);
    const qtd = f.numeros.length;
    const hifen = key.startsWith("-");
    const largura = f.larguraPorNumero.get(maxNum) ?? 3;
    if (
      !melhor ||
      qtd > melhor.qtd ||
      (qtd === melhor.qtd && maxNum > melhor.maxNum) ||
      (qtd === melhor.qtd && maxNum === melhor.maxNum && hifen && !melhor.hifen)
    ) {
      melhor = { key, maxNum, qtd, hifen, largura };
    }
  }
  if (!melhor) return null;
  return { prefixo: melhor.key.replace(/^-/, ""), hifen: melhor.hifen, proximoNumero: melhor.maxNum + 1, largura: Math.max(1, melhor.largura) };
}

/**
 * Proximo codigo de produto disponivel, seguindo o padrao real do cadastro.
 *
 * Nunca devolve um codigo que ja exista (inclusive produtos inativos: o
 * UNIQUE vale para a tabela inteira). Pode ser chamado quantas vezes quiser
 * sem gravar nada - a acao de criar produto que usa o valor devolvido.
 */
export async function gerarCodigoProduto(): Promise<string> {
  const codes = (await all<{ code: string }>(`SELECT code FROM products`)).map((r) => r.code);
  const base =
    analisarPadraoCodigos(codes) ?? { prefixo: PREFIXO_PADRAO, hifen: true, proximoNumero: 1, largura: 3 };

  for (let i = 0; i < TENTATIVAS_GERACAO; i++) {
    const candidato = formatarCodigo(base, base.proximoNumero + i);
    const ocupado = await scalar<number>(`SELECT COUNT(*) FROM products WHERE code = ?`, [candidato]);
    if (!ocupado) return candidato;
  }
  throw new Error(`Nao foi possivel encontrar um codigo de produto livre apos ${TENTATIVAS_GERACAO} tentativas.`);
}

/* ------------------------------------------------------------------ */
/* Criacao do produto com codigo gerado                                */
/* ------------------------------------------------------------------ */

export type DadosNovoProduto = {
  name: string;
  category_id: number | null;
  kind: "simples" | "kit";
  total_qty: number;
  min_qty: number;
  rent_price_cents: number;
  replace_cents: number;
  description: string;
  photo: string;
};

/**
 * Grava o produto novo com codigo gerado na hora, usando o banco como fonte
 * de verdade.
 *
 * Dois cadastros simultaneos podem receber a mesma sugestao (duas abas, dois
 * usuarios, duas requisicoes): quando isso acontece, o UNIQUE de products.code
 * derruba o INSERT perdedor e o codigo e gerado de novo, ja enxergando o
 * codigo que acabou de ser ocupado. Apos `tentativas` rodadas sem sucesso,
 * falha com erro claro - o chamador decide como informar o usuario. Nenhuma
 * tentativa grava um produto sem codigo ou com codigo duplicado.
 */
export async function inserirProdutoComCodigoGerado(
  dados: DadosNovoProduto,
  tentativas = 3,
): Promise<{ id: number; code: string }> {
  let ultimoErro: unknown = null;
  for (let i = 0; i < Math.max(1, tentativas); i++) {
    const code = await gerarCodigoProduto();
    try {
      const id = await insert(
        `INSERT INTO products (code, name, category_id, kind, total_qty, min_qty, rent_price_cents, replace_cents, description, photo)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [
          code,
          dados.name,
          dados.category_id,
          dados.kind,
          dados.total_qty,
          dados.min_qty,
          dados.rent_price_cents,
          dados.replace_cents,
          dados.description,
          dados.photo,
        ],
      );
      return { id, code };
    } catch (e) {
      ultimoErro = e;
    }
  }
  throw new Error(
    "Não foi possível gravar o produto: os códigos gerados foram ocupados por outros cadastros simultâneos.",
    { cause: ultimoErro },
  );
}
