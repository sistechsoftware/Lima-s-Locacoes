/**
 * Opcoes de rota da calculadora de frete (base → destino → base).
 *
 * Cobre: rota unica, multiplas rotas, endereco invalido, erro da API,
 * frete comum e de locacao, troca de rota, fallback manual e a garantia
 * de que a distancia NAO e multiplicada pela nova funcionalidade.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { calculateRouteOptions, calculatorAddresses, roadRouteOptions, RouteError, type MapServices, type Place } from "../src/lib/routes";
import { freightConfig, priceRoadDistance } from "../src/lib/freight-config";
import { calcularFrete } from "../src/lib/freight";

const settings = {
  freight_consumption: "10", freight_fuel_price_cents: "500", freight_cost_per_km_cents: "50",
  freight_margin_percent: "30", freight_minimum_cents: "0", freight_rounding_cents: "0",
  freight_labor_cents: "0", freight_comum_base_address: "Rua da Base 10, Sao Paulo, SP",
  freight_locacao_base_address: "Rua da Locacao 20, Santos, SP",
};
const common = freightConfig(settings, "comum");
const rental = freightConfig(settings, "locacao");

const ponto = (lat: number, lon: number): Place => ({ label: "Ponto", lat, lon });

/** Mock enxuto: geocode devolve pontos distintos; rotas sao injetadas por teste. */
const servicos = (rotas: number[][]): MapServices => ({
  geocode: async (address) => ({ label: address, lat: address.includes("Base") ? 1 : 2, lon: address.includes("Base") ? 1 : 2 }),
  route: async () => rotas[0] ?? [],
  routeOptions: async () => rotas.map((legs) => ({ index: 0, totalKm: legs.reduce((a, b) => a + b, 0), durationMin: 18 })),
});

describe("endereços da calculadora", () => {
  it("usa sempre base → destino (ida simples), sem trecho de coleta nem volta", () => {
    assert.deepEqual(calculatorAddresses(rental.baseAddress, "Rua do Evento 40, Santos, SP"), [
      rental.baseAddress, "Rua do Evento 40, Santos, SP",
    ]);
  });

  it("exige endereço base cadastrado", () => {
    assert.throws(() => calculatorAddresses("", "Rua do Evento 40, Santos, SP"), /base/);
  });

  it("rejeita destino vazio ou curto demais", () => {
    assert.throws(() => calculatorAddresses(rental.baseAddress, ""), /destino/i);
    assert.throws(() => calculatorAddresses(rental.baseAddress, "Rua 1"), /completo/);
  });
});

describe("opções de rota", () => {
  it("rota única volta com uma opção e a distância é a ida direta", async () => {
    const opcoes = await calculateRouteOptions(rental, "Rua do Evento 40, Santos, SP", servicos([[8.4]]));
    assert.equal(opcoes.length, 1);
    assert.equal(opcoes[0].totalKm, 8.4);
  });

  it("múltiplas rotas chegam com distâncias e duração", async () => {
    const opcoes = await calculateRouteOptions(rental, "Rua do Evento 40, Santos, SP", servicos([[8.4], [9.1], [10.2]]));
    assert.equal(opcoes.length, 3);
    assert.deepEqual(opcoes.map(o => o.totalKm), [8.4, 9.1, 10.2]);
    assert.ok(opcoes.every(o => o.durationMin === 18));
  });

  it("sem rota possível gera erro claro", async () => {
    await assert.rejects(
      () => calculateRouteOptions(rental, "Rua do Evento 40, Santos, SP", servicos([])),
      /Nenhuma rota/,
    );
  });

  it("rota com trecho inválido é descartada no OSRM", async () => {
    const rotas = await roadRouteOptions(
      [ponto(1, 1), ponto(2, 2)],
      "https://routing.test",
      async () => Response.json({
        code: "Ok",
        routes: [
          { duration: 1080, legs: [{ distance: 8400 }] },
          { duration: 900, legs: [{ distance: NaN }] },
          { duration: 1200, legs: [] }, // sem trechos
        ],
      }),
    );
    assert.equal(rotas.length, 1);
    assert.equal(rotas[0].totalKm, 8.4);
    assert.equal(rotas[0].durationMin, 18);
  });

  it("OSRM sem rota (NoRoute) gera erro amigável", async () => {
    await assert.rejects(
      () => roadRouteOptions([ponto(1, 1), ponto(2, 2)], "https://routing.test", async () => Response.json({ code: "NoRoute" })),
      /Nenhuma rota/,
    );
  });
});

