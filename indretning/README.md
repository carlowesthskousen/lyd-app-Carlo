# Indretning – 3D-indretning og arkitektur i browseren

Et spil til indretning og arkitektur i stil med The Sims' bygge- og købstilstand og Planet Coaster. Du er selve kameraet og flyver frit rundt. Du tegner vægge, sætter døre og vinduer i, maler, lægger gulve og indretter med møbler i rigtige mål.

Bygget med **Vite + TypeScript + Three.js**. Der er ingen backend: projekter gemmes i browseren (localStorage), og de kan eksporteres og importeres som JSON.

---

## Kom i gang

```bash
cd indretning
npm install
npm run dev        # åbner udviklingsserveren på http://localhost:5173
```

| Kommando            | Hvad den gør                                   |
| ------------------- | ---------------------------------------------- |
| `npm run dev`       | Udviklingsserver med hot reload                |
| `npm run build`     | Typetjek + produktionsbuild i `dist/`          |
| `npm run preview`   | Kør det byggede spil lokalt                    |
| `npm test`          | Unit-tests (væg-graf, rum, kollision, snap)    |

Første gang åbner spillet et lille starterhus, så du kan gå i gang med det samme. **Projekter → Nyt tomt projekt** giver en tom grund.

---

## Styring

Tryk **H** i spillet for at se alle hurtigtaster.

**Kamera – to tilstande (Tab skifter blødt mellem dem)**

*Drone* – fri flyvning i alle retninger, som en rigtig drone:

| Input                                  | Handling                                                        |
| -------------------------------------- | --------------------------------------------------------------- |
| W / S                                  | Flyv frem/tilbage **dertil du kigger**. Kigger du skråt ned, dykker du |
| A / D                                  | Flyv sidelæns                                                   |
| Space / Shift                          | Flyv lodret op / ned                                            |
| Venstre- eller højreklik + træk        | Kig rundt (drejer på stedet). Markøren skjules og låses, mens du trækker |
| Midterklik + træk, eller Alt + venstre-træk | Orbit om punktet på gulvet/objektet, som musen pegede på   |
| Klik (under 5 px bevægelse)            | Bruger det aktive værktøj (vælg, placér, slet …)                |
| Træk på det **valgte** møbel           | Flytter møblet                                                  |
| Scroll                                 | Flyvehastighed (vises kort midt på skærmen)                     |
| Ctrl / Alt                             | Boost (×3) / præcision (meget langsom)                          |

Dronen accelererer blødt og glider videre, når du slipper tasterne. Den krænger let i sving og retter sig selv op. Den kan ikke komme under gulvet, men kan flyve helt op til 1,5 km. Døre og vinduer kan flyves igennem. Væg-kollision kan slås fra, så man flyver gennem vægge. Man kan kigge ±89° op og ned, men ikke vende rundt på hovedet.

> ⚠️ **Ctrl+W (boost frem) lukker fanen i nogle browsere**, og det kan et spil ikke blokere. I drone-tilstand spørger browseren derfor først, om du vil forlade siden. Ctrl+D og Ctrl+S virker som genveje, når dronen står stille. Mens du flyver, er de boost.

*Byg* – oversigtskamera som i The Sims:

| Input                      | Handling                                     |
| -------------------------- | -------------------------------------------- |
| W A S D / piletaster       | Flyv vandret i kameraets retning             |
| Space · C                  | Op · ned                                     |
| Shift                      | Boost                                        |
| Højreklik + træk           | Orbit om punktet under musen                 |
| Midterklik + træk          | Panorér (gulvet "følger musen")              |
| Scroll                     | Zoom mod musens position                     |

**I begge tilstande:**
- **Q / E** drejer til venstre/højre, og **R / F** kigger op/ned.
- **Tab** skifter blødt mellem Drone og Byg, og `[` `]` justerer farten.
- **G** fokuserer på det valgte, **Y** viser oppefra, og **Home** nulstiller.
- Venstreklik bruger værktøjet.

