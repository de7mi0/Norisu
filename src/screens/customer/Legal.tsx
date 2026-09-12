import { LangToggle } from '../../components/LangToggle';
import { Screen, ScreenHeader } from '../../components/Screen';
import { useApp } from '../../state/context';
import { color, font } from '../../theme';
import type { Dictionary } from '../../i18n/en';
import type { LegalTab } from '../../types';

/**
 * The privacy policy and the terms of service, in both languages.
 *
 * Two things decide the shape of this screen. The first is that both app
 * stores need a URL a reviewer can open without an account, and the Saudi
 * PDPL needs one whether the stores ask or not — so it is reachable at
 * `?legal` (see `initialStateFor`) as well as from the Profile screen.
 *
 * The second is that the words are **drafted from the schema**, not from a
 * template. Every line in "what Saloni keeps" is a column that exists, and
 * every line in "what it never asks for" is a column that deliberately does
 * not. Nobody involved in writing it is a lawyer, which is the first thing
 * the page says. Keep it that way: if a migration starts collecting something
 * new, the list here is part of the change, not a follow-up.
 *
 * The strings live in the dictionaries like every other string in the app; all
 * this file decides is the order they appear in.
 */

/**
 * A section is a heading, a body, and optionally a list.
 *
 * Keyed rather than inlined because `Dictionary` is a flat map of plain
 * strings — the same constraint every other screen works under — and keying it
 * this way means a missing Arabic paragraph fails the build rather than
 * rendering `undefined` at a store reviewer.
 */
interface Section {
  heading: keyof Dictionary;
  body: keyof Dictionary;
  /** One item per line; the dictionary holds them newline-separated. */
  list?: keyof Dictionary;
}

const PRIVACY: Section[] = [
  { heading: 'legalPrivIntroH', body: 'legalPrivIntroB' },
  { heading: 'legalPrivCollectH', body: 'legalPrivCollectB', list: 'legalPrivCollectL' },
  { heading: 'legalPrivNeverH', body: 'legalPrivNeverB', list: 'legalPrivNeverL' },
  { heading: 'legalPrivSalonH', body: 'legalPrivSalonB' },
  { heading: 'legalPrivPhotoH', body: 'legalPrivPhotoB' },
  { heading: 'legalPrivOwnerH', body: 'legalPrivOwnerB' },
  { heading: 'legalPrivPushH', body: 'legalPrivPushB' },
  { heading: 'legalPrivWhereH', body: 'legalPrivWhereB' },
  { heading: 'legalPrivKeepH', body: 'legalPrivKeepB' },
  { heading: 'legalPrivDeleteH', body: 'legalPrivDeleteB', list: 'legalPrivDeleteL' },
  { heading: 'legalPrivRightsH', body: 'legalPrivRightsB' },
  { heading: 'legalPrivChildH', body: 'legalPrivChildB' },
  { heading: 'legalPrivChangeH', body: 'legalPrivChangeB' },
  { heading: 'legalPrivContactH', body: 'legalPrivContactB' },
];

const TERMS: Section[] = [
  { heading: 'legalTermIntroH', body: 'legalTermIntroB' },
  { heading: 'legalTermAccountH', body: 'legalTermAccountB' },
  { heading: 'legalTermBookH', body: 'legalTermBookB' },
  { heading: 'legalTermPayH', body: 'legalTermPayB' },
  { heading: 'legalTermWaitH', body: 'legalTermWaitB' },
  { heading: 'legalTermReviewH', body: 'legalTermReviewB' },
  { heading: 'legalTermSalonH', body: 'legalTermSalonB' },
  { heading: 'legalTermUseH', body: 'legalTermUseB', list: 'legalTermUseL' },
  { heading: 'legalTermAvailH', body: 'legalTermAvailB' },
  { heading: 'legalTermEndH', body: 'legalTermEndB' },
  { heading: 'legalTermLawH', body: 'legalTermLawB' },
  { heading: 'legalTermChangeH', body: 'legalTermChangeB' },
];

const TABS: { key: LegalTab; label: keyof Dictionary }[] = [
  { key: 'privacy', label: 'legalTabPrivacy' },
  { key: 'terms', label: 'legalTabTerms' },
];

