import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Conversation } from './entities/conversation.entity';
import { Message } from './entities/message.entity';
import { MessageService } from './services/message.service';
import { ConversationService } from './services/conversation.service';
import { ChatGateway } from './gateway/chat.gateway';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature(
      [
        Conversation,
        Message
      ]
    ),
    AuthModule
  ],
  providers:[
    MessageService,
    ConversationService,
    ChatGateway

  ],
  exports: [
    MessageService,
    ConversationService,
  ],
})
export class ChatModule {}
