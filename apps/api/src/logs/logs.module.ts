import { Global, Module } from '@nestjs/common';
import { LogStreamService } from './log-stream.service';

/** Live log relaying (Server-Sent Events from Redis Streams). */
@Global()
@Module({
  providers: [LogStreamService],
  exports: [LogStreamService],
})
export class LogsModule {}
