export interface ConversationListItem {
  conversationId: string;
  otherParticipantUuid: string;
  participants: [string, string];
  createdAt: Date;
  lastMessage: {
    id: string;
    conversationId: string;
    senderUuid: string;
    content: string;
    createdAt: Date;
  } | null;
}
