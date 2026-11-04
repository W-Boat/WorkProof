import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'tests',testMatch:'desktop-connections.spec.ts',timeout:30000,workers:2,
  use:{baseURL:'http://127.0.0.1:4173',trace:'retain-on-failure'},reporter:[['list'],['html',{open:'never'}]],
  webServer:{command:'python3 -m http.server 4173 --bind 127.0.0.1 --directory apps/desktop/ui',url:'http://127.0.0.1:4173',reuseExistingServer:false},
  projects:[{name:'chromium',use:{browserName:'chromium'}},{name:'firefox',use:{browserName:'firefox'}},{name:'webkit',use:{browserName:'webkit'}}]});
