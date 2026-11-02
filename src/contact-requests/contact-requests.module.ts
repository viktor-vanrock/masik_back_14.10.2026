import { Module } from '@nestjs/common';
import { ContactRequestsRateLimitGuard } from './contact-requests-rate-limit.guard';
import { ContactRequestsController } from './contact-requests.controller';
import { ContactRequestsService } from './contact-requests.service';
import { DemoContactsController } from './demo-contacts.controller';

@Module({
  controllers: [ContactRequestsController, DemoContactsController],
  providers: [ContactRequestsService, ContactRequestsRateLimitGuard],
})
export class ContactRequestsModule {}
