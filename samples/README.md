# Sample projects

Two small story projects, one in Russian and one in English, that ship with the repository so
every command can be tried without the Author's private material. The text is original and
written for this purpose; it is covered by the repository's MIT license. The build prompt asked
for a public-domain text; the sources for one were not reachable from the build environment, so
swapping the sample for a public-domain chapter is a one-file change.

```
apex open samples/ru-mayak
apex lint samples/ru-mayak/chapters/01-smena.md --project samples/ru-mayak
apex write samples/ru-mayak --continue          # needs ANTHROPIC_API_KEY
apex chronicle samples/ru-mayak --full
```

Nothing in `samples/` is used as an eval golden set: the golden set is the Author's own rated
passages (see `evals/README.md`).
