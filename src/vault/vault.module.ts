import { Module } from '@nestjs/common';
import { VaultTransitService } from './vault-transit.service';

@Module({
  providers: [VaultTransitService],
  exports: [VaultTransitService],
})
export class VaultModule {}
