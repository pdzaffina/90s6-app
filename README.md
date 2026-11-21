# 90S6 App

The authenticated 90S6 workspace at **https://app.90s6.com**.

A static HTML/CSS/vanilla JavaScript application hosted on GitHub Pages. Supabase provides authentication, Postgres, Storage, row-level security, and the `admin-users` Edge Function.

## Repository and deployment

- Repository: `90s6-app`
- Production hostname: `app.90s6.com`
- Hosting: GitHub Pages, deployed by `.github/workflows/pages.yml`
- Backend: Supabase
- Frontend: no framework, bundler, or npm dependencies

The repository is intended to be public. The Supabase anon key is a browser key and is not a secret. Never commit a Supabase service-role key, access token, or password.

## 1. Create and publish the GitHub repository

Create a **public** repository named `90s6-app` under the GitHub account that owns the 90S6 website. Upload the contents of this folder to the repository root, preserving the directory structure, and use `main` as the default branch.

The `CNAME` file is already set to `app.90s6.com`. The Pages workflow deploys the repository root on every push to `main`.

In GitHub, open **Settings → Pages** and select **GitHub Actions** as the build and deployment source. After the first successful deployment, add `app.90s6.com` as the custom domain if GitHub has not already picked it up from `CNAME`, then enable **Enforce HTTPS** when it becomes available.

## 2. Configure Squarespace DNS

In Squarespace, open the domain's DNS settings for `90s6.com` and add this record:

| Type | Host | Data / Points to | TTL |
| --- | --- | --- | --- |
| CNAME | `app` | `pdzaffina.github.io` | Default |

This creates `app.90s6.com`. Do not change the existing root (`@`) or `www` records used by the main 90S6 website. If an `app` record already exists, remove or replace the conflicting record before adding this CNAME.

DNS propagation and GitHub's HTTPS certificate issuance can take some time. Do not treat the domain as live until GitHub Pages reports the custom domain as configured and HTTPS is available.

## 3. Configure Supabase

1. In the Supabase SQL Editor, run `supabase/setup.sql`. It is designed to be re-runnable.
2. Create your own user in Supabase Authentication. Then run the commented SQL statement at the bottom of `supabase/setup.sql` to make your profile the first admin.
3. Deploy the Edge Function from this repository:

   ```bash
   supabase functions deploy admin-users
   ```

4. In Supabase Authentication settings:
   - Disable public sign-ups.
   - Keep email confirmation enabled.
   - Set the Site URL to `https://app.90s6.com`.
   - Add `https://app.90s6.com/**` to the redirect URL allowlist.
   - Set a minimum password length of at least 12 characters.
5. Set the Edge Function secret `APP_ORIGIN` to `https://app.90s6.com` if you need to override its default. Supabase supplies `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to the function runtime. The service-role key must remain there and nowhere in the browser or repository.

## 4. Configure the browser client

After creating the Supabase project, run:

```bash
./configure.sh <project-ref> <anon-public-key>
```

This replaces the project reference in `shared/config.js` and the Content Security Policy `connect-src` directives. It also fills the public anon key in the browser config.

Review the resulting diff before committing. The anon key is public by design; RLS policies are the security boundary.

## Application structure

- `index.html`, `home.js`: authenticated launcher and password change
- `shared/`: one Supabase client, sign-in gate, navigation, shared styling, audit formatting
- `work-board/`: Work Board feature, nested tasks, WBS view, sharing, attachments, activity
- `admin/`: user invitations, account management, admin audit view
- `supabase/setup.sql`: database schema, functions, grants, RLS, Storage, audit triggers
- `supabase/functions/admin-users/`: privileged admin operations

## Security notes

- RLS is the actual data-access boundary. Client-side visibility checks are only presentation.
- Never put the service-role key in this repository or in browser JavaScript.
- Keep public sign-up disabled. Users should be invited by an administrator.
- The `admin-users` Edge Function verifies the caller's active admin status before performing privileged actions.
- GitHub Pages cannot set response headers. The original specification recommends placing Cloudflare in front if you want additional response headers such as `X-Frame-Options`, `X-Content-Type-Options`, and `Referrer-Policy`.
- Same-origin pages share browser storage and the Supabase session. Only deploy trusted code under `app.90s6.com`.

## Current validation status

The supplied build reports simulated-browser and local-Postgres testing. It has not yet been validated against a live Supabase project, real Supabase Storage, invitation email delivery, a production Edge Function runtime, or the production domain. Complete those checks before inviting client users.
