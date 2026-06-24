import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
} from '@nestjs/websockets';
import { UseGuards } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { ConversationService } from '../services/conversation.service';
import { MessageService } from '../services/message.service';
import { WsJwtGuard } from '../../auth/guards/ws-jwt.auth.guard';
import { AppLogger } from '../../core/logger/app.logger';
import { AuthService } from '../../auth/services/auth.service';
import { getCookieValue } from '../../auth/cookie.util';
import { DEFAULT_ALLOWED_APP_ORIGINS } from '../../config/env.validation';

@WebSocketGateway({
  cors: {
    origin:
      process.env.ALLOWED_APP_ORIGINS?.split(',') ??
      DEFAULT_ALLOWED_APP_ORIGINS.split(','),
    credentials: true,
  },
})
@UseGuards(WsJwtGuard)
export class ChatGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  constructor(
    private readonly authService: AuthService,
    private readonly conversationService: ConversationService,
    private readonly messageService: MessageService,
    private readonly logger: AppLogger,
  ) {
    this.logger.setContext(ChatGateway.name);
  }

  afterInit(server: Server) {
    server.use(async (socket, next) => {
      try {
        const cookieHeader = socket.handshake.headers.cookie;
        const token = getCookieValue(cookieHeader, 'auth_token');

        if (!token) {
          return next(new Error('Unauthorized'));
        }

        const { sessionId } = this.authService.verifyJwt(token);
        const userUuid = await this.authService.resolveUserUuid(sessionId);

        socket.data.sessionId = sessionId;
        socket.data.userUuid = userUuid;

        return next();
      } catch (e) {
        return next(new Error('Unauthorized'));
      }
    });
  }

  handleConnection(client: Socket) {
    const { userUuid } = client.data;

    if (userUuid) {
      const personalRoom = this.getPersonalRoomName(userUuid);
      client.join(personalRoom);

      this.logger.log(
        `Socket connected socketId=${client.id} userUuid=${userUuid}, joined personal room=${personalRoom}`,
      );
      return;
    }

    this.logger.warn(
      `Socket connected without userUuid socketId=${client.id}`,
    );
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

  @SubscribeMessage('join_conversation_by_id')
  async handleJoinConversationById(
    @MessageBody() payload: { conversationId: string },
    @ConnectedSocket() client: Socket,
  ) {
    const { conversationId } = payload;
    const currentUserUuid = client.data.userUuid;

    this.logger.debug(
      `Join conversation by ID requested conversationId=${conversationId}`,
    );

    const conversation = await this.conversationService.findById(conversationId);

    if (!conversation) {
      this.logger.warn(
        `Conversation not found conversationId=${conversationId}`,
      );
      return this.wsError('CONVERSATION_NOT_FOUND', 'Conversation not found');
    }

    if (
      !this.conversationService.isParticipant(conversation, currentUserUuid)
    ) {
      this.logger.warn(
        `User ${currentUserUuid} is not a participant in conversation ${conversationId}`,
      );
      return this.wsError(
        'NOT_PARTICIPANT',
        'You are not a participant in this conversation',
      );
    }

    const roomName = this.getRoomName(conversationId);
    client.join(roomName);

    this.logger.debug(
      `Joined conversation=${conversationId} by ID`,
    );

    return { conversationId, success: true };
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

    const conversation =
      await this.conversationService.findById(conversationId);

    if (!conversation) {
      this.logger.warn(
        `Conversation not found conversationId=${conversationId}`,
      );
      return this.wsError('CONVERSATION_NOT_FOUND', 'Conversation not found');
    }

    if (!this.conversationService.isParticipant(conversation, senderUuid)) {
      this.logger.warn(
        `User ${senderUuid} is not a participant in conversation ${conversationId}`,
      );
      return this.wsError(
        'NOT_PARTICIPANT',
        'You are not a participant in this conversation',
      );
    }

    const message = await this.messageService.saveMessage(
      conversationId,
      senderUuid,
      payload.content,
    );

    const receiverUuid = this.conversationService.getOtherParticipant(
      conversation,
      senderUuid,
    );

    const conversationRoomName = this.getRoomName(conversationId);
    const receiverPersonalRoom = this.getPersonalRoomName(receiverUuid);

    const messagePayload = this.toMessagePayload(
      message,
      conversationId,
      senderUuid,
    );

    this.logger.log(
      `[MESSAGE SENT] messageId=${message.id} conversationId=${conversationId} senderUuid=${senderUuid} receiverUuid=${receiverUuid} content="${message.content.substring(0, 50)}${message.content.length > 50 ? '...' : ''}"`,
    );

    client.to(conversationRoomName).emit('new_message', messagePayload);
    this.logger.debug(
      `[EMIT] new_message to conversation room: ${conversationRoomName} (excluding sender ${senderUuid})`,
    );

    this.server.to(receiverPersonalRoom).emit('new_message', messagePayload);
    this.logger.debug(
      `[EMIT] new_message to receiver personal room: ${receiverPersonalRoom}`,
    );

    this.server.to(receiverPersonalRoom).emit('conversation_updated', {
      conversationId,
      lastMessage: {
        id: message.id,
        content: message.content,
        senderUuid,
        createdAt: message.createdAt,
      },
      senderUuid,
    });
    this.logger.debug(
      `[EMIT] conversation_updated to receiver personal room: ${receiverPersonalRoom}`,
    );

    this.logger.log(
      `[MESSAGE DELIVERED] messageId=${message.id} emitted to conversation=${conversationRoomName} and receiver room=${receiverPersonalRoom}`,
    );

    return {
      success: true,
      message: this.toMessagePayload(message, conversationId, senderUuid),
    };
  }

  @SubscribeMessage('get_messages')
  async handleGetMessages(
    @MessageBody()
    payload: { conversationId: string; limit?: number; offset?: number },
    @ConnectedSocket() client: Socket,
  ) {
    const { conversationId } = payload;
    const currentUserUuid = client.data.userUuid;
    const limit = payload.limit ?? 50;
    const offset = payload.offset ?? 0;

    this.logger.debug(
      `Get messages requested conversationId=${conversationId} limit=${limit} offset=${offset}`,
    );

    const conversation =
      await this.conversationService.findById(conversationId);

    if (!conversation) {
      this.logger.warn(
        `Conversation not found conversationId=${conversationId}`,
      );
      return this.wsError('CONVERSATION_NOT_FOUND', 'Conversation not found');
    }

    if (
      !this.conversationService.isParticipant(conversation, currentUserUuid)
    ) {
      this.logger.warn(
        `User ${currentUserUuid} is not a participant in conversation ${conversationId}`,
      );
      return this.wsError(
        'NOT_PARTICIPANT',
        'You are not a participant in this conversation',
      );
    }

    const messages = await this.messageService.getMessagesByConversation(
      conversationId,
      limit,
      offset,
    );

    return {
      success: true,
      messages: messages.map((message) =>
        this.toMessagePayload(message, conversationId, message.senderId),
      ),
    };
  }

  @SubscribeMessage('list_conversations')
  async handleListConversations(@ConnectedSocket() client: Socket) {
    const userUuid = client.data.userUuid;

    if (!userUuid) {
      return this.wsError('UNAUTHORIZED', 'Not authenticated');
    }

    this.logger.debug(`List conversations requested userUuid=${userUuid}`);

    try {
      const conversations =
        await this.conversationService.listForUser(userUuid);

      return {
        success: true,
        conversations: conversations.map((item) => ({
          conversationId: item.conversationId,
          otherParticipantUuid: item.otherParticipantUuid,
          participants: item.participants,
          createdAt: item.createdAt,
          lastMessage: item.lastMessage
            ? this.toMessagePayload(
                item.lastMessage,
                item.conversationId,
                item.lastMessage.senderUuid,
              )
            : null,
        })),
      };
    } catch (err) {
      this.logger.error('Failed to list conversations', err?.stack);
      return this.wsError('INTERNAL_ERROR', 'Failed to load conversations');
    }
  }

  private toMessagePayload(
    message: { id?: string; content: string; createdAt: Date },
    conversationId: string,
    senderUuid: string,
  ) {
    return {
      id: message.id,
      conversationId,
      senderUuid,
      content: message.content,
      createdAt: message.createdAt,
    };
  }

  private getRoomName(conversationId: string): string {
    return `conversation:${conversationId}`;
  }

  private getPersonalRoomName(userUuid: string): string {
    return `user:${userUuid}`;
  }

  private wsError(code: string, message: string) {
    return { success: false, error: { code, message } };
  }
}
