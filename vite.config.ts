import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * A Content-Security-Policy for the built site, as a <meta> tag because GitHub
 * Pages cannot send headers.
 *
 * What it is for: the sign-in session lives in localStorage, where any script
 * running on the page can read it. Nothing in the app injects HTML today (no
 * dangerouslySetInnerHTML, no eval — CLAUDE.md §12), so this is the second
 * lock rather than the first: if a bug ever did let markup through, a script
 * from anywhere but this site would not run, and the page could not send what
 * it read anywhere but Supabase.
 *
 * Every source here was read off the build, not guessed:
 *   script-src  'self'           one module script, from this site; no inline scripts
 *   style-src   'unsafe-inline'  React's inline styles are the whole styling approach
 *   font-src    data:            @fontsource bundles small faces as data: URLs
 *   img-src     data: blob:      the photograph cropper draws from blob: URLs
 *   connect-src <supabase>       the only host the app talks to
 *   img-src     <supabase>       salon photographs are served from its storage
 *
 * Build only: Vite's dev server injects inline scripts for live reload, which
 * this would block. `frame-ancestors` (clickjacking) cannot be set from a meta
 * tag at all — browsers ignore it there — so that one stays open on Pages.
 *
 * The Android app loads this same page, so the policy applies there too.
 * Capacitor's bridge is injected by the WebView and talks to native code
 * without a network request, so it should be untouched — but that is reasoned,
 * not run: nothing in the native wrap has been tested on a phone yet.
 *
 * Generated from VITE_SUPABASE_URL so the project address lives in .env alone.
 * Moving to another Supabase project needs no change here.
 */
function contentSecurityPolicy(supabaseUrl: string | undefined): Plugin {
  const supabase = supabaseUrl ? new URL(supabaseUrl).origin : '';
  const policy = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    `img-src 'self' data: blob: ${supabase}`.trim(),
    `connect-src 'self' ${supabase}`.trim(),
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ')
  return {
    name: 'saloni-content-security-policy',
    apply: 'build',
    transformIndexHtml: {
      order: 'pre',
      handler: () => [
        {
          tag: 'meta',
          attrs: { 'http-equiv': 'Content-Security-Policy', content: policy },
          injectTo: 'head-prepend',
        },
      ],
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  return {
    plugins: [react(), contentSecurityPolicy(env.VITE_SUPABASE_URL)],
    // Relative asset paths, so the built site works when served from a sub-path
    // such as https://<user>.github.io/Norisu/ as well as from a domain root.
    base: './',
  }
})
