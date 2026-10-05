# What's new in LazyCreatives Backups

Every version of the app, newest first, in plain words. The section for each
version is copied onto its download page automatically when it is released.

<!--
How to keep this up to date:
- Every change people will notice adds one line under "Unreleased", saying what
  they will see or what now works, not how it was done.
- Put each line under New, Better or Fixed. Leave out headings with nothing under them.
- When the version is bumped for a release, rename "Unreleased" to
  "<version> (<day> <month> <year>)" and start a fresh empty "Unreleased" above it.
  The checks on pull requests fail if the app's version has no section here.
-->

## 0.1.10 (5 October 2026)

### New
- **A tonearm in Dig.** When you flip to a record, a tonearm swings over and lowers onto it; flip again and it lifts off while the next record settles. Leave Dig alone for a few seconds and the crate gently sways. In Sleeve the record peeking out of the cover now turns too. Both looks; switched off when your computer is set to reduce motion.
- **Correct a project's genre.** The genre the app guesses from tempo and name can now be fixed: click the genre on a project's page, right-click a project in the Library, or tick several and press Set genre. Covers, colours and Dig crates follow your pick, a new scan keeps it, Uploader uses it too, and "Use the guess" puts the guess back. Guessed genres have a dotted underline; ones you set don't. Works in both looks.
- **Your own genres.** Type any genre with "Something else…" and it stays at the top of the genre list, with its own colour and Dig crate.
- **Tidy names.** A "Tidy names" button on a project page (and for several ticked projects) gives a song's versions, its folder and its exported songs matching names, such as "Glasshouse v2.als" and "Glasshouse v2 (master).wav". You see every old and new name side by side and can change any of them; nothing is renamed until you press Rename, and Undo puts every name back. Samples, recordings, Backup folders and what's inside your project files are never touched, songs on SoundCloud stay linked, and your backups follow the new names. Works in both looks.
- **Bitwig projects are found and backed up.** Backups now spots your Bitwig Studio projects on Windows, Mac and Linux without exporting anything first, backs up each project with the audio it uses (recordings, samples and bounced clips, plus any from elsewhere), shows tempo and plug-ins, links the songs you export, flags audio that has gone missing, and leaves Bitwig's auto-backup copies out. Works in both looks.
- **Songs not matched yet.** If a song in your exports folder can't be tied to a project, the Library says how many and lists them. Play one, pick its project (Backups suggests one when it can, for example the project you saved ten minutes before the song was exported) and press Link, or mark it as not a song. Works in both looks.
- **Stems kept apart.** Separate parts like "Night Drive Kick" or a "Stems" folder now sit under a fold below the project's songs instead of looking like extra songs, and the Library shows the real song as the latest one.

### Better
- **Smarter genre guesses.** When a tempo fits more than one genre, the closest and most common one wins (a 124 BPM track is now House, not Phonk). Correcting a project also re-guesses projects at a similar tempo to match, and Undo puts them back.
- **Versions sort in number order.** "Song v2" now comes before "Song v10" in the Library and scan lists.
- **Finds far more of your exported songs.** Songs are matched even with your artist name or a date in front ("Robert - Night Drive", "2026-10-01 Night Drive"), tempo and key in the name ("124bpm Amin"), words run together ("NightDrive"), a small typo when the song was exported soon after the project was saved, "_02" style numbers, the name a project had before you renamed it, the title saved inside the file, and names like songs you linked by hand. Reaper projects tell Backups where they render and what they call the files, and Logic's own Bounces folder is checked too.
- **Guessed links are marked.** A song linked by a looser clue has a dotted underline; hover to see why. Right-click it and choose "Yes, it's from this project" to keep it for good.
- **A new sloth drawing.** While a backup runs, and wherever no backup drive is chosen yet (the "Check and start" step and Settings), a sloth hugging a hard drive now keeps you company. Works in both looks.
- **Two more sloth drawings, and they move.** A sleepy sloth napping on a branch shows when there are no backups yet, and a sloth peering through a magnifying glass shows on Scan before you scan, in an empty Library and when a search finds nothing. Both sit still if you turn animations off in your computer's settings. Works in both looks.
- **Calmer, clearer screens.** Settings sections have plain headings in both looks, the Crate look keeps its coloured stripe for genres only (menus, pop-ups and panels no longer have a blue edge), windows slide in smoothly instead of bouncing, and Home says "next tomorrow 03:05" instead of a time with no day.
- **A look of its own.** A new sturdy font and deep ink colours, covers made like printed record sleeves, a shelf of record spines on Home (one per project, click one to open it), a deck-style readout of tempo and size on project pages, level meters that move while a song plays, a record spine with the catalogue number in Sleeve, slightly bigger small text, and the sloth now says a word when a page is empty.

