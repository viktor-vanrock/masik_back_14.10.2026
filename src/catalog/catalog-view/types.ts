import { BenchmarkType } from '../benchmark-test/types';

export type BenchmarkGroupSuiteType = {
  id: string;
  name: string;
  nameEn: string;
  description: string | null;
  descriptionEn: string | null;
  benchmarkTestsCount: number;
  matchedTestsCount: number;
};

export type BenchmarkGroupType = {
  benchmark: BenchmarkGroupSuiteType;
  tests: BenchmarkType[];
};
