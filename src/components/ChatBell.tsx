"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

/**
 * Sino do chat: contador de mensagens nao lidas, atualizado por polling.
 * Fica ao lado do sino de notificacoes na barra superior. Na propria tela do
 * chat o polling do ChatApp ja consume o contador, entao este componente
 * para de consultar la para nao dobrar as chamadas.
 */
export default function ChatBell() {
  const [unread, setUnread] = useState<number | null>(null);
  const pathname = usePathname();

  useEffect(() => {
    if (pathname === "/chat") return;
    let vivo = true;
    const consultar = async () => {
      try {
        const res = await fetch("/api/chat", { cache: "no-store" });
        if (!res.ok) throw new Error();
        const data = (await res.json().catch(() => ({}))) as { unread?: number };
        if (vivo) setUnread(data.unread ?? 0);
      } catch {
        /* offline: mantem o ultimo valor */
      }
    };
    void consultar();
    const t = setInterval(consultar, 5000);
    return () => {
      vivo = false;
      clearInterval(t);
    };
  }, [pathname]);

  if (pathname === "/chat") return null;

  return (
    <Link
      href="/chat"
      aria-label="Mensagens"
      className="relative shrink-0 rounded-xl p-2 text-tinta-700 hover:bg-nuvem-100"
    >
      <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden="true">
        <path
          d="M12 3C7.03 3 3 6.58 3 11c0 2.1.9 4.02 2.38 5.47-.16 1.2-.62 2.4-1.53 3.28a.5.5 0 0 0 .37.86c1.92-.06 3.6-.72 4.9-1.55.92.28 1.88.44 2.88.44 4.97 0 9-3.58 9-8.5S16.97 3 12 3Z"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {!!unread && unread > 0 && (
        <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-emerald-600 px-1 text-[0.6rem] font-bold text-white">
          {unread > 99 ? "99+" : unread}
        </span>
      )}
    </Link>
  );
}
