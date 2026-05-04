import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service.js';

/**
 * Global so any feature module can record audit rows without explicit
 * imports — same pattern as PrismaModule.
 */
@Global()
@Module({
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
