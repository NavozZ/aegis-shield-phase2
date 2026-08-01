import { SetMetadata } from '@nestjs/common';
import { PUBLIC_ROUTE_KEY } from './internal-token.guard';
export const PublicRoute = () => SetMetadata(PUBLIC_ROUTE_KEY, true);
