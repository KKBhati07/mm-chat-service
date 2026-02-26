import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Conversation } from '../entities/conversation.entity';

@Injectable()
export class ConversationService {
  constructor(
    @InjectRepository(Conversation)
    private readonly conversationRepository: Repository<Conversation>,
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
}
