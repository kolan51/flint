<p align="center">
  <img src="site/icon.png" width="84" alt="Flint">
</p>

<h1 align="center">Flint</h1>

<p align="center">
  A desktop studio for a model server you already run.<br>
  Senior splits the job. The workers edit the folder you opened.
</p>

<p align="center">
  <a href="https://kolan51.github.io/flint/"><strong>Open the site</strong></a>
  &nbsp;&nbsp;·&nbsp;&nbsp;
  <a href="https://github.com/kolan51/flint/releases/latest">Latest release</a>
  &nbsp;&nbsp;·&nbsp;&nbsp;
  <a href="LICENSE">MIT</a>
</p>

The page is live at [kolan51.github.io/flint](https://kolan51.github.io/flint/). It is the front door: the installers, then the studio, and the window on that page answers when you click it.

<p align="center">
  <img src="site/images/hero.png" width="920" alt="The Flint site. Download first, then the studio already on a job.">
</p>

That frame is the page itself. The buttons are the builds. Under them, Senior is already waiting on three workers, `calculator.py` is open, and the name in the title bar is the model you connected. Flint does not ship a model.

Closer, with the review open.

<p align="center">
  <img src="site/images/studio.png" width="920" alt="The Flint window: the crew, calculator.py, Senior's chat, and the diff.">
</p>

The left column is the crew and the folder. The middle is the file. The right is the chat with whoever you picked. Under the editor, Review is the line that changed: `return None` comes out, `raise ZeroDivisionError` goes in. It stays a proposal until you keep it.

## One sentence in. A file each.

Name one agent Senior when a job should be split. The others are the workers. You send the job once. Senior does not write every file. It gives `calculator.py` to one worker and the tests to another, and says so in the chat.

Flint asks the model server how many slots it has, and uses that number. Six slots, six workers may talk at once. Until the server answers, one worker goes. The others wait on the model. They do not wait on each other.

A command does not run because an agent wrote it. The composer stops and shows it: Run, allow this once, Allow all, or skip. Allow all is a switch you set. It is not how Flint starts.

Plan mode can read the folder. It cannot edit, and it cannot run a command.

## Download

| | File |
| --- | --- |
| Windows | `Flint-Setup-0.1.0.exe` |
| macOS | disk image, Apple silicon and Intel |
| Ubuntu | `.deb` and AppImage |

[The site](https://kolan51.github.io/flint/) reads the latest release and points each button at a file that exists. A missing build stays quiet. The Mac file is made on a Mac runner. The Ubuntu file is made on Ubuntu. Pushing a `v*` tag is what starts the three builds.

## From this folder

```bash
npm install
npm run desktop
```

Leave the server running. Ollama is `http://127.0.0.1:11434`. llama.cpp and LM Studio are usually `http://127.0.0.1:8080`. Gear, Models. Name it, paste the address, Add model, Test, then pick it in the title bar. Offline means that address did not answer. Flint asks again on its own.

Open a folder. Reads and writes stay inside it.

`Ctrl+Shift+O` opens a folder. `Ctrl+K` opens the command list. Enter sends.

## What leaves the machine

The folder does not. The chats do not. There is no account.

An update check, on unless you turn it off, asks GitHub whether a newer Flint exists. It does not send the folder. Search runs only when an agent uses it, and then it asks DuckDuckGo, or Brave if you saved a key.

[Privacy](https://kolan51.github.io/flint/privacy.html) · [Terms](https://kolan51.github.io/flint/terms.html)

## License

[MIT](LICENSE).
