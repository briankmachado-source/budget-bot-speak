<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Keep voice recognition continuously active after user activation, automatically recovering from browser silence or interruption, because voice is the app's primary interaction.
- No AI/LLM and no YouTube: voice commands are parsed by fixed Spanish phrase rules in `src/lib/commands.ts`. Why: zero per-use cost and no third-party quotas for thousands of users.
- The app has no income/expense finance panel: no balance, charts, transaction form or transaction voice commands. Voice commands cover only reminders and weather (src/lib/commands.ts); keep parseAmount there because PaymentPanel uses it.
- Keep scheduled payments in their own owner-scoped table and PaymentPanel.
- Use a shared confirmation-based DeleteButton for record deletion; show actions on touch screens and update query caches after successful writes.
- Reuse ReminderDateInput for compact reminder date fields and reminder-edit helpers for update validation; rescheduling clears the notification flag while title-only edits preserve it so reminders can alert at their new time.
