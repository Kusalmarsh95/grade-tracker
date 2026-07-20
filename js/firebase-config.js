/* =========================================================
   U.B. Jayasooriya Maha Vidyalaya — Grade Tracker
   Cloud sync configuration

   This is the ONLY file you need to edit to turn on real-time
   sync between teachers' phones. Until you do, the app keeps
   working exactly as before — fully offline, per device.

   HOW TO SET THIS UP (about 5 minutes, completely free):
   1. Go to https://console.firebase.google.com and sign in with
      any Google account.
   2. Click "Add project", give it any name (e.g. "ubjmv-grades"),
      and finish the wizard (you can turn off Google Analytics).
   3. In your new project, click the "</>" (Web) icon to register
      a web app. Give it any nickname and click "Register app".
   4. Firebase will show you a firebaseConfig object. Copy the six
      values it gives you into FIREBASE_CONFIG below, replacing the
      "PASTE_..." placeholders exactly as shown.
   5. In the left sidebar click "Build" -> "Firestore Database" ->
      "Create database". Choose any nearby region and start in
      "production mode".
   6. Once created, click the "Rules" tab and replace the contents
      with the rules shown in the setup guide you were given, then
      click "Publish".
   7. Save this file, re-upload the whole project to GitHub Pages
      (or wherever it's hosted), and reload the app. Go to the
      "Sync" tab in the app and create a shared code — every
      teacher who enters that same code on their own phone will
      then see and add to the same live class data.

   Note on security: because there's no login system, anyone who
   knows your sync code (and your Firebase project) could read or
   write that shared data — the rules above trust the code itself
   as the "password". That's a reasonable trade-off for a small
   staff tool, but don't publish your sync code anywhere public,
   and pick something longer than "1234", e.g. "ubjmv-grade6-2026".
   ========================================================= */

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyDXdyX50nZwRecMQwThkBAmFxb64jusWyY",
  authDomain: "ubj-grade-tracker.firebaseapp.com",
  projectId: "ubj-grade-tracker",
  storageBucket: "ubj-grade-tracker.firebasestorage.app",
  messagingSenderId: "5661236409",
  appId: "1:5661236409:web:222f6bb100526b3b218f68"
};
