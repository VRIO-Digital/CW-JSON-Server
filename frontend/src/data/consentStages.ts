/**
 * The stages of a Google sign-in, one per call the wizard actually makes:
 * `/sources/oauth/start`, `/sources/oauth/callback`, then the connector's
 * discovery twin (`/sources/oauth/projects` or `/sources/oauth/drives`).
 *
 * Kept beside the panel rather than inside it so the labels can be asserted, and
 * so the two connectors are visibly the same list in different units. **Add a
 * stage only when there is a request behind it** — a row that ticks without one
 * claims progress the handshake has not made.
 */
import { providerBrand } from './providerBrand'

export const CONSENT_STAGES = {
  bigquery: [
    'Opening the Google sign-in',
    'Granting read-only access to BigQuery',
    'Reading the projects this account can see',
  ],
  drive: [
    'Opening the Google sign-in',
    'Granting read-only access to Drive',
    'Reading the drives this account can see',
  ],
  gmail: [
    'Opening the Google sign-in',
    'Granting read-only access to Gmail',
    'Reading the mailbox this account can see',
  ],
} as const

/**
 * The same three calls under a Microsoft-brand dataset — the list differs only in what the
 * products are called, because the handshake is the same three requests whoever the vendor is.
 */
export const CONSENT_STAGES_MICROSOFT = {
  bigquery: [
    'Opening the Microsoft sign-in',
    'Granting read-only access to Azure SQL Database',
    'Reading the servers this account can see',
  ],
  drive: [
    'Opening the Microsoft sign-in',
    'Granting read-only access to OneDrive',
    'Reading the libraries this account can see',
  ],
  gmail: [
    'Opening the Microsoft sign-in',
    'Granting read-only access to Outlook',
    'Reading the mailbox this account can see',
  ],
} as const

/** The stage list for a provider under the current brand. */
export const consentStagesFor = (provider: ConsentProvider): readonly string[] =>
  (providerBrand() === 'microsoft' ? CONSENT_STAGES_MICROSOFT : CONSENT_STAGES)[provider]

/**
 * A scope URL as it is shown to a reader — the last segment, which is the part that names the
 * permission. Shared by the consent panel and the sign-in window so one cannot abbreviate a scope
 * the other spells out.
 */
export const CONSENT_SCOPE_LABEL = (scope: string): string =>
  scope
    .replace('https://www.googleapis.com/auth/', '')
    /* Microsoft's scopes carry their resource as the host — Graph for documents and mail, the
       Azure SQL endpoint for the warehouse — and the last segment is likewise the permission. */
    .replace('https://graph.microsoft.com/', '')
    .replace('https://database.windows.net/', '')

/**
 * **What a reader is told when a consent changes who the console is showing.**
 *
 * The sign-in window offers the tenant's directory, so granting a consent as somebody else moves the
 * whole console to them — the sidebar, which pages are listed, what a Library row offers, whose chat
 * history Ask shows. That is not a thing to do silently: it is the same class of act as switching
 * dataset, which this app confirms in words and signs you out for.
 *
 * It names **both** people, for the reason the dataset dialog does: *"now signed in as X"* alone
 * leaves a reader working out what they were before, and the pair is what makes an accidental pick
 * obvious. And it states the remedy, because the persona it lands on may be one with less
 * navigation than the reader started with — `/settings` is routed unconditionally and the sidebar
 * always lists a way out, but "sign out and sign back in" is the sentence that makes that certain.
 *
 * Copy rather than a sentence built where it is printed, for the reason `sourceActions` is: the
 * wizard's own dialog portals out of `renderToString`, so a string written inline cannot be checked.
 */
export const IDENTITY_SWITCH = (from: string, to: string): string =>
  `Signed in as ${to} — this consent was granted by that account, so the console now shows their ` +
  `persona everywhere, not ${from}'s. Sign out and back in to return.`

export const CONSENT_SCOPES = {
  bigquery: 'bigquery.readonly',
  drive: 'drive.metadata.readonly',
  gmail: 'gmail.readonly',
} as const

