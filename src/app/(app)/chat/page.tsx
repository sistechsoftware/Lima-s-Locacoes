import { requireUser } from "@/lib/auth";
import { contactableUsers, listConversations, unreadConversations, unreadMessages } from "@/lib/chat";
import ChatApp from "./ChatApp";

export const dynamic = "force-dynamic";

/**
 * Tela do chat. O servidor entrega so o primeiro quadro (lista de conversas,
 * contatos e contadores); tudo depois e incrementado pelo polling da API,
 * sem recarregar a pagina.
 */
export default async function ChatPage() {
  const user = await requireUser();
  const [users, conversations, unreadMsgs, unreadConv] = await Promise.all([
    contactableUsers(user.id),
    listConversations(user.id),
    unreadMessages(user.id),
    unreadConversations(user.id),
  ]);
  return (
    <ChatApp
      me={{ id: user.id, name: user.name, role: user.role }}
      initialUsers={users}
      initialConversations={conversations}
      initialUnread={unreadMsgs}
      initialUnreadConversations={unreadConv}
    />
  );
}
