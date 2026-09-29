/**
 * Regras da janela evento → entrega → retirada (Novo Orçamento e Nova Reserva).
 * Data e horário ficam separados no estado; carimboDe compõe o valor do servidor.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { carimboDe, dateOf, dividirCarimbo, janelaInicial, pickupDateFor, proximaJanela, timeOf } from "../src/lib/event-window";
import { stamp } from "../src/lib/stock";

const janela = (eventDate = "", deliveryDate = "", deliveryTime = "", pickupDate = "", pickupTime = "") => ({
  eventDate,
  deliveryDate,
  deliveryTime,
  pickupDate,
  pickupTime,
});

describe("helpers de carimbo", () => {
  it("separa data e hora sem depender de fuso", () => {
    assert.equal(dateOf("2026-09-29T10:00"), "2026-09-29");
    assert.equal(timeOf("2026-09-29T10:00"), "10:00");
    assert.equal(timeOf("2026-09-29"), "");
    assert.equal(dateOf(""), "");
  });

  it("dividirCarimbo quebra o valor salvo no banco", () => {
    assert.deepEqual(dividirCarimbo("2026-09-29T10:00"), { data: "2026-09-29", hora: "10:00" });
    assert.deepEqual(dividirCarimbo("2026-09-29"), { data: "2026-09-29", hora: "" });
    assert.deepEqual(dividirCarimbo(""), { data: "", hora: "" });
  });

  it("carimboDe compõe o valor para o servidor", () => {
    assert.equal(carimboDe("2026-09-29", "10:00"), "2026-09-29T10:00");
    assert.equal(carimboDe("2026-09-29", ""), "2026-09-29"); // data sem hora
    assert.equal(carimboDe("", "10:00"), "");
    assert.equal(carimboDe("2026-09-29", "1"), "2026-09-29"); // hora invalida vira so data
  });
});

describe("janelaInicial (edição de registros existentes)", () => {
  it("reconstrói os cinco campos a partir do que veio do banco", () => {
    assert.deepEqual(
      janelaInicial("2026-09-29", "2026-09-29T10:00", "2026-09-30T10:00"),
      janela("2026-09-29", "2026-09-29", "10:00", "2026-09-30", "10:00"),
    );
  });
});

describe("data do evento", () => {
  it("preenche as duas datas automaticamente, horários ficam vazios", () => {
    const r = proximaJanela(janela(), "eventDate", "2026-09-29");
    assert.deepEqual(r, janela("2026-09-29", "2026-09-29", "", "2026-09-30", ""));
  });

  it("evento vazio ou incompleto não calcula nada", () => {
    assert.deepEqual(proximaJanela(janela(), "eventDate", ""), janela(""));
    assert.deepEqual(proximaJanela(janela(), "eventDate", "2026-09"), janela("2026-09"));
  });

  it("alterar a data do evento depois move as duas datas e preserva horários", () => {
    const r = proximaJanela(janela("2026-09-29", "2026-09-29", "10:00", "2026-09-30", "10:00"), "eventDate", "2026-10-05");
    assert.deepEqual(r, janela("2026-10-05", "2026-10-05", "10:00", "2026-10-06", "10:00"));
  });

  it("virada de mês com dia 31 não pula dois dias", () => {
    const r = proximaJanela(janela(), "eventDate", "2026-08-31");
    assert.equal(r.pickupDate, "2026-09-01");
  });

  it("ano novo cai no ano seguinte, sem deslize de UTC", () => {
    const r = proximaJanela(janela(), "eventDate", "2026-12-31");
    assert.equal(r.pickupDate, "2027-01-01");
  });
});

describe("horário da entrega", () => {
  it("espelha o horário na retirada mantendo a data dela", () => {
    const r = proximaJanela(janela("2026-09-29", "2026-09-29", "", "2026-09-30", ""), "deliveryTime", "10:00");
    assert.deepEqual(r, janela("2026-09-29", "2026-09-29", "10:00", "2026-09-30", "10:00"));
  });

  it("alterar o horário da entrega atualiza a retirada (10:00 → 14:00)", () => {
    const r = proximaJanela(janela("2026-10-05", "2026-10-05", "10:00", "2026-10-06", "10:00"), "deliveryTime", "14:00");
    assert.deepEqual(r, janela("2026-10-05", "2026-10-05", "14:00", "2026-10-06", "14:00"));
  });

  it("horário da entrega vazio não preenche horário nenhum", () => {
    assert.deepEqual(proximaJanela(janela("2026-09-29", "2026-09-29", "", "2026-09-30", ""), "deliveryTime", ""), janela("2026-09-29", "2026-09-29", "", "2026-09-30", ""));
  });

  it("retirada sem data ganha o dia seguinte ao evento junto com a hora", () => {
    const r = proximaJanela(janela("2026-09-29", "2026-09-29", "", "", ""), "deliveryTime", "10:00");
    assert.deepEqual(r, janela("2026-09-29", "2026-09-29", "10:00", "2026-09-30", "10:00"));
  });
});

describe("editar retirada manualmente não dispara automatização", () => {
  it("mudar só a data da retirada deixa o resto intocado", () => {
    const antes = janela("2026-09-29", "2026-09-29", "10:00", "2026-09-30", "10:00");
    const r = proximaJanela(antes, "pickupDate", "2026-10-02");
    assert.deepEqual(r, { ...antes, pickupDate: "2026-10-02" });
  });

  it("mudar só o horário da retirada não mexe na entrega", () => {
    const antes = janela("2026-09-29", "2026-09-29", "10:00", "2026-09-30", "10:00");
    const r = proximaJanela(antes, "pickupTime", "16:00");
    assert.deepEqual(r, { ...antes, pickupTime: "16:00" });
  });
});

describe("caminho do exemplo do usuário (29/09 → 05/10, 10:00 → 14:00)", () => {
  it("reproduz a sequência completa", () => {
    let s = janela();
    s = proximaJanela(s, "eventDate", "2026-09-29");
    assert.deepEqual(s, janela("2026-09-29", "2026-09-29", "", "2026-09-30", ""));
    s = proximaJanela(s, "deliveryTime", "10:00");
    assert.deepEqual(s, janela("2026-09-29", "2026-09-29", "10:00", "2026-09-30", "10:00"));
    s = proximaJanela(s, "eventDate", "2026-10-05");
    assert.deepEqual(s, janela("2026-10-05", "2026-10-05", "10:00", "2026-10-06", "10:00"));
    s = proximaJanela(s, "deliveryTime", "14:00");
    assert.deepEqual(s, janela("2026-10-05", "2026-10-05", "14:00", "2026-10-06", "14:00"));
  });
});

describe("compatibilidade com o servidor", () => {
  it("carimbo apenas-data é normalizado pelo stamp do servidor", () => {
    assert.equal(stamp("2026-09-29", "08:00"), "2026-09-29T08:00");
  });

  it("pickupDateFor usa o addDays de calendário já testado contra fuso", () => {
    assert.equal(pickupDateFor("2026-07-15"), "2026-07-16");
  });
});
