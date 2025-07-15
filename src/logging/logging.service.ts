import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EventLog } from './event-log.entity';

@Injectable()
export class LoggingService {
  constructor(
    @InjectRepository(EventLog)
    private readonly eventLogRepository: Repository<EventLog>,
  ) {}

  async logEvent(eventType: string, data: any) {
    const log = this.eventLogRepository.create({ eventType, data });
    return this.eventLogRepository.save(log);
  }
}
