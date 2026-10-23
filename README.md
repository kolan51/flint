<p align="center">
  <img src="site/icon.png" width="84" alt="Flint">
</p>

<h1 align="center">Flint</h1>

<p align="center">
  A Grok-style coding bot for local LLMs and your own APIs.<br>
  Open a folder. Talk to it. Keep the diff.
</p>

<p align="center">
  <a href="https://github.com/kolan51/flint/stargazers"><img alt="Stars" src="https://img.shields.io/github/stars/kolan51/flint?style=flat-square&label=stars"></a>
  <a href="https://github.com/kolan51/flint/releases/latest"><img alt="Release" src="https://img.shields.io/github/v/release/kolan51/flint?style=flat-square&label=release"></a>
  <a href="https://github.com/kolan51/flint#bring-your-own-brain"><img alt="Works with Ollama, llama.cpp, and your API" src="https://img.shields.io/badge/works%20with-Ollama%20%C2%B7%20llama.cpp%20%C2%B7%20your%20API-3d3424?style=flat-square"></a>
  <a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/github/license/kolan51/flint?style=flat-square&label=license"></a>
</p>

<p align="center">
  <a href="https://kolan51.github.io/flint/"><strong>See it</strong></a>
  &nbsp;&nbsp;·&nbsp;&nbsp;
  <a href="https://github.com/kolan51/flint/releases/latest">Download</a>
</p>

You already have a model that can write. Maybe it is Ollama on this PC. Maybe it is llama.cpp, LM Studio, or an API key you already pay for. What you are missing is a place to talk to it while it works in the project.

Flint is that place. A desktop chat, a real editor, and a small crew of agents that can split a job. The folder stays where it is.

<p align="center">
  <a href="https://kolan51.github.io/flint/">
    <img src="site/images/hero.png" width="920" alt="Flint on the web, with the download and the studio.">
  </a>
</p>

The [site](https://kolan51.github.io/flint/) is worth a minute. The buttons up top are the installers. The window under them is clickable, so you can poke the agents, the files, and the chat before you install anything.

<p align="center">
  <img src="site/images/studio.png" width="920" alt="Flint on the desktop: agents, the editor, chat, and a diff.">
</p>

On the left, your agents and the folder. In the middle, the file. On the right, the chat. When the bot changes something, the diff sits under the editor. You keep the lines you like and drop the rest.

## Bring your own brain

Paste the address in Settings and pick it in the title bar.

| You have | Point Flint at |
| --- | --- |
| Ollama | `http://127.0.0.1:11434` |
| llama.cpp or LM Studio | usually `http://127.0.0.1:8080` |
| An API you already use | its OpenAI-compatible address, plus the key |

A local model and a cloud API can both sit in the list. Switch them from the title bar whenever you want a different one for the chat.

## Ask it like you would ask Grok

Fix the bug. Add the page. Explain this file. Rename it across the project.

For a bigger job, name one agent Senior. Senior hands each of the others a piece, and they work in the same folder together. Flint checks how many chats your server can hold at once, and keeps to that.

If it wants to run a command, it shows you first. Run it, allow it, or skip it. There is a Plan mode too, for when you only want it to read.

## Download

Installers for Windows, macOS, and Ubuntu are on the [latest release](https://github.com/kolan51/flint/releases/latest).

| | |
| --- | --- |
| Windows | [Flint Setup](https://github.com/kolan51/flint/releases/latest) |
| Mac | [Disk image](https://github.com/kolan51/flint/releases/latest), Apple silicon and Intel |
| Ubuntu | [`.deb` and AppImage](https://github.com/kolan51/flint/releases/latest) |

Windows may warn before the installer opens. The build is not signed yet.

Or [open the site](https://kolan51.github.io/flint/) and press the button for your machine. Same files.

## From this repo

```bash
npm install
npm run desktop
```

`electron/` is the window. `server/` is the API on this machine. `src/` is the studio. `site/` is the page.

`Ctrl+Shift+O` opens a folder. `Ctrl+K` is the command list. Enter sends.

## Your stuff stays put

Chats, agents, and the project stay on this computer. There is no Flint account to make.

Flint can ask GitHub if a newer version exists. You can turn that off. If an agent searches the web, the query goes to DuckDuckGo, or to Brave when you add a key.

[Privacy](https://kolan51.github.io/flint/privacy.html) · [Terms](https://kolan51.github.io/flint/terms.html)

## FAQ

**Does it need an account?** No. Chats, agents, and the model address stay on this computer.

**Which models?** Any Ollama server, any llama.cpp or LM Studio server, or an OpenAI-compatible API you already have. Several agents can share one. Flint asks the server how many chats it can hold, and stays inside that.

**Where do the edits go?** Into the folder you opened. A change sits in the diff until you keep it. A command does not run until you allow it, unless you have set Allow all.

**Windows warns that the installer is not signed.** That warning is real. There is no signing certificate on these builds yet.

## License

[MIT](LICENSE).
