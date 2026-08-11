import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Relative asset paths, so the built site works when served from a sub-path
  // such as https://<user>.github.io/Norisu/ as well as from a domain root.
  base: './',
})
