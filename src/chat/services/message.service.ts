import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Message } from '../entities/message.entity';
import { UUID } from 'crypto';

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
    limit = 20,
    offset = 0,
  ): Promise<Message[]> {
    return this.messageRepository.find({
      where: { conversationId },
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });
  }
}
