import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Message } from '../entities/message.entity';

@Injectable()
export class MessageService {
  constructor(
    @InjectRepository(Message)
    private readonly messageRepository: Repository<Message>,
  ) {}

  async saveMessage(
    conversationId: string,
    senderId: string,
    content: string,
  ): Promise<Message> {
    return this.messageRepository.save({
      conversationId,
      senderId,
      content,
    });
  }

  async getMessagesByConversation(
    conversationId: string,
    limit = 50,
    offset = 0,
  ): Promise<Message[]> {
    return this.messageRepository.find({
      where: { conversationId },
      order: { createdAt: 'ASC' },
      take: limit,
      skip: offset,
    });
  }

  async getLatestByConversationIds(ids: string[]): Promise<Message[]> {
    if (ids.length === 0) {
      return [];
    }

    return this.messageRepository
      .createQueryBuilder('message')
      .distinctOn(['message.conversationId'])
      .where('message.conversationId IN (:...ids)', { ids })
      .orderBy('message.conversationId', 'ASC')
      .addOrderBy('message.createdAt', 'DESC')
      .getMany();
  }
}
