import { Controller, Post } from '@nestjs/common';
import { RetentionService } from './retention.service';
@Controller('internal/v1/retention')
export class RetentionController {
  constructor(private readonly retention: RetentionService) {}
  @Post() run() {
    return this.retention.run();
  }
}
