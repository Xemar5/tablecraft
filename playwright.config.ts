import { defineConfig } from '@playwright/test';
import { starterProject } from './src/templates';

const project = starterProject();

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  use: { baseURL: 'http://127.0.0.1:5173', viewport: { width: 1440, height: 1000 }, trace: 'retain-on-failure',
    storageState: { cookies: [], origins: [{ origin: 'http://127.0.0.1:5173', localStorage: [
      { name: 'tablecraft.workspace.v1', value: JSON.stringify({ format: 'tablecraft', version: 1, projects: [project] }) },
      { name: 'tablecraft.last-project', value: project.id },
      // Start with a completed, valid profile; named multiplayer tests override it with setProfileName.
      { name: 'tablecraft.settings.v1', value: JSON.stringify({ name: 'Player 1', color: '#b7cc91', onboarded: true }) },
    ] }] },
  },
  webServer: { command: 'npm run dev -- --no-open --port 5173 --strictPort', url: 'http://127.0.0.1:5173', reuseExistingServer: true },
});
