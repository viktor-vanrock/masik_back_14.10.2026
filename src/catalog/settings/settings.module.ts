import { Module } from '@nestjs/common';
import { PrismaModule } from '@/prisma/prisma.module';
import { BenchmarkSearchModule } from '../search/benchmark-search.module';
import { CatalogTestUsageService } from './catalog-test-usage.service';
import { DictionaryRegistry } from './dictionary-registry';
import { AbilityTaxonsHandler } from './handlers/ability-taxons.handler';
import { CapabilitiesHandler } from './handlers/capabilities.handler';
import { DifficultiesHandler } from './handlers/difficulties.handler';
import { DomainsHandler } from './handlers/domains.handler';
import { LanguagesHandler } from './handlers/languages.handler';
import { MacroGroupsHandler } from './handlers/macro-groups.handler';
import { ModalitiesHandler } from './handlers/modalities.handler';
import { SubGroupsHandler } from './handlers/sub-groups.handler';
import { SubdomainsHandler } from './handlers/subdomains.handler';
import { TaskTypesHandler } from './handlers/task-types.handler';
import { SettingsAggregateService } from './settings-aggregate.service';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';

@Module({
  imports: [PrismaModule, BenchmarkSearchModule],
  controllers: [SettingsController],
  providers: [
    CatalogTestUsageService,
    MacroGroupsHandler,
    SubGroupsHandler,
    AbilityTaxonsHandler,
    TaskTypesHandler,
    ModalitiesHandler,
    LanguagesHandler,
    DifficultiesHandler,
    CapabilitiesHandler,
    DomainsHandler,
    SubdomainsHandler,
    DictionaryRegistry,
    SettingsService,
    SettingsAggregateService,
  ],
  exports: [SettingsService, SettingsAggregateService, DictionaryRegistry],
})
export class SettingsModule {}
