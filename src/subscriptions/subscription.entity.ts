import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
  UpdateDateColumn,
  JoinColumn,
} from 'typeorm';
import { Plan } from '../plans/plan.entity';

@Entity()
export class Subscription {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  stripeSubscriptionId: string;

  @Column()
  customerId: string;

  @ManyToOne(() => Plan, { eager: true })
  plan: Plan;

  @Column({ nullable: true })
  pendingPlanId: string | null;

  @ManyToOne(() => Plan, { eager: true, nullable: true })
  @JoinColumn({ name: 'pendingPlanId' })
  pendingPlan: Plan | null;

  @Column()
  status: string;

  @Column({ nullable: true })
  currentPeriodEnd: Date;

  @Column({ nullable: true })
  cancelAtPeriodEnd: boolean;

  @Column({ nullable: true })
  canceledAt: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
