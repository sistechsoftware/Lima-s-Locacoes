import { requireUser } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { rebuildNotifications, unreadCount } from "@/lib/notifications";
import { BottomNav, FloatingAction, Sidebar, TopBar } from "@/components/Shell";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const settings = await getSettings();
  await rebuildNotifications();
  const unread = await unreadCount();

  return (
    <div className="flex min-h-screen">
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
