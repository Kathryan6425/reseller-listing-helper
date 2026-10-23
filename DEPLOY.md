# Putting the Reseller Listing Helper Online — Step by Step

Don't rush. Do these in order, one sitting is fine. Everything here is **free**.
You'll use things you already have: your **GitHub** account, your **Netlify**
account (geeksmithmadeapps@gmail.com), your **Supabase** account, and one new
free key from Google.

What you're looking at in this folder:

| File | What it is |
| --- | --- |
| `index.html`, `styles.css`, `app.js` | The app itself — the part people see |
| `config.js` | One tiny settings file where your Supabase address + public key go (Step 5) |
| `supabase-setup.sql` | The one-time database setup you paste into Supabase (Step 5) |
| `netlify/functions/generate-listing.js` | The behind-the-scenes "listing writer" that talks to the AI |
| `netlify.toml` | A tiny settings note that tells Netlify where things live |

**One thing to know up front:** everybody who uses the app **creates a free
account** (email + password) and signs in. Each person's listings are saved
**in the cloud, under their account** — so if you sign in on a new phone, your
whole shelf is right there. Nobody can see anybody else's listings.

---

## Step 1 — Get your free AI key (the GEMINI_API_KEY)

The app writes listings using Google's AI, called **Gemini**. To use it, the
site needs a key — think of it like a library card for the AI. It's free.

1. Go to **aistudio.google.com** and sign in with your business Google account
   (geeksmithmadeapps@gmail.com).
2. Look for **"Get API key"** (top area of the page) and click it.
3. Click **"Create API key"**. If it asks you to pick a project, pick the
   default one it offers (or "Create API key in new project").
4. It will show you a long string of letters and numbers. That is your key.
   **Copy it and keep it somewhere private for now** (like your Notes app).

⚠️ **Golden rule:** the key is a secret, like a password. Never paste it into
the code files, never put it on GitHub, never post it anywhere. In the next
steps you'll paste it into **one private box inside Netlify** — that's the
only place it ever goes.

## Step 2 — Put this code on GitHub

1. Go to **github.com** and sign in.
2. Click the **+** in the top-right corner → **New repository**.
3. Name it: `reseller-listing-helper`
4. Leave everything else as-is (Public is fine — there's nothing secret in
   the code) and click **Create repository**.
5. On the new repo page, click **"uploading an existing file"**.
6. Drag in **all** the files and folders from this project folder —
   including the `netlify` folder. (On a phone this is hard; a computer is
   much easier for this one step.)
7. Click **Commit changes**.

## Step 3 — Connect the repo to Netlify

1. Go to **netlify.com** and sign in (with GitHub or your business email).
2. Click **Add new site** → **Import an existing project**.
3. Click **GitHub**, and if it asks, authorize Netlify to see your repos.
4. Pick the **`reseller-listing-helper`** repository.
5. On the settings screen it shows:
   - **Build command:** leave it **blank**.
   - **Publish directory:** `.` (just a dot).
   The included `netlify.toml` file already tells Netlify about the
   functions folder, so you don't need to change anything else.
6. Click **Deploy site**. Netlify will think for a minute, then give your
   site an address like `something-something-123.netlify.app`.
   (You can rename it later under **Site settings → Change site name**.)

## Step 4 — Give Netlify the AI key (the important one)

The site will load without this, but the **"Write my listing"** button will
fail with a message saying the AI key isn't set up. Here's the fix:

1. In Netlify, open your site, then go to **Site settings** → **Environment
   variables**.
2. Click **Add a variable**.
   - **Key:** `GEMINI_API_KEY` (type it exactly like that, all caps)
   - **Value:** paste the key you copied in Step 1.
3. Save it.
4. Now make Netlify pick it up: go to the **Deploys** tab → **Trigger
   deploy** → **Deploy site**. Wait for the deploy to say **Published**.

That's it — the key now lives only inside Netlify, where visitors (and
GitHub) can never see it.

## Step 5 — Turn on accounts (Supabase)

