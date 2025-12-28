import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { UseGuards } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { ConversationService } from '../services/conversation.service';
import { MessageService } from '../services/message.service';
import { WsJwtGuard } from '../../auth/guards/ws-jwt.auth.guard';
import { AppLogger } from '../../core/logger/app.logger';

@WebSocketGateway({
  cors: {
    origin: process.env.ALLOWED_APP_ORIGINS?.split(',') ?? [],
    credentials: true,
  },
})
@UseGuards(WsJwtGuard)
export class ChatGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  constructor(
    private readonly conversationService: ConversationService,
    private readonly messageService: MessageService,
    private readonly logger: AppLogger,
  ) {
    this.logger.setContext(ChatGateway.name);
  }

  handleConnection(client: Socket) {
    const { userUuid } = client.data;
    this.logger.log(`Socket connected`);
  }

  handleDisconnect(client: Socket) {
    const { userUuid } = client.data;
    this.logger.warn(`Socket disconnected`);
  }

  @SubscribeMessage('join_conversation')
  async handleJoinConversation(
    @MessageBody() payload: { otherUserUuid: string },
    @ConnectedSocket() client: Socket,
  ) {
    const currentUserUuid = client.data.userUuid;
    const { otherUserUuid } = payload;

    this.logger.debug(
      `Join conversation requested with user=${otherUserUuid}`,
    );

    const conversation =
      await this.conversationService.findOrCreateConversation(
        currentUserUuid,
        otherUserUuid,
      );

    const roomName = this.getRoomName(conversation.id);
    client.join(roomName);

    this.logger.debug(
      `Joined conversation=${conversation.id}`,
    );

    return { conversationId: conversation.id };
  }

  @SubscribeMessage('send_message')
  async handleSendMessage(
    @MessageBody()
    payload: { conversationId: string; content: string },
    @ConnectedSocket() client: Socket,
  ) {
    const { conversationId } = payload;
    const senderUuid = client.data.userUuid;

    this.logger.debug(
      `Sending message in conversation=${conversationId}`,
    );

    const message = await this.messageService.saveMessage(
      conversationId,
      senderUuid,
      payload.content,
    );

    this.server
      .to(this.getRoomName(conversationId))
      .emit('new_message', {
        id: message.id,
        conversationId,
        senderUuid,
        content: message.content,
        createdAt: message.createdAt,
      });

    this.logger.debug(
      `Message emitted messageId=${message.id}`,
    );

    return { success: true };
  }

  private getRoomName(conversationId: string): string {
    return `conversation:${conversationId}`;
  }
}