**Markering af flere ting (markeringsværktøjet, V):**

| Input | Handling |
| ----- | -------- |
| Klik | Markér ét objekt. Er det i en gruppe, markeres hele gruppen |
| Shift+klik | Tilføj/fjern et objekt. Dronen dykker ikke, når Shift bruges til et klik |
| Venstre-træk på tom plads | Markeringsboks: alt med midtpunkt inde i boksen bliver markeret. Shift+træk tilføjer |
| Dobbeltklik på en gruppe | Markér kun det ene objekt i gruppen |
| Cmd/Ctrl+A · Esc | Markér alt · fjern markering |
| "Markér: Kun møbler / Alt" (toppen) | Vælg om vægge, døre og vinduer også kan markeres |
| Træk i et markeret objekt | Flyt hele bunken. Den indbyrdes placering bevares, og snap og kollisionsvisning virker |
| Piletaster · Alt+pile | Skub bunken 1 cm · 10 cm (i kameraets retning, låst til gitteret) |
| R / T (Shift = modsat, Alt = 1°) | Drej bunken 15° om dens fælles midtpunkt |
| Delete / Backspace | Slet alt markeret |
| Cmd/Ctrl+D | Duplikér bunken. Kopien følger musen, til du klikker den på plads (Esc annullerer) |
| Cmd/Ctrl+C · Cmd/Ctrl+V | Kopiér og indsæt. Virker også mellem projekter |
| Cmd/Ctrl+G · Cmd/Ctrl+Shift+G | Gem markeringen som gruppe (navnet foreslås, fx "Spisebord 180 med 6 × spisestol") · opløs gruppen |

Flytter du en væg sammen med møbler, følger dens døre og vinduer med. Grupper gemmes i projektet. Hver handling på bunken er én fortryd (Cmd/Ctrl+Z). På Mac bruges Cmd til alle genveje, og Ctrl+klik bruges ikke til noget, fordi det er højreklik. I markeringsværktøjet ligger "kig rundt" på højreklik-træk, fordi venstre-træk tegner markeringsboksen. Når noget er markeret, drejer R markeringen i stedet for at vippe kameraet, og piletasterne skubber markeringen i stedet for at flyve.

**Controller (gamepad):** Venstre stick bevæger, højre stick kigger og RT/LT er op/ned. RB giver boost, LB præcision, og Y/△ skifter mellem Drone og Byg.

**Indstillinger (⚙):** Kameratilstand, musefølsomhed, invertér Y, farten i begge tilstande, glid (fra stram til flydende), krængning og væg-kollision. Indstillingerne gemmes i browseren. HUD'et øverst til venstre viser tilstand, højde over gulv, fart og en tasteoversigt, som kan skjules.

**Værktøjer**

| Tast | Værktøj                                                                 |
| ---- | ----------------------------------------------------------------------- |
| V    | Vælg & flyt (træk møbler, skub døre/vinduer langs væggen)               |
| B    | Væg: klik punkt for punkt. Shift låser vinklen til 45°, dobbeltklik/Esc afslutter |
| N    | Rum: træk et rektangel, så bygges fire vægge                             |
| O    | Døre & vinduer: peg på en væg og klik. T spejlvender døren              |
| P    | Maling & gulve: klik på en vægside eller et gulv. Shift+klik maler hele rummet |
| X    | Slet: rødt omrids på objektet under musen. Klik sletter, og træk sletter flere |
| K    | Skift mellem **Byg** og **Indret**                                      |
| L    | Vægge oppe / cutaway / nede (som i The Sims)                            |
| M    | Vis/skjul gitter                                                        |

**Redigering:** Ctrl+Z / Ctrl+Y (fortryd/gentag alt), Ctrl+D (duplikér), Delete (slet), T / Shift+T (drej 15°), Alt+T eller Alt+scroll (fri rotation), hold Alt (placér uden snap), Ctrl+S (gem nu).

---

## Importér møbler direkte i spillet (Mine møbler)

