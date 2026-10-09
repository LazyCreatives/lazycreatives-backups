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

## 0.2.8 (9 October 2026)

### Better
- **Find a genre by typing.** The genre box now has a search: type "liq" or "dnb" and pick from what matches, with your own genres on top. A name that isn't listed can be used as it is.
- **Tidier Genre and Year columns.** Long genre names end in "…" and show whole when you point at them, the genre's colour stripe stays put on the one you picked, the Rating and Backup headings stay over their columns, a big library loads 200 projects at a time, and "Nothing pinned here" offers to show every project.
- **Settings fits a mid-size window.** Between the normal and the narrow window the setting names take less room, so rows of buttons no longer wrap.
- **Easier with the keyboard and a screen reader.** On/Off buttons move with the arrow keys, Settings tabs jump with Home and End, every project in the columns view can be opened by its name, and Safe, Changed or Missing is still read out (and shown by shape) in the narrow window.

### Fixed
- **Dropping a project folder on the Library works again.** Dropping a folder (or any file that isn't a song) on a project row or page now adds it to your project folders, instead of saying "That isn't a song". Only songs light a project up as you drag.
- **Two songs with the same file name stay apart.** On "Songs not matched yet", two different "Master.wav" from two song folders now get a row each, so Link no longer ties both to one project. Copies of the same file are still listed and linked together.
- **"Songs not matched yet" fits a narrow window.** When the window is narrow the export date moves under the song's name, so the name has room to be read. The samples list has the same column headings as the main list, and one sample reads "1 sample".
- **The project picker behaves better.** It opens toward the side of the window with more room instead of running off the bottom, closes when you Tab away, and keeps the folder and date hints lined up even next to long names. Screen readers hear how many projects match and which section each one is in.
- **Backup times read naturally.** Automatic backup now says "once a day" and "every hour" instead of "every 1 day" and "every 1 hour", and Settings says whether the next backup is today or tomorrow.
- **The Phone settings never get stuck.** If Backups can't check your phone settings, it says so with a Try again button instead of "Loading…" forever. Removing a paired phone now asks first, since the phone has to pair again afterwards.

## 0.2.7 (9 October 2026)

### New
- **Easier reading.** A new switch in Settings > Look for dyslexia or tired eyes: a clearer font (Atkinson Hyperlegible, or OpenDyslexic if you prefer it), more space between letters and words, bigger text, no capital-letter labels and less movement. Text size, spacing, font and a soft colour tint can each be changed, and lists stay lined up in columns.

### Better
- **Many more genres, in groups.** The genre box now lists 95 genres in ten groups that follow Splice's families, from Jerk, Rage, Plugg and UK drill to Jump up, Liquid and Neurofunk in a Drum & bass group, IDM, Experimental, Amapiano, Metal and Game music. New genres are only guessed when a project's name or samples mention them, so tempo-only guesses stay the same, and "deep house" or "uk drill" in a name now picks that genre rather than plain House or Drill. Genres you set or typed yourself stay as they are.
- **Picking a song's project is quicker.** On "Songs not matched yet" the project list is now a box you type in, with the best guesses for that song on top and why each one is guessed. Projects that share a name show their folder and the day they were last saved, so you can tell them apart.
- **Songs find their project more often.** Backups now matches on the words two names share, in any order, so "BREAKS 140 WOBS" finds "Wobs 140" and "THE PENTHOUSE EXPERIMENT" finds "Penthouse". Typos and cut-short words still count.
- **Samples are tucked away.** Splice sounds, one-shots, loops and bits you resampled no longer crowd the list. They sit under "Probably samples", where one button puts them all aside. Nothing is moved or deleted.
- **One row per song.** The AIF and MP3 of the same song (or the same name twice) share one row, and Link covers them both.

## 0.2.6 (8 October 2026)

### New
- **Drag a song onto its project to link them.** Drop a song from Finder or File Explorer onto a project in Library (list, covers or Genre and Year columns) or onto its open page, and it's linked straight away, with Undo. Several songs at once work too, and Backups asks before moving a song that's already linked to another project. Only the link is saved: the song file stays exactly where it is.

### Better
- **The Genre and Year columns view is redone.** It now matches the rest of the Library: your pinned projects and ratings show on every row, a new Favourites section (Pinned, Rated) sits above the genres to narrow the list, and each project says Safe, Changed, Missing or Not backed up in words.
- **Settings in tabs.** Settings is split into short tabs: Folders, Backups, Look, Privacy and App, and opens on the one you used last. The new Privacy tab says plainly what Backups reads and what leaves your computer. Every switch is an On/Off button, every "Add folder" button says the same, and the jargon is gone.

## 0.2.5 (8 October 2026)

### New
- **Find my projects first.** Before the first scan, Home leads with finding your projects, and setup lets you finish by just browsing. Backups stay one click away.
- **The sloth counts as it looks.** The first look through your folders shows the searching sloth and how many projects it has found so far.
- **A small seal when a backup finishes.** A project's status settles to "Safe" with a seal when its backup finishes from its row.
- **"Out now" on release day.** A stamp lands on the album's cover on release day and stays there after.
- **Hidden folders can come back.** Settings › Export folders lists the folders you told Backups not to look in, each with Show again, and Add or Look again shows how far it has got and what it found.
- **The Sleeve player's glow follows the music**, and switching look or light/dark fades softly instead of jumping.

### Better
- **Big libraries stay quick.** Search no longer freezes with thousands of projects, Ctrl/Cmd+K opens straight away, and scanning again skips project files that haven't changed.
- **A calmer Library.** Two rows of controls instead of five: genre and year are picked in one place (with counts), and the rest is under "More filters".
- **A tidier project page.** Back up now and Open in your music program stay up top, everything else is under "··· More" (also on right-click), and facts aren't repeated.
- **Sleeve Home shows big printed numbers** for where your projects stand, and Sleeve covers only wear a badge when something needs a look.
- **Albums:** rows take the colour of their songs' main genre, crossfade is one line in the album header, and the album list says "ready" once.
- **One calm type scale and square Crate corners.** Text sizes are tidied, section headings stand out, and coloured edges only mean genre or what's playing.
- **"Back up N projects" counts exactly what that button backs up**, and "Look for projects in" starts on the folders you chose at setup.
- **Search finds names in any script**, such as Japanese, Cyrillic or Korean.
- **Easier to use with screen readers and in light mode.** Narrow sidebar icons show their names, and status words on a highlighted row are easier to read in light mode.
- **Album songs slide out of the way when you drag one.** The others make room as you move it, and the numbers update as you go, so you see the new order before you let go. Turned off if your computer is set to reduce motion.
- **Warnings in plain words.** When something doesn't work, the app now says what went wrong and what to do next, instead of short programmer notes like "no such picture" or a bare number.

### Fixed
- **An unplugged backup drive is noticed.** Backups says "Your backup drive isn't connected. Plug it in and try again." instead of making the folder again on your computer or blaming permissions.
- **Crate Library names are readable at the normal window size.** They were cut to one letter. Waveforms show too, and columns step out as the window narrows. Crate Home and Sleeve project pages no longer cut names or wrap their big numbers.
- **Undo on an album puts the song back in its old place**, still ticked ready.
- **Songs on a missing drive are skipped** with a short note instead of showing Pause while nothing plays.
- **Small fixes:** the Next button on the welcome screen stays in view on small windows, "Changed" and "Not backed up" look the same on albums as everywhere else, and the Settings cards line up.

## 0.2.4 (8 October 2026)

### New
- **Albums: plan what comes out next.** A new Albums page holds each album you're putting together: songs from your projects' exports in order (drag to reorder), the release day with a countdown, whether each project is backed up, and what each song still needs before then, like a WAV, a proper title, or a fresh export after the project changed. Albums are shared with Uploader, so a change in one app shows in the other.
- **Hear the whole album, with crossfade.** Play album runs it top to bottom with the songs blending into each other, anywhere from Off to 12 seconds, the way Spotify or Apple Music would play it. Mark songs that should run straight into the next one, and "Play joins only" plays just the seconds around each change. It only changes how the album plays; your files stay exactly as they are.
- **Report a problem in one click.** Help, Report a problem (or the new button at the bottom of Settings) opens a short report on GitHub with your app version and computer type already filled in. You read it before you send it.
- **Crashes offer to report themselves.** If the app runs into an error, its engine stops or it closes suddenly, it says so and offers that same report, with what went wrong filled in. Nothing is ever sent by itself, and no music, project files or file lists are included.
- **Choose your export folders in Settings.** Under Your music, see every place Backups looks for your finished songs, add the folders you save them to, and drop any it shouldn't look in. Uploader picks up the same folders. Backups only reads them; your files stay exactly as they are.
- **Pause the music when you minimize.** A new switch in Settings, under Listening, pauses whatever is playing when you minimize the window. It's off unless you turn it on, and the music waits for you to press play again.

### Better
- **Whole names on the big-type covers.** Covers that print a project's name in big letters now size each word to fit, so "Chrome Hearts" no longer reads "CHROI HEART".
- **No repeats on Home (Crate).** "Recently worked on" skips projects already listed under Changed or Needs a look just above it, so you see more of your other work.
- **Stems are spotted more surely.** Songs and their separate parts are told apart by the same checker Uploader now uses, so both apps agree: FL Studio's "Song_Insert 3" and names like "Night Drive - Vocals" count as stems, while a song genuinely called "Deep Bass" stays a song.

### Fixed
- **Tidier project page and Home.** In Crate the tempo, tracks, size and backups box no longer squashes its numbers onto two lines, and the record label on the right has room for its small print. In Sleeve the Back up button comes first instead of sitting alone on its own line, the big numbers stay on one line in a narrow window, and the Home cards keep their button and folder side by side. The welcome headline and the Crate and Sleeve picture cards line up properly.
- **The level meters keep time with the music.** The two little meters in the player bar now listen to the song as it plays, so they jump with every beat, show left and right separately and fall the moment you pause, instead of drifting out of step.
- **Ratings sit in the middle of their column.** In the Library list, the rating marks and the Rating heading are centred, and all five marks fit.
- **No keychain password prompts on Mac.** Backups never asks your Mac's keychain for anything, so an update can't bring up a "wants to use your confidential information" box.

## 0.2.3 (7 October 2026)

### Better
- **Clearer words about what Backups does for you.** The welcome screen, the empty Library and a new "What it does" line in Settings, under About, now say plainly which jobs it takes off your hands, and that you can browse all your projects without ever backing up.

## 0.2.2 (7 October 2026)

### New
- **Plugins page.** A new page in the sidebar lists every plugin on your computer: its name, who makes it, the formats you have it in (VST3, AU, CLAP, VST2, AAX, LV2), where it lives and how many of your projects use it. Search it, filter by format or by "not used in any project", and open a plugin to see each copy's folder and the projects that use it. Backups looks in the usual plugin folders on Windows, Mac and Linux; add your own folders at the bottom of the page.
- **Recently opened.** The last five projects you opened sit in the sidebar under the menu, newest first, so you can jump back in with one click; Find anything (Ctrl+K / Cmd+K) lists them before you type. Right-click to take one off or clear the list. Kept on this computer only.
- **A bigger player.** Point at the cover in the player along the bottom and press the up arrow (or click the cover) to open a large Now playing view with a big cover, the waveform to scrub and the play button. The down arrow or Escape shrinks it back.

### Better
- **Click the song's name in the player** to open the project it came from.

### Fixed
- **The arrow keys flip records on the Dig page again** as soon as you open a crate, without clicking a record first. Enter opens the record on the deck.
- **Nearly every audio file now plays** in the player: AIFF, Apple Lossless, WMA, AC-3, WavPack, CAF, 64-bit and compressed WAVs and more, where you used to see "Couldn't play this file". Your files are only read, never changed or copied.

## 0.2.1 (6 October 2026)

### New
- **Your own cover art.** In Settings, under Covers, save as many pictures as you like and use each one behind the drawn cover or as the whole cover. Give pictures to genres, mix them across your projects, or use one for everything, and pick Ink print, Photo or Label strip for how a picture sits behind the drawing.
- **Change cover** on a project's page (or right-click a project) picks the drawn cover, any saved picture or a new one for just that project, with its own style; drag the cover to move the picture. Uploader follows the cover you pick.

### Fixed
- **Point to file now sticks.** The exact file you pick for a missing sample is remembered: it still shows as "Using …" after you leave the project page, the missing count drops straight away, and every later backup of that project (scheduled ones too) uses that file.

## 0.2.0 (6 October 2026)

### New
- **Light mode.** Pick Dark, Light or Match my computer in Settings, under Look; both looks come in paper-light too.
- **A narrow window** that sits beside your music program: the project you're working on, whether it's safe, and a Back up now button for it, always on top if you like (View > Narrow window, or Ctrl+Shift+N / Cmd+Shift+N).
- **Right-click menus.** Right-click a project on Home to open it, back it up, pin it, show it in its folder or copy its path; right-click a backup on a project page to check it, restore it or share it. Text boxes get Cut, Copy, Paste and spelling fixes.
- **Point at the waveform** in the player to see the time, and drag to scrub through the song.
- **Glass sidebar** on a Mac (frosted) and Windows 11 (tinted by your wallpaper). Older Windows and Linux stay solid.
- **Ctrl+1, 2, 3… (Cmd on a Mac)** jump to that page in the sidebar.
- **A worn printed sleeve** on the big cover of a project page.
- **Rate your projects** with one to five marks, in the Library and from the right-click menu. Pick flames, hearts, records or dots in Settings, and sort the Library by rating.
- **Crate colours.** Give any genre your own colour from the genre box or by right-clicking a crate in Dig; every stripe, cover and crate of that genre follows it.
- **Row height** in the Crate look's Library: compact, comfortable or tall (a bigger waveform), remembered for next time.
- **Smart crates.** Save any search and filters in the Library as a smart crate. It sits over the list and in Dig, and fills itself as projects change.
- **Find anything with Ctrl+K (Cmd+K on a Mac)**, or the box under the app name: jump to a page, project, genre or smart crate, or back up, switch look and more.
- **Browse by Genre, then Year, then Project** in the Crate look's Library (the columns button). In the Sleeve look the same choices sit over the covers as chips.
- **Your collection** at the bottom of Home: every project in figures, by genre, music app and year. In the Sleeve look it reads like a record's liner notes.
- **More like this** in Dig: press it on any record to see the closest projects in your library by tempo, genre, key and how their songs sound. It listens to your exported songs on your computer; nothing is sent anywhere.
- **Dig in 3D.** The records now stand in a wooden crate, and the one you flip to is pulled up in front of it.
- **Preview on hover.** Switch it on in the Library or Dig, then point at a project (or flip to a record in Dig) to hear a few seconds of its newest song. Up and Down move through the list.
- **Markers on the song.** A project page shows the markers (locators) saved in Ableton, REAPER and DAWproject files along its newest song's waveform; click one to jump there.
- **A bigger project page in the Sleeve look:** the cover takes the left half and the tempo, tracks and backups are printed big.
- **Filter by year last saved and by rating** in the Library.

### Better
- **Calmer pop-up notes.** Up to three stack up instead of replacing each other, pointing at them holds them, and Home's numbers roll to their new value.
- **Smoother, quicker movement** across the app, and hover effects only with a mouse.
- **Big libraries and long names fit.** Smaller windows drop the least needed Library columns instead of squashing them, Home shows 8 changed projects with a "Show all" link, big numbers read 123,456, cut-off names show in full when you point at them, and a very long project name no longer stretches the project page.
- **Clearer Dig.** Crate names use the same lettering as the rest of the app, the arrows are proper buttons with a reminder that the arrow keys flip and Enter opens, and in Sleeve the record you flip to shows its genre, tempo and music app as tags under its name. Ctrl+F (Cmd+F on a Mac) jumps to the search box, and an empty crate shows the sloth with a hint. Both looks.
- **Music apps called by their names.** Lists and project pages say Ableton, FL Studio, Reaper and Logic Pro instead of short codes like "Live" or "RPR".
- **Same words, same times everywhere.** "Changed since last backup" is used throughout, times follow your computer's clock (no more "08:19 PM"), and the last and next backup now sit in a quiet line under the heading on Home.
- **Clearer lines between rows.** Every list and table in both looks has clearer row lines and control edges, so rows are easier to tell apart.
- **Same words everywhere.** Missing samples always reads "Find missing samples", the Library's open button says which music app it opens ("Open in Ableton"), and the counts on Home, Library and Dig now agree.
- **Tidier Library columns.** The colour stripe comes first, as in Uploader, and the Project heading lines up with the names.
- **Plainer headings.** Small headings are in ordinary letters instead of spaced capitals (the Crate deck readout keeps its capitals).
- **Easier with the keyboard.** Enter on a button inside a row now presses that button, the ··· menu works with the arrow keys, pop-ups keep the keyboard inside them, and the left and right arrows skip through the song in the player.
- **Faster big libraries.** The Library only draws the projects on screen, so thousands of projects open and scroll smoothly.
- **Dates and times** follow your computer's settings on every screen.
- **Dig crates show how full they are.** A crate holds up to eight covers, packed tighter as it fills, and in Sleeve a bigger box set is a thicker box.
- **Calmer covers.** Pointing at a cover slides it aside so its record peeks out, instead of the card lifting; covers deal in once per session, not on every visit, and the glow behind Sleeve Home is gone.
- **Pop-ups fade out** when they close instead of vanishing in one frame.
- **Plainer headings.** The Sleeve welcome and the backup screen use the app's normal lettering; the poster font stays for the app name and big project names.

### Fixed
- **Pop-up boxes sit in the middle of the window** in the Sleeve look; on some pages they slipped down and could run off the bottom.
- **A failed backup's note shows a warning mark**, not a green tick.
- **Failed backups now say so.** If backing up one project, finding its samples or checking it again fails, you get a plain message with Try again. The finished screen no longer shows "Backed up and checked" when some projects failed; it lists them with the reason and a "Try these again" button.
- **A library that can't be read** now says so instead of looking empty.

## 0.1.11 (6 October 2026)

### Better
- **A tidier top on Windows.** The white Windows title bar and the File / Edit / View menu row are gone; the app's own dark colour now runs right to the top, with Windows' minimise, maximise and close buttons on the right. The ☰ button at the top left opens the old menus. Dragging, snapping and double-click to maximise work as before. Both looks; Mac and Linux are unchanged.

### Fixed
- **Dig no longer flickers on Windows.** On some Windows computers the Dig page flashed and jumped while a record was spinning, because a record you had already flipped past could still flash up for a moment. Records you have flipped past are now properly put away. Both looks.

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
