-- Saloni — describing a photograph in both languages
--
-- salon_media.alt_text has existed since 0001 and nothing could write it, so
-- every photograph on a salon page was announced to a screen-reader user as
-- the salon's name or as nothing at all. The app is bilingual everywhere else,
-- so a description needs both languages, and the owner — who knows what the
-- picture shows — is who writes them.
--
-- No new grant is needed: salon_media_write (0002) already lets a salon's own
-- owner update its rows, and nobody else. Both columns are capped so a
-- description stays a description.

alter table salon_media
  add column alt_text_ar text not null default '';

alter table salon_media
  add constraint salon_media_alt_length
  check (length(alt_text) <= 200 and length(alt_text_ar) <= 200);

comment on column salon_media.alt_text_ar is
  'What the photograph shows, in Arabic, for screen readers. alt_text is the English.';
