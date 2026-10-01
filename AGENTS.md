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
- Chat: `/chat/$threadId` page + `/api/chat` streaming route (AI SDK useChat, Responses API with tools in `src/lib/chat.server.ts`); messages persisted in `chat_messages`. Why: threaded ChatGPT-style voice assistant with cloud history.
