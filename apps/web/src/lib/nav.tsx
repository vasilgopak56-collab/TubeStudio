import {
  Palette, Plug, Calculator, LayoutDashboard, BarChart3, Lightbulb, Bookmark, PenLine, Mic, Search, Image, Clapperboard,
  ScanText, AudioLines, Gauge, Sparkles, FolderKanban, Settings as SettingsIcon, LifeBuoy, CalendarDays, Fingerprint, FileCode2, Wallet, Telescope, KeySquare, Users, MessageSquareText, ClipboardCheck, Puzzle, Workflow, Film, Activity, Flame, Radar, type LucideIcon,
} from "lucide-react";

export type NavItem = { to: string; label: string; icon: LucideIcon; description: string; stage: number };
/** more — группа из прежних разделов: показывается под кнопкой «Ещё». */
export type NavGroup = { title: string; items: NavItem[]; collapsible?: string; more?: boolean };

const ORIGINAL_NAV: NavGroup[] = [
  {
    title: "Рабочее пространство",
    items: [
      { to: "/profit", label: "Калькулятор прибыли", icon: Calculator, description: "Сценарная выручка по RPM минус указанные расходы, не реальные выплаты", stage: 12 },
      { to: "/daily-ideas", label: "Daily Ideas", icon: Lightbulb, description: "Пять идей из выбранного сохранённого источника, только по кнопке AI", stage: 3 },
      { to: "/coach", label: "AI Coach", icon: MessageSquareText, description: "Чат по сохранённому анализу канала и проекту, без выполнения действий", stage: 12 },
      { to: "/", label: "Панель", icon: LayoutDashboard, description: "Статус ключей, проекты и быстрые действия", stage: 1 },
      { to: "/analysis", label: "Анализ канала", icon: BarChart3, description: "Метрики, вердикт ниши, outlier-темы по своему каналу или конкуренту", stage: 2 },
      { to: "/my-analytics", label: "Моя аналитика", icon: Activity, description: "YouTube Analytics вашего канала: удержание, трафик, прогноз против реальности, уроки", stage: 2 },
    ],
  },
  {
    title: "Исследование",
    collapsible: "research",
    items: [
      { to: "/anomalies", label: "Аномалии", icon: Flame, description: "Небольшие каналы с быстро набравшими просмотры видео — поиск по ключевому слову", stage: 2 },
      { to: "/research", label: "Outliers и обложки", icon: Telescope, description: "Видео, обогнавшие свой канал в разы: Outlier Score, VPH, фильтры, обложки, ремикс", stage: 2 },
      { to: "/keywords", label: "Ключевые слова", icon: KeySquare, description: "Подсказки отдельно от поиска: видимая выборка, публичные счётчики и ручной выбор", stage: 2 },
      { to: "/niches", label: "Похожие каналы", icon: Users, description: "Niche Finder: сравнение каналов по теме, просмотрам и частоте публикаций", stage: 2 },
      { to: "/competitors", label: "Конкуренты", icon: Users, description: "Трекер каналов ниши и тренд-алерты: новые видео, выбросы, всплески", stage: 2 },
      { to: "/transcripts", label: "Транскрипты", icon: ScanText, description: "Субтитры YouTube или файл: краткий разбор и новый сценарий", stage: 2 },
      { to: "/video-scorecard", label: "Разбор видео", icon: ClipboardCheck, description: "Метрики по ссылке, прозрачная база Outlier и локальные проверки оформления", stage: 2 },
      { to: "/comments", label: "Комментарии", icon: MessageSquareText, description: "Что зрители просят, хвалят и ругают: темы, вопросы и возражения для сценария", stage: 2 },
    ],
  },
  {
    title: "Создание контента",
    collapsible: "create",
    items: [
      { to: "/pipeline", label: "Одна кнопка", icon: Workflow, description: "Тема → сценарий → оценка → SEO → обложки → раскадровка → озвучка → видео → Shorts", stage: 3 },
      { to: "/topics", label: "Поиск тем", icon: Lightbulb, description: "Темы с оценкой и доказательствами из реального YouTube", stage: 3 },
      { to: "/script", label: "Сценарист", icon: PenLine, description: "Сценарий под озвучку: нужный объём, хук, CTA, ресёрч", stage: 4 },
      { to: "/voice", label: "Озвучка AnyModel", icon: Mic, description: "Сценарий → MP3 голосом AnyModel (Edge, Fish) или загрузка готовой озвучки в проект", stage: 5 },
      { to: "/seo-audit", label: "SEO-аудит", icon: ClipboardCheck, description: "Локальный контрольный список и отдельный снимок поиска, не SEO-рейтинг", stage: 6 },
      { to: "/seo", label: "SEO", icon: Search, description: "Заголовки, описание, теги и комментарии для закрепа", stage: 6 },
      { to: "/thumbnail", label: "Обложки", icon: Image, description: "3 варианта, Polish Studio, сравнение с конкурентами в ленте", stage: 7 },
      { to: "/storyboard", label: "Раскадровка", icon: Clapperboard, description: "Image- и video-промпты по сценарию", stage: 9 },
      { to: "/audio-storyboard", label: "Из озвучки", icon: AudioLines, description: "Аудио → паузы → текст → сцены с таймкодами и промптами", stage: 9 },
      { to: "/ad-breaks", label: "Рекламные паузы", icon: AudioLines, description: "Локальный план точек между сегментами озвучки, без вставки рекламы", stage: 12 },
      { to: "/video", label: "Видео и Shorts", icon: Film, description: "Черновой ролик из озвучки (Ken Burns, субтитры, музыка) и Shorts из сценария", stage: 9 },
    ],
  },
  {
    title: "Проверка",
    collapsible: "check",
    items: [
      { to: "/check/ai-detector", label: "AI-детектор", icon: ScanText, description: "Насколько текст звучит как написанный AI", stage: 8 },
      { to: "/check/humanizer", label: "Живой голос", icon: AudioLines, description: "Humanizer: убрать признаки ИИ, было → стало, сверка фактов", stage: 8 },
      { to: "/check/script-rater", label: "Оценка сценария", icon: Gauge, description: "Оценка, дуга, триггеры удержания, прогноз кривой", stage: 8 },
      { to: "/check/packaging", label: "Упаковка", icon: Sparkles, description: "Заголовок + обложка → Viral Score и улучшения", stage: 8 },
      { to: "/check/scorecard", label: "Перед публикацией", icon: ClipboardCheck, description: "Заголовок + обложка + хук + SEO → готовность 0–100 и что исправить", stage: 8 },
    ],
  },
  {
    title: "Мои данные",
    items: [
      { to: "/saved", label: "Сохранённые темы", icon: Bookmark, description: "Все сохранённые темы со статусами", stage: 3 },
      { to: "/projects", label: "Проекты", icon: FolderKanban, description: "Тема → сценарий → озвучка → SEO → обложки", stage: 3 },
      { to: "/calendar", label: "Календарь", icon: CalendarDays, description: "План публикаций, лучшее время, напоминания (.ics)", stage: 11 },
      { to: "/voice-profile", label: "Голос канала", icon: Fingerprint, description: "Паспорт стиля по вашим текстам — сценарии звучат как вы", stage: 11 },
    ],
  },
  {
    title: "Система",
    items: [
      { to: "/settings", label: "Настройки", icon: SettingsIcon, description: "Ключи, модели, язык, тема, ставки RPM", stage: 1 },
      { to: "/anymodel", label: "AnyModel", icon: Wallet, description: "Баланс, калькулятор стоимости видео, цены моделей", stage: 12 },
      { to: "/prompts", label: "Промпты", icon: FileCode2, description: "Редактор промптов: версии, сравнение, откат", stage: 11 },
      { to: "/mcp", label: "MCP-подключение", icon: Plug, description: "Чтение выбранных сохранённых данных внешним AI-клиентом", stage: 12 },
      { to: "/extension", label: "Расширение Chrome", icon: Puzzle, description: "Outlier и VPH прямо на YouTube, кнопки «В TubeStudio»", stage: 11 },
      { to: "/help", label: "Справка", icon: LifeBuoy, description: "Как работает каждый раздел — простыми словами, с примерами", stage: 1 },
    ],
  },
];