Den hurtigste måde at få dine egne møbler med. Der er ingen server og ingen kommandolinje.

1. **Træk filerne ind i spillets vindue**, eller klik **Importér møbel** i kataloget. Det virker med:
   - `.glb`, `.gltf`, `.fbx` og `.obj`, gerne med teksturer, `.mtl`- og `.bin`-filer ved siden af.
   - En hel producent-mappe eller en `.zip`. Spillet vælger selv den bedste fil (GLB > glTF > FBX > OBJ) og springer `.dwg`, `.skp`, `.max`, PDF'er osv. over.
   - Flere forskellige møbler på én gang. De importeres ét ad gangen med "Spring over".
2. **Import-dialogen** (tager under 30 sekunder):
   - Drej modellen med musen. En 180 cm figur står ved siden af, så du kan se, om størrelsen er rigtig.
   - Navnet gættes ud fra filnavnet, og kategorien ud fra navnet.
   - **Målene aflæses fra modellen**, og enheden (mm, cm, m eller tommer) gættes. Er gættet forkert, skifter du enhed, og målene regnes om. Du kan også skrive målene direkte, med eller uden låste proportioner.
   - **Drej forside 90°**, hvis møblet vender forkert. **Stå på gulvet** vipper det 90°, hvis det ligger ned (typisk for CAD-eksporter med Z op).
   - **Materialer:** Hver materialedel står i en liste. Klik på en del (i listen eller i 3D) for at se den fremhævet, og giv den en forudindstilling: ask, eg, valnød, sort lak, hvid lak, naturlæder, sort læder, stof, messing, krom, opal glas eller klart glas. Teksturerne får automatiske UV'er, ligesom After Chair. Sæt flueben ved **Kan farves** for de dele, der skal kunne farves i spillet.
3. Klik **Tilføj til katalog**. Møblet ligger nu under **Mine møbler** og i sin normale kategori.

**Lagring:** Importerede møbler gemmes **kun lokalt i din browser** (IndexedDB), aldrig i repoet eller på en offentlig side. Projekter, der bruger dem, virker efter genindlæsning. I **Mine møbler** kan du:
- **redigere** (✎) og **slette** (🗑, to klik),
- **eksportere hele biblioteket** som én fil (`*.indretning-bibliotek.json`) til backup eller flytning til en anden computer,
- **importere biblioteket** igen. Du kan også trække backup-filen ind i vinduet.

**Prøv det:** Mappen `eksempler-import/` indeholder `loungestol.fbx` (cm), `sidebord.obj` + `.mtl` (mm) og `producent-pakke.zip` (samme stol i flere formater plus CAD-filer).

> Et projekt eksporteret som JSON indeholder ikke selve møbelmodellerne. Tag også en biblioteks-backup, hvis du flytter til en anden computer.

## Tilføj dine egne møbelmodeller

Alle møbler styres af én fil: **`public/models/manifest.json`**. Hver linje i `items` er ét møbel. Det gør du for at tilføje et rigtigt møbel, fx fra en producents gratis 3D/CAD-download:

### 1. Skaf modellen som GLB eller glTF

Spillet læser **`.glb`** (anbefalet) og **`.gltf`**. Hvis producenten kun tilbyder andre formater:

