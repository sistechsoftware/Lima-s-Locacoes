"use client";
/**
 * Estado central da janela evento → entrega → retirada para os formulários.
 *
 * Devolve os cinco campos (data/horário do evento, entrega e retirada) mais os
 * carimbos compostos para os inputs ocultos que o servidor le (delivery_at /
 * pickup_at), e os bindings prontos para os inputs visíveis.
 */
import { useCallback, useMemo, useState } from "react";
import { carimboDe, proximaJanela, type CampoJanela, type JanelaState } from "@/lib/event-window";

export type CampoBind = { value: string; onChange: (e: { target: { value: string } }) => void };

/** Espalhe direto no input: {...janela.bind.eventDate}. */
export type EventWindowBind = Record<CampoJanela, CampoBind>;

export function useEventWindow(inicial: JanelaState) {
  const [estado, setEstado] = useState<JanelaState>({ ...inicial });

  const setCampo = useCallback((campo: CampoJanela, valor: string) => {
    setEstado((atual) => proximaJanela(atual, campo, valor));
  }, []);

  const bind: EventWindowBind = useMemo(() => {
    const make = (campo: CampoJanela) => ({
      value: estado[campo],
      onChange: (e: { target: { value: string } }) => setCampo(campo, e.target.value),
    });
    return {
      eventDate: make("eventDate"),
      deliveryDate: make("deliveryDate"),
      deliveryTime: make("deliveryTime"),
      pickupDate: make("pickupDate"),
      pickupTime: make("pickupTime"),
    };
  }, [estado, setCampo]);

  return {
    ...estado,
    bind,
    deliveryAt: carimboDe(estado.deliveryDate, estado.deliveryTime),
    pickupAt: carimboDe(estado.pickupDate, estado.pickupTime),
  };
}
