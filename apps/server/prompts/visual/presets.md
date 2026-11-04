# 18 стилевых пресетов

У каждого пресета: **STYLE ANCHOR** (вставляется в каждый image prompt дословно), **MOTION ANCHOR**, палитра, негатив и область применения. Анкоры даны на английском, потому что генераторы понимают его лучше.

---
## P1 · Editorial Paper-Cut
Для эксплейнеров, систем, таймлайнов, карт, документов, сравнений. Микс: ~80% paper-cut + ~20% сток там, где нужна реальная среда или движение.
**ANCHOR:** `editorial paper-cut documentary collage, warm off-white cream paper background, subtle paper grain and print texture, restrained halftone and stamp patterns, archival photos treated as cut-paper elements, layered cut paper with soft paper shadows and visible depth, slight handmade imperfections, cream black and white base with 2-4 muted accent colors, bold sans-serif or elegant serif editorial typography, one dominant hero subject, 2-5 supporting elements, strong negative space, 16:9`
**MOTION:** `restrained paper slides, drops, mask reveals, gentle scale-ins, paper unfolds, route draws, chart reveals, pin-in-place; logical layer-by-layer assembly; elements lock once placed; static camera; no morphing, no text rewriting`
**NEG:** glossy CGI, dramatic DOF, lens effects, photoreal 3D, random icons, clutter, fake evidence, unreadable text blocks, anime, oversaturation, invented logos.

## P2 · Bean Meme Vector (стиль быстрых 2D-исторических каналов)
**ANCHOR:** `clean 2D vector illustration, minimalist bean/blob characters with small rounded proportions, flat white bodies, thick clean black outlines, simple dot eyes, comedic meme-style expressions, vibrant high-contrast colors, detailed cinematic background environment with historical props and architecture, 16:9`
**MOTION:** `fast zoom-in, screen shake, pan, sudden pop-in, snappy character gesture; lip-sync line in quotes if speaking`
**Правила:** без текста и речевых пузырей в кадре; каждый промпт ссылается на ассет `[CHARACTER_SHEET_ID]`.

## P3 · Webcomic Ink (научно-эволюционные эксплейнеры)
**ANCHOR:** `2D hand-drawn digital illustration style, clean bold black ink linework (3-5px weighted stroke), muted flat earthy color palette, subtle cel shading, webcomic editorial art, simple expressive black-line stickmen with large round bald heads or chibi historical humans and animals with exaggerated expressions, minimalist solid off-white or slate-gray background for diagram scenes, stylized hand-drawn panoramas for narrative scenes, high contrast, clean minimalist composition, no realistic textures, no 3D rendering --ar 16:9`
**MOTION:** `2.5D cut-out puppet animation, slow digital push-in or smooth horizontal tracking, 2D position sliding, subtle breathing idle loop, blink cycle, simple rotational gestures, floating connection lines drift, smooth 2D motion, no morphing, no camera shake`

## P4 · Vector Noir Finance (cel shading + дрожь стоп-моушена)
**ANCHOR:** `2D vector cartoon illustration, flat explainer aesthetic, minimalist geometric characters: round heads, dot eyes, no noses, line mouths, thick black line stick-limbs, solid flat-colored clothing, thick uniform black outlines, hard-edged dramatic cel shading with heavy angular cast shadows across faces objects and floors, muted desaturated moody palette: earthy tones, olive greens, slate grays, sepia browns, dull slate blues, simplified perspective backgrounds with clean vector geometry, flat matte fills, no soft gradients, digital vector art`
**MOTION:** `stop-motion animation style, 12fps frame rate, snappy jerky movements, subtle paper texture jitter, flat vector animation motion` + конкретное микродействие («arm snaps down onto ledger», «ink bottle rattles»).
**Детали среды:** зелёные CRT-экраны с падением рынка, переполненные пепельницы, дождь на стекле небоскрёба, жёсткие конусы флуоресцентного света.

