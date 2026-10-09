import vinext from 'vinext';
import { defineConfig } from 'vite';

// PostgreSQL uses the native Node runtime; no Worker/D1 or Sites bindings.
export default defineConfig({ plugins: [vinext()] });
