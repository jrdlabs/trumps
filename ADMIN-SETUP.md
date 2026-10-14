# Admin test area

After merging this change, open https://jrdlabs.github.io/trumps/admin.html . The hub also links to it. The approved Google email is configured privately in the existing Supabase project's allowlist. No password is needed, and no approved email or OAuth secret is shipped in the public frontend.

## One-time Google setup

Google sign-in is currently disabled in this Supabase project. Signing into the Supabase dashboard with Google does not configure Google login for your own application.

1. Open [Google Auth Platform](https://console.cloud.google.com/auth/overview) in your Google Cloud project (create a project if needed). Configure Branding and Audience. While the app is in testing, add your own Google account as a test user. Only basic `openid`, email, and profile scopes are needed.
2. Create a **Web application** OAuth client. Authorized JavaScript origin: `https://jrdlabs.github.io`. Authorized redirect URI: `https://yxaxfnoveylmtjzbbbee.supabase.co/auth/v1/callback`.
3. In [Supabase → Authentication → Providers](https://supabase.com/dashboard/project/yxaxfnoveylmtjzbbbee/auth/providers), enable **Google** and paste the Google client ID and secret there. Save. Keep these credentials out of source files and chat.
4. In [Supabase → Authentication → URL Configuration](https://supabase.com/dashboard/project/yxaxfnoveylmtjzbbbee/auth/url-configuration), add the exact redirect URL `https://jrdlabs.github.io/trumps/admin.html`. Preserve existing URLs/settings used by other apps in this shared project; do not replace the Site URL just for this feature.
5. Once the pull request is merged and Pages publishes, open the admin page and choose **Continue with Google**, selecting your approved account.

Optional local testing: add `http://127.0.0.1:8080/admin.html` to Supabase's redirect list and use the local preview server. Remove local-only URLs when no longer needed.

See [Supabase's Google sign-in documentation](https://supabase.com/docs/guides/auth/social-login/auth-google).

## Test controls

- **New test table:** seats you and three bots immediately.
- **Control seat:** switch to any seat and play its legal tiles. Automatic bots play all seats other than the selected seat.
- **Run bots automatically:** bots take one turn about every second; uncheck to pause. Changing seats, loading a situation, restarting, hiding the page, or signing out pauses them.
- **Play one turn automatically:** advances the current turn, including your selected seat. Useful for quickly exercising a complete match.
- **Reveal all hands:** private admin-only live-hand visibility.
- **Restart match / Deal next hand:** reset scores/deal, or advance a completed hand.
- **Situations:** blocked hand, tied block, last-tile win, and previous-winner opening. These use synthetic short hands, intentionally not a full 28-tile deal.

Closing/reopening the admin page restores the last test room when available. The newest ten rooms per admin are retained; creating more discards older test fixtures. Normal tables cannot join or open these rooms. Test history stays within its marked test room; no Trumps history/statistics are written. There are currently no global Dominoes stats, so any future aggregator must exclude `dominoes_private.test_sessions`.

## Implementation and database status

The `dominoes_admin_test_mode` migration has already been applied to the existing Supabase project, and the approved email allowlist is configured. **Do not rerun the migration on the existing project.** `supabase/dominoes-admin.sql` is the one-time upgrade for another environment, after the base Dominoes and winner-starts SQL. Configure that environment's private allowlist separately through its SQL editor.

The shared authoritative rules now live in `dominoes_private.engine`. Clients cannot execute it or supply another player's identity. Normal `dominoes_action` calls use the caller's own identity and reject test rooms. Admin calls first check an approved email against a server-maintained, verified Google identity in `auth.identities`, then confirm test-room ownership. Editable user metadata is never used to grant admin access.

Admin login uses a separate browser storage key and PKCE OAuth flow. It does not replace the anonymous Supabase session used by Trumps and Dominoes. Local admin sign-out does not sign the player session out.

`supabase/dominoes-admin-test.sql` rolls back all fixtures and tests authorization, spoofed metadata rejection, engine execution denial, regular/test isolation, hand reveal and seat views, a full bot match, restart, and every scenario. Existing regular Dominoes regression tests remain applicable. Database tests use synthetic Google identity fixtures; the actual Google redirect/login must be verified after provider setup. Visual browser testing also remains outstanding because the in-app browser cannot reach the local preview.

Advisor informational notices for private RLS tables without policies are intentional deny-all access, with all direct client privileges revoked. The existing project's unrelated account/Trumps advisories are unchanged; [RLS advisor explanation](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).
