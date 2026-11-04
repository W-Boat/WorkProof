import {defineConfig} from '@playwright/test';
import base from './playwright.config';

// Exercise the real exported page and metadata Worker without requiring model weights.
export default defineConfig({
  ...base,
  testMatch: 'metadata.spec.ts',
  workers: 2,
  projects: [
    {name: 'chromium', use: {browserName: 'chromium'}},
    {name: 'firefox', use: {browserName: 'firefox'}},
    {name: 'webkit', use: {browserName: 'webkit'}},
  ],
});
