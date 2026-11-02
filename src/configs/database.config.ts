import { registerAs} from '@nestjs/config';
import { DatabaseEnvType } from './types';

export default registerAs('db', (): DatabaseEnvType => ({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 5432,
  username: process.env.DB_USER || '',
  password: process.env.DB_PWD || '',
  name: process.env.DB_NAME || 'benchmark_catalog',
  url: process.env.DB_URL || '',
}));
