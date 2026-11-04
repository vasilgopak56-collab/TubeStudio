# Полная библиотека визуальных стилей Studio

Извлечено из исходников Whiteboard Studio v9.10. Всего: 40 стилей. Это визуальные пресеты, не стили написания сценариев.

## Состав

- Golpo Canvas: 11
- Golpo Sketch: 7
- Из ваших видео: 4
- База знаний (P1–P18): 18

## Как использовать

Выберите стиль и скопируйте основной промпт (anchor) в описание визуального стиля. Добавьте конкретное содержание кадра. Negative prompt задаёт нежелательные элементы; если отдельного поля нет, используйте его как ограничения в основном запросе. Промпт движения предназначен для внешнего генератора видео и не гарантирует анимацию в HandDraw. HandDraw раскрывает готовую картинку своим эффектом.

В styles.json сохранён исходный массив без переименования полей. Это формат данных для переноса или разработки; отдельной кнопки импорта этой библиотеки в программе не заявлено.

Названия, формулировки и ссылки на примеры сохранены из программы. Метки wb3, guide и подобные — внутренние обозначения примеров, не вложенные видео. Промпты являются инструкциями модели, а не гарантией результата.

## Оглавление

1. **Chalkboard · White on Black** — Golpo Canvas; ID: `canvas-chalk-wob`
2. **Chalkboard · Black on White** — Golpo Canvas; ID: `canvas-chalk-bow`
3. **Chalkboard · Color** — Golpo Canvas; ID: `canvas-chalk-color`
4. **Whiteboard** — Golpo Canvas; ID: `canvas-whiteboard`
5. **Modern Minimal** — Golpo Canvas; ID: `canvas-modern-minimal`
6. **Playful** — Golpo Canvas; ID: `canvas-playful`
7. **Technical** — Golpo Canvas; ID: `canvas-technical`
8. **Editorial** — Golpo Canvas; ID: `canvas-editorial`
9. **Sharpie** — Golpo Canvas; ID: `canvas-sharpie`
10. **Illustration** — Golpo Canvas; ID: `canvas-illustration`
11. **Notebook (Compact)** — Golpo Canvas; ID: `canvas-notebook`
12. **Sketch · Classic** — Golpo Sketch; ID: `sketch-classic`
13. **Sketch · Improved (Beta)** — Golpo Sketch; ID: `sketch-improved`
14. **Sketch · Dry Erase** — Golpo Sketch; ID: `sketch-dry-erase`
15. **Sketch · Professional Clean** — Golpo Sketch; ID: `sketch-professional-clean`
16. **Sketch · Crayon** — Golpo Sketch; ID: `sketch-crayon`
17. **Sketch · Formal** — Golpo Sketch; ID: `sketch-formal`
18. **Sketch · Infographics** — Golpo Sketch; ID: `sketch-infographics`
19. **Storybook Colored Pencil** — Из ваших видео; ID: `obs-storybook-pencil`
20. **Comic Marker Explainer** — Из ваших видео; ID: `obs-comic-marker`
21. **Painterly Parchment Epic (Custom)** — Из ваших видео; ID: `obs-parchment-epic`
22. **Dark Glow Motion Graphics** — Из ваших видео; ID: `obs-ai-motion-dark`
23. **P1 · Editorial Paper-Cut** — База знаний (P1–P18); ID: `kb-p1`
24. **P2 · Bean Meme Vector (стиль быстрых 2D-исторических каналов)** — База знаний (P1–P18); ID: `kb-p2`
25. **P3 · Webcomic Ink (научно-эволюционные эксплейнеры)** — База знаний (P1–P18); ID: `kb-p3`
26. **P4 · Vector Noir Finance (cel shading + дрожь стоп-моушена)** — База знаний (P1–P18); ID: `kb-p4`
27. **P5 · Hand-Inked Noir Finance (смысловая цветовая кодировка)** — База знаний (P1–P18); ID: `kb-p5`
28. **P6 · Faceless Photoreal 3D (историческая криминальная реконструкция)** — База знаний (P1–P18); ID: `kb-p6`
29. **P7 · Cinematic Archaeology (тёмная глубокая история)** — База знаний (P1–P18); ID: `kb-p7`
30. **P8 · Sacred Chiaroscuro (сакральные тексты и манускрипты)** — База знаний (P1–P18); ID: `kb-p8`
31. **P9 · Archival Photoreal (якорь эпохи)** — База знаний (P1–P18); ID: `kb-p9`
32. **P10 · Faceted Docu — система из 4 стилей (премиальная бизнес- и тех-документалка)** — База знаний (P1–P18); ID: `kb-p10`
33. **P11 · Whiteboard Stick-Figure (психология)** — База знаний (P1–P18); ID: `kb-p11`
34. **P12 · Anatomical Cinematic (здоровье, тело)** — База знаний (P1–P18); ID: `kb-p12`
35. **P13 · Minimal Typography Finance** — База знаний (P1–P18); ID: `kb-p13`
36. **P14 · Epic 3D with 2D Textures (военная история и монологи полководцев)** — База знаний (P1–P18); ID: `kb-p14`
37. **P15 · Epoch Hyperreal (реконструкции эпох)** — База знаний (P1–P18); ID: `kb-p15`
38. **P16 · Anime Vintage 9:16 (shorts о самоулучшении)** — База знаний (P1–P18); ID: `kb-p16`
39. **P17 · Marker Hand-Drawn Brand (тёплые финансы для миллениалов)** — База знаний (P1–P18); ID: `kb-p17`
40. **P18 · Muted Flat Vector Isometric (история цивилизаций)** — База знаний (P1–P18); ID: `kb-p18`

# Golpo Canvas

## 1. Chalkboard · White on Black

Мел белым по чёрному: классика урока, математика, SAT/ЕГЭ, сторителлинг (как whiteboard-style-3).

**ID:** `canvas-chalk-wob`

**Основной промпт / anchor:**

```text
hand-drawn chalkboard lesson frame, pure matte black board background #0B0B0B with faint chalk-dust haze, crisp white chalk-marker line art with slightly rough chalk texture, thin uniform strokes, white hand-lettered print headings, simple iconic sketches and labeled diagrams, monochrome white on black only, generous negative space, components placed on an invisible grid, Khan-Academy-style teaching board, flat 2D
```

**Промпт движения / motion:**

