/** Generate the current Markdown manual from the exact in-app help source. No network/AI. */
import fs from 'node:fs';
import { HELP } from '../apps/web/src/lib/help.ts';
import { NAV } from '../apps/web/src/lib/nav.tsx';
const version=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url),'utf8')).version;
const chapters=HELP.flatMap(g=>g.sections).length;
const chapterWord=chapters%100>=11 && chapters%100<=14 ? "глав" : chapters%10===1 ? "глава" : chapters%10>=2 && chapters%10<=4 ? "главы" : "глав";
const label=(route:string)=>{for(const g of NAV){const i=g.items.find(x=>x.to===route);if(i)return `${g.title} → ${i.label}`;}return route;};
let out=`# TubeStudio — подробная документация\n\nВерсия ${version}. Руководство для работы на компьютере.\n\n${chapters} ${chapterWord}: объяснения простыми словами, шаги, поля, учебные примеры, ограничения и расходы.\n\nВсе примеры учебные, а не результаты реальных Google/AI-запросов. Оценки модели не являются гарантией качества, оригинальности или просмотров.\n\n**Где обычный сценарист:** Сценарий и идеи → Сценарист. Если включена ДНК, нажмите «Отключить для этого черновика». Отдельного пункта «Старый сценарист» нет. Проверьте поля после переключения.\n\n**Где встроенная справка:** Система → Справка. Поиск работает по тексту руководства, без запуска генераций.\n\n## Содержание\n\n`;
for(const g of HELP){out+=`### ${g.title}\n\n`;for(const s of g.sections) out+=`- [${s.title}](#${s.id})\n`;out+='\n';}
let n=0;
for(const g of HELP){out+=`\n# ${g.title}\n\n`;for(const s of g.sections){out+=`<a id="${s.id}"></a>\n\n## ${++n}. ${s.title}\n\n`;if(s.route)out+=`**Где открыть:** ${label(s.route)}. Вложенную вкладку выберите по шагам ниже.\n\n`;out+=`### Простыми словами\n\n${s.what}\n\n`;if(s.analogy)out+=`**Это как:** ${s.analogy}\n\n`;if(s.when?.length)out+=`### Когда пригодится\n\n${s.when.map(x=>'- '+x).join('\n')}\n\n`;if(s.steps?.length)out+=`### По шагам\n\n${s.steps.map((x,i)=>`${i+1}. ${x}`).join('\n')}\n\n`;for(const [title,rows] of [['Поля и настройки',s.fields],['Как читать результат',s.results],['Если не получается',s.problems]] as const){if(rows?.length)out+=`### ${title}\n\n${rows.map(([k,v])=>`- **${k}:** ${v}`).join('\n')}\n\n`;}
if(s.example)out+=`### Учебный пример\n\n**Ввод или ситуация:** ${s.example.input}\n\n**Как понимать результат:** ${s.example.output}\n\n`;
if(s.codeExample)out+=`### ${s.codeExample.title}\n\n\`\`\`${s.codeExample.language}\n${s.codeExample.code}\n\`\`\`\n\n`;
if(s.tips?.length)out+=`### Важные ограничения и советы\n\n${s.tips.map(x=>'- '+x).join('\n')}\n\n`;
if(s.details?.length)out+=`### Точная методика — необязательное углубление\n\n${s.details.join('\n\n')}\n\n`;
if(s.cost)out+=`### Что расходуется\n\n${s.cost}\n\n`;}}
out+=`\n# Контроль перед настоящим выпуском\n\n1. Проверены источники, права и отличие от референсов.\n2. Герой действует, сталкивается с последствиями и реагирует.\n3. ДНК не подменена общим шаблоном.\n4. Озвучка проверена на слух; картинки и движения проверены в коротком фрагменте.\n5. Заголовок и обложка не обещают того, чего нет в ролике.\n6. Полное видео просмотрено человеком до публикации.\n7. Данные и секретные настройки сохранены приватно.\n\nАвтоматические локальные тесты не заменяют живую приёмку на вашем компьютере с вашими Google-подключениями и моделями.\n`;
const path=process.argv[2]??'DOCUMENTATION-RU.md';fs.writeFileSync(path,out);console.log(JSON.stringify({path,chapters:n,characters:out.length}));
