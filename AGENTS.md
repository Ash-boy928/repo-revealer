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
- backend/ holds the Telegram bot server split into ordered section files assembled by scripts/assemble.mjs; why: guarantees runtime identical to the original monolith while making sections editable.
- backend/ is the bot's runtime folder (HTML, icons, src helpers) with no root server.ts; the section order lives in backend/modules.manifest.json because backend/manifest.json is the PWA manifest the server serves.
- flutter_telebot/ and .github/workflows/ stay at the repo root; why: the APK workflow copies flutter_telebot/ from the repo root.
- go_mtproto_engine/ is an isolated Go module (gotd/td) for the future mobile engine; why: it must never affect the live Node bot in backend/.