const existing = ORIGINAL_NAV.flatMap(g=>g.items);
const item = (route:string) => existing.find(i=>i.to===route)!;
// Выпуск 1–2: новые разделы сверху, прежние — под «Ещё».
const STUDIO: NavItem[] = [
 { to: "/channels", label: "Каналы", icon: Users, description: "Профили каналов: ниша, язык, длина, стиль, образцы, голос и бюджет", stage: 1 },
 { to: "/ideas", label: "Идеи для канала", icon: Radar, description: "Радар: маленькие каналы, у которых ролик обогнал канал в разы", stage: 3 },
 { to: "/studio/script", label: "Сценарий", icon: PenLine, description: "Сценарий под профиль канала: проверка кодом и второе мнение", stage: 4 },
 { to: "/studio/voice", label: "Озвучка", icon: Mic, description: "Голос канала через Lumean: оценка, один заказ, файлы в проект", stage: 5 },
 { to: "/studio/visual", label: "Визуал", icon: Clapperboard, description: "Картинки и анимация через G-Labs: сцены по озвучке, промпты в стиле канала, проверка, файлы для монтажа", stage: 6 },
 { to: "/studio/montage", label: "Монтаж", icon: Film, description: "Автомонтаж: проверка файлов перед сборкой ролика", stage: 6 },
];
export const NAV: NavGroup[] = [
 {title:"Студия",collapsible:"studio",items:[item("/"),...STUDIO,item("/projects"),item("/settings")]},
 {title:"Рабочее пространство",collapsible:"workspace",more:true,items:["/saved","/calendar","/coach"].map(item)},
 {title:"Исследование",collapsible:"research",more:true,items:ORIGINAL_NAV[1].items},
 {title:"Сценарий и идеи",collapsible:"writing",more:true,items:[{to:"/donor-workflow",label:"ДНК канала → сценарий",icon:Lightbulb,description:"ДНК подачи донора, пять новых тем или своя идея, исследование и живая драматургия",stage:3},...["/daily-ideas","/topics","/script","/voice-profile"].map(item)]},
 {title:"Производство",collapsible:"production",more:true,items:[{to:"/director",label:"Режиссёрский пакет",icon:Clapperboard,description:"Бриф, персонажи и реквизит, кадры, референсы и экспорт без генерации видео",stage:9},{to:"/styles",label:"Библиотека стилей",icon:Palette,description:"Выбор отрисовки и анимации, свои стили, импорт и экспорт",stage:9},...["/storyboard","/audio-storyboard","/thumbnail","/voice","/video","/pipeline"].map(item)]},
 {title:"Публикация",collapsible:"publishing",more:true,items:["/seo","/seo-audit","/ad-breaks"].map(item)},
 {title:"Проверка",collapsible:"check",more:true,items:ORIGINAL_NAV[3].items},
 {title:"Аналитика и доход",collapsible:"analytics",more:true,items:["/analysis","/my-analytics","/profit"].map(item)},
 {title:"Система",collapsible:"system",more:true,items:ORIGINAL_NAV[5].items.filter(i=>i.to!=="/settings")},
];
export const ALL_ITEMS = NAV.flatMap((g) => g.items);
export const findItem = (to: string) => ALL_ITEMS.find((i) => i.to === to);
