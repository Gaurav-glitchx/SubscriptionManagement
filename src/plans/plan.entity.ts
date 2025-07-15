import { Entity, PrimaryGeneratedColumn, Column, Unique } from 'typeorm';

@Entity()
@Unique(['stripePriceId'])
export class Plan {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column()
  stripeProductId: string;

  @Column()
  stripePriceId: string;

  @Column('decimal', { precision: 10, scale: 2 })
  amount: number;

  @Column()
  currency: string;

  @Column({ default: true })
  active: boolean;

  @Column({ nullable: true })
  interval: string;

  @Column({ nullable: true })
  description: string;
}