/**
 * Plain-English copy for a scope, keyed by the scope URL itself.
 *
 * **The consent screen lists the scopes `/sources/oauth/start` returned, not a
 * list kept here** — a screen that says "one permission" while the handshake asks
 * for two is the exact misrepresentation a consent screen exists to prevent.
 * (Drive asks for two.) This map only supplies wording; an unmapped scope still
 * renders, as its bare URL, because showing it unexplained beats not showing it.
 *
 * `check-docs` asserts every scope the server can issue has an entry here.
 */
export const CONSENT_GRANT_COPY: Record<string, { title: string; detail: string }> = {
  'https://www.googleapis.com/auth/bigquery.readonly': {
    title: 'View your data in Google BigQuery',
    detail:
      'Datasets, tables and their schemas. Read-only — nothing is written, updated or deleted.',
  },
  'https://www.googleapis.com/auth/drive.metadata.readonly': {
    title: 'See information about your Google Drive files',
    detail: 'Names, folders, file types and sizes. Not the contents.',
  },
  'https://www.googleapis.com/auth/drive.readonly': {
    title: 'See and download all your Google Drive files',
    detail:
      'Needed to extract text and entities when you profile a document. Read-only — no file is modified.',
  },
  'https://www.googleapis.com/auth/gmail.readonly': {
    title: 'Read your email messages and settings',
    detail:
      'Labels, messages and their attachments. Read-only — ContextWeave can never send, modify or ' +
      'delete mail, and this connector profiles nothing.',
  },
  /*
   * The Microsoft scopes, under a Microsoft-brand dataset. Each title is the wording Microsoft's
   * own consent screen uses for that permission, for the reason the Google titles are Google's:
   * a consent screen that rewords a grant is describing a different grant.
   */
  'https://database.windows.net/user_impersonation': {
    title: 'Access Azure SQL Database as you',
    detail:
      'Servers, databases, tables and their schemas, with your own permissions. ContextWeave only ' +
      'ever reads — nothing is written, updated or deleted.',
  },
  'https://graph.microsoft.com/Files.Read.All': {
    title: 'Read all files that you have access to',
    detail:
      'Names, folders, file types and contents, so a document can be profiled. Read-only — no file ' +
      'is modified.',
  },
  'https://graph.microsoft.com/Sites.Read.All': {
    title: 'Read items in all site collections',
    detail: 'Needed to list the shared libraries this account can reach. Not the files themselves.',
  },
  'https://graph.microsoft.com/Mail.Read': {
    title: 'Read your mail',
    detail: 'Access and read emails in your Outlook mailbox.',
  },
  /*
   * The two grants every Microsoft consent carries, around the connector's resource scope — served
   * by `OAUTH_SCOPES_MICROSOFT`, so the rows on screen are requests really being made. The titles
   * are Microsoft's own wording for each permission, same rule as every entry above.
   */
  'https://graph.microsoft.com/User.Read': {
    title: 'Sign in and read your profile',
    detail: 'View your basic profile (name, email, photo).',
  },
  offline_access: {
    title: 'Maintain access to data you have given it access to',
    detail: 'Allows ContextWeave to access your data until you revoke access.',
  },
}

export type ConsentProvider = keyof typeof CONSENT_STAGES

/**
 * The browser window this sign-in is pretending to be, as a title and an address.
 *
 * **Asked for: the reference screens are a Chrome popup, not a bare card.** The chrome is most of
 * what makes them read as Google's rather than as a dialog this app drew, so the window carries a
 * title bar and an address bar above the page.
 *
 * **The address is derived from the screen, which is the point of it being here.** A single static
 * URL would sit unchanged while the window moved from the chooser to the consent, which is the one
 * thing a real address bar never does — each of Google's three screens has its own path. It is a
 * pure function so it can be asserted without rendering the window, the reason every other rule in
 * `src/data/` is one.
 *
 * **The opaque token is hashed from the account**, so it is stable across renders rather than
 * re-rolled on every keystroke elsewhere in the wizard — a query string that changed while the
 * reader sat on one screen would be the animated-progress-bar fault in another form. It is
 * deliberately meaningless: it stands in for Google's own state parameter and nothing reads it.
 */
