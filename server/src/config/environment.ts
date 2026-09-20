import { config } from 'dotenv';
import { resolve } from 'node:path';

config({
  path: process.env.MIAP_ENV_FILE ?? resolve(process.cwd(), '../.env.local'),
  quiet: true,
});

export function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