```text
hand-drawn whiteboard reveal: strokes draw on in reading order (title first, then main diagram, then labels and arrows), each element locks in place once drawn, background stays perfectly static, locked-off camera or very slow 2-3% push-in, no morphing, no redrawing of finished elements, no text rewriting
```

**Ограничения / negative prompt:**

```text
photorealism, 3D render, gradients, glossy, lens flare, depth of field blur, cluttered layout, tiny unreadable text, gibberish letters, misspelled words, extra random text, watermark, logo, frame border, deformed hands, extra fingers, colour accents
```

**Раскрытие / reveal:** `pen`  
**Тип текста / text:** handwritten chalk print  
**Метка примера / src:** `wb3`

## 2. Chalkboard · Black on White

Чёрный «мел» по белому: строгие уроки, конспекты, печатные материалы.

**ID:** `canvas-chalk-bow`

**Основной промпт / anchor:**

```text
hand-drawn lesson board frame, clean off-white board background #FAFAF7, black chalk-like marker strokes with dry rough texture, thin uniform line weight, black hand-lettered print headings, simple iconic sketches and labeled diagrams, monochrome black on white only, generous negative space, components placed on an invisible grid, Khan-Academy-style teaching board, flat 2D
```

**Промпт движения / motion:**

```text
hand-drawn whiteboard reveal: strokes draw on in reading order (title first, then main diagram, then labels and arrows), each element locks in place once drawn, background stays perfectly static, locked-off camera or very slow 2-3% push-in, no morphing, no redrawing of finished elements, no text rewriting
```

**Ограничения / negative prompt:**

```text
photorealism, 3D render, gradients, glossy, lens flare, depth of field blur, cluttered layout, tiny unreadable text, gibberish letters, misspelled words, extra random text, watermark, logo, frame border, deformed hands, extra fingers, colour accents
```

**Раскрытие / reveal:** `pen`  
**Тип текста / text:** handwritten chalk print  
**Метка примера / src:** `guide`

## 3. Chalkboard · Color

Неоновые мелки на чёрном: техно, AI, комплаенс, сложные схемы (whiteboard-style-2, This_video_was_full_made_with_AI).

**ID:** `canvas-chalk-color`

**Основной промпт / anchor:**

```text
hand-drawn neon chalkboard frame, pure black background #050505, glowing chalk-marker strokes in cyan #2EE6E6, hot magenta #FF3D9A, lemon yellow #F2F23A, lime green #7CFF5B and white, rough chalk texture with dense diagonal hatching fills, handwritten marker print lettering, colour-coded meaning (cyan = concepts, magenta = problems, green = correct, yellow = key terms), simple iconic sketches and diagrams, generous negative space, flat 2D
```

**Промпт движения / motion:**

```text
hand-drawn whiteboard reveal: strokes draw on in reading order (title first, then main diagram, then labels and arrows), each element locks in place once drawn, background stays perfectly static, locked-off camera or very slow 2-3% push-in, no morphing, no redrawing of finished elements, no text rewriting
```

**Ограничения / negative prompt:**

```text
photorealism, 3D render, gradients, glossy, lens flare, depth of field blur, cluttered layout, tiny unreadable text, gibberish letters, misspelled words, extra random text, watermark, logo, frame border, deformed hands, extra fingers
```

**Раскрытие / reveal:** `marker`  
**Тип текста / text:** handwritten neon chalk print  
**Метка примера / src:** `wb2, full_ai`

## 4. Whiteboard

Чистая доска Khan Academy: синие заголовки, чёрные схемы, красные акценты, рука с ручкой (whiteboard-style-1, -6, AIME).

**ID:** `canvas-whiteboard`

**Основной промпт / anchor:**

```text
clean digital whiteboard lesson frame, light warm-gray board background #ECEAE6, thin black felt-tip line art with uniform 2px strokes, friendly rounded handwritten print headings in blue #2F6DB5, black body labels, sparse red #D93A3A accents for warnings and emphasis, simple labeled scientific diagrams, arrows, boxes and minimalist icons, lots of empty board space, Khan-Academy style, flat 2D
```

**Промпт движения / motion:**

```text
hand-drawn whiteboard reveal: strokes draw on in reading order (title first, then main diagram, then labels and arrows), each element locks in place once drawn, background stays perfectly static, locked-off camera or very slow 2-3% push-in, no morphing, no redrawing of finished elements, no text rewriting
```

**Ограничения / negative prompt:**

```text
photorealism, 3D render, gradients, glossy, lens flare, depth of field blur, cluttered layout, tiny unreadable text, gibberish letters, misspelled words, extra random text, watermark, logo, frame border, deformed hands, extra fingers
```

**Раскрытие / reveal:** `pen`  
**Тип текста / text:** handwritten print (Comic-Neue-like)  
**Метка примера / src:** `wb1, wb6, aime`

## 5. Modern Minimal

Современный минимализм: тонкие монолинейные иконки, геометричный шрифт, один акцент (whiteboard-style-4).

**ID:** `canvas-modern-minimal`

**Основной промпт / anchor:**

```text
modern minimal explainer frame, soft light-gray background #EDEDED, clean geometric rounded sans-serif typography, thin monoline vector icons with rounded caps and 2px stroke, near-black #1A1A1A line work, a single accent colour periwinkle violet #6C63D9 used sparingly for highlights and underlines, precise alignment, generous negative space, flat 2D, no texture
```

**Промпт движения / motion:**

```text
clean motion-design build: icons draw on with monoline stroke animation, labels type on, underline sweeps left to right, gentle ease-out pop-ins (scale 0.96 to 1.0), static background, locked camera, no morphing, no text rewriting
```

**Ограничения / negative prompt:**

```text
photorealism, 3D render, gradients, glossy, lens flare, depth of field blur, cluttered layout, tiny unreadable text, gibberish letters, misspelled words, extra random text, watermark, logo, frame border, deformed hands, extra fingers, hand-drawn wobble, paper texture
```

**Раскрытие / reveal:** `stylus`  
**Тип текста / text:** geometric sans  
**Метка примера / src:** `wb4`

## 6. Playful

Игривый: яркие цвета, округлые формы, милые персонажи — дети, соцсети, лёгкие темы.

**ID:** `canvas-playful`

**Основной промпт / anchor:**

