/** Показ только данных текущего формата; старые ссылки не были проверены этим механизмом. */
export function VoiceProvenance({ value }: { value: unknown }) {
  const p = value as any;
  const valid = p && p.schema === 1 && (p.mode === 'manual' || p.mode === 'project-script') && typeof p.checkedAt === 'string' && typeof p.inputSha256 === 'string' && typeof p.spokenSha256 === 'string';
  const source = valid && p.mode === 'project-script' && p.source && typeof p.source.title === 'string' && typeof p.source.artifactId === 'string' && typeof p.source.sourceSha256 === 'string' && (p.source.match === 'exact' || p.source.match === 'modified') ? p.source : null;
  if (!valid || (p.mode === 'project-script' && !source)) return <p className="text-xs text-muted-foreground">Проверенная связь сценария с этой озвучкой в данном формате не записана.</p>;
  return <div className="space-y-1 text-xs text-muted-foreground" aria-label="Источник озвучки">
    {source ? <p>Источник при запуске: «{source.title}» {typeof source.version === 'number' ? `· v${source.version}` : '· без номера'} · ID {source.artifactId}. {source.match === 'exact' ? 'Введённый текст совпадал с сохранённой версией.' : 'Введённый текст отличался от сохранённой версии.'}</p> : <p>Источник при запуске: ручной текст, без выбранной версии сценария.</p>}
    <p>Это снимок на момент запуска, не проверка готовой речи и не доказательство актуальности сценария.</p>
    <details><summary>Контрольные суммы текста</summary><p className="break-all">Ввод SHA-256: {p.inputSha256}</p><p className="break-all">После очистки SHA-256: {p.spokenSha256}</p>{source && <p className="break-all">Выбранный сценарий SHA-256: {source.sourceSha256}</p>}</details>
  </div>;
}