## P5 · Hand-Inked Noir Finance (смысловая цветовая кодировка)
**ANCHOR:** `full bleed 16:9 edge-to-edge frame, hand-drawn traditional 2D animation style, classic cel animation, bold clean inked outlines, subtle paper texture, dark charcoal background #121212 with high-contrast accents: emerald green for profit/revenue, crimson red for debt/costs, warm amber-gold for luxury/whales, flat color shading, cinematic 2D cartoon composition --style raw --no borders, frames, white margins, polaroid frame, film border, letterbox, panel outline`
Цифры показывай как рисованную инфографику: карточки, светящиеся графики, шкалы, HUD.

## P6 · Faceless Photoreal 3D (историческая криминальная реконструкция)
**ANCHOR (персонажи — повторять в каждом промпте):** `photorealistic humans with smooth, completely featureless faces — no eyes, no eyebrows, no visible nose structure, no mouth, seamless facial skin — realistic ears, hair, hands, anatomically correct bodies, natural skin texture, historically accurate garments with realistic folds, stitching, dirt and weathering; not mannequins, not plastic, not statues, not masks, not wax figures`
**СРЕДА:** `premium cinematic historical reconstruction, photorealistic architecture and materials, dark but readable exposure, motivated torchlight / oil lamps / moonlight / window light, cinematic depth of field, smoke, dust, rain or fog only when motivated, strong foreground-midground-background separation, realistic lenses, 16:9, non-graphic action`
Эмоции передаются позой, жестом, наклоном головы, светом. Избегай фэнтези, современных предметов, пустых локаций и стоящих без дела персонажей.

## P7 · Cinematic Archaeology (тёмная глубокая история)
**ANCHOR:** `cinematic 35mm still photograph, hyper-realistic, natural textures, volumetric lighting, subtle film grain, muted historical documentary color grade, highly detailed, photorealistic --ar 16:9`
**Палитра:** deep charcoal, limestone ochre, cold subterranean blue, flickering torch amber. **Атмосфера:** volumetric fog, airborne dust, damp sheen, lens bloom. **Оптика:** 35mm anamorphic, macro 100mm для артефактов, ultra-wide 18mm под землёй; chiaroscuro, свет одного фонаря или факела, rim light.
**MOTION:** `slow forward dolly / creeping Dutch tilt / microscopic pan / rising pedestal, drifting dust motes, flickering torch shadows, water droplet falling, subtle focal rack, smooth documentary pacing, stable, photoreal`

## P8 · Sacred Chiaroscuro (сакральные тексты и манускрипты)
**ANCHOR:** `photorealistic cinematic oil painting meets dark documentary photography, heavy chiaroscuro, volumetric light shafts through fog or stone windows, glowing gold leaf on dark surfaces, glowing manuscripts, ancient stone architecture, hyper-detailed weathered parchment, carved stone, worn leather, ancient fabric, palette: warm gold highlights, deep obsidian shadows, muted parchment browns, dark crimson accents --ar 16:9`
**MOTION:** `cinematic slow-motion, slow push-in, subtle tilt, floating dust particles, atmospheric smoke`

## P9 · Archival Photoreal (якорь эпохи)
**ANCHOR:** `pure cinematic realism, 35mm film stock, Arri/Leica cinema glass look, tactile textures, skin pores, atmospheric dust, volumetric natural light, authentic period costumes, unglamorous historical grime --ar 16:9 --style raw` + **якорь эпохи:** «1890s gritty Victorian realism», «1920s Kodachrome», «1950s archival 35mm», «daguerreotype-inspired».
**NEG:** painterly, cartoon/CGI, fantasy glow, airbrushing, oversaturated filters.
**MOTION:** `[camera move & speed], [micro subject action], [atmospheric drift], [particle physics], hyper-realistic slow-motion archival documentary footage, smooth 24fps`

