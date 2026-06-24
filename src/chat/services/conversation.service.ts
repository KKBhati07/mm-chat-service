import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Conversation } from '../entities/conversation.entity';
import { MessageService } from './message.service';
import { ConversationListItem } from './conversation-list.types';

@Injectable()
export class ConversationService {
  constructor(
    @InjectRepository(Conversation)
    private readonly conversationRepository: Repository<Conversation>,
    private readonly messageService: MessageService,
  ) {}

  private normalizeUsers(userA: string, userB: string): [string, string] {
    return userA < userB ? [userA, userB] : [userB, userA];
  }

  async findConversation(
    userA: string,
    userB: string,
  ): Promise<Conversation | null> {
    const [userOneId, userTwoId] = this.normalizeUsers(userA, userB);

    return this.conversationRepository.findOne({
      where: { userOneId, userTwoId },
    });
  }

  async findOrCreateConversation(
    userA: string,
    userB: string,
  ): Promise<Conversation> {
    const [userOneId, userTwoId] = this.normalizeUsers(userA, userB);

    let conversation = await this.conversationRepository.findOne({
      where: { userOneId, userTwoId },
    });

    if (conversation) {
      return conversation;
    }

    conversation = this.conversationRepository.create({
      userOneId,
      userTwoId,
    });

    return this.conversationRepository.save(conversation);
  }

  async findById(conversationId: string): Promise<Conversation | null> {
    return this.conversationRepository.findOne({
      where: { id: conversationId },
    });
  }

  isParticipant(conversation: Conversation, userUuid: string): boolean {
    return (
      conversation.userOneId === userUuid ||
      conversation.userTwoId === userUuid
    );
  }

  getOtherParticipant(conversation: Conversation, userUuid: string): string {
    return conversation.userOneId === userUuid
      ? conversation.userTwoId
      : conversation.userOneId;
  }

  async listForUser(userUuid: string): Promise<ConversationListItem[]> {
    const conversations = await this.conversationRepository.find({
      where: [{ userOneId: userUuid }, { userTwoId: userUuid }],
    });

    if (conversations.length === 0) {
      return [];
    }

    const conversationIds = conversations.map((c) => c.id);
    const latestMessages =
      await this.messageService.getLatestByConversationIds(conversationIds);
    const latestByConversationId = new Map(
      latestMessages.map((message) => [message.conversationId, message]),
    );

    const items: ConversationListItem[] = conversations.map((conversation) => {
      const latest = latestByConversationId.get(conversation.id);

      return {
        conversationId: conversation.id,
        otherParticipantUuid: this.getOtherParticipant(conversation, userUuid),
        participants: [conversation.userOneId, conversation.userTwoId],
        createdAt: conversation.createdAt,
        lastMessage: latest
          ? {
              id: latest.id!,
              conversationId: conversation.id,
              senderUuid: latest.senderId,
              content: latest.content,
              createdAt: latest.createdAt,
            }
          : null,
      };
    });

    items.sort((a, b) => {
      const aTime = a.lastMessage?.createdAt ?? a.createdAt;
      const bTime = b.lastMessage?.createdAt ?? b.createdAt;
      return new Date(bTime).getTime() - new Date(aTime).getTime();
    });

    return items;
  }
}