- **FBX, OBJ, 3DS, DAE, STL:** Åbn filen i [Blender](https://www.blender.org/) (gratis) med *File → Import*, og vælg derefter *File → Export → glTF 2.0*, format *glTF Binary (.glb)*.
- **SketchUp (.skp):** Eksportér fra SketchUp som `.dae` eller `.fbx`, og konvertér i Blender som ovenfor.
- **3ds Max / Revit / ArchiCAD-familier:** Eksportér som FBX, og konvertér i Blender.

Tip: Gør store filer mindre med
`npx @gltf-transform/cli optimize ind.glb ud.glb --compress meshopt`.
Spillet understøtter både Meshopt- og Draco-komprimering.

### 2. Læg filen i `public/models/`

Brug gerne en mappe pr. producent:

```
public/models/
  manifest.json
  hay/about-a-chair-22.glb
  hay/thumbs/about-a-chair-22.webp     (valgfri)
```

### 3. Tilføj én linje i `manifest.json`

```json
{"id": "hay-aac22", "name": "About A Chair AAC 22", "manufacturer": "HAY", "designer": "Hee Welling", "category": "stole", "dimensions": {"width": 52, "depth": 52, "height": 79}, "file": "hay/about-a-chair-22.glb", "thumbnail": "hay/thumbs/about-a-chair-22.webp", "recolorable": ["Shell"], "defaultColor": "#e8e2d6", "placement": "floor"},
```

Husk kommaet mellem linjerne (dog ikke efter den sidste). Genindlæs siden, så står møblet i kataloget.

### 4. Felterne

| Felt            | Påkrævet | Forklaring |
| --------------- | :------: | ---------- |
| `id`            | ✔ | Unikt id (kun små bogstaver, tal og bindestreg). Bruges i gemte projekter, så **skift det ikke** bagefter. |
| `name`          | ✔ | Navnet i kataloget. |
| `manufacturer`  |   | Producent, fx `"HAY"`. |
| `designer`      |   | Designer, fx `"Hee Welling"`. |
| `category`      | ✔ | `stole`, `borde`, `sofaer`, `lamper`, `opbevaring`, `senge`, `dekoration` eller `koekken-bad`. |
| `dimensions`    | ✔ | **Rigtige mål i cm**: `width` (bredde, venstre–højre set forfra), `depth` (dybde, for–bag) og `height`. |
| `file`          | ✔* | Sti til `.glb`/`.gltf` relativt til `public/models/`. |
| `procedural`    | ✔* | Navn på en indbygget placeholder (se nedenfor). *Enten `file` eller `procedural`. Har du begge, bruges placeholderen, hvis filen ikke kan indlæses. |
| `thumbnail`     |   | Billede til kataloget (png/jpg/webp). Mangler det, renderer spillet selv et thumbnail. |
| `rotationY`     |   | Grader. Brug det, hvis modellens forside ikke vender mod betragteren, fx `90`, `-90` eller `180`. |
| `scaleMode`     |   | `"fit"` (standard) strækker modellen, så den passer præcist til målene. `"uniform"` bevarer proportionerne og holder sig inden for målene. |
| `recolorable`   |   | `true` = hele modellen kan farves. En liste som `["Stof", "Shell"]` = kun materialer med de navne kan farves. Undlad feltet, hvis farven ikke skal kunne ændres. |
| `defaultColor`  |   | Startfarve (hex). |
| `finishes`      |   | Materialevalg i egenskabspanelet: `stof`, `laeder`, `trae`, `lak`, `metal`. `defaultFinish` vælger standarden. |
| `light`         |   | Gør møblet til en lampe: `{"color": "#ffd9a8", "intensity": 6, "distance": 7, "height": 140}`. `height` er lyskildens højde i cm over møblets bund. |
| `placement`     |   | `floor` (standard), `surface` (kan stå på borde/kommoder), `wall` (hænger på væggen) eller `ceiling` (hænger fra loftet). |
| `elevation`     |   | Standardhøjde over gulv i cm for `wall`/`ceiling`. |
| `tags`          |   | Ekstra søgeord til katalogets søgefelt. |
| `materials`     |   | Overstyr materialer i GLB-filen efter navn (farve og PBR-teksturer). Se nedenfor. |

### Rigtige materialer og teksturer (`materials`)

Mange producent-modeller har enkle, ensfarvede materialer og ofte ingen UV-koordinater. Med feltet `materials` kan du overstyre et materiale efter dets navn i GLB-filen og give det farve og PBR-teksturer. After Chair bruger det til sit stel af hvidpigmenteret ask:

```json
"materials": {
  "Trae": {
    "color": "#ffffff",
    "map": "textures/ask-hvidpigmenteret/albedo.jpg",
    "normalMap": "textures/ask-hvidpigmenteret/normal.png",
    "normalScale": 0.6,
    "roughnessMap": "textures/ask-hvidpigmenteret/roughness.jpg",
    "roughness": 1,
    "textureSize": 0.4
  }
}
```

| Felt | Forklaring |
| ---- | ---------- |
| `color` | Farve, der ganges på teksturen (`#ffffff` = teksturens egen farve). |
| `map` | Farvetekstur (jpg/png/webp, sRGB). |
| `normalMap`, `normalScale` | Normal-map i OpenGL-format (grøn = op, som hos Poly Haven og ambientCG "GL"). `normalScale` styrer dybden. |
| `roughnessMap`, `roughness` | Roughness-map i gråtoner, der ganges med `roughness`. |
| `metalness` | 0 for træ, stof og læder. |
| `textureSize` | Hvor mange **meter** én teksturflade dækker (standard 0,5). |
| `uv` | `"auto"` (standard) bruger modellens UV'er og laver selv box-projicerede UV'er, hvis modellen ikke har nogen. `"box"` laver dem altid, og `"model"` laver dem aldrig. |

Stierne er relative til `public/models/`. De automatiske UV'er lægger træets årer lodret på lodrette flader (ben og stolper).

**Brug en tekstur fra Poly Haven eller ambientCG (CC0):**
1. Download fx en ask- eller lys træ-tekstur i 1K eller 2K. Hos ambientCG skal du vælge "JPG" og bruge `NormalGL`, ikke `NormalDX`.
2. Læg filerne i `public/models/textures/<navn>/`.
3. Peg `map`, `normalMap` og `roughnessMap` på dem, og sæt `textureSize` til teksturens rigtige størrelse i meter (står på downloadsiden).

De medfølgende træ- og læderteksturer (ask, eg, valnød, læder) er genereret med `node tools/generate-textures.mjs` og kan justeres i scriptet. Med `"preset": "eg"` (eller en anden forudindstilling) i stedet for teksturstier kan du bruge dem direkte i manifestet.

### Sådan virker den automatiske skalering

Det er ligegyldigt, om modellen er lavet i millimeter, centimeter, meter eller tommer. Når modellen indlæses, sker følgende:

1. Den drejes med `rotationY`.
2. Dens bounding box måles, og den skaleres, så bredde × dybde × højde passer **præcis** til `dimensions`.
3. Den centreres og sættes med bunden på gulvet.
4. Meshes med samme materiale slås sammen til én, så der er færre draw calls og bedre fps.

Eksemplet `public/models/eksempel/laenestol-eksempel.glb` er bevidst modelleret i **millimeter** og med forsiden den forkerte vej. Manifestet giver den `"rotationY": -90`, og spillet skalerer den selv til 76 × 74 × 70 cm.

### Fejlfinding

Åbn browserens udviklerkonsol (F12):

- **"Manifest-linjen … springes over"**: Et påkrævet felt mangler, eller kategorien er stavet forkert.
- **"Kunne ikke indlæse …"**: Filstien er forkert, eller filen er ikke gyldig glTF. Møblet vises som placeholder (eller som en kasse), og i egenskabspanelet står der en advarsel.
- **"modellens proportioner afviger …"**: Bredde og dybde er formentlig byttet om, eller modellen skal drejes. Prøv `"rotationY": 90`.
- **Farven virker ikke:** Materialenavnene i `recolorable` skal matche navnene i filen. Du kan se dem i Blender (Material-fanen) eller ved at trække filen ind i <https://gltf-viewer.donmccurdy.com/>.

> Se [CREDITS.md](CREDITS.md) for kilder og licenser på de medfølgende modeller og teksturer. **After Chair** er en 3D-model fra Fritz Hansens officielle downloads og må **kun bruges privat**.
>
> Husk at læse producentens licensvilkår. Mange 3D-filer må bruges til egne projekter, men ikke videredistribueres.

### Indbyggede placeholders (`procedural`)

`diningChair`, `armchair`, `officeChair`, `stool`, `diningTable`, `roundTable`, `coffeeTable`, `glassTable`, `sideTable`, `desk`, `sofa`, `sofaChaise`, `pouf`, `floorLamp`, `tableLamp`, `pendant`, `bookshelf`, `dresser`, `sideboard`, `wardrobe`, `tvBench`, `bed`, `nightstand`, `plant`, `plantSmall`, `rug`, `picture`, `mirror`, `vase`, `tv`, `kitchenCounter`, `kitchenSink`, `stove`, `fridge`, `toilet`, `bathtub`, `bathSink`.

De tilpasser sig automatisk til de mål, du angiver. `"procedural": "sofa"` med bredde 300 giver fx en 3-personers sofa, der er 3 m bred.

---

## Egne teksturer til gulve og vægge

Gulv- og vægmaterialerne (træ, fliser, beton, tæppe, mursten, puds) genereres procedurelt i `src/render/textures.ts`, så spillet ikke er afhængigt af eksterne filer. Vil du bruge rigtige PBR-teksturer, så læg billederne i `public/textures/` og skift den relevante `case` i `src/render/materials.ts` ud med `new THREE.TextureLoader().load('textures/eg.jpg')`. Sæt `colorSpace = SRGBColorSpace` og `repeat` til `1 / meter pr. flise`. Farvelister og materialenavne i Byg-panelet findes i `src/building/buildCatalog.ts`.

---

## Opbygning af koden

```
src/
  state/        Dokumentmodel (ProjectDoc), Store med transaktioner og fortryd/gentag
  camera/       FlyCamera (Drone + Byg), bevægelsesfysik, væg-kollision, gamepad, indstillinger
  building/     Væg-graf (hjørnesamlinger, deling, rumdetektion), vægge med huller,
                døre/vinduer, gulve, cutaway
  furniture/    Katalog + manifest, model-loader med autoskalering, procedurale
                placeholders, kollision (OBB/SAT), væg-snap, lyspulje for lamper
  tools/        Vælg, Væg, Rum, Døre & vinduer, Møbelplacering, Maling, Slet
  render/       Renderer, sol/himmel/tidspunkt, SSAO (GTAO), omrids, materialer
  ui/           Top-bar, værktøjslinje, katalog, egenskabspanel, hjælp, projekter
  persistence/  localStorage, JSON-eksport/-import, starterhus
  import/       Træk-og-slip, zip/mapper, konvertering (GLTF/FBX/OBJ-loaders), import-dialog
  library/      Mine møbler i IndexedDB (backup/gendan)
  materials/    Materiale-forudindstillinger (ask, eg, valnød, læder, metal, glas …)
  app.ts        Binder det hele sammen (input, genveje, render-loop, autosave)
```

**Princip:** Hele projektet er ét serialiserbart dokument. 3D-scenen *afledes* af dokumentet, og alle ændringer sker i transaktioner (`store.transact(...)`). Derfor virker fortryd/gentag, autosave og eksport automatisk for alle handlinger, også nye, du selv tilføjer.

## Ydelse

- Møbelmodeller bages og slås sammen pr. materiale, og materialer deles mellem møbler.
- Skyggekortet gentegnes kun, når noget ændrer sig. Skyggekameraet tilpasses huset.
- Lamper bruger en fast pulje på 8 lyskilder, som tildeles de tændte lamper nærmest kameraet. Det giver ingen shader-genkompilering og stabil fps, uanset hvor mange lamper der står.
- Hvis billedfrekvensen falder under 40 fps i flere sekunder, slås SSAO automatisk fra, og derefter sænkes opløsningen. Alt kan justeres under ⚙.

## Projektformat

Eksporterede projekter er JSON (`*.indretning.json`) med `version: 1`. Det indeholder noder, vægge, åbninger, rumstile (gulv og navn), møbler og indstillinger. Koordinater er i meter, og rotation er i radianer. Ved import valideres og ryddes filen, og projektet får et nyt id.
