/**
 * Geracao automatica do codigo do produto.
 *
 * O cadastro real usa codigos digitados livremente (MESA, CAD, PULA, KIT-MC4).
 * O gerador procura uma familia PREFIXO+NUMERO nos codigos existentes e sugere
 * o proximo numero livre; sem familia, usa PROD-001 no formato das demais
 * numeracoes do sistema (LIMA-001, FRT-001...).
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createTestDb } from "./helpers/d1.ts";
import { all, insert, one, run, scalar } from "../src/lib/db.ts";
import {
  analisarPadraoCodigos,
  formatarCodigo,
  gerarCodigoProduto,
  inserirProdutoComCodigoGerado,
} from "../src/lib/products.ts";
import { rebuildReservationComponents } from "../src/lib/stock.ts";
import { recalcReservation } from "../src/lib/reservations.ts";

/** Cenario base igual ao seed de demonstracao do sistema. */
async function cenarioSeed() {
  createTestDb();
  await insert(`INSERT INTO categories (name) VALUES ('Mesas'), ('Cadeiras'), ('Outros')`);
  const cat = async (n: string) => await scalar<number>(`SELECT id FROM categories WHERE name = ?`, [n]);
  await insert(`INSERT INTO products (code, name, kind, category_id, total_qty) VALUES ('MESA','Mesa plastica','simples',?,50)`, [await cat("Mesas")]);
  await insert(`INSERT INTO products (code, name, kind, category_id, total_qty) VALUES ('CAD','Cadeira plastica','simples',?,200)`, [await cat("Cadeiras")]);
  await insert(`INSERT INTO products (code, name, kind, category_id, total_qty) VALUES ('FRM','Forro de mesa','simples',?,50)`, [await cat("Mesas")]);
  await insert(`INSERT INTO products (code, name, kind, category_id, total_qty) VALUES ('PULA','Pula-pula','simples',?,1)`, [await cat("Outros")]);
  await insert(`INSERT INTO products (code, name, kind, category_id, total_qty) VALUES ('PISC','Piscina de bolinhas','simples',?,1)`, [await cat("Outros")]);
  await insert(`INSERT INTO products (code, name, kind, category_id) VALUES ('KIT-MC4','Kit Mesa + 4 Cadeiras','kit',?)`, [await cat("Outros")]);
}

/** Cenario com uma familia numerica ja em uso pelos usuarios. */
async function cenarioFamilia(codes: string[], inativos: string[] = []) {
  createTestDb();
  for (const code of codes) {
    await insert(`INSERT INTO products (code, name, kind, total_qty) VALUES (?,?,'simples',10)`, [code, "Produto " + code]);
  }
  for (const code of inativos) {
    await insert(`INSERT INTO products (code, name, kind, total_qty, active) VALUES (?,?,'simples',10,0)`, [code, "Produto " + code]);
  }
}

const codigoDe = async (id: number) => (await one<any>(`SELECT code FROM products WHERE id = ?`, [id]))!.code;

const dadosProduto = (overrides: Partial<Parameters<typeof inserirProdutoComCodigoGerado>[0]> = {}) => ({
  name: "Tenda 3x3",
  category_id: null,
  kind: "simples" as const,
  total_qty: 10,
  min_qty: 1,
  rent_price_cents: 8000,
  replace_cents: 90000,
  description: "",
  photo: "",
  ...overrides,
});

/* -------------------------- padrao dos codigos (puro) -------------------------- */

describe("anatomia do padrao de codigos", () => {
  it("nao inventa padrao quando os codigos nao tem sequencia numerica (base real do seed)", () => {
    assert.equal(analisarPadraoCodigos(["MESA", "CAD", "FRM", "FRC", "PULA", "PISC", "KIT-MC4"]), null);
  });

  it("identifica familia MES001 / CAD001 / BRI001 e segue a mais usada", () => {
    const p = analisarPadraoCodigos(["MES001", "MES002", "CAD001", "CAD002", "BRI001"])!;
    assert.equal(p.prefixo, "MES");
    assert.equal(p.hifen, false);
    assert.equal(p.proximoNumero, 3);
    assert.equal(formatarCodigo(p, p.proximoNumero), "MES003");
  });

  it("identifica familia com hifen no formato LIMA-001", () => {
    const p = analisarPadraoCodigos(["P-001", "P-002"])!;
    assert.equal(p.prefixo, "P");
    assert.equal(p.hifen, true);
    assert.equal(formatarCodigo(p, p.proximoNumero), "P-003");
  });

  it("empate de familias: o maior numero define", () => {
    const p = analisarPadraoCodigos(["CAD001", "MES001", "MES002"])!;
    assert.equal(formatarCodigo(p, p.proximoNumero), "MES003");
  });

  it("codigo antigo fora do padrao nao quebra a familia", () => {
    const p = analisarPadraoCodigos(["MESA", "MES001", "MES002", "mes003"])!;
    assert.equal(formatarCodigo(p, p.proximoNumero), "MES004");
  });
});

