# Animation Workflow
**Topic:** animation  **Confidence:** medium-low (DevForum posts are decent; many "Moon Animator tutorial" pages found were SEO filler and were mostly ignored)

## Tools
- Roblox Studio's built-in Animation Editor: fine to start.
- Moon Animator (classic and Moon Animator 2): keyframes, easing, cutscenes, and camera animation; can animate non-character objects that have a PrimaryPart or are welded.
- Blender + Roblox rig exporter/importer: for higher-fidelity work; learn easing styles well.

## Practical tips (DevForum threads)
1. Split work into: common actions (walk, idle), weapon actions (reload, shoot, swing), custom rigs.
2. Stiff or "robotic" results usually come from easing styles. Fix easing first.
3. Visualize yourself as the character and act the motion out, then recreate it; give movements time to "breathe" and show weight.
4. Camera keyframes make cutscenes and trailers feel cinematic; preview camera paths.
5. Animations made in plugins must be exported/published to Roblox to play in-game; then trigger via script (AnimationTrack).
6. Combat: check pacing of wind-up vs. strike (a DevForum reply on a sword swing noted a too-fast flick looked off).
7. Match animations to the rig type (R6/R15) or they will look broken.

## Applies to
Verity Battlegrounds (combat M1s, skills), bike game (rider poses, tricks), Steal A Ghost (creature idles).

## Sources
- devforum.roblox.com: "How to animate a basic fight scene", "Game Design - Animations", "Jespone's guide to animations", "Sword Swing Animations", "How to animate 2 characters ... takedown"