```text
playful cartoon explainer frame, clean white background, bright cheerful palette (sunny yellow #FFC93C, coral #FF6B6B, sky blue #4D96FF, mint green #6BCB77), chunky rounded black outlines, bouncy rounded hand-lettering, cute simple characters with dot eyes and big smiles, doodle stars, sparkles and motion swooshes, flat 2D, high readability
```

**Промпт движения / motion:**

```text
bouncy cartoon build: elements pop in with soft overshoot, doodle sparkles twinkle, characters do one simple gesture (wave, nod, jump), squash-and-stretch kept subtle, locked camera, no morphing, no text rewriting
```

**Ограничения / negative prompt:**

```text
photorealism, 3D render, gradients, glossy, lens flare, depth of field blur, cluttered layout, tiny unreadable text, gibberish letters, misspelled words, extra random text, watermark, logo, frame border, deformed hands, extra fingers
```

**Раскрытие / reveal:** `marker`  
**Тип текста / text:** rounded bouncy hand-lettering  
**Метка примера / src:** `guide`

## 7. Technical

Технический: схемы, чертёж, выноски — инженерия, IT-архитектура, механизмы.

**ID:** `canvas-technical`

**Основной промпт / anchor:**

```text
technical engineering explainer frame, off-white engineering grid paper background #F7F7F2 with faint light-blue grid, precise schematic line drawings in dark navy #1B2A41 with thin consistent strokes, dimension lines, numbered callout leaders and labeled components, monospace-style labels, one accent orange #F28C28 for the active part or data flow, orthographic and isometric views, flat 2D, high legibility
```

**Промпт движения / motion:**

```text
schematic build: components draw on along their outlines, callout leaders extend, data-flow arrows animate along paths with dashed march, active part pulses once in orange, locked camera, no morphing, no text rewriting
```

**Ограничения / negative prompt:**

```text
photorealism, 3D render, gradients, glossy, lens flare, depth of field blur, cluttered layout, tiny unreadable text, gibberish letters, misspelled words, extra random text, watermark, logo, frame border, deformed hands, extra fingers, hand-drawn wobble
```

**Раскрытие / reveal:** `stylus`  
**Тип текста / text:** monospace / technical print  
**Метка примера / src:** `guide`

## 8. Editorial

Редакционный: серифные заголовки, тонкая тушь со штриховкой, приглушённая палитра — бизнес, документалки, история (в «Инструкции» выбран Editorial).

**ID:** `canvas-editorial`

**Основной промпт / anchor:**

```text
editorial magazine-style explainer frame, warm off-white paper background #F4F1EA with subtle paper grain, elegant high-contrast serif headlines, refined ink illustrations with fine cross-hatching, restrained muted palette (deep navy #1F3A5F, brick red #A63D2F, ochre #C99A2E), balanced asymmetric layout with generous margins, sophisticated documentary tone, flat 2D print aesthetic
```

**Промпт движения / motion:**

```text
editorial build: ink lines draw on with fine pen strokes, cross-hatching fills in, headline fades up with slight letter-spacing settle, slow 2-3% push-in, paper stays static, no morphing, no text rewriting
```

**Ограничения / negative prompt:**

```text
photorealism, 3D render, gradients, glossy, lens flare, depth of field blur, cluttered layout, tiny unreadable text, gibberish letters, misspelled words, extra random text, watermark, logo, frame border, deformed hands, extra fingers
```

**Раскрытие / reveal:** `pen`  
**Тип текста / text:** high-contrast serif  
**Метка примера / src:** `instrukcia`

## 9. Sharpie

Маркер Sharpie: толстые контуры, КАПС-заголовки, яркие заливки и подчёркивания — YouTube, реклама, мотивация (whiteboard-style-7, engaging-whiteboard-demo).

**ID:** `canvas-sharpie`

**Основной промпт / anchor:**

```text
bold Sharpie-marker sketch-note frame, clean white background #FFFFFF, thick black permanent-marker outlines with slight hand wobble, heavy hand-lettered ALL-CAPS headlines, bright marker fills with visible streaks (red #E63946, blue #1D70B8, yellow #FFD60A, teal #2EC4B6), highlighter underlines and swooshes, doodle arrows and burst marks, energetic sketch-note composition, flat 2D
```

**Промпт движения / motion:**

```text
hand-drawn whiteboard reveal: thick marker strokes draw on in reading order (title first, then main diagram, then labels and arrows), each element locks in place once drawn, background stays perfectly static, locked-off camera or very slow 2-3% push-in, no morphing, no redrawing of finished elements, no text rewriting
```

**Ограничения / negative prompt:**

```text
photorealism, 3D render, gradients, glossy, lens flare, depth of field blur, cluttered layout, tiny unreadable text, gibberish letters, misspelled words, extra random text, watermark, logo, frame border, deformed hands, extra fingers
```

**Раскрытие / reveal:** `marker`  
**Тип текста / text:** heavy ALL-CAPS marker lettering  
**Метка примера / src:** `wb7, engaging-demo, quantum`

## 10. Illustration

Иллюстрация: полноцветные рисунки тушью и цветным карандашом — истории, наука, культура (Antikythera).

**ID:** `canvas-illustration`

**Основной промпт / anchor:**

```text
richly detailed hand-drawn colour illustration, confident ink outlines with fine cross-hatching, colored-pencil and watercolor fills, warm vintage storybook palette (ochre, teal, brick red, olive), visible paper grain, vignette composition that dissolves into a clean white background with no hard frame, expressive characters, hand-lettered ALL-CAPS captions in two colours, flat 2D
```

**Промпт движения / motion:**

```text
vignette illustration reveal: black ink outline draws on stroke by stroke, then colour washes fill in region by region, subject locks once complete, subtle 1.03x push-in, gentle secondary motion only (hair, cloth, smoke, water), no morphing faces, no new objects appearing
```

**Ограничения / negative prompt:**

```text
photorealism, 3D CGI, plastic skin, glossy airbrush, hard rectangular frame, border, cluttered background, gibberish text, misspelled words, watermark, logo, extra limbs, deformed hands, extra fingers, melted faces
```

**Раскрытие / reveal:** `pen`  
**Тип текста / text:** hand-lettered caps  
**Метка примера / src:** `antikythera`

## 11. Notebook (Compact)

Тетрадь-инфографика: плотная страница конспекта (только Compact).

**ID:** `canvas-notebook`

**Основной промпт / anchor:**

