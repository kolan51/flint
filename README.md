<p align="center">
  <img src="site/icon.png" width="84" alt="Flint">
</p>

<h1 align="center">Flint</h1>

<p align="center">
  A desktop app for coding with a model you already run.<br>
  Open a folder. Agents edit the files in it. You review the changes.
</p>

<p align="center">
  <a href="https://kolan51.github.io/flint/"><strong>Open the site</strong></a>
  &nbsp;&nbsp;·&nbsp;&nbsp;
  <a href="https://github.com/kolan51/flint/releases/latest">Latest release</a>
  &nbsp;&nbsp;·&nbsp;&nbsp;
  <a href="LICENSE">MIT</a>
</p>

[kolan51.github.io/flint](https://kolan51.github.io/flint/) is the download page. The installers are at the top. The window under them is the app, and the controls on that page respond when you click them.

<p align="center">
  <img src="site/images/hero.png" width="920" alt="The Flint site, with the download buttons and the app window.">
</p>

The app connects to a model server you choose. It does not include a model. Ollama, llama.cpp, LM Studio, and any OpenAI-compatible server all work. You paste the address in Settings, test it, and pick it in the title bar.

<p align="center">
  <img src="site/images/studio.png" width="920" alt="The Flint window: agents, files, the editor, chat, and a diff.">
</p>

The window has three columns. Agents and the open folder are on the left. The editor is in the middle. Chat is on the right. Each edit appears as a diff under the editor. You keep it or drop it.

## What you can do

One agent can lead. You name it Senior. It can split a job and give each other agent a part of it. Those agents work in the same folder at the same time.

Flint asks the model server how many sessions it allows, and uses that number. Until the server answers, one agent talks to the model.

A command is shown before it runs. You can run it, allow it once, allow commands from then on, or skip it. Plan mode can read the folder. It does not edit files and it does not run commands.

Flint only reads and writes inside the folder you open.

## Download

| System | Installer |
| --- | --- |
| Windows | `Flint-Setup-0.1.0.exe` |
| macOS | Disk image for Apple silicon and Intel |
| Ubuntu | `.deb` and AppImage |

The [site](https://kolan51.github.io/flint/) links each button to a file from the [latest release](https://github.com/kolan51/flint/releases/latest). A button stays inactive when that build is not published yet. macOS is built on a Mac. Ubuntu is built on Ubuntu. A version tag starting with `v` starts those builds.

## Run from source

```bash
npm install
npm run desktop
```

Point Settings at your model server. Ollama is usually `http://127.0.0.1:11434`. llama.cpp and LM Studio are usually `http://127.0.0.1:8080`. If the title bar says the model is offline, that address is not answering. Flint checks again on its own.

`Ctrl+Shift+O` opens a folder. `Ctrl+K` opens the command list. Enter sends a message.

## Data

Chats, agent settings, and the folder stay on this computer. There is no Flint account.

An update check asks GitHub if a newer version exists. You can turn that off. Web search, when an agent uses it, goes to DuckDuckGo, or to Brave if you add a key.

[Privacy](https://kolan51.github.io/flint/privacy.html) · [Terms](https://kolan51.github.io/flint/terms.html)

## License

[MIT](LICENSE).
