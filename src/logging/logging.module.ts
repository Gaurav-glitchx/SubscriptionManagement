import { Module } from '@nestjs/common';
import { LoggingService } from './logging.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EventLog } from './event-log.entity';

@Module({
  imports: [TypeOrmModule.forFeature([EventLog])],
  providers: [LoggingService],
  exports: [LoggingService],
})
export class LoggingModule {}