/**
 * Renders a paragraph, isolating every `[[…]]` run as left-to-right.
 *
 * Latin names sitting inside an Arabic sentence — Supabase, GitHub Pages —
 * are exactly the mixed-script runs CLAUDE.md §4 warns about: the trailing
 * punctuation is bidi-neutral and reorders around them. Marking them in the
 * dictionary keeps the values plain strings, which is what `Dictionary`
 * requires, and costs nothing in English where `.ltr-run` is a no-op.
 */
function Bidi({ text }: { text: string }) {
  const parts = text.split(/\[\[(.+?)\]\]/g);
  return (
    <>
      {parts.map((part, index) =>
        // split() with one capture group puts the captured runs at odd indices.
        index % 2 === 1 ? (
          <span key={`${index}-${part}`} className="ltr-run">
            {part}
          </span>
        ) : (
          part
        ),
      )}
    </>
  );
}

export function Legal() {
  const { t, state, dispatch, backIcon, isArabic } = useApp();

  const sections = state.legalTab === 'privacy' ? PRIVACY : TERMS;

  return (
    <Screen bottomInset={28}>
      <ScreenHeader
        onBack={() => dispatch({ type: 'back' })}
        backIcon={backIcon}
        backLabel={isArabic ? 'رجوع' : 'Back'}
        title={t.legalTitle}
        subtitle={t.legalSub}
      />

      {/*
        A reviewer may well arrive here from a store listing rather than from
        inside the app, so the language switch is on the page itself — there is
        no header above this screen carrying one.
      */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '14px 24px 0' }}>
        <LangToggle variant="pill" />
      </div>

      {/*
        Said before anything else, and styled so it cannot be mistaken for a
        footnote. Publishing an unreviewed policy as though it were settled is
        the failure mode worth designing against.
      */}
      <div
        role="note"
        style={{
          margin: '14px 24px 0',
          padding: '13px 15px',
          borderRadius: 14,
          background: color.cream,
          border: `1px solid ${color.creamLine}`,
        }}
      >
        <div style={{ font: `700 12px ${font.sans}`, color: color.goldLink }}>
          {t.legalDraftTitle}
        </div>
        <p
          style={{
            font: `500 11.5px/1.6 ${font.sans}`,
            color: color.inkSoft,
            margin: '6px 0 0',
          }}
        >
          {t.legalDraftBody}
        </p>
        <p
          style={{
            font: `600 11.5px/1.6 ${font.sans}`,
            color: color.inkSoft,
            margin: '8px 0 0',
          }}
        >
          {t.legalDraftBlanks}
        </p>
      </div>

      <div
        role="tablist"
        aria-label={t.legalTitle}
        style={{
          display: 'flex',
          gap: 8,
          padding: '18px 24px 0',
        }}
      >
        {TABS.map((tab) => {
          const active = state.legalTab === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => dispatch({ type: 'setLegalTab', tab: tab.key })}
              className="press"
              style={{
                flex: 1,
                padding: '10px 12px',
                borderRadius: 12,
                background: active ? color.ink : color.surfaceSand,
                color: active ? color.page : color.muted,
                border: active ? 'none' : `1px solid ${color.lineSand}`,
                font: `700 12.5px ${font.sans}`,
              }}
            >
              {t[tab.label]}
            </button>
          );
        })}
      </div>

      <div style={{ padding: '4px 24px 0' }}>
        {sections.map((section) => (
          <section key={section.heading} style={{ marginTop: 22 }}>
            <h2
              style={{
                font: `600 17px ${font.serif}`,
                color: color.ink,
                margin: '0 0 6px',
              }}
            >
              {t[section.heading]}
            </h2>
            <p
              style={{
                font: `500 12.5px/1.7 ${font.sans}`,
                color: color.inkSoft,
                margin: 0,
              }}
            >
              <Bidi text={t[section.body]} />
            </p>
            {section.list ? (
              <ul
                style={{
                  margin: '10px 0 0',
                  paddingInlineStart: 18,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                }}
              >
                {t[section.list].split('\n').map((item) => (
                  <li
                    key={item}
                    style={{
                      font: `500 12.5px/1.7 ${font.sans}`,
                      color: color.inkSoft,
                    }}
                  >
                    <Bidi text={item} />
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        ))}
      </div>
    </Screen>
  );
}