## P10 · Faceted Docu — система из 4 стилей (премиальная бизнес- и тех-документалка)
Держи один стиль 15–30 с подряд, меняй на тематических швах. Сцена-блок 6–12 с (15–30 слов).
- **A · Faceted Low-Poly Realism (основной):** `geometric faceted 3D characters and environments with realistic physical materials (matte stone, brushed steel, wet asphalt reflections), moody industrial chiaroscuro, cold slate/charcoal tones vs glowing tungsten-amber windows, volumetric fog, rain puddle reflections, steam, shallow DOF`
- **B · Radar Blueprint CRT:** `deep military forest-green or charcoal CRT screen, fine sonar/radar grid, glowing chalk-white vector line art, dashed measurement axes, yellow/cyan calipers with units, archival photo cutouts taped with translucent yellow masking tape, scanlines, subtle barrel distortion` — для разрезов, глубин, высот и карт.
- **C · Archival Parallax:** `authentic B&W/sepia photographs, 2.5D depth separation, slow volumetric dust, heavy 35mm grain, analog chromatic aberration` — для реальных людей и записей.
- **D · Moody B-roll:** `24fps hyper-real cinematic shots, anamorphic flares, pitch-black silhouettes, spotlight cones through haze, slow-motion embers, rain, particles` — для пауз и мостов.
**Палитра:** Slate #2B303A · Rust #C85A17 · Amber #FFA000 · Sonar #1A2E26. Видео-промпт: 0–3 с кадр и дрейф → 3–7 с действие и атмосфера → 7 с–конец оседание камеры и переход + заметки по композитингу и звуку.

## P11 · Whiteboard Stick-Figure (психология)
**ANCHOR:** `minimalist 2D whiteboard explainer illustration, warm cream paper background #F5EFE3, clean slightly hand-drawn black ink line art, uniform medium line weight, flat shading, no gradients, no 3D, no photorealism, only 1-2 muted accents: soft red = pain/stress, soft blue = calm/thinking, warm yellow-gold glow = insight/healing, lots of empty space, one clear focal point, 16:9, no text`
**Персонаж:** оригинальный круглоголовый stick-figure с точками-глазами, маленьким ртом и ОДНОЙ отличительной деталью (например, полосатый шарф). Номер шага — титульная карточка с крупной рисованной цифрой.

## P12 · Anatomical Cinematic (здоровье, тело)
**ANCHOR:** `cinematic stylized 3D anatomical visualization, translucent organs and cells with soft subsurface glow, clean dark-teal studio void background, hormone molecules as glowing particles, clinical yet poetic lighting, macro depth of field, elegant infographic callout lines without text, 16:9` + чередование с `2.5D historical artwork` и `motion map overlays`, сплит-скрины до/после.
**NEG:** gore, surgical realism, medical-advertising cheese.

## P13 · Minimal Typography Finance
Чистые чёрные или тёмные фоны, сильная белая типографика, изолированные физические объекты (одна банковская карта, ключ, простой график), глубокие тени, гладкий сток (офис, город, руки, ноутбук). Без красных стрелок и шокированных лиц.
**ANCHOR:** `minimalist premium still life, single isolated physical object on deep matte black surface, hard soft-box key light, deep shadows, generous negative space, high contrast, editorial finance aesthetic, 16:9`

## P14 · Epic 3D with 2D Textures (военная история и монологи полководцев)
**ANCHOR:** `cinematic 3D reconstruction with hand-painted 2D textures, aged PBR materials, micro-displacement, oxidized metal patina, coarse woven wool, dust and sweat, Rembrandt key light, low-sun raking light, razor rim light, suspended volumetric dust, heat shimmer, ochre and bronze desaturated earth grade with one faction accent color (e.g. Tyrian purple), 85mm anamorphic f/1.8, AAA cinematic cutscene look, 16:9`
**MOTION:** `slow anamorphic dolly push-in or subtle upward tilt, 24fps with natural handheld drift, wind catching heavy cloak and hair, dust crossing camera axis, controlled authoritative oratory, physical weight shifts, no facial melting`
**Аудио (если генератор умеет):** низкая медь и литавры, ветер пустыни, звон доспехов.

