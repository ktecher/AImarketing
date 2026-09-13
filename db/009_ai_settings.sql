-- db/009_ai_settings.sql
-- Migration nine: which AI backend each feature uses.
--
-- Every text-generation call in this project has gone through lib/ai/generate.ts
-- and Ollama alone. D97 lets the maintainer connect an OpenAI, Anthropic or
-- Google key and switch specific features to it -- opt-in, off by default, and
-- never silently inherited: a feature either follows `global` explicitly
-- ('default') or has made its own concrete choice.
--
-- Embeddings are not a feature here on purpose -- lib/rag/retrieve.ts and
-- lib/catalogue.ts stay on lib/ai/generate.ts's embed() unconditionally.
-- Cosine similarity across a corpus embedded by two different models is not
-- comparable, and nothing about that fails loudly.

create table if not exists ai_settings (
  feature           text        primary key
                      check (feature in ('global','content_studio','advisor','sales_chat','campaigns')),
  provider          text        not null
                      check (provider in ('default','local','openai','anthropic','google')),
  model             text,
  api_key_encrypted text,
  updated_at        timestamptz not null default now(),

  -- The global row is the fallback every 'default' feature resolves through --
  -- it cannot itself say "follow global", or resolution has nowhere to land.
  check (feature <> 'global' or provider <> 'default')
);

comment on column ai_settings.api_key_encrypted is
  'AES-256-GCM ciphertext of a provider API key, base64, IV and auth tag
   prefixed -- same scheme as social_accounts.token_cipher. The key is
   APP_ENCRYPTION_KEY and is not in this database. Null whenever provider is
   ''local'' or ''default''.';

insert into ai_settings (feature, provider) values
  ('global', 'local'),
  ('content_studio', 'default'),
  ('advisor', 'default'),
  ('sales_chat', 'default'),
  ('campaigns', 'default')
on conflict (feature) do nothing;