```text
notebook infographic page, cream lined notebook paper with faint blue rules and a red margin line, compact multi-component layout (title, 3-5 labeled mini-diagrams, bullet notes, small icons) arranged like neat study notes, ballpoint-blue and black ink handwriting, yellow highlighter emphasis, small sticky-note callouts, top-down flat 2D view
```

**Промпт движения / motion:**

```text
study-notes build: handwriting writes on line by line, mini-diagrams sketch in, highlighter swipes across key words, sticky note drops in with tiny shadow, locked top-down camera, no morphing, no text rewriting
```

**Ограничения / negative prompt:**

```text
photorealism, 3D render, gradients, glossy, lens flare, depth of field blur, cluttered layout, tiny unreadable text, gibberish letters, misspelled words, extra random text, watermark, logo, frame border, deformed hands, extra fingers
```

**Раскрытие / reveal:** `pen`  
**Тип текста / text:** neat ballpoint handwriting  
**Метка примера / src:** `guide`


# Golpo Sketch

## 12. Sketch · Classic

Классический скетч ч/б: тушь + карандашная штриховка, VideoScribe-эффект.

**ID:** `sketch-classic`

**Основной промпт / anchor:**

```text
classic whiteboard-animation sketch, clean white background, confident black ink pen outlines, light gray pencil shading and hatching, simple iconic subjects, black and white only, centered subject vignette fading to white, VideoScribe-style hand-drawn look, flat 2D
```

**Промпт движения / motion:**

```text
vignette illustration reveal: black ink outline draws on stroke by stroke, then gray pencil shading fills in, subject locks once complete, subtle 1.03x push-in, gentle secondary motion only (hair, cloth, smoke, water), no morphing faces, no new objects appearing
```

**Ограничения / negative prompt:**

```text
photorealism, 3D CGI, plastic skin, glossy airbrush, hard rectangular frame, border, cluttered background, gibberish text, misspelled words, watermark, logo, extra limbs, deformed hands, extra fingers, melted faces, colour
```

**Раскрытие / reveal:** `pen`  
**Тип текста / text:** hand-lettered print  
**Метка примера / src:** `whiteboard-maker`

## 13. Sketch · Improved (Beta)

Улучшенный: насыщенная тушь + акварель, рваные края виньеток — история, войны, эпосы (Рим, whiteboard-style-5).

**ID:** `sketch-improved`

**Основной промпт / anchor:**

```text
high-detail hand-drawn history illustration, expressive black ink linework with cross-hatching, rich watercolor and colored-pencil fills (crimson, ochre, steel gray, sky blue), vintage history-book feel, dense vignette composition with organic irregular edges that dissolve into a pure white background, dynamic characters with clear silhouettes, hand-lettered banner captions, dramatic but readable, flat 2D
```

**Промпт движения / motion:**

```text
vignette illustration reveal: black ink outline draws on stroke by stroke, then colour washes fill in region by region, subject locks once complete, subtle 1.03x push-in, gentle secondary motion only (hair, cloth, smoke, water), no morphing faces, no new objects appearing
```

**Ограничения / negative prompt:**

```text
photorealism, 3D CGI, plastic skin, glossy airbrush, hard rectangular frame, border, cluttered background, gibberish text, misspelled words, watermark, logo, extra limbs, deformed hands, extra fingers, melted faces
```

**Раскрытие / reveal:** `pen`  
**Тип текста / text:** hand-lettered banners  
**Метка примера / src:** `wb5 (Rome)`

## 14. Sketch · Dry Erase

Маркер для доски: синие/чёрные/красные маркеры, рукописный текст, подчёркивания (Dry_Erase LLM).

**ID:** `sketch-dry-erase`

**Основной промпт / anchor:**

```text
dry-erase marker drawing on a glossy whiteboard, light gray-white surface #EFEFEC with faint ghosting of erased marks, marker strokes in blue #1F4FBF, black and red #D62828, neat handwritten print lettering with blue key words and wavy underlines, simple stick figures, speech bubbles, boxes and arrows, flat 2D
```

**Промпт движения / motion:**

```text
hand-drawn whiteboard reveal: dry-erase marker strokes draw on in reading order (title first, then main diagram, then labels and arrows), each element locks in place once drawn, background stays perfectly static, locked-off camera or very slow 2-3% push-in, no morphing, no redrawing of finished elements, no text rewriting
```

**Ограничения / negative prompt:**

```text
photorealism, 3D render, gradients, glossy, lens flare, depth of field blur, cluttered layout, tiny unreadable text, gibberish letters, misspelled words, extra random text, watermark, logo, frame border, deformed hands, extra fingers
```

**Раскрытие / reveal:** `marker`  
**Тип текста / text:** handwritten print  
**Метка примера / src:** `dry_erase_llm`

## 15. Sketch · Professional Clean

Профессиональный чистый: детальный графит, серо-тёплая бумага, один красный акцент — корпоративное обучение (Enterprise training).

**ID:** `sketch-professional-clean`

**Основной промпт / anchor:**

```text
professional clean graphite illustration, light warm-gray paper background #ECEBE8, detailed pencil drawings with soft tonal shading and fine hatching, crisp handwritten sans-serif labels, a single accent red #D7263D for key words, arrows and check marks, corporate yet human, ample empty space, flat 2D
```

**Промпт движения / motion:**

```text
vignette illustration reveal: black ink outline draws on stroke by stroke, then graphite shading fills in and red accents appear last, subject locks once complete, subtle 1.03x push-in, gentle secondary motion only (hair, cloth, smoke, water), no morphing faces, no new objects appearing
```

**Ограничения / negative prompt:**

```text
photorealism, 3D CGI, plastic skin, glossy airbrush, hard rectangular frame, border, cluttered background, gibberish text, misspelled words, watermark, logo, extra limbs, deformed hands, extra fingers, melted faces, saturated colours
```

**Раскрытие / reveal:** `pen`  
**Тип текста / text:** handwritten sans  
**Метка примера / src:** `enterprise-training`

## 16. Sketch · Crayon

Восковые мелки: детский рисунок — K-12, сказки, семейные темы.

**ID:** `sketch-crayon`

**Основной промпт / anchor:**

```text
children's crayon drawing, waxy crayon texture with visible paper tooth, bright primary colours, wobbly outlines, scribbled fills that slightly overshoot the lines, naive charming shapes and characters, white paper background, flat 2D
```

