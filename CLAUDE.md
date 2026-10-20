# Working rules for this repo (sapphirepanda.com)

## When to push to main (main auto-deploys to the live site via Vercel)
Agreed with Conor, 11 Oct 2026:
- Push straight away, then tell Conor: bug fixes, chat assistant updates
  (api/chat.js, assets/chat-widget.js, api/data/site-content.json), tooling
  and data scripts, and anything visitors don't read.
- Ask first and wait for Conor to say "push": anything that changes what
  visitors read or see on the site, such as wording, claims, stats, prices,
  new or removed pages, and design changes.

## Chat assistant
- After editing any page, rerun `python3 tools/build_chat_knowledge.py` so the
  chat knows the new text. It skips sections listed in SKIP_IDS that aren't
  accurate yet (engine, news).
- `CATALOGUE_LIVE` in api/chat.js stays false until real wines replace the
  demo data in api/data/wines.json.
- The API key is read from `ANTHROPIC_API_KEY` or `conor_claude_tokens`
  (Vercel, Production). Env var changes need a new deploy to take effect.

## Private data
- Winery contact details live in data/private/ (git-ignored). Never commit them.

## Match page "coming soon" mode (added 20 Oct 2026)
- While vineyards are being onboarded, /match shows the placeholder results
  blurred behind a "Coming soon" notice.
- To go live with real matches: remove the `cs-on` class from
  `<div id="results-view">` in match/index.html. Everything else (pallet
  sidebar, wine count, clickable cards, original intro line) comes back.
- The full design before this mode is commit 3e1b7f8 on main.
