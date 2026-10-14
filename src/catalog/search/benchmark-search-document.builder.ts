import { Injectable } from '@nestjs/common';
import { BenchmarkSearchSource } from './types';

type NamePair = Readonly<{ name: string; nameEn: string }>;

@Injectable()
export class BenchmarkSearchDocumentBuilder {
  build(source: BenchmarkSearchSource): string {
    const sections: string[] = [];

    this.add(sections, 'Benchmark', this.names(source.name, source.nameEn));
    this.add(
      sections,
      'Suite',
      this.names(source.benchmark.name, source.benchmark.nameEn)
    );
    this.add(
      sections,
      'Description',
      source.description ?? source.benchmark.description
    );
    this.add(
      sections,
      'Description EN',
      source.descriptionEn ?? source.benchmark.descriptionEn
    );
    this.add(sections, 'Short description', source.shortDescription);
    this.add(sections, 'Task', source.taskDescription);
    this.add(sections, 'Instructions', source.instructions);
    this.add(sections, 'Instructions EN', source.instructionsEn);
    this.add(sections, 'Context format', source.contextFieldFormat);
    this.add(sections, 'Answer format', source.answerFieldFormat);
    this.add(sections, 'Evaluation', source.evaluationLogic);
    this.add(
      sections,
      'Recommended metrics',
      source.recommendedMetricsDescription
    );
    this.add(
      sections,
      'Required model quality',
      source.requiredGigaChatQualityLevel
    );

    this.add(sections, 'Macro group', this.dictionary(source.macroGroup));
    this.add(sections, 'Task type', this.dictionary(source.taskType));
    this.add(sections, 'Language', this.dictionary(source.language));
    this.add(sections, 'Difficulty', this.dictionary(source.difficulty));
    this.add(
      sections,
      'Subgroups',
      source.subGroups.map((item) => this.dictionary(item)).join('; ')
    );
    this.add(
      sections,
      'Ability taxons',
      source.abilityTaxons
        .map((item) => this.dictionary(item))
        .join('; ')
    );
    this.add(
      sections,
      'Domains',
      source.domains.map((item) => this.dictionary(item)).join('; ')
    );
    this.add(
      sections,
      'Subdomains',
      source.subdomains
        .map((item) => this.dictionary(item))
        .join('; ')
    );
    this.add(
      sections,
      'Modalities',
      source.modalities.map((item) => this.dictionary(item)).join('; ')
    );
    this.add(
      sections,
      'Capabilities',
      source.capabilities
        .map((item) => this.dictionary(item))
        .join('; ')
    );
    this.add(sections, 'Skills', source.skills.join('; '));
    this.add(
      sections,
      'Ability tags',
      source.abilityTags.join('; ')
    );

    if (source.datasetSubsamples.length > 0) {
      const subsamples = source.datasetSubsamples.map((subsample) => {
        const details = [
          this.names(subsample.name, subsample.nameEn ?? ''),
          subsample.description,
          subsample.split ? `split: ${subsample.split}` : null,
        ].filter((value): value is string => Boolean(value));

        return `- ${details.join(' | ')}`;
      });

      sections.push(`Dataset subsamples:\n${subsamples.join('\n')}`);
    }

    return sections.join('\n').replace(/[ \t]+/g, ' ').trim();
  }

  private add(sections: string[], label: string, value: string | null | undefined): void {
    const normalized = value?.trim();
    if (normalized) sections.push(`${label}: ${normalized}`);
  }

  private names(name: string, nameEn: string): string {
    const values = [name.trim(), nameEn.trim()].filter(Boolean);
    return [...new Set(values)].join(' / ');
  }

  private dictionary(value: NamePair | null): string {
    return value ? this.names(value.name, value.nameEn) : '';
  }
}
