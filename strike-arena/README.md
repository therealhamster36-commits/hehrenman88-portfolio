# STRIKE ARENA ⚽

Ein kostenloses, spielbares **4-gegen-4-Browser-Fußballspiel** mit privaten Online-Räumen und Bot-Gegnern. Ohne Datenbank, ohne API-Schlüssel und ohne externe Server-Bibliotheken.

## Funktionen

- **Privaten Raum erstellen** und **5-stelligen Code** bzw. Einladungslink teilen
- **Online mit bis zu 8 echten Menschen** spielen (maximal 4 pro Team)
- **Sofort gegen Bots spielen**, mit drei Schwierigkeitsgraden
- Fehlende Teamspieler werden beim Spielstart automatisch durch Bots ersetzt
- **Spieldauer 2, 3, 5 oder 8 Minuten**
- Gemeinsamer Spielstand, Tore, Nachspiel-/Neustart-Lobby, Hostwechsel bei Verlassen
- Desktop-Steuerung (WASD, Maus, Leertaste, E, Shift), Touch-Joystick und Buttons fürs Smartphone
- Server berechnet Bewegungen, Ballphysik, Treffer und Bots; alle Clients sehen denselben Spielzustand

## Lokal starten

Du brauchst **Node.js 20 oder neuer**.

```bash
npm start
```

Danach `http://localhost:3000` aufrufen. Ein zweiter Browser-Tab kann dem Raumcode beitreten. Für ein echtes Spiel über das Internet muss der Server online bereitgestellt werden.

## Öffentlich online stellen

Du kannst dieses Projekt zu **GitHub** hochladen und bei einem Node.js-Hostingdienst wie **Render** bereitstellen:

1. Neues GitHub-Repository anlegen und alle Dateien hochladen (einschließlich `server.js`, `miniws.js` und `public/`).
2. Auf https://dashboard.render.com/ einen neuen **Web Service** für dieses Repository erstellen.
3. Laufzeit **Node**, Build Command `npm install`, Start Command `npm start`. Alternativ ist `render.yaml` enthalten.
4. Nach erfolgreichem Deployment erhalten du und deine Freunde dieselbe öffentliche HTTPS-Adresse.
5. Ein Spieler wählt **Privaten Raum hosten**, kopiert den Einladungslink und die Freunde treten über den Code bei.

**Wichtig:** GitHub Pages allein reicht nicht, weil der Multiplayer-Server WebSocket-Verbindungen braucht. Ein Dienst kann in kostenlosen Tarifen bei Leerlauf einschlafen; die genauen Tarife können sich ändern. Spiele nicht auf zwei getrennten Server-Instanzen, da Räume derzeit im Arbeitsspeicher liegen.

## Tastatur

| Aktion | Steuerung |
| --- | --- |
| Laufen | WASD oder Pfeiltasten |
| Schuss | Leertaste oder Linksklick |
| Pass | E |
| Sprint | Shift |
| Zielen | Mausposition oder Laufrichtung |
| Smartphone | Touch-Joystick, Schuss-/Pass-/Sprint-Buttons |

## Struktur

- `server.js` – HTTP-Server, private Räume, Multiplayer-Simulation und Bots
- `miniws.js` – schlanker WebSocket-Server ohne externe Abhängigkeiten
- `public/index.html` – Website und Spieloberfläche
- `public/style.css` – responsives Premium-Styling
- `public/client.js` – Darstellung des Spielfelds, Eingaben, UI, Audio
- `render.yaml` – beispielhafte Hosting-Konfiguration

## Hinweise

Dieses Projekt ist ein **funktionierender 2D-Arcade-Prototyp**, kein 3D-Fußballsimulator. Alle Räume liegen nur im Arbeitsspeicher und gehen bei Neustart des Servers verloren. Eine Datenbank ist nicht nötig, solange du keine Konten, Ranglisten oder persistenten Daten brauchst. Spielernamen sind öffentlich sichtbar für die anderen Spieler im jeweiligen Raum.
