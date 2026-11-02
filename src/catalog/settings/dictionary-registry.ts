import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  DictionaryCategorySlug,
  DictionaryHandlerMap,
} from './dictionary.constants';
import { AbilityTaxonsHandler } from './handlers/ability-taxons.handler';
import { CapabilitiesHandler } from './handlers/capabilities.handler';
import { IDictionaryHandler } from './handlers/dictionary-handler.interface';
import { DifficultiesHandler } from './handlers/difficulties.handler';
import { DomainsHandler } from './handlers/domains.handler';
import { LanguagesHandler } from './handlers/languages.handler';
import { MacroGroupsHandler } from './handlers/macro-groups.handler';
import { ModalitiesHandler } from './handlers/modalities.handler';
import { SubGroupsHandler } from './handlers/sub-groups.handler';
import { SubdomainsHandler } from './handlers/subdomains.handler';
import { TaskTypesHandler } from './handlers/task-types.handler';


@Injectable()
export class DictionaryRegistry {
  private readonly logger = new Logger(DictionaryRegistry.name);
  private readonly handlers: DictionaryHandlerMap;

  constructor(
    macroGroups: MacroGroupsHandler,
    subGroups: SubGroupsHandler,
    abilityTaxons: AbilityTaxonsHandler,
    taskTypes: TaskTypesHandler,
    modalities: ModalitiesHandler,
    languages: LanguagesHandler,
    difficulties: DifficultiesHandler,
    capabilities: CapabilitiesHandler,
    domains: DomainsHandler,
    subdomains: SubdomainsHandler
  ) {
    this.handlers = {
      taxonomy: {
        'macro-groups': macroGroups,
        'sub-groups': subGroups,
        'ability-taxons': abilityTaxons,
      },
      parameters: {
        'task-types': taskTypes,
        modalities,
        languages,
        difficulties,
        capabilities,
      },
      domains: {
        domains,
        subdomains,
      },
    };
    const total = Object.values(this.handlers).reduce(
      (acc, cat) => acc + Object.keys(cat).length,
      0
    );
    this.logger.debug(`DictionaryRegistry initialised with ${total} handlers`);
  }

  get(category: string, type: string): IDictionaryHandler {
    const byCategory = this.handlers[category as DictionaryCategorySlug];
    if (!byCategory) {
      throw new NotFoundException(`Unknown dictionary category "${category}"`);
    }
    const handler = (byCategory as Record<string, IDictionaryHandler>)[type];
    if (!handler) {
      throw new NotFoundException(
        `Dictionary type "${type}" does not belong to category "${category}"`
      );
    }
    return handler;
  }
}
