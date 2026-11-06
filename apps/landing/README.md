# Zetta landing page

Static Astro site in English (`/`) and pt-BR (`/pt-br/`).

- `bun run dev` starts the dev server. `bun run build` writes `dist/`.
- All copy is in `src/locales/en.json` (source of truth) and `src/locales/pt-br.json` (must match its shape, see the README there). Every claim must match code in the repo.
- Color tokens in `src/styles/global.css` are copied from `packages/ui/src/styles/globals.css`. Change the source first. The main color is emerald (`--primary`); fonts are Geist and Geist Mono. The one emphasized phrase of a heading is bolder and in the main color (`h1 em, h2 em` in `global.css`). There is no underline.

## Sections (`src/components/Landing.astro`)

Header, Hero (a graph: the robot as the chief, the bots connected to it and to each other, and a line out to a cloud with the marks of connected apps), Live (big recording), Features (one full-width row for each thing the bots do: words on one side, a macOS-style window with a looping clip running to the screen edge on the other), Engines (on a tinted band: the agents with their own marks, plus accounts), Chief (Zetta as the boss of the bots: an org chart, six things it manages and an illustrated proposal), SelfHost (install steps, id `install`), Faq (every answer always shown), Cta, Footer.

## The robot

`Logo.astro` with `animated` wraps the eyes, brows, strap clips, forehead shade and goggles of `src/assets/logo.svg` in groups at render time, by the markers in the SVG's comments (the build fails if one is lost). The goggles start on the forehead, the robot blinks, and the goggles drop over the eyes. After that intro the script in `RobotHero.astro` moves them with the pointer: far above the robot they sit up, level with its eyes or lower they are on (the `--g` variable, 0 to 1). On a phone a tap toggles them. With reduced motion the goggles stay on.

## Screenshots and videos: always light mode

- There are no static screenshots: every row shows a recording.
- `public/videos/{team,computer,browser,routines,memory,inbox,tasks,chats}.{webm,mp4}` and `*-poster.webp` are recordings of the real app, light theme only, made by `docs/demo/computer/record.ts` and `docs/demo/build-landing-clips.ts` (see the header of that script for the commands). The recorder and the seed both force the light theme, so a recording cannot come out dark. Check new clips by eye before you commit them.
- `Video.astro` plays a clip only while it is on screen, muted and looping. With reduced motion it shows the poster and a Play button.