### Fixed
- **The button after your first backup now goes somewhere.** In the "Your first backup is done" box, "See your backed-up projects" (it used to say "See what we gathered") opens the Library on every project, newest backups on top. Before, if you started the backup from the Library, it only closed the box. Works in both looks.
- **The counts on Home open the right list.** Clicking "3 safe", "1 changed", "need a look" or "not yet" under the bar on Home now opens the Library showing just those projects.
- **One odd project no longer stops a scan.** A project file the app can't make sense of is skipped and the rest of the scan carries on.

## 0.1.9 (5 October 2026)

### New
- **Skip backup for now.** The first-run screen has a "Skip backup for now" button for people who just want to browse their projects. The app opens straight on the Library, finds your projects, and keeps backups off until you turn them on in Settings. Works in both looks.
- **Dropbox and Google Drive on the first-run screen.** Choosing where backups go now lists Dropbox, Google Drive, iCloud Drive and OneDrive next to your own drive or NAS. Folders found on your computer are one click; otherwise "Find folder…" lets you point at it. Backups go into a "Lazy Creatives Backups" folder inside it. Settings offers the same folders.
- **Pin your favourites.** Star a project to keep it at the top of the Library and on Home.
- **Pick several at once.** Tick projects in the Library to back them up, find their missing samples or pin them in one go.
- **Spots projects you changed since the last backup.** A project you saved in your music app after its last backup now shows as "Changed" instead of "Safe", on Home, in the Library (with its own filter) and on the project page, with a button to back up just the changed ones.
- **Undo.** Removing a folder or a song from a project shows a short message with an Undo button.
- **Studio One songs are found and backed up.** Backups now spots your Studio One (Fender Studio Pro) songs on Windows and Mac, backs up each song with its recordings and any audio it uses from elsewhere, shows tempo, tracks and plug-ins, links the songs in its Mixdown folder, flags audio that has gone missing, and leaves autosaves out. Works in both looks.
- **Logic Pro projects are found and backed up.** Backups now spots Logic projects on your Mac, backs up the whole project with its recordings and any audio it uses from elsewhere, shows tempo and tracks, links its bounces, and flags audio that has gone missing. Works in both looks.
- **Right-click menus.** Right-click a project or a song for its everyday actions in one place: open it in your music app, show it in its folder, back it up, copy its path, or open and copy its SoundCloud link. Works in both looks.
- **Keyboard shortcuts.** Cmd + F (Ctrl + F on Windows and Linux) jumps to the search box, Cmd + , (Ctrl + ,) opens Settings, Space plays or pauses the song in the player, and Esc closes the open project or crate. Help, Keyboard shortcuts lists them all.
- **A proper menu bar.** File, Edit, View, Window and Help menus, with the shortcuts listed next to each item, What's new, the website and Report a problem.
- **Drag and drop.** Drop a project folder (or a project file) onto the window to add it to the folders Backups looks in.
- **Copy buttons.** One click copies a folder path, a project's path, or where a missing sample should be.
- **Progress on the app icon.** While a backup runs, the dock (Mac) or taskbar (Windows) icon fills up to show how far it has got.

### Better
- **Settings save themselves.** Every change in Settings is saved straight away and a small "Saved" appears; there is no Save button to forget.
- **Picks up where you left off.** The app reopens at the same size and place on screen, on the page you closed it on, with your sort order and filters as you left them.
- **Tray menu.** The tray / menu bar icon now reads "Open LazyCreatives Backups" and "Quit LazyCreatives Backups", the same in both apps.
- **Only one copy runs.** Opening Backups again while it is already running brings its window forward instead of starting a second copy.
- **A friendlier welcome.** First-time setup now lets you pick your look straight away, finds your usual project folders for you to tick, and shows both halves of the app side by side: browsing every project and backing them up. Works in both looks.
- **Friendlier empty pages.** When a list is empty or something goes wrong, the sloth shows up with a short line and a button for the next step, such as Scan now or Restart the app.
- **Smoother and rounder.** Pages glide in, dropdowns match the app's look, covers settle into place one after another, and the Sleeve look has softer corners.

### Fixed
- **Home counts honestly.** The headline no longer counts a project that needs a look as safe.
- **Sleeve Home.** "1 sample missing" on a narrow card is no longer cut short.
- **Long song names fit.** On a project's Songs tab, long export names now show in full (wrapping onto a second line) instead of being cut short. The empty SoundCloud column only appears once a song is on SoundCloud.

## 0.1.8 (5 October 2026)

### New
- **Back and forward with your mouse's side buttons.** The extra buttons on the side of a mouse now go back to the last page and forward again, like a web browser. On the keyboard it's Alt + left/right arrow on Windows and Linux, and Cmd + [ or ] on a Mac. Nothing happens while you're typing in a box.
- **Lists remember where you were.** Open a project from the Library, Home or Dig and go back, and the list is scrolled to the same spot with the same search, filters and sort, and the project you opened lights up for a moment. Works in both looks.
- **See what's new after an update.** The update message lists what changed in the new version, and the first time the app opens after updating it shows a short "What's new" list. Open it again any time from **What's new** in Settings, under Updates.

