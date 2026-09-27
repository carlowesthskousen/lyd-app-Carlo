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
| Ask, eg, valnød og læder (`public/models/textures/…`: albedo, normal, roughness) | Procedurale teksturer lavet til dette projekt med `tools/generate-textures.mjs`. Kan frit bruges. |
| Gulve, vægge og stof | Genereres procedurelt i `src/render/textures.ts`. |
| Græs (farve og normal-map) | Genereres procedurelt ved opstart i `src/render/ground.ts`. |

## HDRI (miljølys)

| Fil | Kilde og licens |
| --- | --------------- |
| "park" (`@pmndrs/assets/hdri/park.exr`) | "park"-HDRI fra [Poly Haven](https://polyhaven.com/hdris), **CC0**. Nedskaleret til 512×256 og konverteret til EXR af [@pmndrs/assets](https://github.com/pmndrs/assets) (CC0). |
| `public/hdri/ude.hdr` (valgfri) | Dit eget HDRI, fx et 2K-HDRI fra Poly Haven (CC0). Bruges automatisk, hvis filen findes. |

> **After Chair-filen ligger ikke i git.** Repoet er offentligt, og modellen må kun bruges privat, så `public/models/fritz-hansen/*.glb` står i `.gitignore`. Læg selv `after-chair.glb` i `indretning/public/models/fritz-hansen/` i din lokale kopi. Manifest-linjen og ask-teksturen er i repoet. Uden filen viser spillet en placeholder-spisestol med en advarsel.
