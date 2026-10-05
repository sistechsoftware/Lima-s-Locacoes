/**
 * Estrutura do menu de navegacao.
 *
 * A barra inferior do celular tem um invariante visual (4 itens + botao "Mais"
 * em uma unica linha, grid-cols-5 no Shell) e combinacoes de itens acordadas
 * com a operacao: Agenda direto na barra, Mensagens fora dela (acesso pelo
 * botao flutuante +, sino do topo e "Mais"). Estes testes travam isso.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EXTRA_NAV, MOBILE_NAV, NAV, NAV_GRUPOS, gruposVisiveis, visiveis } from "../src/lib/nav";

describe("estrutura do menu", () => {
  it("barra inferior tem exatamente 4 itens diretos (5o espaco e o Mais)", () => {
    assert.equal(MOBILE_NAV.length, 4);
  });

  it("itens da barra inferior sao os acordados com a operacao", () => {
    assert.deepEqual(
      MOBILE_NAV.map((n) => n.href),
      ["/dashboard", "/agenda", "/reservas", "/operacao"],
    );
  });

  it("Mensagens fica fora da barra inferior, mas continua no menu lateral", () => {
    assert.equal(MOBILE_NAV.some((n) => n.href === "/chat"), false);
    const chat = NAV.find((n) => n.href === "/chat");
    assert.ok(chat, "Mensagens precisa continuar no menu lateral (desktop)");
  });

  it("menu Mais contem tudo que nao esta na barra, sem duplicar entradas", () => {
    assert.equal(EXTRA_NAV.some((n) => n.href === "/chat"), true);
    const hrefs = EXTRA_NAV.map((n) => n.href);
    assert.equal(new Set(hrefs).size, hrefs.length, "hrefs duplicados no EXTRA_NAV");
    for (const n of MOBILE_NAV) {
      assert.equal(hrefs.includes(n.href), false, `${n.href} nao pode aparecer na barra e no Mais`);
    }
  });
});

/**
 * adminOnly precisa ser APLICADO em toda surface da navegacao.
 * Registrado na auditoria: a flag existia em nav.ts mas nenhum componente
 * filtrava por ela — "Diario de erros" aparecia para operador em todos os
 * modos (classico, agrupado, barra inferior e sheets "Mais").
 */
describe("adminOnly aplicado na navegacao", () => {
  const semAdmin = (hrefs: string[]) => hrefs.filter((h) => h === "/erros");

  it("somente admin ve o item no menu classico e no Mais", () => {
    assert.equal(visiveis(NAV, true).some((n) => n.href === "/erros"), true);
    assert.equal(visiveis(EXTRA_NAV, true).some((n) => n.href === "/erros"), true);
    assert.equal(visiveis(NAV, false).some((n) => n.href === "/erros"), false, "operador nao pode ver o item");
    assert.equal(visiveis(EXTRA_NAV, false).some((n) => n.href === "/erros"), false);
  });

  it("operador nao ve o item em nenhum grupo do modo agrupado", () => {
    const grupos = gruposVisiveis(NAV_GRUPOS, false);
    const temErros = grupos.some((g) => g.itens.some((n) => n.href === "/erros"));
    assert.equal(temErros, false);
    // e o grupo nao fica vazio nem fantasioso
    for (const g of grupos) assert.ok(g.itens.length > 0);
    assert.equal(gruposVisiveis(NAV_GRUPOS, true).some((g) => g.itens.some((n) => n.href === "/erros")), true);
  });

  it("filtra sem alterar a ordem dos demais itens", () => {
    const esperado = NAV.filter((n) => n.href !== "/erros").map((n) => n.href);
    assert.deepEqual(visiveis(NAV, false).map((n) => n.href), esperado);
  });

  it("nenhum item adminOnly escapa nos filtros de qualquer lista", () => {
    for (const lista of [NAV, EXTRA_NAV, MOBILE_NAV, ...NAV_GRUPOS.map((g) => g.itens)]) {
      const vazados = semAdmin(visiveis(lista, false).map((n) => n.href));
      assert.deepEqual(vazados, [], "item adminOnly visivel para operador");
    }
  });
});
