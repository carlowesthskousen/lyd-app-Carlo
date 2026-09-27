# Credits

## 3D-modeller

| Model | Producent / designer | Kilde og licens |
| ----- | -------------------- | --------------- |
| **After Chair** (`public/models/fritz-hansen/after-chair.glb`) | Fritz Hansen · design: Michael Anastassiades | 3D-model fra Fritz Hansens officielle downloads, konverteret fra FBX til GLB. **Kun til privat brug.** Må ikke videredistribueres eller bruges kommercielt. |
| Lænestol (GLB-eksempel) (`public/models/eksempel/laenestol-eksempel.glb`) | Lavet til dette projekt | Kan frit bruges. |

Alle andre møbler er procedurale placeholders, der genereres i koden (`src/furniture/procedural.ts`).

## Teksturer

| Tekstur | Kilde og licens |
| ------- | --------------- |
| Hvidpigmenteret ask (`public/models/textures/ask-hvidpigmenteret/`: albedo, normal, roughness) | Procedural tekstur lavet til dette projekt med `tools/generate-ash-texture.mjs`. Kan frit bruges. |
| Gulve, vægge, stof og græs | Genereres procedurelt i `src/render/textures.ts`. |

> **After Chair-filen ligger ikke i git.** Repoet er offentligt, og modellen må kun bruges privat, så `public/models/fritz-hansen/*.glb` står i `.gitignore`. Læg selv `after-chair.glb` i `indretning/public/models/fritz-hansen/` i din lokale kopi. Manifest-linjen og ask-teksturen er i repoet. Uden filen viser spillet en placeholder-spisestol med en advarsel.