/* --------------------------- geracao no banco real ----------------------------- */

describe("geracao automatica do codigo", () => {
  beforeEach(cenarioSeed);

  it("Teste 1 e 2 - produto novo recebe codigo gerado no cadastro", async () => {
    const { id, code } = await inserirProdutoComCodigoGerado(dadosProduto());
    assert.equal(code, "PROD-001");
    assert.equal(await codigoDe(id), "PROD-001");
  });

  it("Teste 3 - cadastros consecutivos seguem a sequencia", async () => {
    const um = await inserirProdutoComCodigoGerado(dadosProduto({ name: "Um" }));
    const dois = await inserirProdutoComCodigoGerado(dadosProduto({ name: "Dois" }));
    const tres = await inserirProdutoComCodigoGerado(dadosProduto({ name: "Tres" }));
    assert.deepEqual(
      [await codigoDe(um.id), await codigoDe(dois.id), await codigoDe(tres.id)],
      ["PROD-001", "PROD-002", "PROD-003"],
    );
  });

  it("segue a familia numerica existente em vez de criar um padrao novo", async () => {
    await cenarioFamilia(["MESA", "MES001", "MES002", "CAD001"]);
    assert.equal(await gerarCodigoProduto(), "MES003");
  });

  it("Teste 4 - lacunas sao ignoradas sem risco de colisao; a sequencia segue do maior numero", async () => {
    await cenarioFamilia(["MES001", "MES003", "MES007"]);
    // MES002 e MES004/005/006 ficaram livres com exclusoes/importacoes antigas;
    // a geracao segue depois do maior numero e nunca colide com uma lacuna
    assert.equal(await gerarCodigoProduto(), "MES008");

    await insert(`INSERT INTO products (code, name, kind) VALUES ('MES008','Ocupada agora','simples')`);
    // com o maior numero ocupado, a geracao avanca para o seguinte
    assert.equal(await gerarCodigoProduto(), "MES009");
  });

  it("Teste 6 - codigo ja existente nunca e gerado (inclusive produto inativo)", async () => {
    await cenarioFamilia(["MES001"], ["MES002"]);
    const code = await gerarCodigoProduto();
    assert.equal(code, "MES003");
    assert.equal(await scalar<number>(`SELECT COUNT(*) FROM products WHERE code = ?`, [code]), 0);
  });

  it("PROD-001 criado manualmente no passado nao gera duplicado", async () => {
    await cenarioFamilia(["MESA", "PROD-001"]);
    assert.equal(await gerarCodigoProduto(), "PROD-002");
  });

  it("Teste 7 - colisao simulada: outro cadastro toma o codigo entre a geracao e o INSERT", async () => {
    const real = createTestDb();
    let interceptou = false;
    const d1 = {
      prepare(sql: string) {
        const stmt = real.prepare(sql);
        if (!interceptou && /INSERT INTO products/.test(sql)) {
          interceptou = true;
          // a outra requisicao gravou o mesmo codigo no intervalo
          real.sqlite.exec(`INSERT INTO products (code, name, kind) VALUES ('PROD-001','Cadastrado em outra aba','simples')`);
        }
        return stmt;
      },
      batch: real.batch.bind(real),
      exec: real.exec.bind(real),
    };
    (globalThis as any).__limasTestDb = d1;

    const { code } = await inserirProdutoComCodigoGerado(dadosProduto({ name: "Produto concorrente" }));

    // o INSERT perdedor bateu no UNIQUE, o codigo foi gerado de novo e gravou
    assert.equal(code, "PROD-002");
    assert.equal(await scalar<number>(`SELECT COUNT(*) FROM products`), 2);
    assert.equal(
      await scalar<number>(`SELECT COUNT(DISTINCT code) FROM products`),
      2,
      "nenhum codigo duplicado no banco",
    );
  });

  it("Teste 12 - produto criado nao altera nenhum codigo existente", async () => {
    const antes = (await all<{ code: string }>(`SELECT code FROM products ORDER BY id`)).map((r) => r.code);
    await inserirProdutoComCodigoGerado(dadosProduto({ name: "Novo" }));
    const depois = (await all<{ code: string }>(`SELECT code FROM products WHERE code <> 'PROD-001' ORDER BY id`)).map((r) => r.code);
    assert.deepEqual(depois, antes);
  });
});

