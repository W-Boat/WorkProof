import {defineConfig} from '@playwright/test';
import fs from 'node:fs';

if(process.env.GITHUB_ACTIONS!=='true'||!process.env.WORKPROOF_EDITOR_STRESS_HARNESS||!fs.existsSync(process.env.WORKPROOF_EDITOR_STRESS_HARNESS))throw new Error('Desktop stress acceptance requires Actions and the compiled real Rust bridge');

export default defineConfig({
  testDir:'tests',
  testMatch:'desktop-editor-stress.spec.ts',
  timeout:180000,
  expect:{timeout:15000},
  workers:1,
  retries:0,
  fullyParallel:false,
  outputDir:'test-results/editor-stress-traces',
  reporter:[['list'],['html',{outputFolder:'test-results/editor-stress-report',open:'never'}]],
  use:{baseURL:'http://127.0.0.1:4178',viewport:{width:1280,height:900},actionTimeout:20000,navigationTimeout:30000,trace:'retain-on-failure'},
  projects:[{name:'chromium',use:{browserName:'chromium'}}],
  webServer:{command:'python3 -m http.server 4178 --bind 127.0.0.1 --directory apps/desktop/ui',url:'http://127.0.0.1:4178/index.html',reuseExistingServer:false},
});
