import {defineConfig} from '@playwright/test';
export default defineConfig({
  testDir:'tests',testMatch:'office.spec.ts',timeout:30000,
  use:{baseURL:'http://127.0.0.1:4173',trace:'retain-on-failure'},
  reporter:[['list'],['html',{open:'never'}]],
  webServer:{command:'python3 -m http.server 4173 --bind 127.0.0.1 --directory .ci-office',url:'http://127.0.0.1:4173/office/index.html',reuseExistingServer:false},
  projects:[{name:'chromium',use:{browserName:'chromium'}}]
});
