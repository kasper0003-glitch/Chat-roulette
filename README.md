# Chat Roulette

En enkel norsk nettside med tre tilfeldig genererte spørsmål, vanlige ChatGPT-svar og opplesning. Ingen API-nøkkel eller innlogging kreves for spillerne.

## Start lokalt

1. Installer Node.js 20 eller nyere.
2. Opprett en OpenAI API-nøkkel på https://platform.openai.com/api-keys (API-fakturering er separat fra ChatGPT Plus).
3. Åpne terminal i denne mappen.
4. Start serveren med en miljøvariabel:

macOS/Linux:
```bash
OPENAI_API_KEY="din-hemmelige-nøkkel" node server.js
```
Windows PowerShell:
```powershell
$env:OPENAI_API_KEY="din-hemmelige-nøkkel"
node server.js
```
5. Åpne http://localhost:3000

## Publisering

Legg hele prosjektet på en Node.js-host (for eksempel Render eller Railway), sett `OPENAI_API_KEY` som hemmelig miljøvariabel i hostens kontrollpanel og start med `node server.js`. Legg **aldri** API-nøkkelen i HTML, JavaScript eller et offentlig Git-repositorium. HTTPS anbefales. `PORT` settes automatisk hos mange hoster.

## Kostnader og begrensninger

- Spørsmål og svar bruker OpenAI API og koster per bruk.
- Opplesning bruker nettleserens innebygde tekst-til-tale og har ingen OpenAI-lydkostnad. Mannsstemme prioriteres hvis en norsk slik stemme finnes, men kan ikke garanteres på alle enheter.
- `MAX_REQUESTS_PER_HOUR` (standard 45 per IP) gir en enkel bruksbegrensning. Dette er **ikke** et garantert kostnadstak på 50 kr. Sett også et lavt API-budsjett/varsling i OpenAI-kontoen og vurder strengere server-side begrensninger før offentlig lansering.
- Historikk og svar lagres bare i serverminnet og forsvinner ved omstart. Flere serverinstanser krever delt lagring for stabil funksjon.
- Serveren har ingen avhengigheter utenom Node.js 20+.
