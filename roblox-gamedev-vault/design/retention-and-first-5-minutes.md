# Retention and the First 5 Minutes
**Topic:** design  **Confidence:** medium-high (official docs + DevForum + several consistent third-party guides)

## What it is
Most players decide to stay or leave within the first few minutes. Retention (D1, D7, D30) is what the Roblox algorithm and your revenue both depend on.

## Why it works
- Roblox's own strategy docs say players should be able to answer "what makes this fun, what makes it different, is it worth replaying" within the first few minutes, and recommend avoiding long tutorials.
- Without first-week retention, monetization is moot: you are selling to people who already left.

## How to apply
1. Get the player doing the core action immediately (action, reward, or curiosity in the first ~30 seconds).
2. Engineer an "aha moment" by minute 3-5: first pet, weapon, upgrade, area unlock, level-up, or first PvP win.
3. Add small early achievements/badges tied to first actions.
4. Keep any tutorial under ~3 minutes (one source says longer kills retention) and teach by doing.
5. Use Roblox Funnel Analytics to find the exact drop-off step (first death, first menu open) and fix that step.
6. Design natural stopping points; aim for sessions around 20-45 minutes, or 3-5 rounds of 5-8 minutes for round-based games.
7. Add social hooks: one source claims players with a friend by Day 5 have ~3x D30 retention (single-source claim).
8. Daily rewards are described as the simplest consistent retention mechanic.

## Benchmarks (third-party, treat as rough)
- D1 retention: below 20% warning, 30%+ healthy, 40%+ exceptional (rowatcher); 50%+ is top ~5% (rolearn).
- Average session below ~8 min suggests a tutorial or core-loop problem; 15+ min is a target (rowatcher).
- Over 90% of players on mobile (rowatcher claim): test mobile controls early.

## Mistakes to avoid
- Long loading, confusing UI, no stated goal in first two minutes.
- Controls that feel fine on PC but clunky on phone.
- Launching thin: weak early retention can mean the algorithm never pushes you, even after big updates (DevForum post-mortems summarized by rowatcher).

## Sources
- Roblox Creator Hub: Recommended strategies (create.roblox.com/docs/get-started/strategies)
- silky_dev, "The Importance of First Impressions on Player Retention" (Roblox Developer blog on Medium)
- rolearn.dev retention guides; rowatcher.com pre-launch playbook
