import { createClient } from '@supabase/supabase-js';
import { createAdminClient } from '@supabase/server/core';
import { fromSupabaseUrl } from '@supabase/server';
import { config, requireConfig } from './config.js';

requireConfig('supabaseUrl', 'supabasePublishableKey', 'supabaseSecretKey');

// Server-side admin client (bypasses RLS) — built with @supabase/server/core
// using the new sb_secret_... API key instead of legacy service_role.
export const sb = createAdminClient({
  env: {
    supabaseUrl: config.supabaseUrl,
    secretKeys: { default: config.supabaseSecretKey },
    publishableKeys: { default: config.supabasePublishableKey },
  },
  resourceServer: fromSupabaseUrl(config.supabaseUrl),
  supabaseOptions: {
    auth: { autoRefreshToken: false, persistSession: false },
    db: { schema: 'public' },
  },
});

// Public client (publishable key) for client-side auth ops like signInWithPassword.
export const sbPublic = createClient(config.supabaseUrl, config.supabasePublishableKey, {
  auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
});