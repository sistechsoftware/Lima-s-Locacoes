/**
 * Regra de promocao por quantidade (funcao pura).
 *
 * Cenario base do pedido: Kit Mesa + 4 Cadeiras, preco normal R$ 20,00, com
 * faixas 1-4 = R$ 15, 5-14 = R$ 13, 15+ = R$ 10.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  conflitaCom,
  datasDePrevia,
  faixaPara,
  precoUnitario,
  promocaoVencedora,
  rotuloFaixa,
  temErro,
  validarFaixas,
  vigente,
  type Faixa,
  type Promocao,
} from "../src/lib/promocoes.ts";

const NORMAL = 2000;

const FAIXAS: Faixa[] = [
  { min_qty: 1, max_qty: 4, unit_price_cents: 1500 },
  { min_qty: 5, max_qty: 14, unit_price_cents: 1300 },
  { min_qty: 15, max_qty: null, unit_price_cents: 1000 },
];

const promo = (extra: Partial<Promocao> = {}): Promocao => ({
  id: 1,
  product_id: 7,
  active: true,
  starts_on: null,
  ends_on: null,
  tiers: FAIXAS,
  ...extra,
});

const preco = (qty: number, p: Promocao | Promocao[] | null = promo(), data = "2026-09-10") =>
  precoUnitario(NORMAL, p, qty, data);

const total = (qty: number, p: Promocao | Promocao[] | null = promo(), data = "2026-09-10") =>
  qty * preco(qty, p, data).unit_price_cents;

describe("preco da faixa vale para toda a quantidade", () => {
  it("os exemplos do pedido batem", () => {
    assert.equal(total(3), 4500, "3 x R$ 15 = R$ 45");
    assert.equal(total(5), 6500, "5 x R$ 13 = R$ 65");
    assert.equal(total(10), 13000, "10 x R$ 13 = R$ 130");
    assert.equal(total(15), 15000, "15 x R$ 10 = R$ 150");
    assert.equal(total(20), 20000, "20 x R$ 10 = R$ 200");
  });

  it("nunca calcula por faixas acumulativas", () => {
    const progressivo = 4 * 1500 + 10 * 1300 + 1 * 1000;
    assert.notEqual(total(15), progressivo);
    assert.equal(total(15), 15 * 1000);
  });
});

describe("limites das faixas", () => {
  it("quantidade 1 cai na primeira faixa", () => {
    assert.equal(preco(1).unit_price_cents, 1500);
  });

  it("limite inferior e superior de cada faixa", () => {
    assert.equal(preco(4).unit_price_cents, 1500, "fim da primeira");
    assert.equal(preco(5).unit_price_cents, 1300, "inicio da segunda");
    assert.equal(preco(14).unit_price_cents, 1300, "fim da segunda");
    assert.equal(preco(15).unit_price_cents, 1000, "inicio da terceira");
  });

  it("faixa sem teto vale para qualquer quantidade acima", () => {
    for (const q of [15, 20, 50, 100, 5000]) {
      assert.equal(preco(q).unit_price_cents, 1000, `${q} unidades`);
    }
  });

  it("quantidade zero ou negativa nao tem faixa", () => {
    assert.equal(faixaPara(FAIXAS, 0), null);
    assert.equal(faixaPara(FAIXAS, -3), null);
  });
});

describe("quando nao ha promocao", () => {
  it("produto sem promocao usa o preco normal", () => {
    const r = preco(15, null);
    assert.equal(r.unit_price_cents, NORMAL);
    assert.equal(r.promocional, false);
  });

  it("promocao desativada usa o preco normal", () => {
    const r = preco(15, promo({ active: false }));
    assert.equal(r.unit_price_cents, NORMAL);
    assert.equal(r.promocional, false);
  });

  it("quantidade fora de todas as faixas usa o preco normal", () => {
    const comLacuna = promo({ tiers: [{ min_qty: 10, max_qty: 20, unit_price_cents: 1000 }] });
    assert.equal(preco(5, comLacuna).unit_price_cents, NORMAL);
    assert.equal(preco(10, comLacuna).unit_price_cents, 1000);
  });
});

describe("vigencia pela data do evento", () => {
  const comPeriodo = promo({ starts_on: "2026-09-01", ends_on: "2026-09-30" });

  it("as bordas do periodo contam", () => {
    assert.ok(vigente(comPeriodo, "2026-09-01"), "primeiro dia vale");
    assert.ok(vigente(comPeriodo, "2026-09-30"), "ultimo dia vale");
  });

  it("um dia antes e um dia depois nao valem", () => {
    assert.ok(!vigente(comPeriodo, "2026-08-31"), "um dia antes do inicio");
    assert.ok(!vigente(comPeriodo, "2026-10-01"), "um dia depois do fim");
    assert.equal(preco(15, comPeriodo, "2026-08-31").unit_price_cents, NORMAL);
    assert.equal(preco(15, comPeriodo, "2026-10-01").unit_price_cents, NORMAL);
  });

  it("dentro do periodo aplica a promocao", () => {
    assert.equal(preco(15, comPeriodo, "2026-09-15").unit_price_cents, 1000);
  });

  it("promocao futura vale na data do evento, mesmo ainda nao tendo chegado", () => {
    // criada hoje para um evento futuro: a data de hoje e irrelevante
    const futura = promo({ starts_on: "2026-11-01", ends_on: "2026-12-31" });
    assert.equal(preco(15, futura, "2026-10-20").unit_price_cents, NORMAL, "antes do periodo");
    assert.equal(preco(15, futura, "2026-11-05").unit_price_cents, 1000, "dentro do periodo");
  });

  it("sem periodo vale enquanto ativa", () => {
    assert.equal(preco(15, promo(), "2030-01-01").unit_price_cents, 1000);
  });

  it("aceita data com hora junto", () => {
    assert.equal(preco(15, comPeriodo, "2026-09-15T14:30").unit_price_cents, 1000);
  });
});

describe("varias promocoes do mesmo produto, uma por periodo", () => {
  const setembro = promo({ id: 1, starts_on: "2026-09-01", ends_on: "2026-09-30" });
  const outubro = promo({ id: 2, starts_on: "2026-10-01", ends_on: "2026-10-31" });
  const novDez = promo({ id: 3, starts_on: "2026-11-01", ends_on: "2026-12-31", tiers: [
    { min_qty: 1, max_qty: null, unit_price_cents: 900 },
  ] });

  it("a lista de promocoes nao descarta nenhuma: a data do evento escolhe", () => {
    const todas = [setembro, outubro, novDez];
    assert.equal(preco(15, todas, "2026-09-15").unit_price_cents, 1000, "setembro usa a de setembro");
    assert.equal(preco(15, todas, "2026-10-15").unit_price_cents, 1000, "outubro usa a de outubro");
    assert.equal(preco(15, todas, "2026-11-20").unit_price_cents, 900, "novembro usa a de nov/dez");
    assert.equal(preco(15, todas, "2026-12-10").unit_price_cents, 900, "dezembro usa a de nov/dez");
  });

  it("fora de qualquer periodo usa o preco normal", () => {
    const todas = [setembro, outubro, novDez];
    assert.equal(preco(15, todas, "2026-08-15").unit_price_cents, NORMAL, "agosto");
    assert.equal(preco(15, todas, "2027-01-15").unit_price_cents, NORMAL, "janeiro do ano seguinte");
  });

  it("promocao atravessando dois meses vale em ambos", () => {
    const longa = [promo({ starts_on: "2026-11-01", ends_on: "2026-12-31" })];
    assert.equal(preco(15, longa, "2026-11-01").unit_price_cents, 1000, "primeiro dia");
    assert.equal(preco(15, longa, "2026-11-30").unit_price_cents, 1000, "fim de novembro");
    assert.equal(preco(15, longa, "2026-12-01").unit_price_cents, 1000, "inicio de dezembro");
    assert.equal(preco(15, longa, "2026-12-31").unit_price_cents, 1000, "ultimo dia");
  });

  it("promocao sem faixa cobrindo a quantidade deixa a proxima responder", () => {
    // caso real de convivenca: faixas complementares (1-4 numa, 5+ na outra)
    const pequenas = promo({ id: 1, tiers: [{ min_qty: 1, max_qty: 4, unit_price_cents: 1500 }] });
    const grandes = promo({ id: 2, tiers: [{ min_qty: 5, max_qty: null, unit_price_cents: 1000 }] });
    const lista = [pequenas, grandes];
    assert.equal(preco(2, lista).unit_price_cents, 1500, "2 unidades caem na primeira");
    assert.equal(preco(10, lista).unit_price_cents, 1000, "10 unidades caem na segunda");
  });

  it("uma promocao unica continua funcionando como antes", () => {
    assert.equal(preco(15, outubro, "2026-10-15").unit_price_cents, 1000);
    assert.equal(preco(15, [outubro], "2026-10-15").unit_price_cents, 1000, "tambem aceita lista de uma");
  });

  it("desempate: duas valendo na mesma data, vence a primeira da lista (ordem de id)", () => {
    const a = promo({ id: 1, tiers: [{ min_qty: 1, max_qty: null, unit_price_cents: 1200 }] });
    const b = promo({ id: 2, tiers: [{ min_qty: 1, max_qty: null, unit_price_cents: 900 }] });
    assert.equal(preco(10, [a, b]).unit_price_cents, 1200, "a veio primeiro");
    assert.equal(preco(10, [b, a]).unit_price_cents, 900, "b veio primeiro");
  });
});

describe("escolha da promocao vencedora (a mesma do preco e da conferencia visual)", () => {
  const setembro = promo({ id: 1, starts_on: "2026-09-01", ends_on: "2026-09-30" });
  const novDez = promo({ id: 2, starts_on: "2026-11-01", ends_on: "2026-12-31", tiers: [
    { min_qty: 1, max_qty: null, unit_price_cents: 900 },
  ] });
  const lista = [setembro, novDez];

  it("devolve a promocao e a faixa que valem na data", () => {
    const r = promocaoVencedora(lista, 15, "2026-11-20");
    assert.equal(r?.promocao.id, 2);
    assert.equal(r?.faixa.unit_price_cents, 900);
  });

  it("null quando nenhuma vale na data", () => {
    assert.equal(promocaoVencedora(lista, 15, "2026-10-15"), null);
    assert.equal(promocaoVencedora(lista, 15, "2027-01-10"), null);
  });

  it("null com lista vazia ou ausente", () => {
    assert.equal(promocaoVencedora([], 15, "2026-09-10"), null);
    assert.equal(promocaoVencedora(null, 15, "2026-09-10"), null);
    assert.equal(promocaoVencedora(undefined, 15, "2026-09-10"), null);
  });

  it("pula a promocao sem faixa cobrindo a quantidade", () => {
    const pequenas = promo({ id: 1, tiers: [{ min_qty: 1, max_qty: 4, unit_price_cents: 1500 }] });
    const grandes = promo({ id: 2, tiers: [{ min_qty: 5, max_qty: null, unit_price_cents: 1000 }] });
    const r = promocaoVencedora([pequenas, grandes], 10, "2026-09-10");
    assert.equal(r?.promocao.id, 2, "a primeira nao cobre 10, a segunda responde");
  });

  it("precoUnitario e promocaoVencedora escolhem sempre igual", () => {
    for (const data of ["2026-09-10", "2026-10-10", "2026-12-10"]) {
      const viaPreco = precoUnitario(NORMAL, lista, 15, data);
      const viaVencedora = promocaoVencedora(lista, 15, data);
      assert.equal(viaPreco.promocional, viaVencedora !== null, data);
      if (viaVencedora) assert.equal(viaPreco.faixa, viaVencedora.faixa, data);
    }
  });
});

describe("datas de amostragem da conferencia por data", () => {
  it("seis meses seguintes, sempre no dia 15", () => {
    assert.deepEqual(datasDePrevia("2026-09-05"), [
      "2026-10-15",
      "2026-11-15",
      "2026-12-15",
      "2027-01-15",
      "2027-02-15",
      "2027-03-15",
    ]);
  });

  it("o mes da base entra fora, porque o periodo em edicao pode valer hoje", () => {
    // o dia 15 do MES ATUAL ficaria no passado quase o mes inteiro; a lista
    // comeca no mes seguinte e a tela explica que a vigencia atual vale desde ja
    assert.ok(!datasDePrevia("2026-09-05").includes("2026-09-15"));
  });

  it("respeita a quantidade pedida e ignora pedido sem sentido", () => {
    assert.equal(datasDePrevia("2026-09-05", 1).length, 1);
    assert.equal(datasDePrevia("2026-09-05", 0).length, 0);
    assert.equal(datasDePrevia("2026-09-05", -2).length, 0);
  });

  it("base invalida devolve lista vazia em vez de estourar", () => {
    assert.deepEqual(datasDePrevia(""), []);
    assert.deepEqual(datasDePrevia("lixo"), []);
    assert.deepEqual(datasDePrevia("2026-13-15"), []);
    assert.deepEqual(datasDePrevia("2026-00-15"), []);
  });
});

describe("validacao das faixas", () => {
  const erros = (f: Faixa[]) => validarFaixas(f).filter((p) => p.tipo === "erro").map((p) => p.mensagem);
  const avisos = (f: Faixa[]) => validarFaixas(f).filter((p) => p.tipo === "aviso").map((p) => p.mensagem);

  it("as faixas do pedido sao validas e sem lacuna", () => {
    assert.deepEqual(validarFaixas(FAIXAS), []);
  });

  it("recusa faixas sobrepostas", () => {
    const p = erros([
      { min_qty: 1, max_qty: 10, unit_price_cents: 1500 },
      { min_qty: 5, max_qty: 20, unit_price_cents: 1200 },
    ]);
    assert.equal(p.length, 1);
    assert.match(p[0], /sobrep/i);
    assert.match(p[0], /5/, "diz qual quantidade ficaria com dois precos");
  });

  it("recusa faixa duplicada", () => {
    assert.ok(
      temErro(
        validarFaixas([
          { min_qty: 1, max_qty: 4, unit_price_cents: 1500 },
          { min_qty: 1, max_qty: 4, unit_price_cents: 1300 },
        ]),
      ),
    );
  });

  it("recusa maxima menor que a minima", () => {
    assert.match(erros([{ min_qty: 10, max_qty: 5, unit_price_cents: 1000 }])[0], /menor que a mínima/i);
  });

  it("recusa quantidade zero ou negativa", () => {
    assert.ok(temErro(validarFaixas([{ min_qty: 0, max_qty: 5, unit_price_cents: 1000 }])));
    assert.ok(temErro(validarFaixas([{ min_qty: -1, max_qty: 5, unit_price_cents: 1000 }])));
  });

  it("recusa preco negativo", () => {
    assert.ok(temErro(validarFaixas([{ min_qty: 1, max_qty: 5, unit_price_cents: -100 }])));
  });

  it("recusa duas faixas sem limite", () => {
    assert.ok(
      temErro(
        validarFaixas([
          { min_qty: 5, max_qty: null, unit_price_cents: 1300 },
          { min_qty: 15, max_qty: null, unit_price_cents: 1000 },
        ]),
      ),
    );
  });

  it("recusa lista vazia", () => {
    assert.ok(temErro(validarFaixas([])));
  });

  it("lacuna e aviso, nao erro, e diz exatamente qual quantidade ficou de fora", () => {
    const f: Faixa[] = [
      { min_qty: 1, max_qty: 4, unit_price_cents: 1500 },
      { min_qty: 6, max_qty: 10, unit_price_cents: 1200 },
    ];
    assert.equal(erros(f).length, 0, "lacuna nao impede salvar");
    assert.match(avisos(f)[0], /quantidade 5/i);
  });

  it("avisa quando a promocao nao comeca em 1", () => {
    assert.match(avisos([{ min_qty: 5, max_qty: null, unit_price_cents: 1000 }])[0], /1 a 4/);
  });

  it("faixa colada na outra nao gera aviso de lacuna", () => {
    assert.equal(
      avisos([
        { min_qty: 1, max_qty: 4, unit_price_cents: 1500 },
        { min_qty: 5, max_qty: null, unit_price_cents: 1300 },
      ]).length,
      0,
    );
  });

  it("ordem de cadastro nao importa", () => {
    assert.deepEqual(validarFaixas([...FAIXAS].reverse()), []);
  });
});

describe("promocoes conflitantes no mesmo produto", () => {
  it("recusa duas promocoes cobrindo a mesma quantidade no mesmo periodo", () => {
    const erro = conflitaCom(
      { starts_on: null, ends_on: null, tiers: [{ min_qty: 1, max_qty: 10, unit_price_cents: 1400 }] },
      [{ id: 9, starts_on: null, ends_on: null, tiers: FAIXAS }],
    );
    assert.match(erro ?? "", /já existe outra promoção/i);
  });

  it("aceita quando os periodos nao se cruzam", () => {
    const erro = conflitaCom(
      { starts_on: "2026-10-01", ends_on: "2026-10-31", tiers: FAIXAS },
      [{ id: 9, starts_on: "2026-09-01", ends_on: "2026-09-30", tiers: FAIXAS }],
    );
    assert.equal(erro, null);
  });

  it("aceita quando as quantidades nao se cruzam", () => {
    const erro = conflitaCom(
      { starts_on: null, ends_on: null, tiers: [{ min_qty: 100, max_qty: null, unit_price_cents: 800 }] },
      [{ id: 9, starts_on: null, ends_on: null, tiers: [{ min_qty: 1, max_qty: 99, unit_price_cents: 1500 }] }],
    );
    assert.equal(erro, null);
  });

  it("pega conflito causado por faixa sem teto", () => {
    const erro = conflitaCom(
      { starts_on: null, ends_on: null, tiers: [{ min_qty: 500, max_qty: 600, unit_price_cents: 700 }] },
      [{ id: 9, starts_on: null, ends_on: null, tiers: [{ min_qty: 15, max_qty: null, unit_price_cents: 1000 }] }],
    );
    assert.match(erro ?? "", /já existe outra promoção/i);
  });
});

describe("rotulo da faixa", () => {
  it("descreve a faixa do jeito que o operador le", () => {
    assert.equal(rotuloFaixa({ min_qty: 15, max_qty: null, unit_price_cents: 1000 }), "15+ unidades");
    assert.equal(rotuloFaixa({ min_qty: 5, max_qty: 14, unit_price_cents: 1300 }), "5 a 14 unidades");
  });
});
