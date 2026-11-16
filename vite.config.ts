import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages serves project sites from /<repository>/, so the deploy workflow sets BASE_PATH.
export default defineConfig({ base: process.env.BASE_PATH ?? '/', plugins: [react()] });