**Промпт движения / motion:**

```text
crayon scribble reveal: outlines scribble on, colour scribbles fill in, characters do one tiny wiggle, locked camera, no morphing
```

**Ограничения / negative prompt:**

```text
photorealism, 3D CGI, plastic skin, glossy airbrush, hard rectangular frame, border, cluttered background, gibberish text, misspelled words, watermark, logo, extra limbs, deformed hands, extra fingers, melted faces, clean vector
```

**Раскрытие / reveal:** `marker`  
**Тип текста / text:** crayon handwriting  
**Метка примера / src:** `guide`

## 17. Sketch · Formal

Формальный: сдержанная сине-серая палитра, деловые люди — финансы, право, госсектор.

**ID:** `sketch-formal`

**Основной промпт / anchor:**

```text
formal corporate sketch illustration, restrained palette of navy #22324A, slate gray and white with one muted teal accent, neat ink line drawings with minimal shading, serious professional people, documents and buildings, clean white background, generous negative space, flat 2D
```

**Промпт движения / motion:**

```text
vignette illustration reveal: black ink outline draws on stroke by stroke, then colour washes fill in region by region, subject locks once complete, subtle 1.03x push-in, gentle secondary motion only (hair, cloth, smoke, water), no morphing faces, no new objects appearing
```

**Ограничения / negative prompt:**

```text
photorealism, 3D CGI, plastic skin, glossy airbrush, hard rectangular frame, border, cluttered background, gibberish text, misspelled words, watermark, logo, extra limbs, deformed hands, extra fingers, melted faces, cartoon exaggeration
```

**Раскрытие / reveal:** `pen`  
**Тип текста / text:** clean serif or sans  
**Метка примера / src:** `guide`

## 18. Sketch · Infographics

Инфографика: графики, иконки, шаги, крупные цифры — отчёты, финансы, медицина.

**ID:** `sketch-infographics`

**Основной промпт / anchor:**

```text
hand-drawn infographic frame, labeled charts (bar, pie, line) drawn with marker, icon set, numbered steps, flow arrows, data callouts with one large hero number, clean white background, marker colours teal #2A9D8F, orange #F4A261 and navy #264653, organized grid layout, flat 2D
```

**Промпт движения / motion:**

```text
infographic build: chart axes draw on, bars grow from baseline to exact values, pie slices sweep clockwise, hero number counts up, icons pop in, locked camera, no morphing, no number changes after reveal
```

**Ограничения / negative prompt:**

```text
photorealism, 3D render, gradients, glossy, lens flare, depth of field blur, cluttered layout, tiny unreadable text, gibberish letters, misspelled words, extra random text, watermark, logo, frame border, deformed hands, extra fingers
```

**Раскрытие / reveal:** `marker`  
**Тип текста / text:** marker print + big numbers  
**Метка примера / src:** `guide`


# Из ваших видео

## 19. Storybook Colored Pencil

Цветной карандаш-сторибук с подписями КАПСОМ (videoplayback — выживание в холоде, формат Sketchocalypse).

**ID:** `obs-storybook-pencil`

**Основной промпт / anchor:**

```text
colored-pencil storybook illustration, warm muted palette (rust orange, teal, mustard, brick red, denim blue), visible pencil strokes and paper grain, hand-lettered ALL-CAPS captions in two colours, single character or object vignette on a clean white background, gentle humour, flat 2D
```

**Промпт движения / motion:**

```text
vignette illustration reveal: black ink outline draws on stroke by stroke, then colour washes fill in region by region, subject locks once complete, subtle 1.03x push-in, gentle secondary motion only (hair, cloth, smoke, water), no morphing faces, no new objects appearing
```

**Ограничения / negative prompt:**

```text
photorealism, 3D CGI, plastic skin, glossy airbrush, hard rectangular frame, border, cluttered background, gibberish text, misspelled words, watermark, logo, extra limbs, deformed hands, extra fingers, melted faces
```

**Раскрытие / reveal:** `pen`  
**Тип текста / text:** hand-lettered caps  
**Метка примера / src:** `videoplayback`

## 20. Comic Marker Explainer

Комикс-маркер: жирные контуры, речевые пузыри, красные/синие ключевые слова (бег и гликоген).

**ID:** `obs-comic-marker`

**Основной промпт / anchor:**

```text
bold comic-marker explainer illustration, thick black ink outlines, saturated marker fills, ALL-CAPS hand-lettered captions with key words in red and blue, speech-bubble and thought-bubble callouts, big expressive cartoon characters, motion lines and impact bursts, clean white background, flat 2D
```

**Промпт движения / motion:**

```text
vignette illustration reveal: black ink outline draws on stroke by stroke, then colour washes fill in region by region, subject locks once complete, subtle 1.03x push-in, gentle secondary motion only (hair, cloth, smoke, water), no morphing faces, no new objects appearing
```

**Ограничения / negative prompt:**

```text
photorealism, 3D CGI, plastic skin, glossy airbrush, hard rectangular frame, border, cluttered background, gibberish text, misspelled words, watermark, logo, extra limbs, deformed hands, extra fingers, melted faces
```

**Раскрытие / reveal:** `marker`  
**Тип текста / text:** comic ALL-CAPS  
**Метка примера / src:** `ud4cad9a (running)`

## 21. Painterly Parchment Epic (Custom)

Кастомный стиль: пергамент, гуашь, ар-нуво-завитки, бронза/бирюза (Odyssey).

**ID:** `obs-parchment-epic`

**Основной промпт / anchor:**

```text
painterly parchment epic illustration, aged cream parchment backdrop with soft vignette and atmospheric teal and amber haze, ornate ink-and-gouache figures with Art-Nouveau swirling linework, bronze, teal and rust palette, classical engraved serif titles, cinematic mythological mood, 2D painterly
```

**Промпт движения / motion:**

```text
painterly reveal: ink contours draw on, gouache colour blooms outward, haze drifts slowly, subtle 1.03x push-in, no morphing faces, no new objects
```

**Ограничения / negative prompt:**

```text
photorealism, 3D CGI, plastic skin, glossy airbrush, hard rectangular frame, border, cluttered background, gibberish text, misspelled words, watermark, logo, extra limbs, deformed hands, extra fingers, melted faces
```

**Раскрытие / reveal:** `pen`  
**Тип текста / text:** engraved serif  
**Метка примера / src:** `7744cc6 (Odyssey)`

