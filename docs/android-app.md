# Saloni as an Android app

Turning this same web app into something installable from Google Play. Written
for somebody who has never opened Android Studio.

**Nothing is rewritten.** Capacitor puts the existing React build inside a
native shell — a full-screen browser with no address bar, plus a bridge to
things a web page cannot reach. Every screen, the Arabic layout and every
migration behind them are untouched.

**iOS is not set up here, and cannot be from Windows or Linux.** Xcode runs
only on macOS. When there is a Mac, `npx cap add ios` adds it; everything in
this repo is already arranged for it.

---

## What has been done for you

| | |
| --- | --- |
| Capacitor installed | `@capacitor/core`, `@capacitor/cli`, `@capacitor/android`, `@capacitor/app` |
| `capacitor.config.ts` | app id `com.saloni.app`, name **Saloni**, web files from `dist/` |
| `android/` | the Android Studio project, generated and committed |
| Hardware back button | `src/hooks/useHardwareBack.ts` — without it the app closes on the first press |
| Safe areas | the status bar and gesture line, in `global.css` |
| Push | honestly switched off in the app — see the last section |

**`com.saloni.app` is permanent once published.** A different id is a different
app on Google Play, with a different listing and no way to move installs
across. Change it in `capacitor.config.ts` now if you want something else; after
the first release it is settled for good.

---

## 1. Install Android Studio

1. Go to **https://developer.android.com/studio** and download it. It is free
   and about 1 GB; the SDK it then downloads is a few more.
2. Run the installer and accept the defaults. When it offers **Standard**
   setup, take it.
3. On first launch it downloads the Android SDK. Let it finish — this is the
   slow part, and nothing below works until it has.

You do not need to learn Android Studio. You are using it as a button that
builds and installs the app.

## 2. Build the app's web files

In the project folder, in a terminal:

```bash
npm install
npm run android
```

`npm run android` does two things: builds the web app into `dist/`, then copies
that build into the Android project. **Run it again after every change to the
app**, or Android Studio will keep installing the old one.

## 3. Open the project

```bash
npm run android:open
```

That builds, syncs, and opens Android Studio on the `android/` folder.

The first time, Android Studio spends several minutes on "Gradle sync" —
downloading the build tools. Let it finish. If it offers to upgrade the Gradle
plugin or the Android Gradle version, **say no** for now: the versions
Capacitor chose are the ones known to work together.

## 4. Run it on your own phone

Easier and more honest than the emulator — you see the real thing, at the real
size, with the real keyboard.

1. On the phone: **Settings → About phone → tap "Build number" seven times.**
   It will say you are now a developer.
2. **Settings → System → Developer options → turn on USB debugging.**
3. Plug the phone into the computer with a USB cable. The phone asks whether to
   trust this computer — say yes.
4. In Android Studio the phone's name appears in the dropdown at the top.
   Choose it and press the green **▶ Run** button.

Saloni installs and opens. It is a real app now — in the launcher, in the task
switcher, with its own icon.

### What to check on that first run

These are the things I could not test from here, in the order they are likely
to be wrong:

- **The top of the screen.** Android 15 forces apps to draw under the status
  bar. There is CSS that should push content clear of it, written from the
  specification rather than from seeing it. If headings sit under the clock,
  that is the thing to fix.
- **The back button.** From a salon page it should go back one screen; from the
  home screen it should send the app to the background. If a single press
  closes the app from anywhere, the hook is not firing.
- **Arabic.** Switch language and check the layout still flips.
- **Signing in.** The passcode e-mail should arrive and work exactly as on the
  web.

## 5. Build the file Google Play wants

Only when you are ready to submit.

Google Play takes an **AAB** (Android App Bundle), not an APK.

1. In Android Studio: **Build → Generate Signed App Bundle / APK**.
2. Choose **Android App Bundle**.
3. Choose **Create new…** to make a signing key. Fill in the form and pick a
   password.
4. **Save the keystore file and its password in a password manager.**

   This is the most important sentence in this document. That file is what
   proves a release is yours. **Lose it and you can never update Saloni on
   Google Play again** — not with a new key, not by asking support; you would
   have to publish a new app and ask every user to reinstall. It is excluded
   from git on purpose, so git is not your backup.

5. Choose **release** as the build type and finish. The `.aab` lands in
   `android/app/release/`.

That file is what you upload at **https://play.google.com/console** — a one-off
$25 registration.

---

## Two things that change once the app is in the store

**You lose "push and it's live".** Today a change deploys in about forty
seconds. Once the app is published, the web files are bundled *inside* it, so a
change reaches people only after a new release and a review — days, not
seconds. The web version at de7mi0.github.io keeps updating instantly and the
app does not. This is the main reason not to publish while the app is still
changing daily.

**Push notifications do not work in the app yet, and it says so.** Web push
needs the browser's own push service, which a system WebView does not have. The
app therefore reports that it cannot message you — which is true — and the
waitlist still works: the seat is held and is waiting when the app is next
opened, exactly as for somebody who never allowed notifications.

Making it work needs Firebase Cloud Messaging and a change to the sending
worker. The database side does not change: `push_subscriptions` and
`register_push_device()` already hold a device token whatever its shape. It is
a week of work rather than an afternoon, and it is the thing that finally makes
push work on an iPhone without asking people to add Saloni to their home
screen.
