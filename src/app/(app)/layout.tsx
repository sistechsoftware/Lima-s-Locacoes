import { requireUser } from "@/lib/auth";
import PushRegistration from "@/components/PushRegistration";
import { scalar } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { unreadCount } from "@/lib/notifications";
import { BottomNav, FloatingAction, Sidebar, TopBar } from "@/components/Shell";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  // Os alertas sao recalculados no dashboard e na tela de notificacoes, e nao
  // aqui: rodar a varredura em toda navegacao deixava cada clique lento.
  const [settings, unread] = await Promise.all([getSettings(), scalar<number>("SELECT COUNT(*) FROM user_notifications WHERE user_id=? AND read_at IS NULL",[user.id])]);

  return (
    <div className="flex min-h-screen">
      <PushRegistration />
      <Sidebar company={settings.company_name} logo={settings.company_logo} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar user={user} unread={unread} company={settings.company_name} logo={settings.company_logo} />
        <main className="com-barra-inferior mx-auto w-full max-w-6xl flex-1 p-3 sm:p-5">{children}</main>
      </div>
      <BottomNav />
      <FloatingAction />
    </div>
  );
}
