// JanitorScheduler — drives JanitorService.sweep() on boot and at the
// configured cadence. start() sweeps once immediately (the boot sweep that
// catches rows stranded by the previous process) then on an interval; stop()
// clears the interval. main.ts owns start/stop around app.listen().
import { Inject, Injectable } from '@nestjs/common';
import { JanitorService } from './janitor.service';
import { API_CONFIG_TOKEN, type ApiConfig } from '../common/config';

@Injectable()
export class JanitorScheduler {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly janitor: JanitorService,
    @Inject(API_CONFIG_TOKEN) private readonly config: ApiConfig,
  ) {}

  start(): void {
    if (this.timer) return;
    void this.janitor.sweep(); // boot sweep
    this.timer = setInterval(() => void this.janitor.sweep(), this.config.janitorSweepIntervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