describe("integração com a fórmula existente (nada é duplicado)", () => {
  it("o valor da calculadora usa a fórmula de sempre com a ida da rota", async () => {
    const opcoes = await calculateRouteOptions(rental, "Rua do Evento 40, Santos, SP", servicos([[8.4]]));
    const ida = opcoes[0].totalKm; // o cliente preenche o valor direto no campo
    const manual = calcularFrete({
      tipo: "locacao", distanciaIdaKm: ida, consumoKmPorLitro: rental.consumption,
      precoLitroCents: rental.fuelPriceCents, custoPorKmCents: rental.costPerKmCents,
      pedagioCents: 0, maoDeObraCents: rental.laborCents, margemPercent: rental.marginPercent,
      valorMinimoCents: rental.minimumCents, arredondamentoCents: rental.roundingCents,
    });
    assert.equal(manual.distanciaIdaKm, 8.4);
    assert.equal(manual.distanciaTotalKm, 33.6); // 4 viagens da locação, pela fórmula existente
    assert.equal(manual.valorSugeridoCents, priceRoadDistance(opcoes[0].totalKm * 4, "locacao", rental).valorSugeridoCents);
  });

  it("frete comum e locação diferem só pelas viagens da fórmula", async () => {
    const opcoes = await calculateRouteOptions(common, "Rua de Destino 30, Santos, SP", servicos([[10]]));
    const ida = opcoes[0].totalKm; // 10 km de ida
    const comum = calcularFrete({ tipo: "comum", distanciaIdaKm: ida, consumoKmPorLitro: 10, precoLitroCents: 500, custoPorKmCents: 50, pedagioCents: 0, maoDeObraCents: 0, margemPercent: 30, valorMinimoCents: 0, arredondamentoCents: 0 });
    const locacao = calcularFrete({ tipo: "locacao", distanciaIdaKm: ida, consumoKmPorLitro: 10, precoLitroCents: 500, custoPorKmCents: 50, pedagioCents: 0, maoDeObraCents: 0, margemPercent: 30, valorMinimoCents: 0, arredondamentoCents: 0 });
    assert.equal(comum.distanciaTotalKm, 20);
    assert.equal(locacao.distanciaTotalKm, 40);
    assert.equal(locacao.distanciaTotalKm, comum.distanciaTotalKm * 2);
  });

  it("fallback manual: a ida digitada não passa pela API nem por priceRoadDistance", () => {
    const manual = calcularFrete({
      tipo: "locacao", distanciaIdaKm: 15, consumoKmPorLitro: 10, precoLitroCents: 500,
      custoPorKmCents: 50, pedagioCents: 0, maoDeObraCents: 0, margemPercent: 30,
      valorMinimoCents: 0, arredondamentoCents: 0,
    });
    assert.equal(manual.distanciaIdaKm, 15);
    assert.equal(manual.distanciaTotalKm, 60);
  });

  it("a ida da rota não chega multiplicada na calculadora", async () => {
    const opcoes = await calculateRouteOptions(rental, "Rua do Evento 40, Santos, SP", servicos([[10]]));
    assert.equal(opcoes[0].totalKm, 10); // a API devolve exatamente a ida
    assert.equal(calcularFrete({ tipo: "locacao", distanciaIdaKm: opcoes[0].totalKm, consumoKmPorLitro: 10, precoLitroCents: 500, custoPorKmCents: 50, pedagioCents: 0, maoDeObraCents: 0, margemPercent: 0, valorMinimoCents: 0, arredondamentoCents: 0 }).distanciaTotalKm, 40);
  });
});

describe("erros amigáveis", () => {
  it("RouteError carrega mensagem de usuário, sem stack exposta", async () => {
    try {
      await calculateRouteOptions(rental, "", servicos([[1]]));
      assert.fail("deveria ter falhado");
    } catch (error) {
      assert.ok(error instanceof RouteError);
      assert.match(error.message, /destino|endereço/i);
    }
  });

  it("falha de rede no serviço de rotas vira RouteError 503", async () => {
    await assert.rejects(
      () => roadRouteOptions([ponto(1, 1), ponto(2, 2)], "https://routing.test", async () => { throw new Error("offline"); }),
      (erro: unknown) => erro instanceof RouteError && erro.status === 503,
    );
  });
});
