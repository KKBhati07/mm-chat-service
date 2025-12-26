import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  OneToMany,
  Index,
} from 'typeorm';
import { Message } from './message.entity';
import { UUID } from 'crypto';

@Entity('conversations')
@Index(['userOneId', 'userTwoId'], { unique: true })
export class Conversation {
  @PrimaryGeneratedColumn('uuid')
  id: UUID;

  @Column({ name: 'user_one_id', type: 'uuid' })
  userOneId: UUID;

  @Column({ name: 'user_two_id', type: 'uuid' })
  userTwoId: UUID;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @OneToMany(() => Message, (message) => message.conversation)
  messages: Message[];
}
