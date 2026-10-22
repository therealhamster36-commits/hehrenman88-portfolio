# STRIKE ARENA 3D ⚽

Browser-Fußball mit 2D-/3D-Ansicht, 1v1, 2v2, 3v3, 4v4, Elfmeterschießen, privaten Online-Räumen und drei Bot-Schwierigkeitsgraden. Spieler im 2D- und 3D-Modus können zusammen spielen: Die gemeinsame Physik wird ausschließlich auf dem Server simuliert.

## Starten

1. Node.js 20 oder neuer installieren.
2. `npm install` ausführen – lädt Three.js für die 3D-Grafik.
3. `npm start` ausführen und `http://localhost:3000` öffnen.
4. Einen Modus und die Grafikansicht wählen. Im Solo-Modus sofort gegen Bots spielen oder per Raumcode Freunde einladen.

## Funktionen

- **2D Classic** und **3D Stadion** – jederzeit wechselbar, auch während des Spiels.
- **3D-Grafik** – Echtzeit-WebGL mit Schatten, Spielfeldlinien, Stadionlichtern, Tribünen, 3D-Spielern und Ball.
- **Torreplay** – Rückblick aus aufgezeichneten Multiplayer-Zuständen mit eigener Wiederholungskamera und Überspringen.
- **Modi:** 1v1, 2v2, 3v3, 4v4 und Elfmeterschießen mit abwechselnden Schüssen, Torwart-KI und möglicher Sudden Death.
- **Private Multiplayer-Räume** mit Einladungscode, bis zu acht echte Spieler (je nach Modus), aufgefüllt mit KI-Bots.
- Tastatur: WASD/Pfeile Bewegung, SPACE Schuss, E Pass, Q Ball erobern, SHIFT Sprint; Touch-Steuerung für mobile Geräte. Beim Elfmeter Zielen per Regler und Schussknopf.

## Technische Hinweise

Der Node.js-Server hostet `/three.module.js` direkt aus dem npm-Paket `three`, ohne externe Grafik-CDNs. Die 3D-Ansicht benötigt WebGL; wenn 3D auf einem Gerät nicht möglich ist, bleibt 2D als Fallback verfügbar. Die Grafik ist ein hochwertiger, prozedural aufgebauter Stadion-Look, **keine fotorealistische Fußballsimulation**. Replays sind clientseitige Ausschnitte der letzten Zustandsupdates und kein auf dem Server dauerhaft gespeichertes Video. Räume liegen im Arbeitsspeicher und gehen bei einem Serverneustart verloren.

## Render Deployment

Im Monorepo wird `cd strike-arena && npm install` für den Build und `cd strike-arena && npm start` zum Starten genutzt; der Start-Port wird aus `process.env.PORT` gelesen. Live-Matches brauchen WebSocket-Verbindungen, daher **kein GitHub Pages**.

## Tests

`npm test` startet Serverphysik-, Modus-, Elfmeter- und Multiplayer-Tests.