## 22. Dark Glow Motion Graphics

Тёмный неоновый моушн с маскотом-роботом (Инструкция / Monetized) — для HyperFrames, а не для I2V.

**ID:** `obs-ai-motion-dark`

**Основной промпт / anchor:**

```text
dark cinematic motion-graphics frame, deep navy-to-black gradient background #0A0F2C, soft volumetric blue-violet glow, glossy rounded UI cards, a small cute round robot mascot with glowing white eyes, neon purple #7B5CFF and electric blue #3D7BFF accents, clean bold sans-serif headline, centered composition, shallow depth haze
```

**Промпт движения / motion:**

```text
UI motion: cards slide in with spring ease, glow pulses, mascot blinks and tilts head, light sweep across headline, slow parallax push, no morphing, no text rewriting
```

**Ограничения / negative prompt:**

```text
hand-drawn texture, paper, cluttered UI, gibberish text, watermark, logo, extra limbs
```

**Раскрытие / reveal:** `none`  
**Тип текста / text:** bold sans  
**Метка примера / src:** `instrukcia, monetized`


# База знаний (P1–P18)

## 23. P1 · Editorial Paper-Cut

Для эксплейнеров, систем, таймлайнов, карт, документов, сравнений. Микс: ~80% paper-cut + ~20% сток там, где нужна реальная среда или движение.

**ID:** `kb-p1`

**Основной промпт / anchor:**

```text
editorial paper-cut documentary collage, warm off-white cream paper background, subtle paper grain and print texture, restrained halftone and stamp patterns, archival photos treated as cut-paper elements, layered cut paper with soft paper shadows and visible depth, slight handmade imperfections, cream black and white base with 2-4 muted accent colors, bold sans-serif or elegant serif editorial typography, one dominant hero subject, 2-5 supporting elements, strong negative space, 16:9
```

**Промпт движения / motion:**

```text
restrained paper slides, drops, mask reveals, gentle scale-ins, paper unfolds, route draws, chart reveals, pin-in-place; logical layer-by-layer assembly; elements lock once placed; static camera; no morphing, no text rewriting
```

**Ограничения / negative prompt:**

```text
glossy CGI, dramatic DOF, lens effects, photoreal 3D, random icons, clutter, fake evidence, unreadable text blocks, anime, oversaturation, invented logos.
```

**Раскрытие / reveal:** `none`  
**Тип текста / text:** no text by default  
**Метка примера / src:** `KB`

## 24. P2 · Bean Meme Vector (стиль быстрых 2D-исторических каналов)

Bean Meme Vector (стиль быстрых 2D-исторических каналов)

**ID:** `kb-p2`

**Основной промпт / anchor:**

```text
clean 2D vector illustration, minimalist bean/blob characters with small rounded proportions, flat white bodies, thick clean black outlines, simple dot eyes, comedic meme-style expressions, vibrant high-contrast colors, detailed cinematic background environment with historical props and architecture, 16:9
```

**Промпт движения / motion:**

```text
fast zoom-in, screen shake, pan, sudden pop-in, snappy character gesture; lip-sync line in quotes if speaking
```

**Ограничения / negative prompt:**

```text
watermark, logo, gibberish text, deformed hands, extra fingers, morphing faces
```

**Раскрытие / reveal:** `none`  
**Тип текста / text:** no text by default  
**Метка примера / src:** `KB`

## 25. P3 · Webcomic Ink (научно-эволюционные эксплейнеры)

Webcomic Ink (научно-эволюционные эксплейнеры)

**ID:** `kb-p3`

**Основной промпт / anchor:**

```text
2D hand-drawn digital illustration style, clean bold black ink linework (3-5px weighted stroke), muted flat earthy color palette, subtle cel shading, webcomic editorial art, simple expressive black-line stickmen with large round bald heads or chibi historical humans and animals with exaggerated expressions, minimalist solid off-white or slate-gray background for diagram scenes, stylized hand-drawn panoramas for narrative scenes, high contrast, clean minimalist composition, no realistic textures, no 3D rendering --ar 16:9
```

**Промпт движения / motion:**

```text
2.5D cut-out puppet animation, slow digital push-in or smooth horizontal tracking, 2D position sliding, subtle breathing idle loop, blink cycle, simple rotational gestures, floating connection lines drift, smooth 2D motion, no morphing, no camera shake
```

**Ограничения / negative prompt:**

```text
watermark, logo, gibberish text, deformed hands, extra fingers, morphing faces
```

**Раскрытие / reveal:** `none`  
**Тип текста / text:** no text by default  
**Метка примера / src:** `KB`

## 26. P4 · Vector Noir Finance (cel shading + дрожь стоп-моушена)

Vector Noir Finance (cel shading + дрожь стоп-моушена)

**ID:** `kb-p4`

**Основной промпт / anchor:**

```text
2D vector cartoon illustration, flat explainer aesthetic, minimalist geometric characters: round heads, dot eyes, no noses, line mouths, thick black line stick-limbs, solid flat-colored clothing, thick uniform black outlines, hard-edged dramatic cel shading with heavy angular cast shadows across faces objects and floors, muted desaturated moody palette: earthy tones, olive greens, slate grays, sepia browns, dull slate blues, simplified perspective backgrounds with clean vector geometry, flat matte fills, no soft gradients, digital vector art
```

**Промпт движения / motion:**

```text
stop-motion animation style, 12fps frame rate, snappy jerky movements, subtle paper texture jitter, flat vector animation motion
```

**Ограничения / negative prompt:**

```text
watermark, logo, gibberish text, deformed hands, extra fingers, morphing faces
```

**Раскрытие / reveal:** `none`  
**Тип текста / text:** no text by default  
**Метка примера / src:** `KB`

## 27. P5 · Hand-Inked Noir Finance (смысловая цветовая кодировка)

Hand-Inked Noir Finance (смысловая цветовая кодировка)

**ID:** `kb-p5`

**Основной промпт / anchor:**

```text
full bleed 16:9 edge-to-edge frame, hand-drawn traditional 2D animation style, classic cel animation, bold clean inked outlines, subtle paper texture, dark charcoal background #121212 with high-contrast accents: emerald green for profit/revenue, crimson red for debt/costs, warm amber-gold for luxury/whales, flat color shading, cinematic 2D cartoon composition --style raw --no borders, frames, white margins, polaroid frame, film border, letterbox, panel outline
```

