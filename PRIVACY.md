# Peekword privacy policy

Effective date: 2026-10-10

Peekword is a browser extension that shows the meaning of a word you select. This page explains what happens to your data when you use it.

## In short

- Peekword has **no account, no server, no analytics, and no advertising**.
- The author of Peekword **collects no data** from you.
- The word you look up is sent to public dictionary services to fetch its definition.
- Nothing is saved: no history, no cookies, no local storage.

## What Peekword reads

When you open the Peekword popup, it reads the text you have selected in the **tab you are currently viewing**, and only then. It does not read the rest of the page, does not run on pages in the background, and does not look at your other tabs.

If nothing is selected, you can type a word into the popup instead.

## What is sent, and to whom

To show a definition, Peekword sends the selected or typed word to:

1. **api.dictionaryapi.dev** (the Free Dictionary API), and
2. **en.wiktionary.org** (Wiktionary, operated by the Wikimedia Foundation), only when the first service is unavailable or has no entry for the word.

Only the word itself is sent. Like any web request, these requests are visible to those services together with your IP address and your browser's standard request headers. Their handling of that information is governed by their own policies, not by Peekword:

- Wikimedia Foundation Privacy Policy: https://foundation.wikimedia.org/wiki/Policy:Privacy_policy
- dictionaryapi.dev: see https://dictionaryapi.dev/

## Pronunciation

The Listen button uses your browser's built-in speech synthesis. Depending on the voice your system or browser chooses, the speech may be generated on your computer or by an online voice service operated by your browser or operating system vendor. Peekword does not control or receive that audio.

## What is not collected or stored

- No personal information, identifiers, or account details.
- No browsing history or page content.
- No lookup history. Closing the popup discards the entry.
- No data is sold, shared with advertisers, or used for any purpose other than showing the definition you asked for.

## Permissions

Peekword requests only what it needs: `activeTab` and `scripting` to read your selection in the current tab when you open the popup, and access to the two dictionary hosts above to fetch definitions. It does not use content scripts, a background worker, or storage.

## Changes

If this policy changes, the updated version will be published in this repository with a new effective date.

## Contact

Questions or concerns can be raised by opening an issue in this repository.