export function signInWindowChrome(
  phase: 'account' | 'confirm' | 'consent' | 'granting',
  app: string,
  email: string,
): { title: string; url: string } {
  let n = 0
  for (let i = 0; i < email.length; i += 1) n = (n * 31 + email.charCodeAt(i)) >>> 0
  const token = String(n).padStart(9, '0').slice(0, 9)

  /*
   * A Microsoft-brand dataset's handshake goes through login.microsoftonline.com, so the window
   * standing in for it carries that address. The `- Google Chrome` suffix stays on both brands,
   * because it names the **browser** the popup opens in, not the vendor being signed in to.
   */
  if (providerBrand() === 'microsoft') {
    /* Two addresses, not three: the Microsoft flow is the email screen then the permissions
       screen — its password screen was removed on request, and `confirm` is unreachable there. */
    if (phase === 'account') {
      return {
        title: 'Sign in to your account - Google Chrome',
        url: 'login.microsoftonline.com/common/oauth2/v2.0/authorize?prompt=select_account&cli…',
      }
    }
    return {
      title: 'Let this app access your info? - Google Chrome',
      url: `login.microsoftonline.com/common/oauth2/v2.0/authorize?state=S${token}…`,
    }
  }

  if (phase === 'account') {
    return {
      title: 'Sign in - Google Accounts - Google Chrome',
      url: 'accounts.google.com/v3/signin/accountchooser?access_type=offline&cli…',
    }
  }
  if (phase === 'confirm') {
    return {
      title: 'Sign in - Google accounts - Google Chrome',
      url: `accounts.google.com/signin/oauth/id?authuser=1&part=AJi8hA${token.slice(0, 6)}…`,
    }
  }
  return {
    title: `${app} wants to access your Google Account - Google Ch…`,
    url: `accounts.google.com/signin/oauth/consent?as=S${token}%3A178999…`,
  }
}

/**
 * The words the sign-in window prints, per brand — everything on it that names the vendor.
 *
 * Declared here beside the chrome and the grant copy rather than written into the component, for
 * the reason every string in this file is: the window portals out of `renderToString`, so a
 * sentence written inline cannot be asserted. The *structure* of the window is one component for
 * both brands — four phases, an account list, a grant per served scope — because the handshake is
 * the same handshake; what a brand owns is the wording.
 */
export interface SignInWindowCopy {
  /** The header under the chrome — Google writes a sentence, Microsoft its wordmark. */
  headText: string
  chooserTitle: string
  /** What the vendor calls the account being granted against — "Google Account" / "Microsoft account". */
  accountNoun: string
  /** The consent title's tail, after the app's name. */
  consentTitleTail: string
  /** The verb that spends the consent — Google's Allow, Microsoft's Accept. */
  allowLabel: string
  /** The "learn more about …" phrase on the confirm screen. */
  signInName: string
  closeAria: string
  footLeft: string
  footLinks: string[]
}

export const SIGN_IN_WINDOW_COPY: Record<'google' | 'microsoft', SignInWindowCopy> = {
  google: {
    headText: 'Sign in with Google',
    chooserTitle: 'Choose an account',
    accountNoun: 'Google Account',
    consentTitleTail: 'wants to access your Google Account',
    allowLabel: 'Allow',
    signInName: 'Sign in with Google',
    closeAria: 'Close the Google sign-in',
    footLeft: 'English (United States)',
    footLinks: ['Help', 'Privacy', 'Terms'],
  },
  microsoft: {
    headText: 'Microsoft',
    chooserTitle: 'Pick an account',
    accountNoun: 'Microsoft account',
    consentTitleTail: 'wants to access your Microsoft account',
    allowLabel: 'Accept',
    signInName: 'Sign in with Microsoft',
    closeAria: 'Close the Microsoft sign-in',
    footLeft: 'English (United States)',
    footLinks: ['Terms of use', 'Privacy & cookies'],
  },
}

export const signInWindowCopy = (): SignInWindowCopy => SIGN_IN_WINDOW_COPY[providerBrand()]