/* ---------------- edicao, reserva, estoque e exclusao com o codigo ------------- */

describe("codigo gerado no dia a dia do sistema", () => {
  let produtoId = 0;
  let clienteId = 0;
  let codigo = "";

  beforeEach(async () => {
    await cenarioSeed();
    ({ id: produtoId, code: codigo } = await inserirProdutoComCodigoGerado(dadosProduto()));
    clienteId = await insert(`INSERT INTO customers (name) VALUES ('Cliente Teste')`);
  });

  it("Teste 8 - edicao do produto preserva o codigo", async () => {
    // mesma gravacao que updateProduct faz: o codigo vem do banco, nunca do formulario
    const current = await one<any>(`SELECT * FROM products WHERE id = ?`, [produtoId]);
    await run(
      `UPDATE products SET code=?, name=?, category_id=?, kind=?, total_qty=?, min_qty=?, rent_price_cents=?, replace_cents=?,
              description=?, photo=? WHERE id = ?`,
      [
        current.code,
        "Tenda 4x4 renomeada",
        current.category_id,
        current.kind,
        12,
        current.min_qty,
        current.rent_price_cents,
        current.replace_cents,
        current.description,
        current.photo,
        produtoId,
      ],
    );
    assert.equal(await codigoDe(produtoId), "PROD-001");
  });

  it("Teste 9 - reserva usando o produto novo funciona e nao altera codigos", async () => {
    const antes = (await all<{ code: string }>(`SELECT code FROM products ORDER BY id`)).map((r) => r.code);
    const resId = await insert(
      `INSERT INTO reservations (number, customer_id, status, event_date, delivery_at, pickup_at)
       VALUES (?,?,?,?,?,?)`,
      ["LIMA-901", clienteId, "confirmada", "2026-10-10", "2026-10-10T08:00", "2026-10-11T10:00"],
    );
    await insert(`INSERT INTO reservation_items (reservation_id, product_id, qty, unit_price_cents) VALUES (?,?,?,?)`, [
      resId,
      produtoId,
      4,
      8000,
    ]);
    await rebuildReservationComponents(resId);
    await recalcReservation(resId);
    const item = await one<any>(
      `SELECT i.qty, p.code FROM reservation_items i JOIN products p ON p.id = i.product_id WHERE i.reservation_id = ?`,
      [resId],
    );
    assert.equal(item.qty, 4);
    assert.equal(item.code, "PROD-001");
    const depois = (await all<{ code: string }>(`SELECT code FROM products ORDER BY id`)).map((r) => r.code);
    assert.deepEqual(depois, antes, "nenhum codigo mudou com a reserva");
  });

  it("Teste 10 - movimentacao de estoque do produto novo e unidades MESA-001", async () => {
    // entrada de estoque como faz syncPurchaseStock
    await insert(
      `INSERT INTO stock_movements (product_id, qty_delta, reason) VALUES (?,?,?)`,
      [produtoId, 5, "compra"],
    );
    await run(`UPDATE products SET total_qty = total_qty + 5 WHERE id = ?`, [produtoId]);
    // unidades individuais usam o codigo como prefixo, como em addUnits
    await insert(`INSERT INTO product_units (product_id, code) VALUES (?,?)`, [produtoId, `${codigo}-001`]);
    const p = await one<any>(`SELECT code, total_qty FROM products WHERE id = ?`, [produtoId]);
    assert.equal(p.total_qty, 15);
    assert.equal(p.code, "PROD-001");
    assert.equal(await scalar<number>(`SELECT COUNT(*) FROM product_units WHERE code = ?`, ["PROD-001-001"]), 1);
  });

  it("Teste 11 - exclusao do produto nao renumera os demais", async () => {
    // cria dois com a familia e exclui o primeiro
    const a = await inserirProdutoComCodigoGerado(dadosProduto({ name: "A" }));
    const b = await inserirProdutoComCodigoGerado(dadosProduto({ name: "B" }));
    assert.equal(await codigoDe(a.id), "PROD-002");
    assert.equal(await codigoDe(b.id), "PROD-003");
    await run(`DELETE FROM product_units WHERE product_id = ?`, [a.id]);
    await run(`DELETE FROM products WHERE id = ?`, [a.id]);
    const restantes = (await all<{ code: string }>(`SELECT code FROM products ORDER BY id`)).map((r) => r.code);
    assert.ok(restantes.includes("PROD-003"), "o codigo dos demais nao foi renumerado");
    assert.equal(await gerarCodigoProduto(), "PROD-004", "o proximo cadastro nao reutiliza o codigo excluido");
  });
});
