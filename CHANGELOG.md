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

## Unreleased

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
