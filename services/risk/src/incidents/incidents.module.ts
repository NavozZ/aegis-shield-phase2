import { Module } from '@nestjs/common';
import { IncidentService } from './incident.service';
@Module({ providers: [IncidentService], exports: [IncidentService] })
export class IncidentsModule {}
