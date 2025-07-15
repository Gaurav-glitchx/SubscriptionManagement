import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

@Entity()
export class EventLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  eventType: string;

  @Column({ type: 'jsonb', nullable: true })
  data: any;

  @CreateDateColumn()
  createdAt: Date;
}
