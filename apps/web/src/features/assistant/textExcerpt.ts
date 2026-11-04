/** Local, explicit line-range selection. No truncation and no network. */
export function textExcerpt(source:{name:string;text:string},from:number,to:number){
 if(!/\.(txt|md)$/i.test(source.name)||source.name.length>180||!Number.isSafeInteger(from)||!Number.isSafeInteger(to))throw Error('Неверные имя файла или номера строк.');
 const lines=source.text.split('\n');if(lines.length>100000)throw Error('В файле больше 100 000 строк.');
 if(from<1||to<from||to>lines.length)throw Error('Выберите существующий диапазон строк.');
 const excerpt=lines.slice(from-1,to).join('\n')+(to<lines.length?'\n':'');
 if(!excerpt.trim())throw Error('Выбранный фрагмент пуст.');
 const header='Выбранный диапазон пользовательского файла; происхождение не подтверждено.\n'+JSON.stringify({source:source.name,fromLine:from,toLine:to,totalLines:lines.length,excerptCharacters:excerpt.length})+'\n--- Начало фрагмента ---\n';
 const text=header+excerpt+'\n--- Конец фрагмента ---';
 if(text.length>30000)throw Error('Фрагмент с оформлением превышает 30 000 символов. Выберите меньше строк; текст не обрезан.');
 return {excerpt,text,totalLines:lines.length,characters:text.length};
}
