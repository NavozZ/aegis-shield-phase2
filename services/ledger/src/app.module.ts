import { MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AccountModule } from './accounts/account.module';
import { LedgerConfigModule } from './common/config/config.module';
import { CorrelationMiddleware } from './common/http/correlation.middleware';
import { InternalTokenGuard } from './common/security/internal-token.guard';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { JournalModule } from './ledger/journal.module';
import { ReconciliationModule } from './reconciliation/reconciliation.module';
import { TransactionModule } from './transactions/transaction.module';
import { CustomerTransferModule } from './transfers/customer-transfer.module';

@Module({
  imports: [
    LedgerConfigModule,
    DatabaseModule,
    HealthModule,
    AccountModule,
    JournalModule,
    ReconciliationModule,
    TransactionModule,
    CustomerTransferModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: InternalTokenGuard }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationMiddleware).forRoutes('*');
  }
}
