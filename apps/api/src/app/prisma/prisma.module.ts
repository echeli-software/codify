import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';

/**
 * Global Prisma module — singleton client available everywhere via DI
 * without needing to be imported in every feature module. Marked @Global
 * to match Nest's convention for infra-level providers.
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
