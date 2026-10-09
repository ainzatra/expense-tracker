import { defineConfig } from 'drizzle-kit';
export default defineConfig({
  schema: './src/data/tables.ts',
  out: './drizzle',
  dialect: 'sqlite',
  driver: 'expo',
});
