# YouTube downloader plugin

Bots can look up a video, save it, or save only its sound, through [yt-dlp](https://github.com/yt-dlp/yt-dlp). It works with YouTube and every other site yt-dlp supports.

## Tools

| Tool       | Effect | What it does                                                                                                    |
| ---------- | ------ | --------------------------------------------------------------------------------------------------------------- |
| `info`     | read   | Title, channel, length, date and available heights of one video. Downloads nothing.                             |
| `download` | write  | Saves one video to `outputs/youtube/` in the person's code folder. Quality: best, 1080p ... 360p.               |
| `audio`    | write  | Saves only the sound as mp3, m4a or opus.                                                                       |
| `job`      | read   | Progress of a download that is still going (percent, speed, time left), or its result. No id: recent downloads. |
| `cancel`   | write  | Stops a download that is still going.                                                                           |
| `update`   | write  | Gets the newest yt-dlp when Zetta keeps its own copy.                                                           |

## Limits: none unless you set them

The plugin's settings have two optional fields. **Empty means no limit.**

- **Largest file**: a number with K, M, G or T (`500M`, `2G`). A bigger video is not saved, and the bot is told it was this limit.
- **Longest download (minutes)**: a download that takes longer is stopped, and the bot is told it was this limit.

A value that is not understood stops the install and every call with a clear message; it is never ignored. The only fixed rule is that one person runs at most three downloads at once.

## Long downloads

The platform cuts a plugin call off after 60 seconds, so saving runs as a background job. `download` and `audio` wait about 40 seconds: a quick one answers with the saved path, a longer one answers with a job id, and the bot asks `job` for progress. Jobs are kept in memory (the last 20 per person); a server restart forgets them, and a download that was running stops with the server.

## What gets installed

Installing the plugin gets whatever the computer lacks. Each is used from the computer's own copy when there is one.

| Dependency | Needed for                                                                    | When missing                                                                                                                                       |
| ---------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| yt-dlp     | everything                                                                    | Downloaded from the project's GitHub releases into Zetta's `bin` folder (`$ZETTA_HOME/bin`, or `~/.zetta/bin`) and checked against `SHA2-256SUMS`. |
| Deno       | reading YouTube (yt-dlp solves YouTube's challenge with a JavaScript runtime) | Downloaded from Deno's GitHub releases into the same folder and checked against its `.sha256sum`. Linux needs `unzip` to open it.                  |
| ffmpeg     | joining the best video with the best sound, and `audio`                       | Linux and Windows: the yt-dlp project's build, checked against its `checksums.sha256`. macOS: `brew install ffmpeg` when Homebrew is there.        |

yt-dlp is installed before the install finishes. Deno and ffmpeg are large, so they install in the background: the plugin works at once, and its status says what is still coming ("ffmpeg is being installed."). A job waits for them. Without ffmpeg, `download` asks for one file that already has sound (usually up to 720p on YouTube) and `audio` installs it first. A download that does not match its published checksum is thrown away. No root access, and nothing outside Zetta's data folder except Homebrew's own install on a Mac. Nothing is configured with an environment variable.

## Safety

- Only public `http(s)` addresses. Private, loopback and `.local` addresses are refused, so a bot cannot use the downloader to reach the local network.
- The address is passed after `--`, so it can never be read as an option. User config files are ignored. The child process has a neutral environment and working folder.
- One video per call, never a playlist.
- Saving a file is a write: bots answering outside people cannot use `download`, `audio` or `cancel`.
- Only download what you have the right to keep. Some videos need a sign-in (private, age-restricted, members-only): those fail with a clear message.
