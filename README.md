# @thetiririri/10x-ai-toolkit

Moje artefakty AI dla Claude Code w jednej paczce npm na GitHub Packages: skille `code-review` i `html-report` oraz reguły pracy, które instalator dokleja do `CLAUDE.md` repozytorium konsumenta.

## Dlaczego GitHub Packages

Odbiorcą są moje własne repozytoria na jednym koncie GitHub i pracujące w nich sesje agentów, więc wybieram Model 1 z lekcji M5L4. Kosztuje on jedno pole `publishConfig` w `package.json` i jeden PAT do odczytu, a AWS CodeArtifact albo własne API z CLI dałyby infrastrukturę bez odbiorcy.

## Zawartość

| W paczce | U konsumenta | Co to jest |
| --- | --- | --- |
| `skills/code-review/` | `.claude/skills/code-review/` | recenzja zmiany: sześć kryteriów w skali 1–10, werdykt `pass`/`fail` wyliczany z ocen, podsumowanie |
| `skills/html-report/` | `.claude/skills/html-report/` | raport w Markdownie zamieniony na samodzielną stronę HTML |
| `rules/CLAUDE.md` | blok między znacznikami w `CLAUDE.md` | reguły pracy |

Instalator zapisuje też `.claude/.10x-ai-toolkit-manifest.json` z wersją, trybem instalacji i hashem każdego wgranego pliku.

## Instalacja w repozytorium konsumenta

1. Commitowany `.npmrc` zawiera samo mapowanie scope'u, bez tokenu:

   ```
   @thetiririri:registry=https://npm.pkg.github.com
   ```

2. Odczyt wymaga PAT (classic) z uprawnieniem `read:packages`, bo rejestr npm w GitHub Packages nie przyjmuje tokenów fine-grained. Token trafia do `~/.npmrc` jako `//npm.pkg.github.com/:_authToken=…`, nigdy do repozytorium i nigdy przez czat.
3. Instalacja z katalogu głównego repozytorium, zawsze z przypiętą wersją, bo cache npx potrafi podać starą kopię:

   ```bash
   npx --yes @thetiririri/10x-ai-toolkit@0.1.0
   ```

4. Commit zainstalowanych plików (`.claude/skills/`, manifest, `CLAUDE.md`). W trybie kopiowania artefakty jadą razem z repozytorium, także do CI i do sesji w chmurze.

Aktualizacja to ta sama komenda z nowszą wersją. Skill zmieniony lokalnie zostaje pominięty z ostrzeżeniem, a `--force` nadpisuje go wersją z paczki.

Odinstalowanie działa z samego manifestu, więc nie potrzebuje `node_modules`:

```bash
npx --yes -p @thetiririri/10x-ai-toolkit@0.1.0 10x-ai-toolkit-uninstall
```

Bramka dryfu w CI konsumenta instaluje wersję zapisaną w manifeście z `--force` i sprawdza, czy drzewo zostało czyste:

```bash
version=$(node -p 'require("./.claude/.10x-ai-toolkit-manifest.json").version')
npx --yes "@thetiririri/10x-ai-toolkit@$version" --force
drift=$(git status --porcelain -- .claude/skills CLAUDE.md .claude/.10x-ai-toolkit-manifest.json)
if [ -n "$drift" ]; then echo "$drift"; exit 1; fi
```

Bez `--force` lokalnie zmieniony skill zostałby pominięty i dryf by nie wyszedł. `git status` zamiast `git diff --exit-code`, bo instalacja przywraca skasowany plik skilla jako nieśledzony, a `git diff` takich nie widzi.

## Jak działa instalator

- **Znaczniki.** Reguły stoją w `CLAUDE.md` między `<!-- BEGIN @thetiririri/10x-ai-toolkit -->` a `<!-- END @thetiririri/10x-ai-toolkit -->`. Każdy znacznik stoi w osobnej linii, a znacznik zacytowany w środku zdania nie jest znacznikiem. Każda instalacja podmienia tylko ten blok, a notatki poza nim zostają. Niesparowany albo powtórzony znacznik zatrzymuje instalację, zanim zmieni się choćby jeden plik, a reguły zawierające znacznik są odrzucane. Blok przyjmuje końce linii pliku (CRLF albo LF), więc zmiana końców linii w całym pliku nie jest ani ręczną edycją bloku, ani dryfem.
- **Manifest.** Deinstalator usuwa wyłącznie pliki z manifestu i tylko te, których hash się zgadza; zmienione zostają, chyba że podasz `--force`. `CLAUDE.md` znika tylko wtedy, gdy utworzyła go instalacja i poza blokiem nic w nim nie zostało. `.npmrc` i `package.json` konsumenta nigdy nie są dotykane. Nieczytelny manifest, ścieżka w nim wychodząca poza `.claude/skills/` albo dowiązanie symboliczne, przez które zapis lub usunięcie wyszłoby poza katalog projektu, zatrzymuje oba skrypty, zanim zmieni się jakikolwiek plik. Dowiązanie wewnątrz projektu (np. `CLAUDE.md` → `AGENTS.md`) działa normalnie.
- **Idempotencja.** Druga instalacja tej samej wersji nie zmienia ani bajtu, łącznie z `installedAt` w manifeście, więc `git status` zostaje czysty.
- **Katalog docelowy.** Przez `npx` (tryb kopiowania) paczka instaluje się do bieżącego katalogu i odmawia, gdy ten nie wygląda na projekt: brak `.git`, `package.json`, `.claude/` i `CLAUDE.md`. Jako zależność (`npm install`) `postinstall` instaluje do projektu nad `node_modules`, a przy instalacji globalnej nic nie robi. `PROJECT_ROOT` wskazuje katalog docelowy w obu trybach, z jednym wyjątkiem: w cache npx `postinstall` zawsze się pomija, bo zaraz po nim instaluje bin. Błąd w `postinstall` jest tylko ostrzeżeniem, żeby nie przerwać `npm install`.

## Kolizje nazw skilli w Claude Code

- Projektowy `code-review` zastępuje wbudowane `/code-review`, a wbudowana recenzja zostaje pod aliasem `/review`.
- Skill osobisty wygrywa z projektowym: na maszynie z `~/.claude/skills/html-report` komenda `/html-report` uruchamia tamtą kopię, a nie tę z paczki.

## Wydanie nowej wersji

1. Zmiana w `skills/`, `rules/` albo `lib/` i commit na `main`.
2. `npm version patch -m "Release %s."` (albo `minor`) tworzy commit z wersją i tag `vX.Y.Z`.
3. `git push origin main --follow-tags`. Push tagu **publikuje** wersję. GitHub Packages odrzuca ponowną publikację tej samej wersji (409), więc poprawka to zawsze nowa wersja.

Workflow `.github/workflows/publish-10x-ai-toolkit.yml` waliduje każdy push i PR, a publikuje tylko z tagu `v*`. Przed publikacją sprawdza, że tag równa się wersji z `package.json`, ostrzega, gdy od poprzedniego tagu nie zmienił się żaden plik paczki, i pomija wersję już opublikowaną. Publikuje tokenem `GITHUB_TOKEN`, a `packages: write` ma tylko job publikacji.

## Rozwój

Paczka nie ma zależności ani lockfile'a i wymaga Node 22 lub nowszego.

```bash
npm test           # testy node:test
npm run validate   # frontmatter skilli, reguły bez znaczników, składnia, testy i dokładna lista plików z npm pack
```