### Better
- The update button now says **Restart the app**, and the message makes clear that only the app restarts, never your computer.
- **Runs on a newer app engine** with the latest security and speed fixes. Everything looks and works the same, and file pickers still open in the folder you last used. On a Mac it needs macOS 13 (Ventura) or newer.

## 0.1.7 (3 October 2026)

### New
- **Search and filters in the Library.** Type part of a project name, a genre or a song title and the list narrows as you type, even with a typo. Filter by backup state, DAW, genre, tempo range, or whether a project has a song (or one on SoundCloud). One click on **Clear all** shows everything again. In the Crate look, click any column heading to sort the list by it.
- **Check for updates yourself.** The bottom of Settings now shows which version you have and a **Check for updates** button. It tells you straight away if you are up to date, or offers the new version: **Restart now** on Windows and Linux, **Open download page** on a Mac.

### Fixed
- **FL Studio samples no longer show as missing when FL Studio plays them.** If a project still remembers a sample's old spot (another computer, a network address like \\\\PC-NAME\\Users\\..., or a different user name), Backups now finds the same file in your own folders, and **Fix now** finds a sample that was moved elsewhere the same way FL Studio does, by its file name. It also looks in FL Studio's own folder (Documents\\Image-Line).

## 0.1.6 (2 October 2026)

### New
- **Two looks, your choice.** A switch at the top of Settings changes the whole app between **Crate** and **Sleeve**.
  - **Crate** looks like a DJ library: each project is a row with a colour stripe for its genre, alternating shading, its cover, the waveform of its latest song, and its tempo and key.
  - **Sleeve** looks like a record shop: every project gets cover art, the Library becomes a wall of covers, and each project opens as an album-style page.
- Every screen is built in both looks: Home, Library, the project page, Dig, the backup steps and Settings.
- **Play your songs in the app.** A player bar at the bottom plays the latest song exported from a project.
- **Cover art for every project**, drawn from its name and genre, so the same song looks the same in Backups and Uploader.
- **The app updates itself.** On Windows and Linux new versions download quietly and offer "Restart now" or "Later". On a Mac the app tells you a new version is out and takes you to the download page. After this version you won't need to download updates by hand.
- **Backing up is now three clear steps:** pick your projects, check what's going in, then watch each one finish.
- **Settings are grouped** under four headings (how it looks, your music, where backups go, when it runs), and the backup drive shows how full it is.

### Better
- New heading font, Bebas Neue, used for the app name and the big project name.
- Dig shows your projects' real covers in the crates and uses the same genre colours as the rest of the app.
- Each song on a project page shows its waveform.

### Fixed
- Projects no longer all come up unticked after a scan.

## 0.1.5 (2 October 2026)

### Better
- **Your exports folder is found on its own**, including shared folders with names like Exports, Bounces, Renders or WAVS, and it is checked again every time the app opens. Any folder it finds can be switched off from the project page.
- **Songs link to the right project**, so the play button shows up. Numbered titles stay apart: "Freaky 3 master" goes to "Freaky 3", not to "Freaky".
- Checking for new songs runs in the background with a progress line and a "Look again" button on the project page.

### Fixed
- Checking for songs can no longer get stuck. Drives or folders that don't answer are skipped and the check stops after two minutes.
- Home: the "Space saved" labels no longer cover each other, the legend no longer squashes, and "could use a look" shows the same number everywhere.
- Project page: the name on the record label is readable, and an empty green box no longer appears.
- Library: no empty gap where the play button would go when you have no songs yet.

## 0.1.4 (2 October 2026)

### New
- **Cloud copies work straight away.** Google Drive, Dropbox, OneDrive and similar now work without installing anything else.
- A **Start with your computer** switch in Settings.

### Better
- Every list lines up in proper columns, the same way on every screen.
- Words match your computer: "Show in Finder" on a Mac, "My whole PC" on Windows, and so on.

### Fixed
- The Mac app failed to open in 0.1.3. It opens again.

## 0.1.3 (1 October 2026)

### New
- **Everything is unlocked** while the app is a free beta.
- **Each project has its own page**, with the songs you've exported from it and a play button.
- Songs you've exported are linked to the project they came from, and the app knows which ones are already on SoundCloud.

### Better
- Calmer Library rows that say plainly where each project stands.
- Home no longer says "Backed up and verified" when some projects are missing samples or the backup had problems.
- The app's fonts are included, so it looks the same on every computer.

### Fixed
- A sideways scrollbar on Home, file paths shown back to front in the missing samples list, and labels in Dig.

## 0.1.2 (1 October 2026)

### New
- The first public version of the current app: Home, Library, Dig with crates, finding and fixing missing samples, and verified backups of Ableton, FL Studio, Reaper and DAWproject files.
