import type { Request } from 'express';

export interface RequestContext extends Request {
  correlationId: string;
}
