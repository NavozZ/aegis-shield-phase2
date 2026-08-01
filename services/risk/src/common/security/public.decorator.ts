import { SetMetadata } from '@nestjs/common';
export const PUBLIC_ROUTE_KEY = 'aegis:public';
export const PublicRoute = () => SetMetadata(PUBLIC_ROUTE_KEY, true);