**Промпт движения / motion:**

```text
slow subtle push-in, gentle secondary motion, stable composition, no morphing
```

**Ограничения / negative prompt:**

```text
watermark, logo, gibberish text, deformed hands, extra fingers, morphing faces
```

**Раскрытие / reveal:** `none`  
**Тип текста / text:** no text by default  
**Метка примера / src:** `KB`

## 28. P6 · Faceless Photoreal 3D (историческая криминальная реконструкция)

Faceless Photoreal 3D (историческая криминальная реконструкция)

**ID:** `kb-p6`

**Основной промпт / anchor:**

```text
photorealistic humans with smooth, completely featureless faces — no eyes, no eyebrows, no visible nose structure, no mouth, seamless facial skin — realistic ears, hair, hands, anatomically correct bodies, natural skin texture, historically accurate garments with realistic folds, stitching, dirt and weathering; not mannequins, not plastic, not statues, not masks, not wax figures
```

**Промпт движения / motion:**

```text
slow subtle push-in, gentle secondary motion, stable composition, no morphing
```

**Ограничения / negative prompt:**

```text
watermark, logo, gibberish text, deformed hands, extra fingers, morphing faces
```

**Раскрытие / reveal:** `none`  
**Тип текста / text:** no text by default  
**Метка примера / src:** `KB`

## 29. P7 · Cinematic Archaeology (тёмная глубокая история)

Cinematic Archaeology (тёмная глубокая история)

**ID:** `kb-p7`

**Основной промпт / anchor:**

```text
cinematic 35mm still photograph, hyper-realistic, natural textures, volumetric lighting, subtle film grain, muted historical documentary color grade, highly detailed, photorealistic --ar 16:9
```

**Промпт движения / motion:**

```text
slow forward dolly / creeping Dutch tilt / microscopic pan / rising pedestal, drifting dust motes, flickering torch shadows, water droplet falling, subtle focal rack, smooth documentary pacing, stable, photoreal
```

**Ограничения / negative prompt:**

```text
watermark, logo, gibberish text, deformed hands, extra fingers, morphing faces
```

**Раскрытие / reveal:** `none`  
**Тип текста / text:** no text by default  
**Метка примера / src:** `KB`

## 30. P8 · Sacred Chiaroscuro (сакральные тексты и манускрипты)

Sacred Chiaroscuro (сакральные тексты и манускрипты)

**ID:** `kb-p8`

**Основной промпт / anchor:**

```text
photorealistic cinematic oil painting meets dark documentary photography, heavy chiaroscuro, volumetric light shafts through fog or stone windows, glowing gold leaf on dark surfaces, glowing manuscripts, ancient stone architecture, hyper-detailed weathered parchment, carved stone, worn leather, ancient fabric, palette: warm gold highlights, deep obsidian shadows, muted parchment browns, dark crimson accents --ar 16:9
```

**Промпт движения / motion:**

```text
cinematic slow-motion, slow push-in, subtle tilt, floating dust particles, atmospheric smoke
```

**Ограничения / negative prompt:**

```text
watermark, logo, gibberish text, deformed hands, extra fingers, morphing faces
```

**Раскрытие / reveal:** `none`  
**Тип текста / text:** no text by default  
**Метка примера / src:** `KB`

## 31. P9 · Archival Photoreal (якорь эпохи)

Archival Photoreal (якорь эпохи)

**ID:** `kb-p9`

**Основной промпт / anchor:**

```text
pure cinematic realism, 35mm film stock, Arri/Leica cinema glass look, tactile textures, skin pores, atmospheric dust, volumetric natural light, authentic period costumes, unglamorous historical grime --ar 16:9 --style raw
```

**Промпт движения / motion:**

```text
[camera move & speed], [micro subject action], [atmospheric drift], [particle physics], hyper-realistic slow-motion archival documentary footage, smooth 24fps
```

**Ограничения / negative prompt:**

```text
painterly, cartoon/CGI, fantasy glow, airbrushing, oversaturated filters.
```

**Раскрытие / reveal:** `none`  
**Тип текста / text:** no text by default  
**Метка примера / src:** `KB`

## 32. P10 · Faceted Docu — система из 4 стилей (премиальная бизнес- и тех-документалка)

Держи один стиль 15–30 с подряд, меняй на тематических швах. Сцена-блок 6–12 с (15–30 слов).

**ID:** `kb-p10`

**Основной промпт / anchor:**

```text
geometric faceted 3D characters and environments with realistic physical materials (matte stone, brushed steel, wet asphalt reflections), moody industrial chiaroscuro, cold slate/charcoal tones vs glowing tungsten-amber windows, volumetric fog, rain puddle reflections, steam, shallow DOF
```

**Промпт движения / motion:**

```text
slow subtle push-in, gentle secondary motion, stable composition, no morphing
```

**Ограничения / negative prompt:**

```text
watermark, logo, gibberish text, deformed hands, extra fingers, morphing faces
```

**Раскрытие / reveal:** `none`  
**Тип текста / text:** no text by default  
**Метка примера / src:** `KB`

## 33. P11 · Whiteboard Stick-Figure (психология)

Whiteboard Stick-Figure (психология)

**ID:** `kb-p11`

**Основной промпт / anchor:**

```text
minimalist 2D whiteboard explainer illustration, warm cream paper background #F5EFE3, clean slightly hand-drawn black ink line art, uniform medium line weight, flat shading, no gradients, no 3D, no photorealism, only 1-2 muted accents: soft red = pain/stress, soft blue = calm/thinking, warm yellow-gold glow = insight/healing, lots of empty space, one clear focal point, 16:9, no text
```

**Промпт движения / motion:**

```text
slow subtle push-in, gentle secondary motion, stable composition, no morphing
```

**Ограничения / negative prompt:**

```text
watermark, logo, gibberish text, deformed hands, extra fingers, morphing faces
```

**Раскрытие / reveal:** `none`  
**Тип текста / text:** no text by default  
**Метка примера / src:** `KB`

## 34. P12 · Anatomical Cinematic (здоровье, тело)

Anatomical Cinematic (здоровье, тело)

**ID:** `kb-p12`

**Основной промпт / anchor:**

```text
cinematic stylized 3D anatomical visualization, translucent organs and cells with soft subsurface glow, clean dark-teal studio void background, hormone molecules as glowing particles, clinical yet poetic lighting, macro depth of field, elegant infographic callout lines without text, 16:9
```

