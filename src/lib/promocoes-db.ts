import "server-only";
import { all } from "./db";
import { ordenar, precoUnitario, type Faixa, type Promocao } from "./promocoes";

/**
 * Acesso a dados das promocoes.
 *
 * Fica separado da regra (promocoes.ts) para a regra continuar testavel sem
 * banco. Tudo aqui carrega em lote: os formularios precisam da tabela inteira
 * de uma vez para recalcular preco enquanto o operador digita, e uma consulta
 * por produto seria N+1 na tela de montar reserva.
 */

export type PromocaoComProduto = Promocao & {
  name: string;
  notes: string | null;
  product_name: string;
  product_code: string;
  rent_price_cents: number;
};

function montar(linhas: any[], faixas: any[]): Map<number, PromocaoComProduto> {
  const porPromocao = new Map<number, Faixa[]>();
  for (const f of faixas) {
    const lista = porPromocao.get(f.promotion_id) ?? [];
    lista.push({ min_qty: f.min_qty, max_qty: f.max_qty, unit_price_cents: f.unit_price_cents });
    porPromocao.set(f.promotion_id, lista);
  }
  const mapa = new Map<number, PromocaoComProduto>();
  for (const p of linhas) {
    mapa.set(p.id, {
      id: p.id,
      product_id: p.product_id,
      name: p.name,
      notes: p.notes ?? null,
      active: !!p.active,
      starts_on: p.starts_on,
      ends_on: p.ends_on,
      product_name: p.product_name,
      product_code: p.product_code,
      rent_price_cents: p.rent_price_cents,
      tiers: ordenar(porPromocao.get(p.id) ?? []),
    });
  }
  return mapa;
}

/**
 * Agrupa as promocoes por produto mantendo TODAS as de cada produto.
 *
 * Este era o ponto onde o sistema perdia promocoes: manter so a primeira de
 * cada produto descartava as de periodos futuros (outubro, novembro...) antes
 * de qualquer consulta de data, e a promocao de setembro vencia sempre. A
 * ordem de id se preserva: e ela que desempata se duas valem na mesma data.
 */
function porProdutoTodas(promocoes: Iterable<PromocaoComProduto>): Map<number, Promocao[]> {
  const porProduto = new Map<number, Promocao[]>();
  for (const promocao of promocoes) {
    if (promocao.tiers.length === 0) continue;
    const lista = porProduto.get(promocao.product_id) ?? [];
    lista.push(promocao);
    porProduto.set(promocao.product_id, lista);
  }
  return porProduto;
}

const SELECT = `
  SELECT pr.*, p.name AS product_name, p.code AS product_code, p.rent_price_cents
    FROM promotions pr JOIN products p ON p.id = pr.product_id`;

/** Todas as promocoes cadastradas, para a tela de administracao. */
export async function listarPromocoes(filtro: { busca?: string; situacao?: string } = {}) {
  const where: string[] = [];
  const params: any[] = [];
  if (filtro.busca) {
    where.push("(p.name LIKE ? OR p.code LIKE ? OR pr.name LIKE ?)");
    const like = `%${filtro.busca}%`;
    params.push(like, like, like);
  }
  if (filtro.situacao === "ativas") where.push("pr.active = 1");
  if (filtro.situacao === "inativas") where.push("pr.active = 0");

  const linhas = await all<any>(
    `${SELECT} ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY p.name, pr.id DESC`,
    params,
  );
  const faixas = linhas.length
    ? await all<any>(
        `SELECT * FROM promotion_tiers WHERE promotion_id IN (${linhas.map(() => "?").join(",")}) ORDER BY min_qty`,
        linhas.map((l) => l.id),
      )
    : [];
  return [...montar(linhas, faixas).values()];
}

export async function getPromocao(id: number): Promise<PromocaoComProduto | null> {
  const linhas = await all<any>(`${SELECT} WHERE pr.id = ?`, [id]);
  if (linhas.length === 0) return null;
  const faixas = await all<any>(`SELECT * FROM promotion_tiers WHERE promotion_id = ? ORDER BY min_qty`, [id]);
  return montar(linhas, faixas).get(id) ?? null;
}

/** Outras promocoes do mesmo produto, para checar conflito antes de gravar. */
export async function promocoesDoProduto(productId: number, exceto?: number) {
  const linhas = await all<any>(
    `${SELECT} WHERE pr.product_id = ? AND pr.active = 1 ${exceto ? "AND pr.id <> ?" : ""}`,
    exceto ? [productId, exceto] : [productId],
  );
  const faixas = linhas.length
    ? await all<any>(
        `SELECT * FROM promotion_tiers WHERE promotion_id IN (${linhas.map(() => "?").join(",")})`,
        linhas.map((l) => l.id),
      )
    : [];
  return [...montar(linhas, faixas).values()];
}

/**
 * Promocoes vigentes de cada produto na data do evento, em duas consultas.
 *
 * Devolve TODAS as promocoes vigentes por produto: o cadastro recusa promocoes
 * que brigam pela mesma quantidade no mesmo periodo, mas periodos diferentes
 * podem coexistir (setembro, outubro, novembro-dezembro...). A escolha do preco
 * fica para precoUnitario, que avalia cada uma contra a data recebida.
 */
export async function promocoesVigentes(dataISO: string): Promise<Map<number, Promocao[]>> {
  const dia = dataISO.slice(0, 10);
  const linhas = await all<any>(
    `${SELECT}
      WHERE pr.active = 1
        AND (pr.starts_on IS NULL OR pr.starts_on <= ?)
        AND (pr.ends_on IS NULL OR pr.ends_on >= ?)
      ORDER BY pr.id`,
    [dia, dia],
  );
  const faixas = linhas.length
    ? await all<any>(
        `SELECT * FROM promotion_tiers WHERE promotion_id IN (${linhas.map(() => "?").join(",")}) ORDER BY min_qty`,
        linhas.map((l) => l.id),
      )
    : [];
  return porProdutoTodas(montar(linhas, faixas).values());
}

/**
 * Promocoes ativas por produto, sem filtrar por data.
 *
 * A vigencia fica para quem chama avaliar com a data certa: o formulario de
 * reserva usa a data do evento, que pode ser daqui a dois meses, e nao a de
 * hoje. A lista pode ter varias promocoes do mesmo produto, uma por periodo:
 * e a data do evento, e nao a ordem de cadastro, que decide qual vale.
 */
export async function promocoesAtivasPorProduto(): Promise<Map<number, Promocao[]>> {
  const linhas = await all<any>(`${SELECT} WHERE pr.active = 1 ORDER BY pr.id`);
  if (linhas.length === 0) return new Map();
  const faixas = await all<any>(
    `SELECT * FROM promotion_tiers WHERE promotion_id IN (${linhas.map(() => "?").join(",")}) ORDER BY min_qty`,
    linhas.map((l) => l.id),
  );
  return porProdutoTodas(montar(linhas, faixas).values());
}

/**
 * Preco unitario que o sistema sugere para uma linha, ja considerando promocao.
 * Mesma regra usada pelo formulario; existe para quem precisar do preco no
 * servidor sem passar pela tela.
 */
export async function precoSugerido(productId: number, qty: number, dataISO: string) {
  const [produto] = await all<any>(`SELECT rent_price_cents FROM products WHERE id = ?`, [productId]);
  const vigentes = await promocoesVigentes(dataISO);
  // vigentes.get() traz todas as promocoes do produto que valem nesta data;
  // precoUnitario escolhe entre elas a que cobre a quantidade.
  return precoUnitario(produto?.rent_price_cents ?? 0, vigentes.get(productId), qty, dataISO);
}