/**
 * The Microsoft sign-in's one screen, word for word from the reference screenshot: **Sign in**,
 * with an email box rather than an account chooser — Microsoft's login asks you to type. Google's
 * flow keeps its chooser; this list is read only when the brand is Microsoft.
 *
 * **It was two screens, and the second is gone — removed on request**, together with two lines of
 * the first: *Enter your password* (the back arrow, the address pill, the theatrical password box
 * and its eye), the *Sign-in options* strip, and *Can't access your account?*. Next on the email
 * screen now goes straight to the permissions screen, which is where the grant was always made —
 * the password was theatre that never left the component, so nothing about the handshake changed.
 * Their copy went with them, because a string nothing renders is an invitation for the screen to
 * come back. **Do not restore any of it without being asked.**
 *
 * Here rather than in the component for the reason every sign-in string is: the window portals out
 * of `renderToString`, so a sentence written inline cannot be asserted. *Create one!* — a link on
 * the real screen — is rendered as marked text, never an anchor: this window opens nothing, and a
 * blue underline that goes nowhere is the control-with-no-destination refused everywhere else.
 */
export const MICROSOFT_SIGN_IN = {
  title: 'Sign in',
  emailPlaceholder: 'Email, phone, or Skype',
  noAccount: 'No account?',
  createOne: 'Create one!',
  next: 'Next',
  invalidEmail: 'Enter a valid email address, phone number, or Skype name.',
} as const

/**
 * The Microsoft consent screen's own words — the reference screenshot's *Let this app access your
 * info?* dialog, which replaced a Google-shaped consent wearing Microsoft words (asked for against
 * the two screenshots). The grant rows themselves are still the scopes `/sources/oauth/start`
 * returned, titled through `CONSENT_GRANT_COPY`; what this holds is everything around them.
 *
 * The phrases that are links on the real screen (*privacy statement*, *Microsoft account*, *Learn
 * more about the permissions*) are rendered as marked text, never anchors — this window opens
 * nothing. The domain under the app's name is the tenant's own web address, the one the What-if
 * receipt and the share links already print.
 */
export const MICROSOFT_CONSENT = {
  title: 'Let this app access your info?',
  appName: 'ContextWeave',
  appDomain: 'contextweave.com',
  lead: 'This app would like to:',
  /* Composed around the two marked phrases where it is printed, split here so no half is inline. */
  footAccepting:
    'Accepting these permissions means that you allow this app to use your data as specified in ' +
    'their terms of service and ',
  footPrivacy: 'privacy statement',
  footChange: '. You can change these permissions at any time in your ',
  footAccount: 'Microsoft account',
  footLearn: 'Learn more about the permissions',
  cancel: 'Cancel',
  accept: 'Accept',
  accepting: 'Accepting…',
} as const

/**
 * The colour Google tints an account's initial with.
 *
 * **Per account, not per position.** A hue keyed to the row index would move when the list
 * reordered — and this window's list does change length, since the reader's own row joins the two
 * declared accounts only when they are neither. A colour that shifted under a reader is worse than
 * one colour for everybody.
 *
 * The palette is Google's own account tints. Pure and here rather than in the component for the
 * reason every other rule in `src/data/` is: it can be asserted without rendering the window.
 */
const AVATAR_TINTS = ['#e8710a', '#5f6368', '#1a73e8', '#188038', '#a142f4', '#d93025']

export function avatarTint(email: string): string {
  /*
   * **Hashed on the local part, not the whole address.** Every account in this tenant ends
   * `@vriodigital.com`, and both a multiply-by-31 and an FNV-1a over the full string are dominated
   * by that shared tail — the two accounts the chooser always shows came out the same colour, which
   * is the one pair this has to separate. The part before the `@` is the part that differs.
   *
   * It is still a hash over a small palette, so a collision between *some* pair is possible; what
   * it guarantees is a stable colour per address, not a unique one. The row is identified by its
   * name and address, and the tint only helps the eye find it again.
   */
  const local = email.split('@')[0]
  let h = 0x811c9dc5
  for (let i = 0; i < local.length; i += 1) {
    h ^= local.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return AVATAR_TINTS[h % AVATAR_TINTS.length]
}