## P15 · Epoch Hyperreal (реконструкции эпох)
**ANCHOR:** `cinematic AI hyperrealism like an expensive historical blockbuster, volumetric lighting, god rays, chiaroscuro, dense immersive atmosphere with dust, smoke, fog, sparks or rain, gritty hyper-detailed textures (fabric weave, skin pores, old stone), low-angle and wide-angle cinematic framing, depth of field --ar 16:9 --style raw --stylize 250`
Люди присутствуют в большинстве сцен (эмоции, взаимодействие, детали эпохи). Чередуй общие планы города и крупные планы лиц. I2V — только диегетический звук эпохи.

## P16 · Anime Vintage 9:16 (shorts о самоулучшении)
**ANCHOR:** `anime-influenced stylized realism, large expressive eyes, simplified noses, clean soft line art, painterly digital illustration with visible soft brushstrokes, graphic-novel color blocks, desaturated vintage grade (70-80% saturation), faded film tones, 15-25% film grain, soft diffuse light, soft blue-grey shadows never pure black, rule of thirds, 1080x1920 vertical, no text`
**Палитры:** Созерцание #33526f #42666a #2B4F5C #e7dbc8 · Романтика #E5916A #E8A84F #30696D #EBE9DC · Природа #3D806D #D4C9A2 #6BB5B9 · Ночь и город #1F2E3A #F0C475 #2b2b2b.
**Типы сцен:** одинокая фигура в огромном пейзаже (небо на 60–70% кадра) · портрет · пара · символический объект в руках · ночной город с боке · уютная комната с лампой.

## P17 · Marker Hand-Drawn Brand (тёплые финансы для миллениалов)
**ANCHOR:** `2D traditional hand-drawn cartoon, organic marker line-wobble, intentional human imperfections, variable-weight ink-black #111111 outlines with slightly unjoined corners, flat slightly uneven marker/gouache fills, stippled dot shading or parallel hatch lines, no airbrushing, no gradients, no 3D, white #FFFFFF or light sketchbook cream canvas, palette: warm ochre yellow, deep terracotta, soft denim blue, organic sage green, no text in scene`
Сцены чередуются: с маскотом и без (концептуальные объекты: рисованный сейф, кривые весы).

## P18 · Muted Flat Vector Isometric (история цивилизаций)
**ANCHOR:** `2D flat vector digital illustration, bold clean uniform black outlines, stylized simplified characters with round heads, dot eyes, curved mouth, stick-adjacent limbs with rounded hands, flat cel shading with one darker hard-edge tone, layered flat color-block backgrounds, 2.5D axonometric/isometric perspective for cities, no film grain, no paper texture, no lens flares, no vignettes, no text, 16:9`
**Палитры по сцене:** руины и конфликт — пепельно-серый, сланцево-коричневый, фиолетовое небо, огненно-оранжевые акценты · битва — огненный оранжевый, сажа, тёмный дым · карта — пергаментный беж, сланцево-синие океаны, оливковые леса · персонажи — кремовые и охристые туники.

---
## Как создать СВОЙ уникальный пресет (рекомендуется для канала)
Смешай: **1 медиум** (paper-cut, ink, low-poly, гуашь, клеймация, линогравюра, blueprint) + **1 световую логику** (chiaroscuro, мягкий диффуз, неон, свет одного источника) + **1 смысловую цветовую кодировку** (например, зелёный = прибыль, красный = долг) + **1 фирменный мотив** (лента-скотч, стрелки-маршруты, печати, пыль) + **1 правило композиции** (герой всегда слева, огромное негативное пространство). Запиши это в бренд-кит (yt-channel-strategy) и используй в каждом видео. Уникальное сочетание делает канал узнаваемым с одного кадра.
