# STRIKE ARENA — v2

Ein kostenloses **4-gegen-4-Online-Fußballspiel im Browser**. Pro Match sind maximal acht Personen und frei auffüllbare Bots auf dem Feld.

## Start

Node.js 20+ erforderlich:

```bash
npm install
npm start
```

Öffne `http://localhost:3000` im Browser. Um die Tests auszuführen: `npm test`.

## Features

- Privaten Raum hosten, Code/Einladungslink kopieren, Freunde einladen
- Spiel gegen Bots, drei Schwierigkeitsstufen, Teamwechsel, Matchdauer 2–8 Minuten
- **Neue Ballkontrolle**: Ein Spieler führt den Ball, statt dass alle Spieler ihn gleichzeitig bewegen
- Zielgerichtete Schüsse und Pässe, Ballgewinne mit `Q`, Lauf- und Sprintsystem
- Verbessertes Bot-Spiel: Torwartpositionierung, zielgerichtete Pässe, Zweikampf und Pressing
- Spätes Beitreten im laufenden Match (Bots werden ersetzt), automatische Wiederverbindung im Frontend
- PC und Touch-Bedienung; am Handy für mehr Übersicht Querformat nutzen
- Serverseitiger Spielzustand mit WebSocket-Synchronisierung, health-Endpoint unter `/health`
- Kein Tracking, keine API-Keys, keine externen Laufzeitabhängigkeiten

## Steuerung

| PC | Aktion |
|---|---|
| WASD / Pfeiltasten | Bewegen |
| Maus | Zielen |
| Leertaste / Linksklick | Schießen |
| E | Passen |
| Q | Zweikampf / Ball erobern |
| Shift | Sprint |

Am Smartphone Joystick plus Schuss-, Pass-, Sprint- und Ballgewinnen-Buttons. Der Aim-Richtungsvektor kommt vom Joystick.

## Deployment

Das Projekt ist im GitHub-Repository `hehrenman88-portfolio` unter `strike-arena/` abgelegt. Es läuft als Node.js Web Service auf Render.

- Region: Frankfurt, Instanz: `free`
- Build-Befehl: `cd strike-arena && npm install`
- Start-Befehl: `cd strike-arena && npm start`
- Health-Check: `/health`
- Für neue GitHub-Commits ist Auto-Deploy aktiviert.

**Grenzen:** Dies ist weiterhin ein **2D-Arcade-Fußballspiel**, kein 3D-Simulator. Räume und Live-Spiele sind nur im Speicher einer Render-Instanz gespeichert. Kostenlose Render-Webdienste können im Leerlauf pausieren, danach gehen laufende Runden verloren. Eine DB/Authentifizierung gibt es derzeit nicht. Bitte nur eine Instanz betreiben. 

## Dateistruktur

- `server.js`: Autoritativer Multiplayer-/Spieleserver
- `miniws.js`: Minimaler WebSocket-Server
- `public/index.html`: Web-UI
- `public/style.css`: Layout für Desktop und Mobile
- `public/client.js`: Spielrenderer, Eingaben, UI, Reconnect
- `tests`: HTTP-, Multiplayer- und Spielphysiktests
