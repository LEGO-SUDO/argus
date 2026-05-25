// HeartbeatModule — provides the heartbeat scheduler. main.ts starts/stops it
// around app.listen().
import { Module } from '@nestjs/common';
import { Clock } from '../common/clock';
import { apiConfigProvider } from '../common/config';
import { HeartbeatScheduler } from './scheduler';

@Module({
  providers: [HeartbeatScheduler, Clock, apiConfigProvider],
  exports: [HeartbeatScheduler],
})
export class HeartbeatModule {}
