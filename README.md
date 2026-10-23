<p align="center">
  <img src="site/icon.png" width="84" alt="Flint">
</p>

<h1 align="center">Flint</h1>

<p align="center">
  Open the folder. Leave it there.<br>
  A senior splits the job. The workers do it on a model you already run.
</p>

<p align="center">
  <img src="site/images/hero.png" width="920" alt="Flint, with the download and the studio">
</p>

<p align="center">
  <img src="site/images/studio.png" width="920" alt="The Flint window: agents, editor, chat, and review">
</p>

You already have the model. It is on this machine, or on a box in the room. Flint is the desk it sits at. Files on the left. The editor in the middle. The crew on the right.

Senior reads the job and hands each worker one file. You see the diff before anything stays.

## Before / after

You paste a project into a chat. The model answers from the piece you pasted. You copy the answer back, and hope the rest of the folder still fits.

Flint opens the folder. The edit lands on the file that was already there. Keep it, drop a hunk, or send a note back.

## The window

| | |
| --- | --- |
| **Crew** | Senior splits a job. The workers start together, each on one file. A second address in Settings keeps them off Senior's server. |
| **Editor** | Tabs, preview, and Pyright on Python. Problems sit in the dock. Drag the edges. Double-click a divider to put them back. |
| **Review** | Every edit is a diff. Test runs the suite and leaves each failure beside the review. |
| **Model** | Ollama, llama.cpp, or anything that speaks OpenAI. Flint asks the server how many slots it has, and only then lets that many workers talk at once. |

## Download

Windows installer. macOS disk image. Ubuntu `.deb` and AppImage.

[Latest release](https://github.com/kolan51/flint/releases/latest)

The site's buttons point at those files once the release exists. Until then they stay quiet. A Mac build is made on a Mac. An Ubuntu build is made on Ubuntu.

## From this folder

```bash
npm install
npm run desktop
```

Then:

1. Leave a model server running. Ollama is `http://127.0.0.1:11434`. llama.cpp and LM Studio are often `http://127.0.0.1:8080`.
2. Gear, Models. Name it, paste the address, Add model, Test. Pick it in the title bar.
3. Open a folder. Flint reads and edits only inside it.
4. Name one agent Senior when the work should be split. The others are the workers.
5. Send the job. Agent mode can edit and run commands. Plan mode can only read. A command waits until you press Run.

`Ctrl+Shift+O` opens a folder. `Ctrl+K` opens commands. `Enter` sends.

## FAQ

**Does a chat leave this computer?**
The folder and the chats stay here. An update check asks GitHub whether a newer Flint exists. Search, if you turn it on, asks DuckDuckGo or Brave.

**Why a crew?**
One model, one long thread, gets slow and loses the file it was in. Senior keeps the plan. Each worker gets a file and a short job.

**What if the title bar says the model is offline?**
That address is not answering. Flint asks again every few seconds. When the server is back, the warning goes away on its own.

**Why are workers waiting?**
They are waiting for a free slot on your model, not for each other. Flint reads the slot count from the server. Until that answer arrives, one worker goes.

**Can it run a command by itself?**
Only if you set Allow all. Otherwise it stops and shows the command.

## License

[MIT](LICENSE).