This is what lets people create accounts and keeps each person's shelf saved
in the cloud. You already have a Supabase account — here's the one-time setup:

1. Go to **supabase.com** and sign in, then open (or create) your project.
   Pick any name you like; the free plan is fine.
2. **Make the listings table:** in the left menu click **SQL Editor** →
   **New query**. Open the file **`supabase-setup.sql`** from this project,
   paste the *whole thing* in, and click **Run**.
   You should see "Success" — that created the table and the privacy rules
   (each user can only ever touch their own rows).
3. **Get your two public values:** go to **Project Settings** (gear icon) →
   **API**. You'll see:
   - **Project URL** — looks like `https://abcd1234.supabase.co`
   - **anon public** key — a long string starting with `eyJ...`
4. **Put them in `config.js`:** open the `config.js` file (in GitHub, open the
   file and click the pencil ✏️), and paste the URL between the quotes on the
   `supabaseUrl` line and the anon key between the quotes on the
   `supabaseAnonKey` line. Save / **Commit changes**.

   ⚠️ **Important:** there are two keys on that API page. Use **anon public**
   ONLY. The other one is called **service_role** and it is a master secret —
   never put it in `config.js`, never put it on GitHub, never share it.
   (`config.js` is fine to be public *with the anon key in it* — the privacy
   rules from step 2 are what actually protect everyone's listings.)

5. **Redeploy:** Netlify usually redeploys on its own when GitHub changes.
   If it doesn't, go to Netlify → **Deploys** → **Trigger deploy** →
   **Deploy site**, and wait for **Published**.

   Until this step is done, the site politely shows a "finishing setup"
   notice instead of the sign-in box — that's your sign the values in
   `config.js` are still empty.

## Step 6 — Check it's really live ✅

1. Open your site's address (the `.netlify.app` link) on your phone.
2. You should see the **sign-in card**. Type your email + a password and tap
   **Create account**. (If it tells you to check your email and tap a confirm
   link, do that, then come back and **Sign in**.)
3. Tap **⌨️ Type it** and type something like:
   `women's black Converse high-tops, size 9.5, good condition`
4. Tap **✨ Write my listing**.
5. Within a few seconds you should get a finished listing — title,
   description, and a price with a range — saved as a **Draft** on your shelf.
6. Try the photo way too: **📸 Snap a photo**, take a picture of something,
   and tap the button again.
7. Tap a listing on the shelf: try the **Copy** buttons, a **Rewrite** style,
   and moving it from Draft → Ready.

If all of that works, you are live. Send the link to a friend — that's your
app, on the real internet, for $0. 🎉

---

## If something goes wrong

- **"The AI key isn't set up on the server yet"** → Step 4 wasn't finished,
  or the deploy after adding the key didn't run yet. Add the variable, then
  **Trigger deploy** again and wait for "Published."
- **"The free AI is busy right now (rate limit)"** → Google's free tier is
  just crowded. Wait a minute and try again. Your photo/text stays put.
- **Page loads but looks plain/unstyled** → check that `styles.css` got
  uploaded to GitHub with that exact name.
- **Buttons do nothing at all** → check that `app.js` was uploaded too, and
  that the `netlify` folder (with `functions` inside it) made it into the
  repo.
- **Site says "finishing setup" instead of a sign-in box** → the two values
  in `config.js` are still empty. Do Step 5, parts 3–5.
- **"Create account" worked but signing in says the email isn't confirmed**
  → tap the confirm link in the welcome email first, then sign in.
- **Signed in but the shelf stays empty / listings won't save** → the SQL
  in Step 5 part 2 probably didn't run (or ran in a different project than
  the one whose URL is in `config.js`). Run `supabase-setup.sql` once in the
  same project, then try again.
- **Listings missing on a different phone** → sign in with the *same* email
  on that phone. Your shelf lives in your account now, not on the phone —
  a different email means a different (empty) shelf.

## What's next, later (not now)

- A nicer site name (Netlify rename — free).
- Google Play ($25, one time) wraps this same site into a store app.
- The Apple App Store ($99/year) comes after it's earning.
