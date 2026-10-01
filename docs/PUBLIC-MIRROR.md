# Public mirror

Development happens in the private repo `LazyCreatives/lazycreatives-backups-dev` (branches, PRs,
full history). The public repo `LazyCreatives/lazycreatives-backups` only receives releases: one
commit per `v*` tag, pushed by `.github/workflows/public-mirror.yml`. Releases,
installers and the GitHub Pages site live on the public repo, so public links
(`releases/latest/download/...`, issues, LICENSE) keep working.

## Releasing

```bash
git tag v0.1.0 && git push origin v0.1.0   # the version must match electron/package.json
```

The mirror pushes a `Release v0.1.0` commit and the `v0.1.0` tag to the public repo.
Anything the public repo runs on tags (installer builds, the GitHub Release) runs there.
To re-publish an existing tag, run the workflow by hand with that tag
(Actions → public mirror → Run workflow); a tag that already exists publicly is refused.

Paths that never go public are listed under `EXCLUDE` in the workflow.

## One-time setup

1. Create a deploy key pair: `ssh-keygen -t ed25519 -N "" -C public-mirror -f mirror_key`
2. Public repo → Settings → Deploy keys → Add: paste `mirror_key.pub`, tick **Allow write access**.
3. Dev repo → Settings → Secrets and variables → Actions → New secret
   `PUBLIC_MIRROR_DEPLOY_KEY`: paste the contents of `mirror_key`. Then delete both files.
Leave GitHub Pages off on both repos: the org site redirects /lazycreatives-backups/ to the homepage.