**Промпт движения / motion:**

```text
slow subtle push-in, gentle secondary motion, stable composition, no morphing
```

**Ограничения / negative prompt:**

```text
gore, surgical realism, medical-advertising cheese.
```

**Раскрытие / reveal:** `none`  
**Тип текста / text:** no text by default  
**Метка примера / src:** `KB`

## 35. P13 · Minimal Typography Finance

Чистые чёрные или тёмные фоны, сильная белая типографика, изолированные физические объекты (одна банковская карта, ключ, простой график), глубокие тени, гладкий сток (офис, город, руки, ноутбук). Без 

**ID:** `kb-p13`

**Основной промпт / anchor:**

```text
minimalist premium still life, single isolated physical object on deep matte black surface, hard soft-box key light, deep shadows, generous negative space, high contrast, editorial finance aesthetic, 16:9
```

**Промпт движения / motion:**

```text
slow subtle push-in, gentle secondary motion, stable composition, no morphing
```

**Ограничения / negative prompt:**

```text
watermark, logo, gibberish text, deformed hands, extra fingers, morphing faces
```

**Раскрытие / reveal:** `none`  
**Тип текста / text:** no text by default  
**Метка примера / src:** `KB`

## 36. P14 · Epic 3D with 2D Textures (военная история и монологи полководцев)

Epic 3D with 2D Textures (военная история и монологи полководцев)

**ID:** `kb-p14`

**Основной промпт / anchor:**

```text
cinematic 3D reconstruction with hand-painted 2D textures, aged PBR materials, micro-displacement, oxidized metal patina, coarse woven wool, dust and sweat, Rembrandt key light, low-sun raking light, razor rim light, suspended volumetric dust, heat shimmer, ochre and bronze desaturated earth grade with one faction accent color (e.g. Tyrian purple), 85mm anamorphic f/1.8, AAA cinematic cutscene look, 16:9
```

**Промпт движения / motion:**

```text
slow anamorphic dolly push-in or subtle upward tilt, 24fps with natural handheld drift, wind catching heavy cloak and hair, dust crossing camera axis, controlled authoritative oratory, physical weight shifts, no facial melting
```

**Ограничения / negative prompt:**

```text
watermark, logo, gibberish text, deformed hands, extra fingers, morphing faces
```

**Раскрытие / reveal:** `none`  
**Тип текста / text:** no text by default  
**Метка примера / src:** `KB`

## 37. P15 · Epoch Hyperreal (реконструкции эпох)

Epoch Hyperreal (реконструкции эпох)

**ID:** `kb-p15`

**Основной промпт / anchor:**

```text
cinematic AI hyperrealism like an expensive historical blockbuster, volumetric lighting, god rays, chiaroscuro, dense immersive atmosphere with dust, smoke, fog, sparks or rain, gritty hyper-detailed textures (fabric weave, skin pores, old stone), low-angle and wide-angle cinematic framing, depth of field --ar 16:9 --style raw --stylize 250
```

**Промпт движения / motion:**

```text
slow subtle push-in, gentle secondary motion, stable composition, no morphing
```

**Ограничения / negative prompt:**

```text
watermark, logo, gibberish text, deformed hands, extra fingers, morphing faces
```

**Раскрытие / reveal:** `none`  
**Тип текста / text:** no text by default  
**Метка примера / src:** `KB`

## 38. P16 · Anime Vintage 9:16 (shorts о самоулучшении)

Anime Vintage 9:16 (shorts о самоулучшении)

**ID:** `kb-p16`

**Основной промпт / anchor:**

```text
anime-influenced stylized realism, large expressive eyes, simplified noses, clean soft line art, painterly digital illustration with visible soft brushstrokes, graphic-novel color blocks, desaturated vintage grade (70-80% saturation), faded film tones, 15-25% film grain, soft diffuse light, soft blue-grey shadows never pure black, rule of thirds, 1080x1920 vertical, no text
```

**Промпт движения / motion:**

```text
slow subtle push-in, gentle secondary motion, stable composition, no morphing
```

**Ограничения / negative prompt:**

```text
watermark, logo, gibberish text, deformed hands, extra fingers, morphing faces
```

**Раскрытие / reveal:** `none`  
**Тип текста / text:** no text by default  
**Метка примера / src:** `KB`

## 39. P17 · Marker Hand-Drawn Brand (тёплые финансы для миллениалов)

Marker Hand-Drawn Brand (тёплые финансы для миллениалов)

**ID:** `kb-p17`

**Основной промпт / anchor:**

```text
2D traditional hand-drawn cartoon, organic marker line-wobble, intentional human imperfections, variable-weight ink-black #111111 outlines with slightly unjoined corners, flat slightly uneven marker/gouache fills, stippled dot shading or parallel hatch lines, no airbrushing, no gradients, no 3D, white #FFFFFF or light sketchbook cream canvas, palette: warm ochre yellow, deep terracotta, soft denim blue, organic sage green, no text in scene
```

**Промпт движения / motion:**

```text
slow subtle push-in, gentle secondary motion, stable composition, no morphing
```

**Ограничения / negative prompt:**

```text
watermark, logo, gibberish text, deformed hands, extra fingers, morphing faces
```

**Раскрытие / reveal:** `none`  
**Тип текста / text:** no text by default  
**Метка примера / src:** `KB`

## 40. P18 · Muted Flat Vector Isometric (история цивилизаций)

Muted Flat Vector Isometric (история цивилизаций)

**ID:** `kb-p18`

**Основной промпт / anchor:**

```text
2D flat vector digital illustration, bold clean uniform black outlines, stylized simplified characters with round heads, dot eyes, curved mouth, stick-adjacent limbs with rounded hands, flat cel shading with one darker hard-edge tone, layered flat color-block backgrounds, 2.5D axonometric/isometric perspective for cities, no film grain, no paper texture, no lens flares, no vignettes, no text, 16:9
```

**Промпт движения / motion:**

```text
slow subtle push-in, gentle secondary motion, stable composition, no morphing
```

**Ограничения / negative prompt:**

```text
watermark, logo, gibberish text, deformed hands, extra fingers, morphing faces
```

**Раскрытие / reveal:** `none`  
**Тип текста / text:** no text by default  
**Метка примера / src:** `KB`
