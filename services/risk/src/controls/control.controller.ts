import {
  applyControlRequestSchema,
  controlCheckRequestSchema,
  releaseControlRequestSchema,
} from '@aegis/contracts';
import { Body, Controller, Param, Post } from '@nestjs/common';
import { ControlService } from './control.service';
@Controller('internal/v1/controls')
export class ControlController {
  constructor(private readonly controls: ControlService) {}
  @Post('check') check(@Body() body: unknown) {
    const input = controlCheckRequestSchema.parse(body);
    return this.controls.check(input.scopes);
  }
  @Post() apply(@Body() body: unknown) {
    return this.controls.apply(
      applyControlRequestSchema.parse(body),
      'trusted:internal-service',
    );
  }
  @Post(':id/release') release(@Param('id') id: string, @Body() body: unknown) {
    return this.controls.release(
      id,
      releaseControlRequestSchema.parse(body).reason,
      'trusted:internal-service',
    );
  }
}
